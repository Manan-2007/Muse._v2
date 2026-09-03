import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { prisma } from '../models/prisma.js'
import { UPLOAD_DIR, UPLOAD_ROUTE } from './upload.service.js'
import * as azure from './azure.service.js'
import * as generate from './generate.service.js'
import * as speech from './speech.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * A lesson that plays.
 *
 * Not a generated video. The model writes a script — narration split into
 * beats, each carrying one visual drawn from a fixed vocabulary — and the
 * browser animates those beats against narration audio. The distinction is
 * the whole design: a diagram here is data rendered by the same code that
 * draws the notes, so it is exactly as correct as the data, where a diagram
 * generated as pixels is confidently wrong in a medium nobody can spot-check
 * at a glance.
 *
 * Beats are deliberately small — one idea, one visual state. That removes the
 * need for word-level timing entirely: a beat's own audio length is when its
 * visual is on screen, and consecutive beats sharing a `group` build one
 * diagram up a piece at a time rather than restarting it.
 */

export const EXPLAINER_STATUS = ['pending', 'scripting', 'narrating', 'ready', 'failed'] as const
export type ExplainerStatus = (typeof EXPLAINER_STATUS)[number]

/** What a beat puts on screen. The player knows exactly these and no others. */
export type Visual =
  | { kind: 'title'; text: string; subtitle?: string }
  | { kind: 'bullets'; heading?: string; items: string[]; reveal?: number }
  | { kind: 'steps'; heading?: string; items: string[]; active?: number }
  | { kind: 'diagram'; mermaid: string; caption?: string }
  | { kind: 'code'; language: string; code: string; highlight?: number[]; caption?: string }
  | {
      kind: 'compare'
      heading?: string
      left: { title: string; points: string[] }
      right: { title: string; points: string[] }
    }
  | { kind: 'callout'; tone: 'exam' | 'pitfall' | 'insight'; text: string }

export type Beat = {
  /** What is spoken over this beat. */
  say: string
  show: Visual
  /** Beats sharing this keep one visual mounted and only advance it. */
  group?: string
  /** Filled in by narration: a URL the player can fetch, and its length. */
  audio?: string
  seconds?: number
}

/**
 * The script prompt.
 *
 * Written at length because this is the one place the quality of the whole
 * feature is decided. Two failure modes are worth naming: a script that
 * explains a university topic the way a children's channel would, all analogy
 * and no mechanism; and a script that recites the syllabus back without ever
 * saying how anything works. The first is patronising, the second is useless
 * in an exam, and a model asked only for "a lesson" produces one or the other
 * roughly at random.
 */
