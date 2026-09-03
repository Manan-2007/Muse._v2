/**
 * Making a generated diagram parse.
 *
 * Mermaid's grammar treats brackets and parentheses as syntax wherever they
 * appear, including inside a node's label. So `A[Collection (I)]` — a
 * perfectly reasonable thing to write about Java interfaces — is a parse
 * error, and `A[Old Array: [1, 2, 3]]` is another. Both came out of a real
 * lesson, and what the reader saw was the diagram's own source code sitting
 * where the picture should have been.
 *
 * Asking the model for "valid simple Mermaid" is what the prompt already did.
 * This is the same lesson as the code highlights and the list pointers before
 * it: a rule that can be enforced mechanically should be enforced, not
 * requested. Quoting a label is always safe — `A["Collection (I)"]` parses,
 * means exactly the same thing, and needs no cooperation from the model.
 *
 * Applied when the diagram is rendered rather than when it is written, which
 * is deliberate: every diagram already sitting in somebody's saved lessons and
 * notes is broken in exactly this way, and fixing it here repairs those too
 * without regenerating anything.
 */

/** Characters that are grammar to Mermaid and therefore unsafe bare. */
const NEEDS_QUOTING = /[()[\]{}]/

/** Openers that begin a node label, paired with what closes them. */
const CLOSERS: Record<string, string> = { '[': ']', '(': ')', '{': '}' }

/**
 * Quote one label's text, unless it is quoted already.
 *
 * Inner quotes become `#quot;` — Mermaid's own entity escape — because a raw
 * one would end the string early and produce a different parse error than the
 * one being fixed.
 */
function quoted(body: string): string {
  const trimmed = body.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) return body
  if (!NEEDS_QUOTING.test(body)) return body
  return `"${body.replace(/"/g, '#quot;')}"`
}

function quoteLabels(source: string): string {
  let out = ''
  let i = 0

  while (i < source.length) {
    const ch = source[i]!

    /*
     * An edge label: `A -->|text| B`. Delimited by pipes and never nested, so
     * the closing one is simply the next pipe.
     */
    if (ch === '|') {
      const end = source.indexOf('|', i + 1)
      if (end === -1) {
        out += ch
        i += 1
        continue
      }
      out += `|${quoted(source.slice(i + 1, end))}|`
      i = end + 1
      continue
    }

    const closer = CLOSERS[ch]
    if (!closer) {
      out += ch
      i += 1
      continue
    }

    /*
     * A doubled opener is a different node shape — `[[subroutine]]`,
     * `((circle))`, `{{hexagon}}` — and quoting its inner pair away would
     * silently change the shape rather than fix the label. Kept as its own
     * case so the shape survives.
     */
    const doubled = source[i + 1] === ch
    const open = doubled ? ch + ch : ch
    const close = doubled ? closer + closer : closer

    /* Scan to the matching close, counting nesting of this bracket only —
       which is what lets `[Old Array: [1, 2]]` find its real end rather than
       stopping at the first `]` and mangling the rest of the line. */
    let depth = 0
    let scan = i
    let end = -1
    while (scan < source.length) {
      if (source.startsWith(open, scan)) {
        depth += 1
        scan += open.length
        continue
      }
      if (source.startsWith(close, scan)) {
        depth -= 1
        if (depth === 0) {
          end = scan
          break
        }
        scan += close.length
        continue
      }
      scan += 1
    }

    /* Unbalanced. Left exactly as it was — a diagram this broken is the
       model's to answer for, and guessing at a repair would more likely
       produce a different wrong picture than the right one. */
    if (end === -1) {
      out += ch
      i += 1
      continue
    }

    out += open + quoted(source.slice(i + open.length, end)) + close
    i = end + close.length
  }

  return out
}

/*
 * Everything above quotes labels. Everything below fixes the rest of what a
 * language model reaches for when asked for a diagram.
 *
 * The failures are not random — they are the neighbouring syntaxes. Asked for
 * a graph, a model that has read the whole internet will sometimes write
 * Graphviz, because Graphviz is what most graph source on the internet is.
 * `digraph TD` instead of `graph TD` is one token wrong and renders nothing.
 * Each repair below was confirmed against Mermaid's own parser: the broken
 * form fails, the repaired form parses, and the repair changes nothing else.
 *
 * What is deliberately NOT repaired: anything whose intent is ambiguous. A
 * diagram that cannot be understood is left exactly as written, because a
 * guessed repair produces a confident wrong picture, which is worse than the
 * source text the reader currently gets.
 */

/** Diagram types Mermaid knows. A first line naming one of these is fine. */
const KNOWN_TYPES =
  /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|architecture(-beta)?|kanban|radar|treemap)\b/

