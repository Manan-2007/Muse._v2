import { cn } from '@/lib/utils'

/**
 * The record.
 *
 * Muse._v1's move: the whole album cover *is* the disc — a large circle that
 * turns while the music plays and holds its groove when it stops, rather than a
 * small label sunk into a black record. A thin groove ring and a spindle at the
 * centre keep the vinyl read; a soft bloom in the cover's own colour sits
 * behind it so the object glows on the page it colours.
 *
 * The rotation is a CSS animation that is paused rather than removed, so the
 * record picks up from where it was instead of snapping back to zero — and it
 * runs on the compositor, so it stays smooth while the main thread is busy.
 */
export function Vinyl({
  artwork,
  playing,
  accent = 'var(--color-signal)',
  className,
}: {
  artwork: string | null
  playing: boolean
  /** Colour of the bloom behind the disc, sampled from the cover. */
  accent?: string
  className?: string
}) {
  return (
    <div className={cn('relative aspect-square w-full', className)}>
      {/* The bloom the record casts onto the page, in the cover's own colour. */}
      <div
        aria-hidden
        className="absolute inset-[4%] rounded-full blur-[60px] transition-opacity duration-700"
        style={{ background: accent, opacity: playing ? 0.5 : 0.22 }}
      />

      <div
        className="absolute inset-0 rounded-full shadow-[0_45px_100px_-24px_rgba(0,0,0,0.8)]"
        style={{
          animation: 'music-spin 14s linear infinite',
          animationPlayState: playing ? 'running' : 'paused',
        }}
      >
        {/* The cover, filling the disc. */}
        {artwork ? (
          <img
            src={artwork}
            alt=""
            className="absolute inset-0 size-full rounded-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-signal/70 to-signal-deep" />
        )}

        {/* A dark groove at the very rim and a bright hairline just inside it —
            the two edges that make a flat circle read as a pressed record. */}
        <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-inset ring-black/45" />
        <span aria-hidden className="absolute inset-[2.5%] rounded-full ring-1 ring-inset ring-white/12" />

        {/* A single sheen sweeping across the face, like light on lacquer. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[linear-gradient(118deg,transparent_38%,rgba(255,255,255,0.16)_48%,transparent_58%)]"
        />

        {/* The spindle: a small dark hub with a punched hole, so the middle
            reads as the record's centre without masking the cover. */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 grid size-[10%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-void/75 ring-1 ring-white/15 backdrop-blur-sm"
        >
          <span className="size-[26%] rounded-full bg-void ring-1 ring-white/25" />
        </span>
      </div>
    </div>
  )
}
