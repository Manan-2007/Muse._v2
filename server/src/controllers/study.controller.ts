import type { Request, Response } from 'express'
import { z } from 'zod'

import { env } from '../config/env.js'
import { prisma } from '../models/prisma.js'
import * as assistant from '../services/assistant.service.js'
import * as azure from '../services/azure.service.js'
import * as embeddings from '../services/embeddings.service.js'
import * as explainer from '../services/explainer.service.js'
import * as generate from '../services/generate.service.js'
import * as judge from '../services/judge.service.js'
import * as resources from '../services/resource.service.js'
import * as speech from '../services/speech.service.js'
import { assertMembership } from '../services/room.service.js'
import * as syllabus from '../services/syllabus.service.js'
import { discardUpload, finishUpload } from '../services/upload.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * Everything on the study page that is a request rather than a live event.
 *
 * Which is nearly all of it. A generated set of questions takes seconds to
 * write and is then read for weeks; a document is uploaded once and searched
 * forever. Only the shared timer belongs on the socket, and it lives in
 * `study.gateway.ts` with the rest of the live state.
 */

async function gate(req: Request) {
  const roomId = req.params.id!
  await assertMembership(req.userId!, roomId)
  return roomId
}

/**
 * A subject, confirmed to belong to the room being asked about.
 *
 * Every route below takes a subject id from the client, and membership of the
 * room is not membership of whatever subject id somebody typed. Without this
 * check, a member of any room could read any other room's shelf by guessing an
 * id — the room gate alone would let them through.
 */
async function subjectIn(roomId: string, subjectId: unknown) {
  if (typeof subjectId !== 'string' || !subjectId) {
    throw HttpError.badRequest('Which subject?')
  }
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, roomId } })
  if (!subject) throw HttpError.notFound('That subject is not in this room.')
  return subject
}

/** What this server can actually do, so the UI can disable rather than fail. */
export async function capabilities(req: Request, res: Response) {
  await gate(req)
  res.json({
    ai: azure.configured(),
    /* Independent of `ai`. Chat and embeddings are separate deployments on a
       resource, or separate providers entirely — Azure can write questions
       with no embedding deployment behind it, and a room can search its
       shelf through Gemini with no Azure key at all. */
    search: await embeddings.available(),
    judge: judge.configured(),
    /* Narration rides the same Cognitive Services key as chat, but on a
       different host — so it can be reachable when chat is not, and the UI
       has to be told about them separately. */
    narration: speech.configured(),
    voices: speech.configured() ? [...speech.VOICES] : [],
    judgeLanguages: judge.configured() ? judge.JUDGE_LANGUAGES : [],
    chatModel: azure.configured() ? env.azure.chatDeployment : null,
  })
}

// ─── Subjects ─────────────────────────────────────────────────────────────────

const subjectInput = z.object({
  name: z.string().trim().min(1, 'Give the subject a name').max(120),
  code: z.string().trim().max(40).optional().nullable(),
  blurb: z.string().trim().max(300).optional().nullable(),
})

export async function subjects(req: Request, res: Response) {
  const roomId = await gate(req)

  const rows = await prisma.subject.findMany({
    where: { roomId },
    orderBy: { createdAt: 'asc' },
    include: {
      syllabus: { select: { id: true, title: true } },
      _count: { select: { resources: true, mcqSets: true, notes: true, problems: true } },
    },
  })

  res.json({
    subjects: rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      blurb: row.blurb,
      hasSyllabus: row.syllabus !== null,
      counts: row._count,
    })),
  })
}

export async function createSubject(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = subjectInput.parse(req.body)

  const subject = await prisma.subject.create({
    data: {
      roomId,
      createdById: req.userId!,
      name: input.name,
      code: input.code || null,
      blurb: input.blurb || null,
    },
  })

  res.status(201).json({ subject })
}

export async function deleteSubject(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.params.subjectId)

  /* Files first. The rows cascade, but a deleted subject whose PDFs are still
     on disk is a directory that grows forever with nothing pointing at it. */
  const files = await prisma.resource.findMany({
    where: { subjectId: subject.id },
    select: { id: true },
  })
  for (const file of files) await resources.remove(file.id)

  await prisma.subject.delete({ where: { id: subject.id } })
  res.json({ ok: true })
}

// ─── Resources ────────────────────────────────────────────────────────────────

export async function listResources(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const rows = await prisma.resource.findMany({
    where: { subjectId: subject.id },
    orderBy: { createdAt: 'desc' },
    include: { addedBy: { select: { id: true, name: true } } },
  })

  res.json({
    resources: rows.map((row) => ({
      id: row.id,
      title: row.title,
      mimeType: row.mimeType,
      bytes: row.bytes,
      status: row.status,
      error: row.error,
      chunkCount: row.chunkCount,
      createdAt: row.createdAt,
      addedBy: row.addedBy,
    })),
  })
}

