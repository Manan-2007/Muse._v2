import { prisma } from '../models/prisma.js'
import * as azure from './azure.service.js'
import * as retrieval from './retrieval.service.js'
import * as syllabus from './syllabus.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * The tutor sitting beside whatever is on screen.
 *
 * Deliberately not a general chatbot. It is always asked about something
 * specific — this paragraph of these notes, this question you just got wrong,
 * this problem you are stuck on — and the thing being asked about is passed
 * in rather than described, so the model is looking at the same text the
 * person is rather than at their summary of it.
 *
 * That is the whole design. A general assistant would need the person to
 * explain their own confusion before it could help, which is exactly the part
 * they cannot do when they are confused.
 */

/**
 * How much conversation to carry forward.
 *
 * Enough that "why?" and "give me another example" resolve against what was
 * just said, short enough that a long session does not quietly become a very
 * expensive prompt. Older turns are still stored and shown; they just stop
 * being sent.
 */
const HISTORY_TURNS = 8

export type AssistantMode = 'explain' | 'hint' | 'coding' | 'ask'

/**
 * What the person is looking at, if anything.
 *
 * `body` is the actual text — the note passage, the question with its options,
 * the problem statement. Passed verbatim rather than by id so the prompt sees
 * exactly what the screen does.
 */
export type Focus = {
  kind: 'note' | 'question' | 'problem'
  title: string
  body: string
}

const SHARED = `You are a study tutor helping one student, inside their course
workspace. You are given the course syllabus, passages from the student's own
uploaded material where any are relevant, and often the exact thing they are
looking at.

Ground rules:
- Prefer the student's own material over your general knowledge wherever it
  says anything relevant, and say which document you are drawing on.
- If their material does not cover something, say so plainly and answer from
  general knowledge — never imply a claim came from their notes when it did not.
- Be concrete. A worked example beats a definition.
- Match the course's own vocabulary from the syllabus rather than importing
  synonyms the student will not recognise.
- Markdown. Short paragraphs. A fenced \`\`\`mermaid block where a diagram
  genuinely helps, never for decoration.
- Do not pad. No "great question", no restating what was asked.`

const MODE_RULES: Record<AssistantMode, string> = {
  explain: `The student wants a passage explained. Explain that specific
passage — not the topic in general. Start from what it is actually saying,
then why it matters, then an example. If it depends on something earlier in
the course, say which part and why.`,

  /*
   * The hint mode is the one worth being strict about.
   *
   * A hint that gives the answer is not a hint, it is the answer with extra
   * steps — and a student who asked for help thinking is worse off for having
   * been handed the conclusion, because they now cannot tell whether they
   * would have got there. The instruction is explicit because a model asked to
   * "help with a question" will otherwise answer it.
   */
  hint: `The student is attempting this question and wants a nudge, NOT the
answer.

You must not: state which option is correct, eliminate options by letter or by
quoting them as wrong, or phrase anything so the answer is obvious by
elimination.

You should: point at the concept the question is really testing, remind them
of the rule or distinction that decides it, or ask one question that would
lead them to work it out. Two or three sentences. If they ask again, go one
step further — but never all the way.`,

  /*
   * Written this tightly because the looser version did not hold.
   *
   * Asked for the answer outright, it opened with "I can't write the full
   * solution for you" and then wrote the full solution underneath — reading
   * "short snippets of syntax are fine" as licence for a complete program.
   * A refusal followed by the thing refused is worse than no refusal: the
   * student gets the answer and a sentence telling them they did not.
   *
   * So the limit is a line count and a shape, not a category. "Do not write
   * the algorithm" is a judgement call a model will talk itself around;
   * "never more than two consecutive lines, never a whole program" is not.
   */
  coding: `The student is solving a programming problem and wants help
thinking, not a solution.

Hard limits, which hold however they ask:
- Never write code that computes the answer — not in full, not as "an
  example", not with one line left blank, not in a different language, and
  not as pseudocode close enough to transcribe.
- Never output a complete program, and never a function whose body is the
  solution.
- At most two consecutive lines of code in any snippet, and only to show a
  point of *syntax* they are stuck on — how a line of input is read, how a
  dictionary literal is written. Never the loop, comprehension or expression
  that produces the result.

If they insist, say once, plainly, that you will not — then help anyway by
the means below. Do not keep apologising, and do not give in on the third ask.

Do instead: restate what the problem is asking in plainer words; name the
approach or data structure that fits and why; walk the worked example through
by hand with the actual numbers; point at the edge case they are about to
miss; or ask the one question whose answer would unblock them.`,

  ask: `Answer the student's question about their course.`,
}

