import { useId } from 'react'

import { cn } from '@/lib/utils'

/**
 * The Huddle mark.
 *
 * Two figures leaning in until they meet — the notch where they touch is the
 * whole idea, and the arch they make between them is the room. Cut out rather
 * than drawn on: the counters are holes, so the mark takes the colour of
 * whatever it sits on and works on the dark chrome and a light page alike.
 *
 * The cut-outs are a mask, not an even-odd path. Even-odd cancels wherever
 * subpaths overlap, which turned the bar joining the two circles back into
 * fill; a mask lets them union instead.
 */
export function Logo({ className }: { className?: string }) {
  /* Ids have to be unique per instance — the header and the footer both
     render one, and a repeated id makes the second mask reference the
     first, which silently drops the cut-outs. */
  const id = useId()

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('size-7 shrink-0 text-chalk', className)}
      role="img"
      aria-label="Huddle"
    >
      <defs>
        <mask id={id}>
    <rect width="100" height="100" fill="#fff"/>
    <circle cx="38" cy="32" r="8" fill="#000"/>
    <circle cx="62" cy="32" r="8" fill="#000"/>
    <rect x="38" y="28" width="24" height="8" rx="4" fill="#000"/>
    <path fill="#000" d="M20 92V62c0-15 13-24 30-24s30 9 30 24v30h-7c0-14-2-22-5-28-3-7-9-11-18-11s-15 4-18 11c-3 6-5 14-5 28Z"/>
    <path fill="#000" d="M10 92V72a20 20 0 0 1 20 20Z"/>
    <path fill="#000" d="M90 92V72a20 20 0 0 0-20 20Z"/>
        </mask>
      </defs>
      <path mask={`url(#${id})`} fill="currentColor" d="M10 92V46c0-19 13-32 29-32 6 0 9 4 11 9 2-5 5-9 11-9 16 0 29 13 29 32v46Z" />
    </svg>
  )
}