export async function uploadResource(req: Request, res: Response) {
  const file = req.file
  if (!file) throw HttpError.badRequest('No document arrived.')

  /*
   * The bytes have already landed by the time this runs — multer streams the
   * body before the handler is reached — so every rejection from here on has
   * to take the file with it. Left behind, it is an orphan on disk that
   * nothing references and nothing will ever clean up.
   */
  let roomId: string
  let subject: { id: string }
  try {
    roomId = await gate(req)
    subject = await subjectIn(roomId, req.body?.subjectId)
  } catch (cause) {
    await discardUpload(req, file)
    throw cause
  }

  const stored = await finishUpload(req, file)
  const title = (req.body?.title as string | undefined)?.trim() || file.originalname || stored
  const canEmbed = await embeddings.available()

  const resource = await prisma.resource.create({
    data: {
      roomId,
      subjectId: subject.id,
      addedById: req.userId!,
      title: title.slice(0, 200),
      file: stored,
      mimeType: file.mimetype,
      bytes: file.size,
      status: canEmbed ? 'pending' : 'failed',
      /* Without a provider there is nothing to embed with, and a document
         stuck at "pending" forever would look like a bug rather than a
         missing key. */
      error: canEmbed
        ? null
        : 'No embedding provider is configured on this server, so documents cannot be made searchable.',
    },
  })

  if (canEmbed) resources.ingestInBackground(resource.id)

  res.status(201).json({ resource })
}

export async function deleteResource(req: Request, res: Response) {
  const roomId = await gate(req)
  const resource = await prisma.resource.findFirst({
    where: { id: req.params.resourceId!, roomId },
  })
  if (!resource) throw HttpError.notFound('That document is not here.')

  await resources.remove(resource.id)
  res.json({ ok: true })
}

/** Try again on a document that failed — a rate limit is worth one retry. */
export async function retryResource(req: Request, res: Response) {
  const roomId = await gate(req)
  const resource = await prisma.resource.findFirst({
    where: { id: req.params.resourceId!, roomId },
  })
  if (!resource) throw HttpError.notFound('That document is not here.')
  if (!(await embeddings.available())) {
    throw HttpError.unavailable('No embedding provider is configured on this server.')
  }

  await prisma.resource.update({
    where: { id: resource.id },
    data: { status: 'pending', error: null },
  })
  resources.ingestInBackground(resource.id)
  res.json({ ok: true })
}

// ─── Syllabus ─────────────────────────────────────────────────────────────────

export async function getSyllabus(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const row = await prisma.syllabus.findUnique({ where: { subjectId: subject.id } })
  if (!row) {
    res.json({ syllabus: null })
    return
  }

  res.json({
    syllabus: {
      ...syllabus.parseOutline(row),
      id: row.id,
      resourceId: row.resourceId,
      createdAt: row.createdAt,
    },
  })
}

/**
 * Read an uploaded handout into an outline.
 *
 * Takes a resource that is already on the shelf rather than its own upload —
 * a syllabus is a document like any other and should be searchable too, so it
 * goes through the normal shelf and is then read a second time for structure.
 */
export async function readSyllabus(req: Request, res: Response) {
  const roomId = await gate(req)
  const resourceId = req.body?.resourceId
  if (typeof resourceId !== 'string') throw HttpError.badRequest('Which document?')

  const resource = await prisma.resource.findFirst({ where: { id: resourceId, roomId } })
  if (!resource) throw HttpError.notFound('That document is not here.')

  const saved = await syllabus.readResource(resource.id)
  res.status(201).json({
    syllabus: {
      ...saved.outline,
      id: saved.id,
      resourceId: saved.resourceId,
      createdAt: saved.createdAt,
    },
  })
}

/** Topics the syllabus lists that nothing has been generated about yet. */
export async function nextUp(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)
  res.json({ suggestions: await generate.suggestions(subject.id) })
}

// ─── Questions ────────────────────────────────────────────────────────────────

/**
 * Keep only the ids that really belong to this subject and can be searched.
 *
 * A resource still processing has no chunks yet, so asking to draw from it
 * would silently ground nothing — dropping it here means the caller falls
 * back to the whole shelf instead of getting an empty answer.
 */
async function pickable(subjectId: string, ids: string[] | undefined) {
  if (!ids?.length) return undefined
  const rows = await prisma.resource.findMany({
    where: { id: { in: ids }, subjectId, status: 'ready' },
    select: { id: true },
  })
  return rows.length > 0 ? rows.map((row) => row.id) : undefined
}

