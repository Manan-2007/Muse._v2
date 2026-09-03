import { prisma } from '../models/prisma.js'
import * as azure from './azure.service.js'
import * as judge from './judge.service.js'
import * as retrieval from './retrieval.service.js'
import * as syllabus from './syllabus.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * Everything the study page writes for you.
 *
 * Three generators — questions, notes, coding problems — that differ in what
 * they produce and agree on everything else, so the parts they agree on live
 * here once: find what the course says about this topic, find what the shelf
 * says about it, and tell the model plainly which of the two it is working
 * from.
 *
 * That last part is the one worth being careful about. A set of questions
 * written from a model's general knowledge is a perfectly good set of
 * questions — but it is not the same thing as one drawn from the room's own
 * documents, and a page that quietly implies otherwise is teaching somebody
 * the wrong syllabus with total confidence. So `grounded` is recorded from
 * what actually happened, never assumed.
 */

export type Grounding = {
  hits: retrieval.Hit[]
  /** The syllabus outline as prompt text, when the subject has one. */
  outline: string | null
  grounded: boolean
  sources: string[]
}

/**
 * Gather what is known about a topic before writing anything about it.
 *
 * Both halves are optional and independent: a subject can have a syllabus and
 * no documents (the handout is uploaded first, which is the normal order), or
 * documents and no syllabus.
 *
 * The two halves do different jobs, which is why the syllabus is kept out of
 * the second one. A course handout is an index: it names every topic in the
 * course and says almost nothing about any of them. That makes its passages
 * score well against any topic query — it does literally contain the word —
 * while carrying course codes, outcome-mapping tables and enrolment links
 * instead of anything to learn from.
 *
 * Measured on a real handout: a search for "Flexbox" returned one passage
 * from the lecture notes and seven from the syllabus — a coupon code, a
 * PO/CLO table, a list of project titles. All of it then went to the model
 * under "prefer these over your general knowledge", which is worse than
 * having retrieved nothing at all.
 *
 * So the outline goes in as the outline, and the passages come from
 * everything else. Unless there is nothing else, in which case the handout is
 * all the room has, and this course's own thin words beat writing from
 * nowhere.
 */
export async function gather(
  subjectId: string,
  topic: string,
  options: { only?: string[]; limit?: number } = {},
): Promise<Grounding> {
  const [outline, syllabusResourceId] = await Promise.all([
    syllabus.asPromptContext(subjectId).catch(() => null),
    syllabus.sourceResourceId(subjectId).catch(() => null),
  ])

  /* A document chosen by hand is never second-guessed. Somebody who picked
     the handout on purpose is asking for the handout. */
  const picked = options.only?.length ? options.only : null
  const exclude = !picked && syllabusResourceId ? [syllabusResourceId] : []

  /*
   * No topic, but documents were named: read them rather than search them.
   *
   * "Write notes from these two handouts" has nothing to rank passages by,
   * and searching for the empty string embeds to a direction that means
   * nothing — it would return an order that looks deliberate and is not.
   */
  let hits = !topic.trim() && picked
    ? await retrieval
        .passagesFrom(subjectId, picked, options.limit ?? 8)
        .catch(() => [] as retrieval.Hit[])
    : await retrieval
        .search(subjectId, topic, { limit: options.limit ?? 8, only: picked ?? undefined, exclude })
        .catch(() => [] as retrieval.Hit[])

  /*
   * Fall back to the handout only when it is the whole shelf.
   *
   * Not when nothing matched — that is the opposite case. A subject with real
   * lecture notes that say nothing about this topic should report exactly
   * that, and reaching for the syllabus instead fills the prompt with the
   * course codes and enrolment links this function just finished excluding,
   * under a badge claiming the answer came from the student's own material.
   */
  if (hits.length === 0 && exclude.length > 0) {
    const others = await prisma.resource.count({
      where: { subjectId, status: 'ready', id: { notIn: exclude } },
    })
    if (others === 0) {
        hits = await retrieval.search(subjectId, topic, { limit: options.limit ?? 8 }).catch(() => [])
    }
  }

  return {
    hits,
    outline,
    grounded: hits.length > 0,
    sources: retrieval.sourceTitles(hits),
  }
}