const SCRIPT_SYSTEM = `You write the script for a narrated lesson, for a
university student revising a course they are enrolled in and will be examined
on.

WHO IS LISTENING
An adult who has already sat the lectures. Not a beginner, not a child. They
can read code, follow a derivation, and hold two ideas at once. Write to that
person: no "imagine you're at a pizza shop", no "let's dive in", no
exclamation marks, no reassurance, no "in this lesson we will". Analogy is
allowed once, and only when it carries real structure.

DENSITY — THE MOST COMMON FAILURE
The first version of this prompt produced eighteen beats of which seven were
single-sentence callouts, and a callout is one line of text in the middle of a
very large screen. The lesson was mostly empty space. Do not do that.

Every beat must put something substantial on screen. Concretely:
  - At most THREE "callout" beats in the whole lesson. They are for the two or
    three things worth stopping on, not a default.
  - At least TWO "diagram" beats, and this is a floor rather than a
    suggestion — the lessons that felt like a slideshow were the ones that
    shipped with none. Almost anything worth teaching has a shape: what
    contains what, what happens in which order, what inherits from what, how
    data moves. Draw it. If you cannot see a shape in the topic, you have not
    looked hard enough at it yet.
  - At least THREE "code" beats where the subject involves code. Each is a
    COMPLETE program somebody could paste into a file and run — imports, the
    class, main, and print statements that show the result. Ten to twenty
    lines. Three lines of fragment in the middle of a large screen is the
    emptiness this whole section exists to prevent, and a fragment cannot be
    run, so it cannot be checked.
    The narration over a code beat walks it: what it does line by line where
    that matters, what it prints, and why that is the answer rather than the
    one the student expected. State the printed output out loud.
  - At least one "steps" group of three or more beats, so something is
    visibly built rather than stated.

THE BAR
State the mechanism, not the label. "The box model defines how elements are
sized" is a glossary entry and is worthless to somebody revising. "Width sets
the content box only, so padding and border are added outside it — which is
why a 200 pixel box with 20 of padding occupies 240 and breaks a three-column
layout" is a lesson. Every beat should carry one of:
  - the rule stated precisely, including where it stops applying
  - why the plausible wrong answer is wrong
  - the distinction an examiner uses to separate people who understand from
    people who memorised
  - a worked case with real numbers carried through to a real result
If a beat could be replaced by its own heading without loss, cut it.

WHERE THE CONTENT COMES FROM
If passages from the student's own course material are given to you below,
they are the primary source and they outrank your own knowledge. Teach the
topic as those passages teach it: their definitions, their notation, their
worked examples, their emphasis, their order. Where they use a term your
general knowledge would call something else, use theirs — that is the word
the exam will use. Cite them by their bracketed number as you go.

Follow their emphasis, not just their facts. If a passage says something is
the most common mistake, or the thing students always get wrong, or worth
memorising — that is the passage telling you what the lesson is for. It gets
a beat of its own, with the worked case. Skipping the one point the material
went out of its way to stress, while covering the ones it mentioned in
passing, produces a lesson that is technically grounded and practically
useless.

Your own knowledge fills the gaps around that: the mechanism the notes assume
but never state, the boundary case they skip, the example they leave as an
exercise. Say nothing that contradicts them. If they are silent on the topic
entirely, teach it from your own knowledge and do not imply otherwise.

EXAM RELEVANCE
The course syllabus is given to you. Where it names this topic, let it set the
emphasis and the vocabulary — use the course's own terms, because those are
the words the question paper will use. Mark the two or three genuinely
assessable points with a "callout" of tone "exam". Two or three. Not every
beat.

OUTPUT
{ "title": "a specific title, not the topic echoed back",
  "beats": [ { "say": "...", "show": { ... }, "group": "optional" } ] }

"say" is spoken aloud: two to four sentences of real English. Write it to be
heard — no bullet fragments, no markdown, no "as shown below", no symbols that
are not words. Say "n squared", not "n^2". Say "two hundred pixels", not
"200px".

"show" is exactly one of:
  { "kind": "title", "text": "...", "subtitle": "..." }
  { "kind": "steps", "heading": "...", "items": ["...","..."], "active": 0 }
  { "kind": "diagram", "mermaid": "graph LR\n  A[...] --> B[...]", "caption": "..." }
  { "kind": "code", "language": "css", "code": "...", "highlight": [2], "caption": "..." }
  { "kind": "compare", "heading": "...",
    "left": { "title": "...", "points": ["..."] },
    "right": { "title": "...", "points": ["..."] } }
  { "kind": "callout", "tone": "exam" | "pitfall" | "insight", "text": "..." }

THE SCREEN IS NOT THE SCRIPT
There is no "bullets" kind on purpose. A list of sentences on screen while the
same sentences are read aloud is the single thing that makes one of these feel
like a slideshow with a voice over it rather than somebody teaching. The voice
carries the explanation. The screen carries the thing being explained — the
shape of it, the code, the comparison, the sequence.

So on-screen text is LABELS, not prose:
  BAD   "Combines data and methods into a single unit called a class"
  GOOD  "data + methods -> one class"
Three to six words per item. If an item reads as a sentence, it belongs in the
narration and something else belongs on screen.

Reach for, in this order: a diagram if the thing has a shape, code if it has
behaviour, compare if it is two things held against each other, steps if it is
an order. A callout only for the two or three points genuinely worth stopping
on.

MERMAID THAT ACTUALLY PARSES
This is Mermaid, not Graphviz. The first line is graph TD or graph LR — never
digraph, never dot, never a name in braces. Edges are --> and never ->. Those
are the two habits that produce a diagram which renders as its own source code
instead of a picture, and they come from Graphviz being what most graph source
looks like.

Every node label goes in double quotes, always, with no exceptions:
  RIGHT  A["Collection (I)"] --> B["ArrayList"]
  WRONG  A[Collection (I)] --> B[ArrayList]
Unquoted brackets and parentheses inside a label are a parse error, and a
diagram that does not parse shows the reader its own source code where the
picture should be. Quote every label and this cannot happen. Keep to
graph TD or graph LR, and keep labels short — a label is a name, not a
sentence.

NEVER TALK ABOUT SOMETHING THAT IS NOT ON SCREEN
This is the rule most often broken and the most damaging when it is. If the
narration says "when this code runs", "look at line four", "notice the output",
"in this example", or anything else that points at a thing — that thing MUST be
the visual of that same beat. Not the one before it.

The failure looks like this, and it makes the lesson useless:
  beat 4  show: code        say: "here is a class with two constructors"
  beat 5  show: callout     say: "when this code runs it prints Name: Unknown"
By beat 5 the code is gone. The listener is being told what "this code" prints
while looking at a sentence in a box. They cannot follow it and they cannot
check it.

Written correctly, the code stays and the attention moves:
  beat 4  show: code (group "demo", highlight [6,7])   say: "here is the default constructor..."
  beat 5  show: code (group "demo", highlight [12])    say: "and here is the parameterized one..."
  beat 6  show: code (group "demo", highlight [18,19]) say: "when this runs it prints Name: Unknown, Age: 0..."
Same code, same group, highlight moving, and the thing being discussed is in
front of them the whole time.

So: every code listing gets AT LEAST THREE consecutive beats in one group.
Introduce it, walk the parts that matter, then run it in words. A code beat
that appears for one beat and vanishes has taught nobody anything.

The same applies to diagrams: if you are going to discuss a diagram over
several sentences, hold it in a group rather than showing it once and moving
to a callout.

GROUPS — READ THIS TWICE
A "group" is how one visual stays on screen and is built up across several
beats instead of being thrown away. The rule is mechanical:

  Every beat in a group MUST have the same "kind" AND byte-identical content,
  except for exactly one advancing field.

  - "steps": identical "heading" and identical "items". "active" starts at 0
    and goes up by one each beat. The narration of each beat must be about the
    step that beat makes active.
  - "steps": identical "heading" and identical "items". "active" starts at 0
    and goes up by one each beat. The narration of each beat must explain the
    item at "active" — not introduce the next one, not recap the last. A beat
    highlighting "add the padding" while the voice says "first take the
    width" is worse than no highlight at all, because the eye follows the
    highlight and the ear follows the voice and they disagree.
  - "code": identical "code" and "language". "highlight" moves to the lines
    being discussed.
  - "diagram": identical "mermaid". Use a group only to hold it while you talk
    over it.

If the kind changes, or the items change, it is NOT the same group — leave
"group" out or start a new one. A group of a diagram followed by two callouts
is wrong and produces nothing.

At least two groups per lesson, each at least three beats long. That is where
the lesson stops being a slideshow: a list revealing one line at a time as
each line is explained, a walkthrough stepping through its own stages, code
with attention moving line to line.

WHEN THE STUDENT HAS TOLD YOU WHAT THEY STRUGGLE WITH
If they name a specific thing they get wrong, that thing gets the most beats
in the lesson — not a passing mention at the end. Somebody who says they lose
marks on margin collapse needs the rule, the vertical-only boundary, the
nested-element case, the case where it does not happen, and a worked example.
Four beats minimum on a named weakness. Everything else in the topic can be
covered more briskly to make room; they asked for help with one thing.

LENGTH AND SHAPE
- Length follows the topic, not a target. Count the distinct things the
  student has to come away able to do, and give each one enough beats to be
  taught: introduce it, show it working, and show where it stops working.
  A single narrow mechanism might need twelve beats in total. Something with
  four genuinely separate sub-ideas — four pillars, four collection types —
  needs four times what one of them needs, and coming in at the same length
  as the narrow topic means three of the four got a sentence each.
  Never fewer than 14 beats. Up to 26 where the topic earns them.
- "say" runs FOUR TO SIX sentences on any beat that is not a title card. Two sentences is a caption, not teaching, and a lesson of
  captions is the thing students describe as "I watched it and I still don't
  get it" — every beat asserts something and none of them explain it.
  This is the difference between a lesson somebody can follow and a list of
  assertions read aloud: say the thing, then say why it is so, then give the
  case where it matters. A student listening without watching should be able
  to follow the whole argument.
- Carry at least one worked example the whole way through, with real values
  and real output, using a group. Not "for example, consider a class Animal"
  and then moving on — actually write it, actually run it in words, actually
  say what it prints and why.
- Where something has an exception or a boundary, give the case on each side
  of it. "This is true, except here, and here is why the exception exists."
- If the subject involves code, the code beats are the spine of the lesson,
  not decoration between callouts. Fewer than 14 is too thin to have taught anything.
- Open on a "title" beat whose narration states what the listener will be able
  to do by the end. "By the end of this you will be able to work out the
  rendered width of any element and say which rule decided it." Never a
  definition of the topic's own name — that teaches nothing and wastes the
  one moment you have their full attention.
- Somewhere in the middle, carry one worked example all the way through with
  real numbers, using a "steps" group.
- If the subject involves code, markup or syntax at all, at least two "code"
  beats with real, correct, idiomatic code.
- Close by stating what now holds, not "thanks for watching".

DIAGRAMS
Valid, simple Mermaid: "graph LR", "graph TD", or "sequenceDiagram". Node
labels under six words. No styling directives, no colours, no subgraph unless
containment is genuinely the point. If a relationship is containment rather
than sequence, say so in the labels — arrows read as "then", not "inside".

Return only the JSON object.`