/*
 * A topic, unless the documents already are the topic.
 *
 * Naming documents is itself an instruction — "from these two handouts" says
 * what to write about as completely as a phrase does, and demanding both is
 * asking somebody to summarise what they just pointed at. With nothing picked
 * there is no such instruction, and a generator given neither would be writing
 * about a whole subject at once, which is not a request anything answers well.
 *
 * Checked here as well as in the browser: the field going optional is a UI
 * affordance, but "one or the other" is a rule about what can actually be
 * generated.
 */
const NEEDS_SUBJECT_MATTER = 'Name a topic, or pick the documents to write from.'

const hasSubjectMatter = (value: { topic: string; resourceIds?: string[] }) =>
  value.topic.length > 0 || (value.resourceIds?.length ?? 0) > 0

const mcqInput = z.object({
  subjectId: z.string(),
  topic: z.string().trim().max(300).default(''),
  /* Which documents to draw on. Absent means everything on the shelf, which
     is what almost everybody wants; naming them is for "just from these
     slides". Validated against the subject rather than trusted, so an id from
     another room cannot be read through this. */
  resourceIds: z.array(z.string()).max(50).optional(),
  count: z.number().int().min(1).max(20).default(8),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
}).refine(hasSubjectMatter, { message: NEEDS_SUBJECT_MATTER, path: ['topic'] })

export async function listMcq(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const rows = await prisma.mcqSet.findMany({
    where: { subjectId: subject.id },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { questions: true } },
      attempts: {
        where: { userId: req.userId!, completedAt: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { score: true, total: true, completedAt: true },
      },
    },
  })

  res.json({
    sets: rows.map((row) => ({
      id: row.id,
      title: row.title,
      topic: row.topic,
      difficulty: row.difficulty,
      grounded: row.grounded,
      sources: JSON.parse(row.sources) as string[],
      questionCount: row._count.questions,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      lastAttempt: row.attempts[0] ?? null,
    })),
  })
}

export async function createMcq(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = mcqInput.parse(req.body)
  const subject = await subjectIn(roomId, input.subjectId)

  const written = await generate.mcq({
    subjectId: subject.id,
    topic: input.topic,
    count: input.count,
    difficulty: input.difficulty,
    resourceIds: await pickable(subject.id, input.resourceIds),
  })

  const set = await prisma.mcqSet.create({
    data: {
      roomId,
      subjectId: subject.id,
      createdById: req.userId!,
      title: written.title,
      topic: input.topic,
      difficulty: input.difficulty,
      grounded: written.grounding.grounded,
      sources: JSON.stringify(written.grounding.sources),
      questions: {
        create: written.questions.map((question, index) => ({
          prompt: question.prompt,
          options: JSON.stringify(question.options),
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          position: index,
        })),
      },
    },
    include: { _count: { select: { questions: true } } },
  })

  res.status(201).json({
    set: {
      id: set.id,
      title: set.title,
      topic: set.topic,
      difficulty: set.difficulty,
      grounded: set.grounded,
      sources: written.grounding.sources,
      questionCount: set._count.questions,
      createdAt: set.createdAt,
    },
  })
}

/**
 * A set to attempt, plus wherever the person had got to in it.
 *
 * The correct answer and the explanation are withheld until a question is
 * actually answered. They live in the same row as the question, so a client
 * that received the row would have the answers sitting in its network tab —
 * filtering here is the only place it can be done.
 *
 * The attempt comes back with it because a quiz that reveals as it goes has
 * state worth losing: reload halfway through and without this you would be
 * looking at four blank options you have already answered.
 */
export async function getMcq(req: Request, res: Response) {
  const roomId = await gate(req)
  const set = await prisma.mcqSet.findFirst({
    where: { id: req.params.setId!, roomId },
    include: { questions: { orderBy: { position: 'asc' } } },
  })
  if (!set) throw HttpError.notFound('That set is not here.')

  const attempt = await latestAttempt(set.id, req.userId!)

  res.json({
    set: {
      id: set.id,
      title: set.title,
      topic: set.topic,
      difficulty: set.difficulty,
      grounded: set.grounded,
      sources: JSON.parse(set.sources) as string[],
      questions: set.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: JSON.parse(question.options) as string[],
      })),
    },
    attempt: attempt ? shapeAttempt(attempt, set.questions.length) : null,
  })
}

type AttemptRow = {
  id: string
  completedAt: Date | null
  answers: {
    chosenIndex: number
    correct: boolean
    questionId: string
    question: { correctIndex: number; explanation: string }
  }[]
}

function latestAttempt(setId: string, userId: string) {
  return prisma.mcqAttempt.findFirst({
    where: { setId, userId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      completedAt: true,
      answers: {
        select: {
          chosenIndex: true,
          correct: true,
          questionId: true,
          question: { select: { correctIndex: true, explanation: true } },
        },
      },
    },
  })
}