/**
 * How to name the subject matter in a prompt when nobody typed one.
 *
 * "Write 8 questions on: " is a broken sentence, and a model handed one
 * invents a topic to fill the gap. When documents were chosen instead, the
 * honest instruction is to cover what those documents actually say — the
 * passages are already in the prompt above this line, so it has everything it
 * needs without a phrase standing in for them.
 */
export function subjectMatter(topic: string, grounding: Grounding) {
  const named = topic.trim()
  if (named) return named
  const sources = grounding.sources.length
    ? grounding.sources.join(', ')
    : 'the material above'
  return `whatever the following material covers — ${sources}. Work from the passages above rather than picking one narrow theme, and cover the ground they actually set out.`
}

/**
 * The shared preamble: what course this is, and what the shelf says.
 *
 * Exported because the explainer scripts are grounded the same way, and two
 * copies of this would be two chances for them to drift apart on which of
 * the syllabus and the material is authoritative.
 */
export function promptContext(grounding: Grounding) {
  const parts: string[] = []

  if (grounding.outline) {
    parts.push(
      `This is the course being studied — its syllabus, which is what the student is examined on. Use it to decide what belongs in the answer and what does not, and use its own words for topic names. It is an index, not the material: never quote it as though it explained anything.\n\n${grounding.outline}`,
    )
  }

  if (grounding.hits.length > 0) {
    parts.push(
      `These passages are the course material itself — the student's own lecture notes, slides and readings. This is what to write from: follow their definitions, their notation and their worked examples in preference to your own wherever they say anything relevant, and cite them by their bracketed number when you use them.\n\n${retrieval.asContext(grounding.hits)}`,
    )
  } else {
    parts.push(
      'The student has uploaded nothing relevant to this topic, so write from your own knowledge. Do not claim or imply that anything came from their material.',
    )
  }

  return parts.join('\n\n---\n\n')
}

// ─── Questions ────────────────────────────────────────────────────────────────

export type GeneratedMcq = {
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string
}

const MCQ_SYSTEM = `You write multiple-choice questions for a university student revising a course.

Return JSON of exactly this shape:
{ "title": "a short name for this set",
  "questions": [ { "prompt": "...", "options": ["...","...","...","..."],
                   "correctIndex": 0, "explanation": "why that answer is right" } ] }

Rules:
- Exactly four options per question, exactly one correct.
- Wrong options must be plausible to somebody who half-knows the material.
  "None of the above" and obviously silly options teach nothing.
- Test understanding, not recall of a sentence's wording.
- The explanation says why the right answer is right, and where useful why a
  tempting wrong one is wrong. Two or three sentences.
- Vary what you ask about across the set rather than circling one idea.
- Return only the JSON object.`

export async function mcq(input: {
  subjectId: string
  topic: string
  /** Draw only from these documents. Empty means the whole shelf. */
  resourceIds?: string[]
  count: number
  difficulty: string
}): Promise<{ title: string; questions: GeneratedMcq[]; grounding: Grounding }> {
  const grounding = await gather(input.subjectId, input.topic, { only: input.resourceIds })

  const parsed = await azure.chatJson<{ title?: string; questions?: unknown[] }>(
    [
      { role: 'system', content: MCQ_SYSTEM },
      {
        role: 'user',
        content: `${promptContext(grounding)}\n\n---\n\nWrite ${input.count} ${input.difficulty} questions on: ${subjectMatter(input.topic, grounding)}`,
      },
    ],
    { temperature: 0.6, maxTokens: 6000 },
  )

  const questions: GeneratedMcq[] = []
  for (const raw of parsed.questions ?? []) {
    const q = raw as Partial<GeneratedMcq>
    const options = Array.isArray(q.options)
      ? q.options.filter((entry): entry is string => typeof entry === 'string')
      : []
    /*
     * Dropped rather than repaired.
     *
     * A question with three options, or an answer index pointing past the end,
     * cannot be shown or marked — and guessing at what was meant would mean
     * marking somebody wrong on a question this made up. One short set beats a
     * set with a broken question in it.
     */
    if (typeof q.prompt !== 'string' || !q.prompt.trim()) continue
    if (options.length !== 4) continue
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) continue

    questions.push({
      prompt: q.prompt.trim(),
      options,
      correctIndex: q.correctIndex,
      explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '',
    })
  }

  if (questions.length === 0) {
    throw HttpError.badGateway('The model did not return any usable questions. Try again.')
  }

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : input.topic,
    questions,
    grounding,
  }
}