/** Kept modest: eighteen beats of three sentences is not a long document. */
/*
 * The ceiling, not the target.
 *
 * Was 18, which combined with a narration pace of about 135 words a minute
 * put every lesson in the same three-to-four-minute band regardless of how
 * much there was to teach — a topic with four separate pillars came out the
 * same length as one narrow mechanism. Raised so a big topic can be big; the
 * prompt above decides what each one actually needs.
 */
const MAX_BEATS = 26

type Raw = { title?: unknown; beats?: unknown }

function asVisual(value: unknown): Visual | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '')
  const list = (k: string) =>
    Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []

  switch (v.kind) {
    case 'title':
      return str('text') ? { kind: 'title', text: str('text'), subtitle: str('subtitle') || undefined } : null
    case 'bullets': {
      const items = list('items')
      if (items.length === 0) return null
      return {
        kind: 'bullets',
        heading: str('heading') || undefined,
        items,
        reveal: typeof v.reveal === 'number' ? Math.max(1, Math.min(items.length, v.reveal)) : items.length,
      }
    }
    case 'steps': {
      const items = list('items')
      if (items.length === 0) return null
      return {
        kind: 'steps',
        heading: str('heading') || undefined,
        items,
        active: typeof v.active === 'number' ? Math.max(0, Math.min(items.length - 1, v.active)) : 0,
      }
    }
    case 'diagram':
      return str('mermaid') ? { kind: 'diagram', mermaid: str('mermaid'), caption: str('caption') || undefined } : null
    case 'code': {
      const code = str('code')
      if (!code) return null

      /*
       * Highlights, checked against the code they point into.
       *
       * The model counts lines by eye and gets it wrong: observed highlighting
       * a blank line, a line holding nothing but a closing brace, and a line
       * past the end of the listing — all in one lesson. A highlight on a
       * blank line is worse than none, because the student assumes the
       * emphasis means something and goes looking for what.
       *
       * So a line only survives if it exists and has something on it worth
       * pointing at. Punctuation-only lines are dropped for the same reason a
       * blank one is: nobody needs a brace singled out.
       */
      const lines = code.split('\n')
      const worthPointingAt = (index: number) => {
        const line = lines[index - 1]
        if (line === undefined) return false
        const bare = line.trim().replace(/[{}()[\];,]/g, '').trim()
        return bare.length > 0
      }

      const highlight = Array.isArray(v.highlight)
        ? [
            ...new Set(
              (v.highlight as unknown[]).filter(
                (n): n is number => typeof n === 'number' && Number.isInteger(n) && worthPointingAt(n),
              ),
            ),
          ].sort((a, b) => a - b)
        : []

      return {
        kind: 'code',
        language: str('language') || 'text',
        code,
        highlight: highlight.length ? highlight : undefined,
        caption: str('caption') || undefined,
      }
    }
    case 'compare': {
      const side = (k: string) => {
        const raw = v[k]
        if (!raw || typeof raw !== 'object') return null
        const o = raw as Record<string, unknown>
        const points = Array.isArray(o.points)
          ? (o.points as unknown[]).filter((x): x is string => typeof x === 'string')
          : []
        const title = typeof o.title === 'string' ? o.title.trim() : ''
        return title || points.length ? { title, points } : null
      }
      const left = side('left')
      const right = side('right')
      return left && right ? { kind: 'compare', heading: str('heading') || undefined, left, right } : null
    }
    case 'callout': {
      const tone = v.tone
      const ok = tone === 'exam' || tone === 'pitfall' || tone === 'insight'
      return str('text') ? { kind: 'callout', tone: ok ? tone : 'insight', text: str('text') } : null
    }
    default:
      return null
  }
}


