import { useEffect, useRef, useState } from 'react'

import { useStudyDark } from '@/features/study/useStudyDark'
import { safeMermaid } from '@/features/study/mermaidSafe'

/**
 * A diagram, from the text a model wrote.
 *
 * Mermaid rather than a generated image: a model emits a flowchart as a dozen
 * lines of text far more reliably than it draws one, the result is legible at
 * any size because it is vector, and a diagram that turns out wrong can be
 * corrected by editing a line rather than by paying for another picture.
 *
 * The library is loaded on first use and kept — it is a large dependency, and
 * a page of notes with no diagrams in it should never pay for it.
 */

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null

/* Mermaid bakes its colours into the SVG at render time, so the palette has to
   be handed to it rather than inherited. Re-initialised whenever the tab's
   theme changes — the library allows it, and the alternative is dark boxes
   with dark text sitting in a white page. */
const PALETTE = {
  dark: {
    primaryColor: '#1c1c1f',
    primaryTextColor: '#fafafa',
    primaryBorderColor: '#3a3a40',
    lineColor: '#8a8a94',
    secondaryColor: '#141416',
    tertiaryColor: '#0d0d0f',
  },
  light: {
    primaryColor: '#f1efec',
    primaryTextColor: '#17171b',
    primaryBorderColor: '#c9c5c0',
    lineColor: '#6b6b75',
    secondaryColor: '#e7e4e0',
    tertiaryColor: '#fbfaf9',
  },
}

/**
 * The one font both halves of a diagram agree on.
 *
 * Kept as a constant rather than written twice, because the entire bug it
 * exists to prevent is the two copies disagreeing.
 */
const MERMAID_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

function loadMermaid(dark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => module.default)
  }
  return mermaidPromise.then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      /* Errors are handled below, as a readable fallback. Left to itself the
         library writes its own error graphic into the page, which is a
         picture of a bomb where a diagram should be. */
      suppressErrorRendering: true,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      darkMode: dark,
      /*
       * Named, never inherited.
       *
       * Mermaid sizes every node box by measuring its label, and it measures
       * in a container of its own before the SVG is ever put on the page.
       * `inherit` resolves differently in those two places: in the notes a
       * diagram arrives from a fenced code block, so it lands inside a `pre`
       * and inherits monospace — which is wider than whatever was measured.
       * The label then overflows a `foreignObject` sized for the narrower
       * font and is clipped mid-word, which is why "Java Object" rendered as
       * "Java Obje".
       *
       * Stating the family fixes the measurement half; `MERMAID_FONT` below
       * puts the same stack on the host so the display half agrees with it.
       */
      fontFamily: MERMAID_FONT,
      themeVariables: { background: 'transparent', ...(dark ? PALETTE.dark : PALETTE.light) },
      flowchart: { curve: 'basis', useMaxWidth: true },
      sequence: { useMaxWidth: true },
    })
    return mermaid
  })
}

let counter = 0

export function Mermaid({ chart, draw = false }: { chart: string; draw?: boolean }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const dark = useStudyDark()

  useEffect(() => {
    let cancelled = false
    counter += 1
    const id = `study-diagram-${counter}`

    void loadMermaid(dark)
      .then((mermaid) => mermaid.render(id, safeMermaid(chart)))
      .then(({ svg: rendered }) => {
        if (!cancelled) {
          setSvg(rendered)
          setFailed(false)
        }
      })
      .catch(() => {
        /*
         * A diagram that will not parse is shown as its own source.
         *
         * The model writes these, and it occasionally writes one Mermaid
         * cannot read. The text still says what the diagram meant, so showing
         * it beats showing nothing — and it makes the fault obvious rather
         * than leaving a blank space where a picture was promised.
         */
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [chart, dark])

  /*
   * Trace the diagram in rather than cutting to it.
   *
   * Every stroke in the rendered SVG is given a dash pattern as long as
   * itself and offset out of view, then animated back to zero — the standard
   * line-drawing trick, applied to whatever Mermaid happened to produce. Text
   * cannot be drawn that way, so labels fade in behind the strokes instead.
   *
   * Done to the live SVG rather than in the markup because Mermaid hands back
   * a finished string, and rewriting that string would mean parsing it.
   */
  useEffect(() => {
    if (!draw || !svg || !host.current) return
    const root = host.current.querySelector('svg')
    if (!root) return

    const strokes = root.querySelectorAll<SVGGeometryElement>('path, line, polyline, rect, circle, ellipse, polygon')
    const labels = root.querySelectorAll<SVGElement>('text, foreignObject, .label')

    strokes.forEach((node, at) => {
      let length = 0
      try {
        length = node.getTotalLength()
      } catch {
        /* Some shapes cannot report a length. They simply appear. */
        return
      }
      if (!length) return
      node.style.strokeDasharray = `${length}`
      node.style.strokeDashoffset = `${length}`
      node.style.animation = `study-trace 0.75s ease-out ${at * 0.055}s forwards`
    })

    labels.forEach((node, at) => {
      node.style.opacity = '0'
      node.style.animation = `study-fade-in 0.4s ease-out ${0.25 + at * 0.045}s forwards`
    })
  }, [svg, draw])

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-3 text-[0.74rem] leading-relaxed text-[var(--study-soft)]">
        <code>{chart}</code>
      </pre>
    )
  }

  return (
    <div
      ref={host}
      className="my-4 overflow-x-auto rounded-[0.9rem] border border-[var(--study-line)] bg-[var(--study-card)] p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      /* Set on the host rather than left to whatever encloses it. A diagram
         in the notes sits inside a `pre`, and inheriting that `pre`'s
         monospace is exactly what made the labels wider than the boxes
         Mermaid had measured for them. */
      style={{ fontFamily: MERMAID_FONT }}
      /* The SVG comes from Mermaid's own renderer with `securityLevel: strict`,
         which strips script and event handlers from the graph it is given. */
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg ? undefined : <span className="text-[0.76rem] text-[var(--study-faint)]">Drawing…</span>}
    </div>
  )
}