/* Answered questions carry their answer and explanation, because answering is
   what reveals them. Unanswered ones are simply absent. */
function shapeAttempt(attempt: AttemptRow, total: number) {
  const revealed = attempt.answers.map((answer) => ({
    questionId: answer.questionId,
    chosenIndex: answer.chosenIndex,
    correctIndex: answer.question.correctIndex,
    explanation: answer.question.explanation,
    correct: answer.correct,
  }))

  return {
    id: attempt.id,
    revealed,
    score: revealed.filter((entry) => entry.correct).length,
    answered: revealed.length,
    total,
    completed: attempt.completedAt !== null,
  }
}

const answerInput = z.object({
  /* Absent starts a new attempt. That is also how a retake works — there is
     no separate endpoint for beginning again, because beginning again is just
     the first answer of the next attempt. */
  attemptId: z.string().nullable().default(null),
  questionId: z.string(),
  chosenIndex: z.number().int().min(0).max(9),
})

/**
 * Answer one question, and get back what it was.
 *
 * Marked here rather than in the browser, and not because anybody would cheat
 * on their own revision — because the score is what the progress page counts,
 * and a number the client computed and posted is a number the client can be
 * wrong about.
 *
 * Answering is deliberately once-only per question: the reply contains the
 * correct index, so accepting a second answer would let a wrong one be walked
 * back into a right one after the fact. A repeat returns the original answer
 * unchanged rather than an error, so a double-tap or a retried request is
 * harmless.
 */
export async function answerMcq(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = answerInput.parse(req.body)

  const set = await prisma.mcqSet.findFirst({
    where: { id: req.params.setId!, roomId },
    include: { questions: { orderBy: { position: 'asc' } } },
  })
  if (!set) throw HttpError.notFound('That set is not here.')

  const question = set.questions.find((entry) => entry.id === input.questionId)
  if (!question) throw HttpError.notFound('That question is not in this set.')

  let attemptId = input.attemptId
  if (attemptId) {
    const owned = await prisma.mcqAttempt.findFirst({
      where: { id: attemptId, setId: set.id, userId: req.userId! },
      select: { id: true },
    })
    if (!owned) throw HttpError.notFound('That attempt is not here.')
  } else {
    const started = await prisma.mcqAttempt.create({
      data: { setId: set.id, userId: req.userId!, total: set.questions.length },
      select: { id: true },
    })
    attemptId = started.id
  }

  const existing = await prisma.mcqAnswer.findUnique({
    where: { attemptId_questionId: { attemptId, questionId: question.id } },
    select: { id: true },
  })

  if (!existing) {
    await prisma.mcqAnswer.create({
      data: {
        attemptId,
        questionId: question.id,
        chosenIndex: input.chosenIndex,
        correct: input.chosenIndex === question.correctIndex,
      },
    })
  }

  const attempt = await latestAttempt(set.id, req.userId!)
  const shaped = shapeAttempt(attempt!, set.questions.length)

  /* The last answer closes the attempt. The score is written onto the row
     here rather than counted from the answers every time the progress page
     loads — the answers are still the record, this is the summary of them. */
  if (shaped.answered >= set.questions.length && !shaped.completed) {
    await prisma.mcqAttempt.update({
      where: { id: attemptId },
      data: { completedAt: new Date(), score: shaped.score, total: set.questions.length },
    })
    shaped.completed = true
  }

  res.json({ attempt: shaped })
}

export async function deleteMcq(req: Request, res: Response) {
  const roomId = await gate(req)
  const set = await prisma.mcqSet.findFirst({ where: { id: req.params.setId!, roomId } })
  if (!set) throw HttpError.notFound('That set is not here.')
  await prisma.mcqSet.delete({ where: { id: set.id } })
  res.json({ ok: true })
}

// ─── Notes ────────────────────────────────────────────────────────────────────

const notesInput = z.object({
  subjectId: z.string(),
  topic: z.string().trim().max(300).default(''),
  /* Which documents to draw on. Absent means everything on the shelf, which
     is what almost everybody wants; naming them is for "just from these
     slides". Validated against the subject rather than trusted, so an id from
     another room cannot be read through this. */
  resourceIds: z.array(z.string()).max(50).optional(),
  depth: z.enum(['brief', 'standard', 'thorough']).default('standard'),
}).refine(hasSubjectMatter, { message: NEEDS_SUBJECT_MATTER, path: ['topic'] })