/** Directions Mermaid accepts after `graph`. */
const DIRECTIONS = /^(TD|TB|BT|LR|RL)$/i

/**
 * Strip a code fence the model wrapped around its own answer.
 *
 * It is asked for the diagram source and sometimes returns the Markdown it
 * would have been embedded in. The fence is not part of the diagram.
 */
function stripFence(source: string): string {
  let text = source.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  /* A bare "mermaid" on its own opening line, left behind by the same habit. */
  return text.replace(/^\s*mermaid\s*\n/i, '')
}

/**
 * Make the first line a diagram type Mermaid recognises.
 *
 * `digraph`/`graphviz`/`dot` are Graphviz; the direction after them is the
 * same vocabulary, so only the type word has to change. Graphviz also wraps
 * its body in braces, which Mermaid has no use for.
 */
function fixHeader(source: string): string {
  const lines = source.split('\n')
  const at = lines.findIndex((line) => line.trim().length > 0)
  if (at === -1) return source

  const first = lines[at]!.trim()

  if (KNOWN_TYPES.test(first)) return source

  const graphviz = /^(?:strict\s+)?(?:digraph|graphviz|graph|dot)\b(.*)$/i.exec(first)
  if (graphviz) {
    /* Whatever followed the type word: a direction, a graph name, or a brace. */
    const rest = (graphviz[1] ?? '').replace(/\{\s*$/, '').trim()
    const direction = DIRECTIONS.test(rest) ? rest.toUpperCase() : 'TD'
    lines[at] = `graph ${direction}`
    /* Graphviz closes with a brace on its own line. Mermaid would read it as
       a node. */
    for (let i = lines.length - 1; i > at; i -= 1) {
      if (lines[i]!.trim() === '}') {
        lines.splice(i, 1)
        break
      }
      if (lines[i]!.trim().length > 0) break
    }
    return lines.join('\n')
  }

  /* No recognisable type at all, but it is drawing edges — so it meant a
     flowchart and simply never said so. */
  if (/(-->|---|->|=>)/.test(source)) return `graph TD\n${source}`
  return source
}

/**
 * Turn Graphviz edges into Mermaid ones.
 *
 * `->` is Graphviz; Mermaid needs at least two dashes. Written so the arrows
 * that are already correct are left alone — `-->`, `<-->`, `-.->`, `==>` and
 * the longer `<--->` forms all parse, and lengthening them again would break
 * what already worked.
 */
function fixArrows(source: string): string {
  return source
    /* `<->` needs a second dash to become Mermaid's bidirectional arrow. */
    .replace(/<->/g, '<-->')
    /* A lone `->` not already part of a longer arrow. */
    .replace(/(^|[^-<.=|])->(?!>)/g, '$1-->')
    /* A lone `=>`; `==>` is Mermaid's thick arrow and is left alone. */
    .replace(/(^|[^=])=>/g, '$1-->')
}

/**
 * `end` is a keyword, and a node cannot be called it.
 *
 * It closes a `subgraph`, so a bare `end` on its own line is left exactly
 * where it is. Only `end` used as one side of an edge is renamed — and it
 * keeps its text through a label, so the picture still reads "end".
 */
function fixReservedIds(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      if (line.trim().toLowerCase() === 'end') return line
      if (!/\bend\b/.test(line)) return line
      return line.replace(/(^|[\s>|-])end(?=\s|$|-|>)/g, '$1endNode["end"]')
    })
    .join('\n')
}

/**
 * Everything, in the order the repairs depend on each other.
 *
 * Fences first, because nothing else can read a header through them, and the
 * header next, because it decides whether any of the rest applies at all.
 *
 * That gate is not a nicety. Every repair below the header is written for the
 * flowchart grammar and is damage anywhere else: `->` is a legitimate arrow in
 * a sequence diagram and `->>` would be mangled into `-->>`; braces delimit a
 * class body in a class diagram and quoting one would turn the members into a
 * string. Both were caught by a test asserting that already-valid diagrams
 * come back byte-identical — which is the property worth protecting here,
 * because a repair pass that quietly breaks working input is worse than no
 * repair pass at all.
 *
 * So: anything that is not a flowchart gets its fence removed and is handed
 * back untouched.
 */
const FLOWCHART = /^\s*(graph|flowchart)\b/

export function safeMermaid(source: string): string {
  if (!source.trim()) return source

  const text = fixHeader(stripFence(source))
  if (!FLOWCHART.test(text)) return text

  return quoteLabels(fixReservedIds(fixArrows(text)))
}