/**
 * Phrases that point at something the listener is expected to be looking at.
 *
 * Deliberately narrow. "when this code runs" is unambiguously about a listing;
 * a bare "prints" is not, and widening this would start rewriting beats that
 * were fine.
 */
const POINTS_AT_CODE =
  /\b(this code|the code above|the code below|when (?:this|it) runs|when this code runs|running this|the output (?:will be|is)|line \d+|in this example|as shown above)\b/i

/** How far back a listing can still be "the code" being talked about. */
const REACH = 3

/**
 * Put the code back on screen when the narration is talking about it.
 *
 * The model writes a listing, then explains it on the next beat with a
 * callout — so the student hears "when this code runs it prints Name:
 * Unknown" while looking at a sentence in a box, with the code two beats
 * gone. It is the single most damaging thing a lesson can do, because the one
 * moment the listener needs to see the code is the moment it is taken away.
 *
 * The prompt asks for this and the prompt is not enough: told explicitly, with
 * a worked example of the failure, it still produced four such beats out of
 * fifteen and no groups at all. So it is repaired here instead. Structure that
 * can be checked mechanically should be, rather than requested and hoped for —
 * the same reason the generated test cases are run before they are trusted.
 *
 * A beat is only rewritten when it says something that can only mean a
 * listing, and only when a listing is recent enough to be the one it means.
 * Its narration is never touched.
 */