export async function listNotes(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const rows = await prisma.note.findMany({
    where: { subjectId: subject.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      topic: true,
      grounded: true,
      sources: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  })

  res.json({
    notes: rows.map((row) => ({ ...row, sources: JSON.parse(row.sources) as string[] })),
  })
}

export async function getNote(req: Request, res: Response) {
  const roomId = await gate(req)
  const note = await prisma.note.findFirst({
    where: { id: req.params.noteId!, roomId },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!note) throw HttpError.notFound('Those notes are not here.')
  res.json({ note: { ...note, sources: JSON.parse(note.sources) as string[] } })
}

export async function createNote(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = notesInput.parse(req.body)
  const subject = await subjectIn(roomId, input.subjectId)

  const written = await generate.notes({
    subjectId: subject.id,
    topic: input.topic,
    depth: input.depth,
    resourceIds: await pickable(subject.id, input.resourceIds),
  })

  const note = await prisma.note.create({
    data: {
      roomId,
      subjectId: subject.id,
      createdById: req.userId!,
      title: written.title,
      topic: input.topic,
      content: written.content,
      grounded: written.grounding.grounded,
      sources: JSON.stringify(written.grounding.sources),
    },
  })

  res.status(201).json({ note: { ...note, sources: written.grounding.sources } })
}

export async function deleteNote(req: Request, res: Response) {
  const roomId = await gate(req)
  const note = await prisma.note.findFirst({ where: { id: req.params.noteId!, roomId } })
  if (!note) throw HttpError.notFound('Those notes are not here.')
  await prisma.note.delete({ where: { id: note.id } })
  res.json({ ok: true })
}

// ─── Coding ───────────────────────────────────────────────────────────────────

const codingInput = z.object({
  subjectId: z.string(),
  topic: z.string().trim().max(300).default(''),
  /* Which documents to draw on. Absent means everything on the shelf, which
     is what almost everybody wants; naming them is for "just from these
     slides". Validated against the subject rather than trusted, so an id from
     another room cannot be read through this. */
  resourceIds: z.array(z.string()).max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
}).refine(hasSubjectMatter, { message: NEEDS_SUBJECT_MATTER, path: ['topic'] })

export async function listProblems(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const rows = await prisma.codingProblem.findMany({
    where: { subjectId: subject.id },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      submissions: {
        where: { userId: req.userId! },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, passedCount: true, totalCount: true },
      },
    },
  })

  res.json({
    problems: rows.map((row) => ({
      id: row.id,
      title: row.title,
      difficulty: row.difficulty,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      lastSubmission: row.submissions[0] ?? null,
    })),
  })
}

export async function createProblem(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = codingInput.parse(req.body)
  const subject = await subjectIn(roomId, input.subjectId)

  const written = await generate.coding({
    subjectId: subject.id,
    topic: input.topic,
    difficulty: input.difficulty,
    resourceIds: await pickable(subject.id, input.resourceIds),
  })

  const problem = await prisma.codingProblem.create({
    data: {
      roomId,
      subjectId: subject.id,
      createdById: req.userId!,
      title: written.title,
      description: written.description,
      difficulty: written.difficulty,
      languages: JSON.stringify(Object.keys(written.starters)),
      starters: JSON.stringify(written.starters),
      testCases: {
        create: written.cases.map((testCase, index) => ({
          input: testCase.input,
          expected: testCase.expected,
          hidden: testCase.hidden,
          position: index,
        })),
      },
    },
  })

  res.status(201).json({
    problem: { id: problem.id, title: problem.title, difficulty: problem.difficulty },
  })
}

/**
 * One problem, with the hidden cases stripped.
 *
 * The filter is here and nowhere else. A hidden case that reaches the browser
 * is not hidden — it is one devtools panel away from being the answer key,
 * and no amount of client-side care changes that.
 */
export async function getProblem(req: Request, res: Response) {
  const roomId = await gate(req)
  const problem = await prisma.codingProblem.findFirst({
    where: { id: req.params.problemId!, roomId },
    include: { testCases: { orderBy: { position: 'asc' } } },
  })
  if (!problem) throw HttpError.notFound('That problem is not here.')

  res.json({
    problem: {
      id: problem.id,
      title: problem.title,
      description: problem.description,
      difficulty: problem.difficulty,
      languages: JSON.parse(problem.languages) as string[],
      starters: JSON.parse(problem.starters) as Record<string, string>,
      samples: problem.testCases
        .filter((testCase) => !testCase.hidden)
        .map((testCase) => ({ input: testCase.input, expected: testCase.expected })),
      hiddenCount: problem.testCases.filter((testCase) => testCase.hidden).length,
    },
  })
}

const submitInput = z.object({
  language: z.string().min(1),
  code: z.string().min(1, 'There is nothing to run.'),
  /** Sample cases only — the "Run" button, as distinct from "Submit". */
  samplesOnly: z.boolean().default(false),
})