// ─── Notes ────────────────────────────────────────────────────────────────────

const NOTES_SYSTEM = `You write study notes a student will actually revise from.

Return JSON of exactly this shape:
{ "title": "a short name for these notes", "content": "the notes, as Markdown" }

NOTES ARE READ, NOT WATCHED
There is a narrated lesson generator alongside this one, drawing on the same
material, and the two must not produce the same artefact. A lesson is spoken:
its screen holds a diagram while a voice does the explaining, so its on-screen
text is deliberately sparse. Notes have no voice. Everything the reader needs
has to be on the page, in sentences that stand on their own at one in the
morning with nobody to ask.

So: be complete where the lesson is selective. Cover every part of the topic
rather than the two or three worth narrating. Define terms in full the first
time. Write the explanation out — the reasoning, the boundary case, the worked
example with its numbers — rather than gesturing at it. A heading with three
fragments under it is a slide, and a slide is the other generator's job.

The notes must also be genuinely visual, not a wall of prose:
- Structure with headings, and keep paragraphs short.
- Use a Markdown table wherever you are comparing things, listing properties,
  or setting out anything with more than one dimension.
- Use a fenced \`\`\`mermaid block wherever a picture helps — a flowchart for a
  process, a graph for how ideas relate, a sequence diagram for an exchange
  over time, a mindmap for a topic's shape. Prefer \`flowchart TD\`, keep it
  simple, and put EVERY node label in double quotes: A["List (I)"], never
  A[List (I)]. This is Mermaid, not Graphviz — the first line is flowchart TD
  or graph TD, never digraph, and edges are --> and never ->. An unquoted bracket or parenthesis inside a label is a parse
  error, and a diagram that does not parse shows the reader its own source
  code where the picture should be.
- Do not draw a diagram for its own sake. A diagram of three bullet points is
  worse than three bullet points.
- Bold the terms a student is expected to know.
- Where something is easy to get wrong, say so under a "Common mistakes"
  heading.
- End with a short "In one line" summary of the whole topic.

Return only the JSON object.`

export async function notes(input: {
  subjectId: string
  topic: string
  /** Draw only from these documents. Empty means the whole shelf. */
  resourceIds?: string[]
  depth: string
}): Promise<{ title: string; content: string; grounding: Grounding }> {
  const grounding = await gather(input.subjectId, input.topic, { only: input.resourceIds })

  const parsed = await azure.chatJson<{ title?: string; content?: string }>(
    [
      { role: 'system', content: NOTES_SYSTEM },
      {
        role: 'user',
        content: `${promptContext(grounding)}\n\n---\n\nWrite ${input.depth} notes on: ${subjectMatter(input.topic, grounding)}`,
      },
    ],
    { temperature: 0.5, maxTokens: 8000 },
  )

  const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''
  if (!content) throw HttpError.badGateway('The model returned empty notes. Try again.')

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : input.topic,
    content,
    grounding,
  }
}

// ─── Coding problems ──────────────────────────────────────────────────────────

export type GeneratedCase = { input: string; expected: string; hidden: boolean }

