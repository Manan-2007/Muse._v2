import { prisma } from '../models/prisma.js'
import * as azure from './azure.service.js'
import { extract } from './extract.service.js'
import { filePath } from './resource.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * Reading a course handout and understanding what the course covers.
 *
 * This is the piece that makes everything else in Study know what it is
 * talking about. A generator asked for "ten questions on unit two" has no idea
 * what unit two is; a generator handed the syllabus does — the unit's name,
 * the topics under it, and how much of the course it is worth.
 *
 * Read once, on demand, and stored. A handout does not change during a term,
 * and re-reading it before every generation would be a paid call and several
 * seconds each time to arrive at the same answer.
 */

export type SyllabusUnit = {
  name: string
  /** Percent of the course, when the handout states one. */
  weightage: number | null
  /** Lectures or hours, when stated. */
  lectures: number | null
  topics: string[]
}

export type SyllabusOutline = {
  title: string
  code: string | null
  units: SyllabusUnit[]
  outcomes: string[]
}

/**
 * How much of the document to show the model.
 *
 * A course handout is short — the one this was built against is seven pages
 * and 17,000 characters. Sending the whole thing beats retrieving from it,
 * because the structure being read *is* the document's shape, and chunks
 * pulled out by similarity would arrive with that shape destroyed. The cap
 * exists only so a mis-uploaded textbook cannot become a 400-page prompt.
 */
const MAX_CHARS = 60_000

const SYSTEM = `You read university course handouts and extract their structure.

You are given the text of one course handout, syllabus, or course plan. Return
what the course actually covers, as JSON matching exactly this shape:

{
  "title": "the course's name as the document states it",
  "code": "the course code, or null if there is none",
  "units": [
    {
      "name": "the unit or module name",
      "weightage": 45,
      "lectures": 42,
      "topics": ["one topic per entry", "as the handout lists them"]
    }
  ],
  "outcomes": ["stated learning outcomes, one per entry"]
}

Rules:
- Use the document's own wording for topics. Do not invent, merge, rename, or
  helpfully expand them. If it says "Box Model, Flexbox, Grid" those are three
  topics, exactly as written.
- weightage is a number of percent, or null if the handout does not say.
- lectures is a count, or null if the handout does not say.
- If the handout has no unit breakdown, return a single unit named after the
  course with every topic under it.
- outcomes is [] if none are listed. Never fill it with your own guesses about
  what a student should learn.
- Return only the JSON object.`

/**
 * Read a handout into an outline.
 *
 * Exported on its own so the assistant can offer the same thing for a document
 * already on the shelf, rather than only at upload time.
 */
export async function read(text: string): Promise<SyllabusOutline> {
  const body = text.slice(0, MAX_CHARS)
  if (!body.trim()) throw HttpError.badRequest('There is no text in that document to read.')

  const parsed = await azure.chatJson<Partial<SyllabusOutline>>(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: body },
    ],
    /* Low, because this is extraction, not writing. The same handout should
       read the same way twice, and a warmer setting starts paraphrasing topic
       names — which is precisely the thing the prompt forbids. */
    { temperature: 0.1, maxTokens: 4000 },
  )

  const units: SyllabusUnit[] = Array.isArray(parsed.units)
    ? parsed.units
        .map((unit) => ({
          name: typeof unit?.name === 'string' ? unit.name.trim() : '',
          weightage: typeof unit?.weightage === 'number' ? unit.weightage : null,
          lectures: typeof unit?.lectures === 'number' ? unit.lectures : null,
          topics: Array.isArray(unit?.topics)
            ? unit.topics.filter((topic): topic is string => typeof topic === 'string' && topic.trim() !== '')
            : [],
        }))
        .filter((unit) => unit.name !== '')
    : []

  if (units.length === 0) {
    throw HttpError.badGateway(
      "That document did not read as a syllabus — no units or topics could be found in it.",
    )
  }

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Untitled course',
    code: typeof parsed.code === 'string' && parsed.code.trim() ? parsed.code.trim() : null,
    units,
    outcomes: Array.isArray(parsed.outcomes)
      ? parsed.outcomes.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      : [],
  }
}

/**
 * Read a resource already on the shelf, and attach the result to its subject.
 *
 * Replaces whatever was there. A second handout is a correction or a newer
 * term's version, not an addition — two syllabuses for one subject would leave
 * every generator having to guess which one is current.
 */
export async function readResource(resourceId: string) {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } })
  if (!resource) throw HttpError.notFound('That document is not here.')

  const extracted = await extract(filePath(resource.file), resource.mimeType)
  const outline = await read(extracted.text)

  const saved = await prisma.syllabus.upsert({
    where: { subjectId: resource.subjectId },
    create: {
      subjectId: resource.subjectId,
      resourceId: resource.id,
      title: outline.title,
      units: JSON.stringify(outline.units),
      outcomes: JSON.stringify(outline.outcomes),
      source: extracted.text.slice(0, MAX_CHARS),
    },
    update: {
      resourceId: resource.id,
      title: outline.title,
      units: JSON.stringify(outline.units),
      outcomes: JSON.stringify(outline.outcomes),
      source: extracted.text.slice(0, MAX_CHARS),
    },
  })

  /* A subject named "Untitled" before a handout arrived should take the
     course's real name from it — but one somebody deliberately named is left
     alone, because their name for it is the one they recognise. */
  const subject = await prisma.subject.findUnique({ where: { id: resource.subjectId } })
  if (subject && (!subject.code || subject.name.trim().toLowerCase() === 'untitled')) {
    await prisma.subject.update({
      where: { id: subject.id },
      data: { code: subject.code ?? outline.code, name: subject.name, blurb: subject.blurb ?? outline.title },
    })
  }

  return { ...saved, outline }
}

export function parseOutline(row: { title: string; units: string; outcomes: string }): SyllabusOutline {
  const safe = <T>(json: string, fallback: T): T => {
    try {
      return JSON.parse(json) as T
    } catch {
      return fallback
    }
  }
  return {
    title: row.title,
    code: null,
    units: safe<SyllabusUnit[]>(row.units, []),
    outcomes: safe<string[]>(row.outcomes, []),
  }
}

/**
 * The syllabus as a line or two for a prompt.
 *
 * Every generator gets this when the subject has one, so a request for "unit
 * two" or "the hooks topic" resolves to what the course actually means by it
 * rather than to whatever the model assumes those words usually mean.
 */
export async function asPromptContext(subjectId: string): Promise<string | null> {
  const row = await prisma.syllabus.findUnique({ where: { subjectId } })
  if (!row) return null

  const outline = parseOutline(row)
  const units = outline.units
    .map((unit, index) => {
      const weight = unit.weightage != null ? ` (${unit.weightage}%)` : ''
      return `Unit ${index + 1}: ${unit.name}${weight}\n  ${unit.topics.join('; ')}`
    })
    .join('\n')

  const outcomes = outline.outcomes.length
    ? `\n\nStated outcomes:\n${outline.outcomes.map((entry) => `- ${entry}`).join('\n')}`
    : ''

  return `Course: ${outline.title}\n\n${units}${outcomes}`
}

/**
 * Which uploaded document the syllabus was read out of, if it is still there.
 *
 * Used to keep the handout out of content retrieval — see the note in
 * `generate.gather` for why an index makes such poor material. Null when the
 * outline was read from a file since deleted, which is fine: there are then
 * no chunks of it to exclude either.
 */
export async function sourceResourceId(subjectId: string) {
  const row = await prisma.syllabus.findUnique({
    where: { subjectId },
    select: { resourceId: true },
  })
  return row?.resourceId ?? null
}