export async function submitProblem(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = submitInput.parse(req.body)

  const problem = await prisma.codingProblem.findFirst({
    where: { id: req.params.problemId!, roomId },
    include: { testCases: { orderBy: { position: 'asc' } } },
  })
  if (!problem) throw HttpError.notFound('That problem is not here.')

  const cases = input.samplesOnly
    ? problem.testCases.filter((testCase) => !testCase.hidden)
    : problem.testCases

  const verdict = await judge.run({
    language: input.language,
    code: input.code,
    cases: cases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
      hidden: testCase.hidden,
    })),
  })

  /* A sample run is a check, not an attempt — recording it would make the
     progress page count every experiment as a failed submission. */
  if (!input.samplesOnly) {
    await prisma.codingSubmission.create({
      data: {
        problemId: problem.id,
        userId: req.userId!,
        language: input.language,
        code: input.code,
        status: verdict.status,
        passedCount: verdict.passedCount,
        totalCount: verdict.totalCount,
        detail: verdict.detail,
      },
    })
  }

  res.json({ verdict })
}

const reviewInput = z.object({
  language: z.string().min(1),
  code: z.string().min(1, 'There is nothing to review.').max(60_000),
  verdict: z.object({
    status: z.string(),
    passedCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
    detail: z.string().nullable().default(null),
    shown: z
      .object({
        input: z.string(),
        expected: z.string(),
        got: z.string(),
        passed: z.boolean(),
      })
      .nullable()
      .default(null),
  }),
})

/**
 * Remarks on a submission that has already been run.
 *
 * The verdict is posted back rather than looked up, because a sample run is
 * deliberately not recorded — pressing Run and then asking what went wrong is
 * the most ordinary thing anybody does here, and it would be strange for that
 * to be the one case with nothing to review.
 *
 * Trusting the client's copy of the verdict is fine: the worst a forged one
 * can do is make the review discuss a failure that did not happen, to the
 * person who forged it.
 */
export async function reviewSubmission(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = reviewInput.parse(req.body)

  const problem = await prisma.codingProblem.findFirst({
    where: { id: req.params.problemId!, roomId },
    select: { title: true, description: true },
  })
  if (!problem) throw HttpError.notFound('That problem is not here.')

  res.json({
    remarks: await generate.review({
      title: problem.title,
      description: problem.description,
      language: input.language,
      code: input.code,
      verdict: input.verdict,
    }),
  })
}

/**
 * Check an existing problem's cases, and throw away the ones that are wrong.
 *
 * Cases are verified when a problem is generated, but that check did not
 * always exist, and every problem written before it has cases nobody ever
 * ran. They fail in a particular and confusing way: the examples on the page
 * are fine, so the code looks right, and then a submission dies on a hidden
 * case that declares a hundred rows and supplies none. The student goes
 * looking for a bug in a program that does not have one.
 *
 * This is the repair. Same reference-solution check the generator does, run
 * against what is already stored.
 */
export async function recheckProblem(req: Request, res: Response) {
  const roomId = await gate(req)

  const problem = await prisma.codingProblem.findFirst({
    where: { id: req.params.problemId!, roomId },
    include: { testCases: { orderBy: { position: 'asc' } } },
  })
  if (!problem) throw HttpError.notFound('That problem is not here.')
  if (!judge.configured()) {
    throw HttpError.unavailable('There is no judge configured, so the cases cannot be checked.')
  }

  const kept = await generate.verifyCases(
    `${problem.title}\n\n${problem.description}`,
    /* The hidden flag goes with them: `verifyCases` uses the visible cases as
       its yardstick for whether to believe its own reference solution. */
    problem.testCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
      hidden: testCase.hidden,
    })),
  )

  /* Matched on content rather than on index — `verifyCases` returns a subset
     in the same order, and identifying survivors by what they contain is what
     makes that assumption unnecessary. */
  const survivors = new Set(kept.map((entry) => `${entry.input}\u0000${entry.expected}`))
  const doomed = problem.testCases.filter(
    (testCase) => !survivors.has(`${testCase.input}\u0000${testCase.expected}`),
  )

  if (doomed.length > 0) {
    await prisma.codingTestCase.deleteMany({
      where: { id: { in: doomed.map((testCase) => testCase.id) } },
    })
  }

  res.json({
    removed: doomed.length,
    remaining: problem.testCases.length - doomed.length,
  })
}

export async function deleteProblem(req: Request, res: Response) {
  const roomId = await gate(req)
  const problem = await prisma.codingProblem.findFirst({
    where: { id: req.params.problemId!, roomId },
  })
  if (!problem) throw HttpError.notFound('That problem is not here.')
  await prisma.codingProblem.delete({ where: { id: problem.id } })
  res.json({ ok: true })
}

// ─── Explainers ───────────────────────────────────────────────────────────────