const CODING_SYSTEM = `You write programming problems in the style of a competitive-programming site.

Return JSON of exactly this shape:
{ "title": "...",
  "description": "the problem, as Markdown",
  "difficulty": "easy" | "medium" | "hard",
  "starters": { "python": "...", "javascript": "...", "java": "...", "cpp": "..." },
  "cases": [ { "input": "...", "expected": "...", "hidden": false } ] }

Rules:
- The description states the problem, the input format, the output format, the
  constraints, and two worked examples with their explanations. Markdown.
- Solutions read from standard input and write to standard output. Say exactly
  what the input looks like and exactly what should be printed, because the
  answer is checked by comparing output text.
- \`input\` is what goes on stdin; \`expected\` is the exact stdout, no trailing
  blank line.

- Every case must be written out in full. If the format says a header line of
  \`n\` followed by \`n\` lines, then all \`n\` lines are present in \`input\`.
  Never abbreviate, never elide with "...", and never write a header for rows
  you are not going to supply — a case whose input is incomplete has no
  correct output, so whatever you put in \`expected\` is invented.

- That constrains how large "large" can be. A case you cannot write out
  completely is one you must not use: pick the largest input you can actually
  enumerate — a few dozen lines — rather than claiming a maximum you would
  have to fake. Testing that a solution is fast enough is not this format's
  job.

- Compute each \`expected\` from the \`input\` you just wrote, by hand, digit by
  digit. Do not pattern-match it from a neighbouring case.
- Give 3 visible cases (hidden: false) and 6 to 8 hidden ones (hidden: true).

- The hidden cases are where the marking actually happens, so they are a
  checklist, not filler. Work through these and include every one that means
  anything for this problem:
    * the smallest input the constraints allow — n = 1, an empty collection,
      a single character;
    * the largest the constraints allow, or close to it, so a solution that
      is too slow or overflows is caught;
    * negative numbers and zero, wherever the constraints permit them;
    * every element identical, and every element distinct;
    * already-sorted and reverse-sorted input, if order can matter;
    * the boundary itself — exactly at a limit, exactly one either side;
    * the answer being absent, empty, or zero, so a solution that always
      finds something is caught.
  Then add one case for each way a plausible-but-wrong solution fails: the
  off-by-one, the unhandled tie, the assumption that input is sorted, the
  greedy choice that is locally right and globally wrong.

- The visible cases stay ordinary. They are there to show the format and let
  somebody check they have understood the question, and burying an edge case
  in them turns "read the examples" into a trap.
- Starter code declares nothing but the reading and writing scaffold, with a
  clearly marked place to write the solution. Never include the solution.
- Return only the JSON object.`

/**
 * Throw away the cases a reference solution disagrees with.
 *
 * Generated test cases are the part of this feature most able to be quietly
 * wrong. A model writing ten cases by hand will, sooner or later, write a
 * header for rows it never supplies and then invent the answer — and a
 * fabricated case is worse than a missing one, because it fails a correct
 * submission and sends somebody looking for a bug they do not have.
 *
 * So the cases are checked the only way that actually settles it: write a
 * solution, run it against them, and believe the run.
 *
 * The reference can be wrong too, which is why disagreement alone is not
 * enough to delete anything. If it fails most of them, the reference is the
 * broken one and everything is kept; only when it agrees with a clear
 * majority is it trusted to condemn the rest. Without a judge, nothing here
 * can be checked and everything is kept — unverified, and not pretending
 * otherwise.
 */
const MAX_VERIFIED = 12

/**
 * How much of the reference has to be right before it is allowed to condemn
 * a case.
 *
 * The visible cases are the yardstick, not a percentage of the whole. They
 * are the worked examples printed in the problem statement — the ones a human
 * reads, checks by hand, and would notice were wrong — so a reference that
 * reproduces every one of them is almost certainly correct, and anything it
 * then disagrees with is the disagreement's fault.
 *
 * A share of all cases was the first rule here and it was the wrong one. On
 * the problem that prompted this, three of six cases were fabricated: the
 * reference agreed with exactly half, fell under a 60% bar, and was thrown
 * out as broken — leaving every bad case in place. The proportion of cases
 * that are wrong is precisely what is unknown, so it cannot be the thing the
 * test depends on.
 *
 * With no visible case to check against there is no yardstick, and a bare
 * majority is the most that can be claimed.
 */
