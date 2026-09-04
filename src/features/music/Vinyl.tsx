import { useEffect, useRef } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * The record — a real one you can put your hand on.
 *
 * Two interactions live here, and both are the point of Muse._v2's player:
 *
 * - A **tonearm** that swings onto the record when the music starts and lifts
 *   off when it stops — the "playing" tell you read from across a room.
 *
 * - **Drag to scrub.** Grab the disc and turn it, and the playhead moves with
 *   the groove — a full turn is `secondsPerTurn` of the track. The disc follows
 *   your finger exactly rather than snapping, and the auto-spin stands down
 *   until you let go.
 *
 * The record is drawn to read as pressed vinyl, not a floating photo: the cover
 * is the label, ringed by fine grooves, with a lit rim and a spindle punched
 * through the middle. Rotation is a JS rAF loop rather than a CSS keyframe so
 * the drag and the playback spin can share one transform.
 *
 * Reduced motion stops the idle spin and the tonearm's swing, but never the
 * scrub — dragging to seek is a control, not an animation.
 */

/** Degrees the disc turns per second of playback. 360 / 14s ≈ a lazy LP. */
const DEG_PER_SEC = 360 / 14

/** Shortest signed distance from `a` to `b`, in degrees, in (-180, 180]. */
function angleDelta(from: number, to: number) {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

export function Vinyl({
  artwork,
  playing,
  accent = 'var(--color-signal)',
  className,
  scrubbable = false,
  secondsPerTurn = 30,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: {
  artwork: string | null
  playing: boolean
  /** Colour of the bloom behind the disc, sampled from the cover. */
  accent?: string
  className?: string
  /** Whether turning the disc seeks. Off until a duration is known. */
  scrubbable?: boolean
  /** Seconds of track moved per full turn of the disc. */
  secondsPerTurn?: number
  onScrubStart?: () => void
  /** Cumulative seconds scrubbed since the grab — signed, throttling is the caller's. */
  onScrub?: (deltaSeconds: number) => void
  onScrubEnd?: (deltaSeconds: number) => void
}) {
  const reduced = usePrefersReducedMotion()

  const disc = useRef<HTMLDivElement>(null)
  const rotation = useRef(0)
  const dragging = useRef(false)

  const playingRef = useRef(playing)
  playingRef.current = playing
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const handlers = useRef({ onScrubStart, onScrub, onScrubEnd })
  handlers.current = { onScrubStart, onScrub, onScrubEnd }
  const scrubbableRef = useRef(scrubbable)
  scrubbableRef.current = scrubbable
  const perTurnRef = useRef(secondsPerTurn)
  perTurnRef.current = secondsPerTurn

  useEffect(() => {
    let frame = 0
    let last = performance.now()

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const elapsed = (now - last) / 1000
      last = now

      if (playingRef.current && !dragging.current && !reducedRef.current) {
        rotation.current = (rotation.current + elapsed * DEG_PER_SEC) % 360
      }
      if (disc.current) disc.current.style.transform = `rotate(${rotation.current}deg)`
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const element = disc.current
    if (!element) return

    let lastAngle = 0
    let accumulated = 0

    const angleAt = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
    }

    const onDown = (event: PointerEvent) => {
      if (!scrubbableRef.current) return
      dragging.current = true
      accumulated = 0
      lastAngle = angleAt(event)
      element.setPointerCapture(event.pointerId)
      element.style.cursor = 'grabbing'
      handlers.current.onScrubStart?.()
    }

    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return
      const current = angleAt(event)
      const delta = angleDelta(lastAngle, current)
      lastAngle = current

      rotation.current += delta
      accumulated += delta
      handlers.current.onScrub?.((accumulated / 360) * perTurnRef.current)
    }

    const onUp = (event: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      element.style.cursor = ''
      try {
        element.releasePointerCapture(event.pointerId)
      } catch {
        /* Capture can already be gone if the pointer left the document. */
      }
      handlers.current.onScrubEnd?.((accumulated / 360) * perTurnRef.current)
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
    }
  }, [])

  /* Tonearm rest angles about its pivot. `down` sets the stylus on the outer
     groove; `up` lifts it clear of the record. */
  const armAngle = playing && !reduced ? 0 : -20

  return (
    <div className={cn('relative aspect-square w-full select-none', className)}>
      {/* The bloom the record casts onto the page, in the cover's own colour. */}
      <div
        aria-hidden
        className="absolute inset-[3%] rounded-full blur-[64px] transition-opacity duration-700"
        style={{ background: accent, opacity: playing ? 0.5 : 0.22 }}
      />

      {/* The platter the record sits on — a shade of graphite just proud of the
          disc, so the record reads as resting on something rather than floating. */}
      <div
        aria-hidden
        className="absolute inset-[-3%] rounded-full bg-[radial-gradient(circle_at_50%_38%,#26262c,#0c0c0f_72%)] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/5"
      />

      <div
        ref={disc}
        className={cn(
          'absolute inset-0 rounded-full shadow-[0_34px_90px_-24px_rgba(0,0,0,0.95)]',
          scrubbable ? 'cursor-grab touch-none' : '',
        )}
        style={{
          /* Pressed black vinyl: a light catching the top, falling to true
             black at the rim — MD Vinyl's glossy disc rather than a flat one. */
          background:
            'radial-gradient(circle at 50% 34%, #1b1b22 0%, #0b0b0e 46%, #030304 100%)',
        }}
        role={scrubbable ? 'slider' : undefined}
        aria-label={scrubbable ? 'Turn the record to scrub' : undefined}
      >
        {/* Grooves: fine concentric rings pressed across the black, the thing
            that makes it read as a record and not a black coin. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full opacity-80"
          style={{
            background:
              'repeating-radial-gradient(circle at 50% 50%, rgba(0,0,0,0.6) 0px, rgba(0,0,0,0.6) 0.7px, rgba(255,255,255,0.05) 1.1px, rgba(255,255,255,0.05) 1.5px, transparent 1.5px, transparent 3.2px)',
          }}
        />

        {/* A wide, soft gloss falling across the disc from the top-left — the
            single highlight that makes lacquer read as lacquer. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(58% 46% at 34% 26%, rgba(255,255,255,0.16), rgba(255,255,255,0.04) 42%, transparent 62%)',
          }}
        />
        {/* A tighter specular sweep, like a lamp caught on the turn. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(118deg,transparent_40%,rgba(255,255,255,0.12)_49%,transparent_57%)]"
        />

        {/* The label: the album art, pressed into the centre the way a 45's is —
            a proper circular label, not the whole face. */}
        <span className="pointer-events-none absolute inset-[30%] overflow-hidden rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(0,0,0,0.5)] ring-1 ring-white/15">
          {artwork ? (
            <img src={artwork} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            <span className="block size-full bg-gradient-to-br from-signal/70 to-signal-deep" />
          )}
          {/* A slick of shine across the paper label. */}
          <span
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.18)_0%,transparent_34%)]"
          />
        </span>

        {/* Lit outer rim — the edge of a thick disc. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/12" />

        {/* The spindle hole, punched through the middle of the label. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[3.4%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#050506] shadow-[0_0_0_2px_rgba(255,255,255,0.14),inset_0_1px_1px_rgba(0,0,0,0.9)]"
        />
      </div>

      {/* The tonearm, mounted at the top-right and reaching onto the record. */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <defs>
          <linearGradient id="chrome" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4f4f6" />
            <stop offset="0.5" stopColor="#b9b9c0" />
            <stop offset="1" stopColor="#8a8a93" />
          </linearGradient>
        </defs>

        {/* The mounting base, over the platter's edge. */}
        <circle cx="88" cy="12" r="7" fill="#1a1a1f" stroke="#3a3a42" strokeWidth="1" />
        <circle cx="88" cy="12" r="3" fill="url(#chrome)" />

        <g
          style={{
            transformOrigin: '88px 12px',
            transform: `rotate(${armAngle}deg)`,
            transition: reduced ? 'none' : 'transform 750ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          {/* Counterweight behind the pivot. */}
          <line x1="88" y1="12" x2="95.5" y2="5.5" stroke="url(#chrome)" strokeWidth="3.6" strokeLinecap="round" />
          <circle cx="96.5" cy="4.5" r="3.6" fill="#20202a" stroke="url(#chrome)" strokeWidth="1.2" />
          {/* The arm tube reaching to the headshell over the outer groove. */}
          <line x1="88" y1="12" x2="47" y2="47" stroke="url(#chrome)" strokeWidth="2.6" strokeLinecap="round" />
          {/* Headshell + stylus at the reaching end. */}
          <g transform="translate(47 47) rotate(40)">
            <rect x="-5" y="-3.6" width="10" height="7.2" rx="1.8" fill="#26262e" stroke="url(#chrome)" strokeWidth="0.8" />
            <line x1="0" y1="3.6" x2="0" y2="6.2" stroke="#cfcfd6" strokeWidth="1.2" />
            <circle cx="0" cy="6.4" r="1.3" fill="var(--color-signal)" />
          </g>
        </g>

        {/* The cap on the mounting post, drawn last. */}
        <circle cx="88" cy="12" r="1.6" fill="#54545c" />
      </svg>
    </div>
  )
}
