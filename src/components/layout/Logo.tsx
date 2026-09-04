import { cn } from '@/lib/utils'

/**
 * The Muse. mark.
 *
 * A record: an outer edge, two grooves, and a red centre where a spindle would
 * be — the same red as the period in the "Muse." wordmark, so the mark and the
 * name are one idea. The rings take `currentColor`, so the mark sits on dark
 * chrome or a light page alike; the centre is always the signal red, which is
 * the one spot of brand colour that makes it read as Muse. and not just a
 * generic disc.
 *
 * Drawn on a 100×100 grid with generous stroke weights so it holds together
 * as a favicon and an app icon, not only at header size.
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
      <circle cx="50" cy="50" r="45" stroke="currentColor" strokeWidth="5.5" />
      <circle cx="50" cy="50" r="33" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
      <circle cx="50" cy="50" r="24" stroke="currentColor" strokeWidth="2.5" opacity="0.32" />
      {/* The label: the brand red, with a punched spindle hole. */}
      <circle cx="50" cy="50" r="13" fill="var(--color-signal)" />
      <circle cx="50" cy="50" r="3" fill="currentColor" />
    </svg>
  )
}

/**
 * The full lockup: the record mark beside the "Muse." wordmark.
 *
 * One component so every header, footer and splash spells the name the same
 * way — "Muse" in the page's ink, the period in the signal red that the mark's
 * centre also wears.
 */
export function Wordmark({
  className,
  markClassName,
}: {
  className?: string
  markClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Logo className={markClassName} />
      <span className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-chalk">
        Muse<span className="text-signal">.</span>
      </span>
    </span>
  )
}