const FALLBACK_AGREEMENT = 0.6

export async function verifyCases(
  statement: string,
  cases: { input: string; expected: string; hidden?: boolean }[],
) {
  if (!judge.configured()) return cases

  /* Bounded because every case is a round trip to the judge, and a problem
     with more than a dozen is not made better by a slower generation. */
  const subject = cases.slice(0, MAX_VERIFIED)

  /* Where the split is already decided, the visible ones are the yardstick.
     Where it is not — during generation, before this function's own result
     decides it — the model's leading cases are its examples, and those are
     the same rows. */
  const vetted = subject.some((entry) => entry.hidden !== undefined)
    ? subject.map((entry, index) => (entry.hidden === false ? index : -1)).filter((i) => i >= 0)
    : subject.slice(0, 3).map((_, index) => index)

  const isTrusted = (results: boolean[]) =>
    vetted.length > 0
      ? vetted.every((index) => results[index])
      : results.filter(Boolean).length >= Math.ceil(subject.length * FALLBACK_AGREEMENT)

  async function writeReference(previous?: { code: string; failed: number[] }) {
    try {
      const written = await azure.chat(
        [
          {
            role: 'system',
            content: `Write a correct Python 3 solution. It reads from standard input and writes to standard output. Output only the program — no markdown fence, no commentary, no explanation.`,
          },
          {
            role: 'user',
            content:
              `Problem: ${statement}\n\nIt must turn each of these inputs into exactly its output:\n\n${subject
                .map((c, i) => `Case ${i + 1}\nstdin:\n${c.input}\nstdout:\n${c.expected}`)
                .join('\n\n')}` +
              (previous
                ? `\n\nYour previous attempt did not produce the stated output for case${
                    previous.failed.length === 1 ? '' : 's'
                  } ${previous.failed.map((i) => i + 1).join(', ')}. Read those cases again and write a version that handles them. If one of those cases looks impossible — its input does not contain the data the problem says it will — still write the solution the problem describes, and let that case fail.\n\nPrevious attempt:\n${previous.code}`
                : ''),
          },
        ],
        { temperature: 0, maxTokens: 1200 },
      )
      return (written.content ?? '').replace(/^```[a-z]*\n?|```$/gm, '').trim()
    } catch {
      return ''
    }
  }

  /*
   * Two attempts at a reference, not one.
   *
   * This used to give up the moment the first reference disagreed with a
   * visible case, and "give up" meant returning every case unchecked —
   * including any that were malformed. So whether a broken case survived came
   * down to whether one model call got the problem right first time, which is
   * a coin flip, and a lost toss ships a test nobody's code can pass.
   *
   * A second attempt is told which cases it missed, and told explicitly that a
   * case whose input does not contain what the problem promises is allowed to
   * fail — otherwise the obliging thing for it to do is contort the solution
   * until the broken case passes, which is how a bad case gets ratified
   * instead of caught.
   */
  let results: boolean[] | null = null
  let solution = await writeReference()

  for (let attempt = 0; attempt < 2 && solution; attempt += 1) {
    const run = await judge.check({ language: 'python', code: solution, cases: subject })
    if (!run) return cases
    if (isTrusted(run)) {
      results = run
      break
    }
    if (attempt === 0) {
      const failed = run.map((ok, index) => (ok ? -1 : index)).filter((i) => i >= 0)
      solution = await writeReference({ code: solution, failed })
    }
  }

  /* Both references disagreed with cases the problem itself presents as
     correct. That is a statement about this function's confidence, not about
     the cases, so nothing is removed on it. */
  if (!results) return cases

  const kept = cases.filter((_, index) => index >= subject.length || results[index])
  /* Never strip a problem down to nothing on the word of one program. */
  return kept.length > 0 ? kept : cases
}