function stitch(beats: Beat[]): Beat[] {
  const out = beats.map((beat) => ({ ...beat }))

  let lastCode: { at: number; visual: Extract<Visual, { kind: 'code' }> } | null = null
  let groupSeq = 0

  for (let i = 0; i < out.length; i += 1) {
    const beat = out[i]!

    if (beat.show.kind === 'code') {
      /* A new listing, or the same one continuing. */
      if (!lastCode || lastCode.visual.code !== beat.show.code) {
        groupSeq += 1
        lastCode = { at: i, visual: beat.show }
      } else {
        lastCode = { at: i, visual: beat.show }
      }
      beat.group = beat.group ?? `listing-${groupSeq}`
      continue
    }

    if (!lastCode || i - lastCode.at > REACH) continue
    if (!POINTS_AT_CODE.test(beat.say)) continue

    /*
     * Bring the listing back, un-highlighted.
     *
     * No highlight rather than the previous beat's: this beat is talking about
     * what the whole thing does, and leaving the old lines lit would point at
     * the wrong part of it.
     */
    beat.show = { ...lastCode.visual, highlight: undefined }
    beat.group = out[lastCode.at]!.group
    lastCode = { at: i, visual: beat.show }
  }

  /*
   * Group any run of the same visual, whatever its kind.
   *
   * Two consecutive beats showing the identical diagram or list should hold
   * one on screen rather than crossfading it into itself.
   */
  for (let i = 1; i < out.length; i += 1) {
    const previous = out[i - 1]!
    const beat = out[i]!
    if (beat.group || previous.show.kind !== beat.show.kind) continue
    if (JSON.stringify(sansIndex(previous.show)) !== JSON.stringify(sansIndex(beat.show))) continue
    previous.group = previous.group ?? `run-${i}`
    beat.group = previous.group
  }

  /*
   * A group only ever moves forward.
   *
   * Observed on a closing beat: five key points on screen, the voice
   * summarising all of them, and the highlight sitting on point one — because
   * the model emitted `active: 0` again for the summary. The eye goes where
   * the highlight is and the ear is somewhere else entirely, which is the
   * same fault as explaining code that has left the screen, in miniature.
   *
   * Within a group the pointer is therefore forced to be non-decreasing, and
   * a group's last beat shows the whole list — by then everything in it has
   * been said, and dimming four of five points while summarising all five is
   * telling the student to ignore what they are being told.
   */
  const groupRuns = new Map<string, number[]>()
  out.forEach((beat, at) => {
    if (!beat.group) return
    groupRuns.set(beat.group, [...(groupRuns.get(beat.group) ?? []), at])
  })

  for (const positions of groupRuns.values()) {
    let floor = -1
    positions.forEach((at, nth) => {
      const beat = out[at]!
      const last = nth === positions.length - 1

      if (beat.show.kind === 'steps') {
        const items = beat.show.items.length
        const wanted = last ? items - 1 : Math.max(beat.show.active ?? 0, floor)
        beat.show = { ...beat.show, active: Math.min(items - 1, wanted) }
        floor = beat.show.active ?? 0
      } else if (beat.show.kind === 'bullets') {
        const items = beat.show.items.length
        const wanted = last ? items : Math.max(beat.show.reveal ?? items, floor)
        beat.show = { ...beat.show, reveal: Math.min(items, Math.max(1, wanted)) }
        floor = beat.show.reveal ?? 1
      }
    })
  }

  /*
   * A list that is not being built shows all of itself.
   *
   * Revealing one item at a time is what a group is for. On a beat standing
   * alone there is no next beat to reveal the rest, so a pointer at item one
   * leaves four items greyed out permanently and the student reading a list
   * they have been told not to read.
   */
  for (const beat of out) {
    if (beat.group) continue
    if (beat.show.kind === 'steps') {
      beat.show = { ...beat.show, active: beat.show.items.length - 1 }
    } else if (beat.show.kind === 'bullets') {
      beat.show = { ...beat.show, reveal: beat.show.items.length }
    }
  }

  return out
}