const explainerInput = z.object({
  subjectId: z.string(),
  topic: z.string().trim().max(300).default(''),
  /* The student's own description of how they want to be taught. Free text on
     purpose: a menu of "beginner / intermediate / advanced" cannot express "I
     keep losing marks on the derivation, go slowly there". */
  style: z.string().trim().max(1000).default(''),
  voice: z.string().trim().max(80).optional(),
  /* Which documents to teach from. Absent means the whole shelf. Validated
     against the subject rather than trusted, so an id from another room
     cannot be read through this. */
  resourceIds: z.array(z.string()).max(50).optional(),
}).refine(hasSubjectMatter, { message: NEEDS_SUBJECT_MATTER, path: ['topic'] })

function shapeExplainer(row: {
  id: string
  title: string
  topic: string
  style: string
  voice: string
  beats: string
  duration: number
  grounded: boolean
  sources: string
  status: string
  error: string | null
  createdAt: Date
  createdBy?: { id: string; name: string }
}, withBeats: boolean) {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    style: row.style,
    voice: row.voice,
    duration: row.duration,
    grounded: row.grounded,
    sources: JSON.parse(row.sources) as string[],
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    /* The list does not carry beats. A dozen lessons of eighteen beats each
       is a large response nobody on that screen reads. */
    ...(withBeats ? { beats: JSON.parse(row.beats) as unknown[] } : {}),
  }
}

export async function listExplainers(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)

  const rows = await prisma.explainer.findMany({
    where: { subjectId: subject.id },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  })

  res.json({ explainers: rows.map((row) => shapeExplainer(row, false)) })
}