export async function coding(input: {
  subjectId: string
  topic: string
  /** Draw only from these documents. Empty means the whole shelf. */
  resourceIds?: string[]
  difficulty: string
}): Promise<{
  title: string
  description: string
  difficulty: string
  starters: Record<string, string>
  cases: GeneratedCase[]
  grounding: Grounding
}> {
  const grounding = await gather(input.subjectId, input.topic, { only: input.resourceIds })

  const parsed = await azure.chatJson<{
    title?: string
    description?: string
    difficulty?: string
    starters?: Record<string, string>
    cases?: unknown[]
  }>(
    [
      { role: 'system', content: CODING_SYSTEM },
      {
        role: 'user',
        content: `${promptContext(grounding)}\n\n---\n\nWrite one ${input.difficulty} problem on: ${subjectMatter(input.topic, grounding)}`,
      },
    ],
    { temperature: 0.7, maxTokens: 8000 },
  )

  /*
   * The split is decided here, not taken from the model.
   *
   * Asked for three visible and the rest hidden, it has cheerfully returned
   * one hidden case and marked the two largest as examples — which puts the
   * hardest input on the page as the thing to read first, and leaves almost
   * nothing behind to mark against. Ordering is the model's to choose; which
   * end of that order is visible is not.
   */
  const seen = new Set<string>()
  const collected: { input: string; expected: string }[] = []
  for (const raw of parsed.cases ?? []) {
    const c = raw as Partial<GeneratedCase>
    if (typeof c.input !== 'string' || typeof c.expected !== 'string') continue
    /* An empty input or an empty expected output is not a test, and a
       duplicate is a test already being run. */
    if (!c.input.trim() || !c.expected.trim()) continue
    const key = `${c.input}\u0000${c.expected}`
    if (seen.has(key)) continue
    seen.add(key)
    collected.push({ input: c.input, expected: c.expected })
  }

  /*
   * A problem with nothing to show is not usable.
   *
   * Hidden cases alone would mean submitting blind — no way to check your
   * understanding of the format before spending an attempt on it.
   */
  if (collected.length === 0) {
    throw HttpError.badGateway('The model returned no usable test cases. Try again.')
  }

  const checked = await verifyCases(
    `${typeof parsed.title === 'string' ? parsed.title : input.topic}\n\n${
      typeof parsed.description === 'string' ? parsed.description : ''
    }`,
    collected,
  )

  const VISIBLE = 3
  const cases: GeneratedCase[] = checked.map((entry, index) => ({
    ...entry,
    /* The last case stays visible when that is all there is, so a problem
       never arrives with nothing to read. */
    hidden: checked.length > 1 && index >= Math.min(VISIBLE, checked.length - 1),
  }))

  const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
  if (!description) throw HttpError.badGateway('The model returned an empty problem. Try again.')

  const starters: Record<string, string> = {}
  for (const [language, code] of Object.entries(parsed.starters ?? {})) {
    if (typeof code === 'string' && code.trim()) starters[language] = code
  }

  return {
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : input.topic,
    description,
    difficulty: ['easy', 'medium', 'hard'].includes(parsed.difficulty ?? '')
      ? (parsed.difficulty as string)
      : input.difficulty,
    starters,
    cases,
    grounding,
  }
}

/**
 * What a subject's syllabus suggests studying next.
 *
 * Not a generator — it reads the outline that is already stored and the
 * attempts already recorded, and says which topics have had least attention.
 * No model call, because none is needed: the syllabus lists the topics and the
 * database knows which have been asked about.
 */
export async function suggestions(subjectId: string) {
  const row = await prisma.syllabus.findUnique({ where: { subjectId } })
  if (!row) return []

  const outline = syllabus.parseOutline(row)
  const [sets, notes_] = await Promise.all([
    prisma.mcqSet.findMany({ where: { subjectId }, select: { topic: true } }),
    prisma.note.findMany({ where: { subjectId }, select: { topic: true } }),
  ])

  const touched = new Set(
    [...sets, ...notes_].map((entry) => entry.topic.toLowerCase().trim()),
  )

  const untouched: { unit: string; topic: string; weightage: number | null }[] = []
  for (const unit of outline.units) {
    for (const topic of unit.topics) {
      if (touched.has(topic.toLowerCase().trim())) continue
      untouched.push({ unit: unit.name, topic, weightage: unit.weightage })
    }
  }

  /* Heaviest units first — the syllabus already says what the course thinks
     matters most, and that is a better order than the one they happen to be
     listed in. */
  untouched.sort((a, b) => (b.weightage ?? 0) - (a.weightage ?? 0))
  return untouched.slice(0, 12)
}

