import { cn } from '@/lib/utils'

/**
 * The Muse. mark.
 *
 * A record: the outer edge, two grooves, and the spindle at the centre. Drawn
 * in strokes of `currentColor` so it takes the colour of whatever it sits on
 * and reads on the dark chrome and a light page alike — the same reason the
 * old cut-out mark did, without the mask.
 *
 * The spindle hole is a filled dot rather than a ring so the centre still reads
 * at 28px, where a hollow one closes up to a smudge.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('size-7 shrink-0 text-chalk', className)}
      role="img"
      aria-label="Muse."
      fill="none"
    >
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="6" />
      <circle cx="50" cy="50" r="31" stroke="currentColor" strokeWidth="3" opacity="0.55" />
      <circle cx="50" cy="50" r="20" stroke="currentColor" strokeWidth="3" opacity="0.35" />
      <circle cx="50" cy="50" r="6.5" fill="currentColor" />
    </svg>
  )
}