export async function getExplainer(req: Request, res: Response) {
  const roomId = await gate(req)
  const row = await prisma.explainer.findFirst({
    where: { id: req.params.explainerId!, roomId },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!row) throw HttpError.notFound('That lesson is not here.')
  res.json({ explainer: shapeExplainer(row, true) })
}

/**
 * Start building a lesson.
 *
 * Returns as soon as the row exists. Writing the script is one large
 * completion and narrating it is a few dozen more round trips — minutes, in
 * total, which is not a request anybody should be holding open. The row
 * carries its own status and the client watches it, exactly as an uploaded
 * document does.
 */
export async function createExplainer(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = explainerInput.parse(req.body)
  const subject = await subjectIn(roomId, input.subjectId)

  if (!azure.configured()) {
    throw HttpError.unavailable('No AI key is configured on this server, so lessons cannot be written.')
  }
  if (!speech.configured()) {
    throw HttpError.unavailable('Narration is not configured on this server, so lessons cannot be voiced.')
  }

  const voice = input.voice && speech.isVoice(input.voice) ? input.voice : speech.DEFAULT_VOICE

  const row = await prisma.explainer.create({
    data: {
      roomId,
      subjectId: subject.id,
      createdById: req.userId!,
      /* A placeholder until the script names it. Shown in the list while it
         builds, so the row is not a blank line for two minutes — which is
         also why it cannot be the empty topic somebody is allowed to leave
         blank when they picked the documents instead. */
      title: input.topic || 'Lesson from the chosen documents',
      topic: input.topic,
      style: input.style,
      /* Kept so a retry draws on the same documents. A retry that quietly
         widened to the whole shelf would be a different lesson wearing the
         same row. */
      resources: JSON.stringify((await pickable(subject.id, input.resourceIds)) ?? []),
      voice,
      status: 'pending',
    },
    include: { createdBy: { select: { id: true, name: true } } },
  })

  void explainer.buildInBackground(row.id)

  res.status(201).json({ explainer: shapeExplainer(row, false) })
}

/**
 * Try a failed lesson again.
 *
 * Its own endpoint rather than "delete it and type it all in again", because
 * the failure this exists for is almost never the request's fault — a tunnel
 * that dropped, a rate limit, a laptop that slept mid-narration. Making
 * somebody re-describe how they wanted to be taught in order to retry a
 * network blip is a charge for someone else's connection.
 */
export async function retryExplainer(req: Request, res: Response) {
  const roomId = await gate(req)
  const row = await prisma.explainer.findFirst({
    where: { id: req.params.explainerId!, roomId },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  if (!row) throw HttpError.notFound('That lesson is not here.')

  /* Only a lesson that stopped. Retrying one that is mid-build would put two
     writers on the same row and the same folder of clips. */
  if (row.status !== 'failed') {
    throw HttpError.badRequest('That lesson is not in a failed state.')
  }

  if (!azure.configured()) {
    throw HttpError.unavailable('No AI key is configured on this server, so lessons cannot be written.')
  }
  if (!speech.configured()) {
    throw HttpError.unavailable('Narration is not configured on this server, so lessons cannot be voiced.')
  }

  const queued = await prisma.explainer.update({
    where: { id: row.id },
    data: { status: 'pending', error: null },
    include: { createdBy: { select: { id: true, name: true } } },
  })

  void explainer.retryInBackground(row.id)

  res.json({ explainer: shapeExplainer(queued, false) })
}

export async function deleteExplainer(req: Request, res: Response) {
  const roomId = await gate(req)
  const row = await prisma.explainer.findFirst({
    where: { id: req.params.explainerId!, roomId },
    select: { id: true },
  })
  if (!row) throw HttpError.notFound('That lesson is not here.')

  await explainer.discardAudio(row.id)
  await prisma.explainer.delete({ where: { id: row.id } })
  res.json({ ok: true })
}

// ─── Progress ─────────────────────────────────────────────────────────────────

/**
 * What has actually been done, per subject.
 *
 * Counted on request rather than kept in a summary table. These are a handful
 * of grouped queries over a few hundred rows; a cached total would be a second
 * source of truth to keep correct in exchange for nothing measurable.
 */
export async function progress(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)
  const userId = req.userId!

  const [attempts, notes, problems, submissions, resourceRows] = await Promise.all([
    /* Every attempt that got at least one answer into it, counted from the
       answers rather than the summary on the row — an abandoned half of a
       quiz is still ten questions somebody answered, and dropping it would
       make the accuracy here disagree with what they remember doing. */
    prisma.mcqAttempt.findMany({
      where: { userId, set: { subjectId: subject.id }, answers: { some: {} } },
      select: {
        completedAt: true,
        set: { select: { topic: true } },
        answers: { select: { correct: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
    prisma.note.count({ where: { subjectId: subject.id } }),
    prisma.codingProblem.count({ where: { subjectId: subject.id } }),
    prisma.codingSubmission.findMany({
      where: { userId, problem: { subjectId: subject.id } },
      select: { status: true, problemId: true },
    }),
    prisma.resource.groupBy({
      by: ['status'],
      where: { subjectId: subject.id },
      _count: true,
    }),
  ])

  const answered = attempts.reduce((sum, attempt) => sum + attempt.answers.length, 0)
  const correct = attempts.reduce(
    (sum, attempt) => sum + attempt.answers.filter((answer) => answer.correct).length,
    0,
  )

  /* Weakest topics by accuracy, not by count — three wrong out of four is a
     worse signal than ten wrong out of forty, and a list ordered by volume
     would put the topic being revised most at the top. */
  const byTopic = new Map<string, { correct: number; total: number }>()
  for (const attempt of attempts) {
    const topic = attempt.set.topic
    const entry = byTopic.get(topic) ?? { correct: 0, total: 0 }
    entry.correct += attempt.answers.filter((answer) => answer.correct).length
    entry.total += attempt.answers.length
    byTopic.set(topic, entry)
  }

  const weakest = [...byTopic]
    .filter(([, entry]) => entry.total >= 3)
    .map(([topic, entry]) => ({ topic, accuracy: entry.correct / entry.total, asked: entry.total }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5)

  const solved = new Set(
    submissions.filter((entry) => entry.status === 'passed').map((entry) => entry.problemId),
  ).size

  res.json({
    progress: {
      quiz: {
        attempts: attempts.length,
        answered,
        correct,
        accuracy: answered > 0 ? correct / answered : null,
        weakest,
      },
      notes,
      coding: { problems, solved, submissions: submissions.length },
      resources: Object.fromEntries(resourceRows.map((row) => [row.status, row._count])),
      suggestions: await generate.suggestions(subject.id),
    },
  })
}

// ─── Assistant ────────────────────────────────────────────────────────────────

const askInput = z.object({
  subjectId: z.string(),
  message: z.string().trim().min(1, 'Ask something').max(4000),
  mode: z.enum(['explain', 'hint', 'coding', 'ask']).default('ask'),
  /* The thing on screen, sent verbatim rather than by id — see the note on
     `Focus` in the service for why the text itself is what gets passed. */
  focus: z
    .object({
      kind: z.enum(['note', 'question', 'problem']),
      title: z.string().max(300),
      body: z.string().max(20_000),
    })
    .nullable()
    .default(null),
})

export async function assistantHistory(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)
  res.json({ messages: await assistant.history(roomId, req.userId!, subject.id) })
}

export async function assistantAsk(req: Request, res: Response) {
  const roomId = await gate(req)
  const input = askInput.parse(req.body)
  const subject = await subjectIn(roomId, input.subjectId)

  const reply = await assistant.ask({
    roomId,
    userId: req.userId!,
    subjectId: subject.id,
    mode: input.mode,
    message: input.message,
    focus: input.focus,
  })

  res.json({ reply })
}

export async function assistantClear(req: Request, res: Response) {
  const roomId = await gate(req)
  const subject = await subjectIn(roomId, req.query.subjectId)
  await assistant.clear(roomId, req.userId!, subject.id)
  res.json({ ok: true })
}