/**
 * Remarks on a submission, once it has actually been run.
 *
 * Deliberately after the judge rather than instead of it. A model asked "is
 * this right?" guesses, and guesses confidently; a model asked "it failed on
 * this input with this output, what would you look at" is reading a fact. So
 * the verdict goes in the prompt and the review is written around it.
 *
 * The restraint is the same one the tutor's coding mode has, for the same
 * reason: a review that ends in the corrected program is not a review, it is
 * the answer with commentary attached, and it costs the student the one part
 * that was going to teach them something.
 */
const REVIEW_SYSTEM = `You are reviewing one student's submission to a
programming exercise, just after it was run against real test cases.

You are given the problem, their code, and what the judge actually reported.

Hard limits, which hold however they ask:
- Never write the corrected program, or the corrected function, or the line
  that fixes it. Describe what is wrong and where; let them write it.
- At most two consecutive lines of code in any snippet, and only to show a
  point of syntax. Never the logic that solves the problem.

What to write, in this order, skipping anything that does not apply:

1. If it failed or errored: what the evidence points at. Reason from the
   input, the expected output and what it actually printed — say which of the
   three disagree and what kind of mistake produces that shape of difference.
   Name the line if you can see it. Do not guess past the evidence.
2. If it passed: say so in one line, then what would still be worth changing.
3. Correctness risks the tests did not catch — the empty case, the single
   element, the negative number, integer overflow, an off-by-one at a
   boundary. Only ones that genuinely apply to this code.
4. Complexity, if it is worse than it needs to be. Give the current and the
   achievable, briefly, and name the idea — not the implementation.
5. Readability and idiom, last and briefly: what a reviewer on their team
   would flag. Skip entirely if the code is already clean.

Markdown. Short. Use "###" headings only if there is more than one section
worth having. No preamble, no praise, no restating the problem back at them.
Three or four points is a good review; twelve is a wall nobody reads.`

export async function review(input: {
  title: string
  description: string
  language: string
  code: string
  verdict: {
    status: string
    passedCount: number
    totalCount: number
    detail: string | null
    shown: { input: string; expected: string; got: string; passed: boolean } | null
  }
}) {
  const { verdict } = input

  /* The judge's own words, not a summary of them. "Expected 6 15, got 9 18"
     is the whole of what the model needs to reason from, and paraphrasing it
     is how a review ends up addressing a failure that did not happen. */
  const failing = verdict.shown && !verdict.shown.passed ? verdict.shown : null

  const outcome =
    verdict.status === 'passed'
      ? `It passed all ${verdict.totalCount} cases.`
      : failing
        ? `It passed ${verdict.passedCount} of ${verdict.totalCount} cases, then failed on:\n\nInput:\n${failing.input}\n\nExpected:\n${failing.expected}\n\nActually printed:\n${failing.got}`
        : `It passed ${verdict.passedCount} of ${verdict.totalCount} cases. The judge said:\n\n${verdict.detail ?? 'no further detail'}`

  const content = await azure.chat(
    [
      { role: 'system', content: REVIEW_SYSTEM },
      {
        role: 'user',
        content: `Problem — ${input.title}\n\n${input.description}\n\n---\n\nTheir ${input.language}:\n\n\`\`\`${input.language}\n${input.code.slice(0, 12_000)}\n\`\`\`\n\n---\n\n${outcome}`,
      },
    ],
    { temperature: 0.3, maxTokens: 1200 },
  )

  const remarks = (content.content ?? '').trim()
  if (!remarks) throw HttpError.badGateway('The review came back empty.')
  return remarks
}