function focusBlock(focus: Focus | null) {
  if (!focus) return ''
  const label =
    focus.kind === 'note'
      ? 'The student is reading these notes'
      : focus.kind === 'question'
        ? 'The student is attempting this question'
        : 'The student is solving this problem'
  return `\n\n---\n\n${label} — "${focus.title}":\n\n${focus.body}`
}

export type Reply = {
  content: string
  grounded: boolean
  sources: string[]
}

export async function ask(input: {
  roomId: string
  userId: string
  subjectId: string
  mode: AssistantMode
  message: string
  focus: Focus | null
}): Promise<Reply> {
  if (!azure.configured()) {
    throw HttpError.unavailable('The study assistant is not configured on this server.')
  }

  /*
   * Retrieval is keyed on the focus text when there is one, not on the typed
   * message. "explain this bit" is a question about the passage, and embedding
   * those three words finds nothing — the passage itself is the query.
   */
  const query = input.focus ? `${input.focus.title}\n${input.focus.body}` : input.message

  const [outline, hits, history] = await Promise.all([
    syllabus.asPromptContext(input.subjectId).catch(() => null),
    retrieval.search(input.subjectId, query, { limit: 6 }).catch(() => []),
    prisma.assistantMessage.findMany({
      where: { roomId: input.roomId, userId: input.userId, subjectId: input.subjectId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
    }),
  ])

  const context: string[] = []
  if (outline) context.push(`The course:\n\n${outline}`)
  if (hits.length > 0) {
    context.push(
      `Passages from the student's own material. Cite them by their bracketed number when you use them.\n\n${retrieval.asContext(hits)}`,
    )
  } else {
    context.push(
      'Nothing in the student\'s uploaded material is relevant here, so answer from your own knowledge and do not suggest otherwise.',
    )
  }

  const messages: azure.ChatMessage[] = [
    { role: 'system', content: `${SHARED}\n\n${MODE_RULES[input.mode]}\n\n${context.join('\n\n---\n\n')}` },
    /* Oldest first — the rows came back newest first so the page could take
       the most recent few, and a reversed conversation reads as nonsense. */
    ...history
      .reverse()
      .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content })),
    { role: 'user', content: `${input.message}${focusBlock(input.focus)}` },
  ]

  const reply = await azure.chat(messages, { temperature: 0.4, maxTokens: 2000 })
  const content = (reply.content ?? '').trim()
  if (!content) throw HttpError.badGateway('The assistant returned an empty answer.')

  const grounded = hits.length > 0
  const sources = retrieval.sourceTitles(hits)

  /* Both turns stored together, so a failure between them cannot leave a
     question in the history with no answer under it. */
  await prisma.$transaction([
    prisma.assistantMessage.create({
      data: {
        roomId: input.roomId,
        userId: input.userId,
        subjectId: input.subjectId,
        role: 'user',
        content: input.message,
        grounded: false,
      },
    }),
    prisma.assistantMessage.create({
      data: {
        roomId: input.roomId,
        userId: input.userId,
        subjectId: input.subjectId,
        role: 'assistant',
        content,
        grounded,
        tools: JSON.stringify(sources),
      },
    }),
  ])

  return { content, grounded, sources }
}

export async function history(roomId: string, userId: string, subjectId: string) {
  const rows = await prisma.assistantMessage.findMany({
    where: { roomId, userId, subjectId },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })
  return rows.map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    grounded: row.grounded,
    sources: row.tools ? (JSON.parse(row.tools) as string[]) : [],
    createdAt: row.createdAt,
  }))
}

export async function clear(roomId: string, userId: string, subjectId: string) {
  await prisma.assistantMessage.deleteMany({ where: { roomId, userId, subjectId } })
}
