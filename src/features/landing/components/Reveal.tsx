import { useEffect, useRef, useState } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * How things arrive on this page.
 *
 * Two devices, both one-shot on entry rather than tied to the scrollbar. That
 * distinction matters more than it looks: a scrubbed reveal plays at whatever
 * speed the wheel was spun, so a fast flick fires it in two frames and a slow
 * drag stalls it halfway. Playing on its own easing means the reveal always
 * looks the way it was designed, however the visitor got there.
 */

/**
 * Fires once, the first time the element is meaningfully on screen.
 *
 * Written to **fail open**. Everything these reveals do starts by hiding
 * content, so the one outcome that must be impossible is content that never
 * comes back — and `IntersectionObserver` has more ways of staying quiet than
 * is comfortable to rely on. It does not report while a document is not being
 * rendered, which covers a backgrounded tab, some embedded webviews, and a
 * handful of automation and accessibility contexts. In every one of those the
 * honest answer is "show the content", not "wait indefinitely".
 *
 * So there are three ways in, and only the first is the pretty one:
 *
 * 1. The observer, for anything scrolled to normally.
 * 2. A synchronous geometry check on mount, so anything already on screen at
 *    first paint reveals without waiting to be told.
 * 3. A slow geometry poll running alongside the observer, which reveals on the
 *    same condition the observer would have. It asks the question itself
 *    rather than trusting anything to volunteer the answer.
 *
 * The poll deliberately re-checks position rather than revealing on a timer.
 * A plain timeout would fail open by showing every block on the page a couple
 * of seconds after load, which is not failing open — it is deleting the
 * feature. This keeps the behaviour identical and only changes who noticed.
 */
const FALLBACK_POLL_MS = 350

function useEnteredOnce<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || entered) return

    let done = false
    let observer: IntersectionObserver | null = null
    let poll: ReturnType<typeof setInterval> | null = null

    const finish = () => {
      done = true
      observer?.disconnect()
      if (poll !== null) clearInterval(poll)
    }

    const reveal = () => {
      if (done) return
      finish()
      setEntered(true)
    }

    /* The same line the observer's margin draws, asked directly. */
    const onScreen = () => {
      const box = node.getBoundingClientRect()
      return box.top < window.innerHeight * 0.82 && box.bottom > 0
    }

    /* Already there when it mounted — above the fold, or restored at a scroll
       position. Waiting to be told would hold the top of the page blank. */
    if (onScreen()) {
      reveal()
      return
    }

    /* Fires a little before the element is fully in view, so the movement is
       finishing as it reaches a comfortable reading position rather than
       starting there. */
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) reveal()
      },
      { rootMargin: '0px 0px -18% 0px', threshold: 0.15 },
    )
    observer.observe(node)

    poll = setInterval(() => {
      if (onScreen()) reveal()
    }, FALLBACK_POLL_MS)

    return finish
  }, [entered])

  return { ref, entered }
}

/**
 * A heading with a band of light passing through it.
 *
 * The text is transparent and filled by a gradient clipped to the glyphs; the
 * gradient is four times wider than the box, so sliding its position sweeps a
 * lit band across the letters and leaves them at rest again.
 *
 * The colour is the room's own signal red, which is otherwise almost absent
 * from this page — the light is the only place the accent appears, the same
 * way a film in a dark room is the only thing lighting anybody's face.
 *
 * `background-clip: text` needs `-webkit-` to this day for Safari, and the
 * fill has to be transparent or it paints over the gradient.
 */
export function SweepHeading({
  children,
  className,
  as: Tag = 'h2',
}: {
  children: React.ReactNode
  className?: string
  as?: 'h1' | 'h2' | 'h3'
}) {
  const { ref, entered } = useEnteredOnce<HTMLHeadingElement>()
  const reduced = usePrefersReducedMotion()

  /* Reduced motion still gets the finished heading, just without the journey:
     the band is parked past the end so the type reads as plain chalk. */
  const swept = reduced || entered

  return (
    <Tag
      ref={ref}
      className={cn('sweep-text', className)}
      data-swept={swept ? 'true' : 'false'}
    >
      {children}
    </Tag>
  )
}

/**
 * A block that rises into place behind a clipped edge.
 *
 * The mask is the point. A plain fade is the default everything on the web
 * does and reads as a page loading slowly; something sliding up from behind a
 * hard edge reads as deliberate, because nothing in the physical world fades.
 */
export function RevealBlock({
  children,
  className,
  /** Stagger, in ms — used to bring a row in one item at a time. */
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const { ref, entered } = useEnteredOnce<HTMLDivElement>()
  const reduced = usePrefersReducedMotion()
  const shown = reduced || entered

  return (
    <div ref={ref} className={cn('reveal-mask', className)} data-shown={shown ? 'true' : 'false'}>
      <div
        className="reveal-mask__inner"
        style={{ transitionDelay: reduced ? '0ms' : `${delay}ms` }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * A row whose children arrive one after another.
 *
 * Saves threading a delay through every call site by hand, and keeps the
 * interval between items in one place — the rhythm is the effect, and it is
 * only convincing while every row on the page shares it.
 */
export function RevealGroup({
  children,
  className,
  step = 90,
  start = 0,
}: {
  children: React.ReactNode[]
  className?: string
  /** Gap between one child arriving and the next, in ms. */
  step?: number
  start?: number
}) {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <RevealBlock key={index} delay={start + index * step}>
          {child}
        </RevealBlock>
      ))}
    </div>
  )
}