/** The visual minus whatever advances within a group. */
function sansIndex(visual: Visual) {
  const { ...rest } = visual as Record<string, unknown>
  delete rest.reveal
  delete rest.active
  delete rest.highlight
  return rest
}

/**
 * Write the script.
 *
 * Grounded through the same `gather` every other generator uses, so the
 * syllabus sets scope and the uploaded lecture material supplies substance —
 * and `grounded` records which of those actually happened rather than
 * assuming.
 */
export async function script(input: {
  subjectId: string
  topic: string
  style: string
  resourceIds?: string[]
}) {
  /*
   * A lesson takes more context than anything else here.
   *
   * A quiz question needs the one passage that settles it; a six-minute
   * lesson is drawing on everything the course said about the topic, so the
   * search runs wider. `gather` still decides what is relevant — this only
   * raises the ceiling on how much of it comes back.
   */
  const grounding = await generate.gather(input.subjectId, input.topic, {
    only: input.resourceIds,
    limit: 14,
  })

  /* The student's own words about how they want to be taught, passed through
     rather than paraphrased. "I have the exam on Friday and I keep losing
     marks on the derivation" carries intent no menu of options would. */
  const asked = input.style.trim()
    ? `\n\n---\n\nThe student described how they want this taught, in their words. Honour it, so long as it does not conflict with the rules above:\n\n"${input.style.trim()}"`
    : ''

  const ask = `${generate.promptContext(grounding)}\n\n---\n\nWrite the lesson on: ${generate.subjectMatter(input.topic, grounding)}${asked}`

  const readBeats = (parsed: Raw) => {
    const beats: Beat[] = []
    for (const raw of Array.isArray(parsed.beats) ? parsed.beats : []) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const say = typeof r.say === 'string' ? r.say.trim() : ''
      const show = asVisual(r.show)
      if (!say || !show) continue
      beats.push({ say, show, group: typeof r.group === 'string' && r.group ? r.group : undefined })
      if (beats.length >= MAX_BEATS) break
    }
    return beats
  }

  /**
   * What is wrong with this script, in words it can act on.
   *
   * The prompt states these as requirements and they were still missed — of
   * four real lessons checked, not one carried the two diagrams the prompt
   * demands, and most ran short enough to land in the same three-minute band
   * whatever the topic. Same lesson as the code highlights and the list
   * pointers before it: something checkable should be checked rather than
   * requested and hoped for. The difference here is that a diagram cannot be
   * synthesised after the fact the way a highlight can be dropped, so the
   * repair is to say precisely what is missing and ask once more.
   */
  const shortfall = (beats: Beat[]) => {
    const faults: string[] = []
    const diagrams = beats.filter((beat) => beat.show.kind === 'diagram').length
    if (diagrams < 2) {
      faults.push(
        `it has ${diagrams === 0 ? 'no diagrams at all' : 'only one diagram'} where at least two are required — find the shapes in this topic and draw them`,
      )
    }
    if (beats.length < 14) {
      faults.push(
        `it is only ${beats.length} beats, which is under the fourteen minimum — the topic has not been covered at that length`,
      )
    }
    return faults
  }

  let parsed = await azure.chatJson<Raw>(
    [
      { role: 'system', content: SCRIPT_SYSTEM },
      { role: 'user', content: ask },
    ],
    { temperature: 0.55, maxTokens: 8000 },
  )
  let beats = readBeats(parsed)

  /*
   * One more attempt, told exactly what was short.
   *
   * Only one: a second failure means the model is not going to satisfy this
   * for this topic, and a third round would spend another large completion
   * and most of a minute to arrive at the same place. What comes back is used
   * either way — a lesson with one diagram is still a lesson, and refusing to
   * ship it would trade a real shortcoming for no lesson at all.
   */
  const faults = shortfall(beats)
  if (faults.length > 0) {
    try {
      const retry = await azure.chatJson<Raw>(
        [
          { role: 'system', content: SCRIPT_SYSTEM },
          { role: 'user', content: ask },
          { role: 'assistant', content: JSON.stringify(parsed).slice(0, 6000) },
          {
            role: 'user',
            content: `That script does not meet the requirements: ${faults.join('; and ')}. Write it again in full, keeping what was good and fixing those. Every mermaid node label must be in double quotes.`,
          },
        ],
        { temperature: 0.55, maxTokens: 8000 },
      )
      const second = readBeats(retry)
      /* Kept only if it is actually better — a retry that came back shorter or
         no better shaped is a worse lesson, and asking twice is not a reason
         to take it. */
      if (shortfall(second).length < faults.length || second.length > beats.length) {
        parsed = retry
        beats = second
      }
    } catch {
      /* The first script stands. It is short of the bar, not unusable. */
    }
  }

  /* Six is a floor against a broken response, not the target — the prompt
     asks for fourteen. A lesson that comes back at five beats is a failed
     generation wearing a success, and shipping it teaches nothing. */
  if (beats.length < 6) {
    throw HttpError.badGateway('The lesson came back too short to be useful. Try again.')
  }

  return {
    title:
      typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : input.topic,
    beats: stitch(beats),
    grounded: grounding.grounded,
    sources: grounding.sources,
  }
}

/** Where one lesson's narration clips live on disk. */
const folderFor = (explainerId: string) => path.join(UPLOAD_DIR, 'explainers', explainerId)

/**
 * Narration length, from the byte count.
 *
 * The output format is fixed constant-bitrate 48 kbit/s, so the duration is
 * arithmetic rather than a question for a media library. Checked against
 * ffprobe across several clips and voices: identical to the millisecond.
 */
const BITRATE_BYTES_PER_SECOND = 48_000 / 8

/**
 * Narrate every beat, writing each clip to disk as it lands.
 *
 * Sequential on purpose. A lesson is fifteen-odd clips against a per-second
 * quota, and firing them at once is the quickest way to be rate limited into
 * a half-narrated lesson — which would look like a broken feature rather than
 * a busy one. The whole set takes about half a minute either way.
 */
async function narrate(explainerId: string, beats: Beat[], voice: string) {
  const folder = folderFor(explainerId)
  await mkdir(folder, { recursive: true })

  let total = 0
  const done: Beat[] = []

  for (const [index, beat] of beats.entries()) {
    const audio = await speech.speak(beat.say, voice)
    const name = `${String(index).padStart(2, '0')}.mp3`
    await writeFile(path.join(folder, name), audio)

    const seconds = audio.byteLength / BITRATE_BYTES_PER_SECOND
    total += seconds
    done.push({
      ...beat,
      audio: `${UPLOAD_ROUTE}/explainers/${explainerId}/${name}`,
      seconds: Math.round(seconds * 1000) / 1000,
    })
  }

  return { beats: done, duration: Math.round(total * 1000) / 1000 }
}

/** The document ids a lesson was narrowed to, or undefined for the shelf. */
function readResources(raw: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[]
  } catch {
    /* Unreadable is the same as unset: fall back to the whole shelf. */
  }
  return undefined
}

async function fail(explainerId: string, message: string) {
  await prisma.explainer
    .update({ where: { id: explainerId }, data: { status: 'failed', error: message.slice(0, 400) } })
    .catch(() => undefined)
}

/**
 * Build the lesson, after the response has already gone.
 *
 * Scripting is a large completion and narration is a few dozen round trips —
 * together well past what anybody should hold a request open for. So the row
 * is written first and moves through its statuses while the client watches
 * the list, exactly as an uploaded document does.
 */
export async function buildInBackground(explainerId: string) {
  void build(explainerId).catch(async (cause) => {
    await fail(explainerId, cause instanceof Error ? cause.message : 'The lesson could not be built.')
  })
}

async function build(explainerId: string) {
  const row = await prisma.explainer.findUnique({ where: { id: explainerId } })
  if (!row) return

  try {
    await prisma.explainer.update({
      where: { id: explainerId },
      data: { status: 'scripting', error: null },
    })

    const written = await script({
      subjectId: row.subjectId,
      topic: row.topic,
      style: row.style,
      /* What the student narrowed it to, if they did. Stored on the row so a
         retry after a dropped connection draws on the same documents. */
      resourceIds: readResources(row.resources),
    })

    await prisma.explainer.update({
      where: { id: explainerId },
      data: {
        status: 'narrating',
        title: written.title,
        beats: JSON.stringify(written.beats),
        grounded: written.grounded,
        sources: JSON.stringify(written.sources),
      },
    })

    const narrated = await narrate(explainerId, written.beats, row.voice)

    await prisma.explainer.update({
      where: { id: explainerId },
      data: {
        status: 'ready',
        error: null,
        beats: JSON.stringify(narrated.beats),
        duration: narrated.duration,
      },
    })
  } catch (cause) {
    /* A half-narrated lesson is worse than none: it plays, stops partway, and
       looks like the player is broken. The clips go with the failure. */
    await rm(folderFor(explainerId), { recursive: true, force: true }).catch(() => undefined)
    throw cause
  }
}

/**
 * Try a failed lesson again, without redoing what already worked.
 *
 * Worth separating from a fresh build because the two halves fail for very
 * different reasons and cost very different amounts. The script is one large
 * completion; the narration is a couple of dozen small ones, which makes it
 * far likelier to be the half that met a dropped connection — and it is
 * already saved by then, because the row is updated with it on the way into
 * narrating. Re-scripting at that point would spend the expensive call to
 * throw away a perfectly good lesson and write a different one.
 *
 * So a retry after a narration failure narrates the same script again, and
 * only a lesson that never got one starts over.
 */
export async function retryInBackground(explainerId: string) {
  void retry(explainerId).catch(async (cause) => {
    await fail(explainerId, cause instanceof Error ? cause.message : 'The lesson could not be built.')
  })
}

async function retry(explainerId: string) {
  const row = await prisma.explainer.findUnique({ where: { id: explainerId } })
  if (!row) return

  let existing: Beat[] = []
  try {
    const parsed: unknown = JSON.parse(row.beats)
    if (Array.isArray(parsed)) existing = parsed as Beat[]
  } catch {
    /* Unreadable is the same as absent here — it gets written again below. */
  }

  /* Nothing survived the last attempt, so this is just a build. */
  if (existing.length === 0) return build(explainerId)

  try {
    await prisma.explainer.update({
      where: { id: explainerId },
      data: { status: 'narrating', error: null },
    })

    const narrated = await narrate(explainerId, existing, row.voice)

    await prisma.explainer.update({
      where: { id: explainerId },
      data: {
        status: 'ready',
        error: null,
        beats: JSON.stringify(narrated.beats),
        duration: narrated.duration,
      },
    })
  } catch (cause) {
    await rm(folderFor(explainerId), { recursive: true, force: true }).catch(() => undefined)
    throw cause
  }
}

/** Remove a lesson's narration from disk. The row is the caller's to delete. */
export async function discardAudio(explainerId: string) {
  await rm(folderFor(explainerId), { recursive: true, force: true }).catch(() => undefined)
}
