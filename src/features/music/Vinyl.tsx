import { useEffect, useRef } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * The record — and now something you can actually put your hand on.
 *
 * Two interactions live here, and both are the point of Muse._v2's player:
 *
 * - A **tonearm** that swings onto the record when the music starts and lifts
 *   off when it stops. It is decoration with a job: it is the thing that reads
 *   as "playing" from across a room, before you have looked at the transport.
 *
 * - **Drag to scrub.** Grab the disc and turn it, and the playhead moves with
 *   the groove — a full turn is `secondsPerTurn` of the track. Turning it also
 *   *feels* like a record: the disc follows your finger exactly rather than
 *   snapping, and the auto-spin stands down until you let go.
 *
 * Rotation is driven in JavaScript rather than by a CSS keyframe, because the
 * drag has to add to the same angle the playback spin advances — one transform,
 * two contributors. A single `rotate()` written once per frame is cheap; the
 * thing CSS bought (compositor spin while the main thread is busy) is not worth
 * giving up the ability to grab the record for.
 *
 * Reduced motion stops the idle spin and the tonearm's swing, but never the
 * scrub — dragging to seek is a control, not an animation, and switching it off
 * would take a feature away rather than calm one down.
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

  /* Read inside the animation loop and the pointer handlers, which are set up
     once — so the current values live in refs rather than the closure. */
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

  /* The turntable loop: advance the angle while playing, and paint whatever it
     is every frame so a drag that mutated it directly still shows. */
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

  /* Pointer scrub. Turning the disc is measured as an angle about its centre,
     accumulated across the whole gesture, and handed back as seconds. */
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

  /* Tonearm rest angles, about its pivot at the top-right. `up` holds it clear
     of the record; `down` sets the needle onto the outer groove. */
  const armAngle = playing && !reduced ? 26 : 6

  return (
    <div className={cn('relative aspect-square w-full select-none', className)}>
      {/* The bloom the record casts onto the page, in the cover's own colour. */}
      <div
        aria-hidden
        className="absolute inset-[4%] rounded-full blur-[60px] transition-opacity duration-700"
        style={{ background: accent, opacity: playing ? 0.5 : 0.22 }}
      />

      <div
        ref={disc}
        className={cn(
          'absolute inset-0 rounded-full shadow-[0_45px_100px_-24px_rgba(0,0,0,0.8)]',
          scrubbable ? 'cursor-grab touch-none' : '',
        )}
        role={scrubbable ? 'slider' : undefined}
        aria-label={scrubbable ? 'Turn the record to scrub' : undefined}
      >
        {/* The cover, filling the disc. Not a drag target of its own — the
            whole disc is, so the image never gets picked up and ghosted. */}
        {artwork ? (
          <img
            src={artwork}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full rounded-full object-cover"
          />
        ) : (
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-signal/70 to-signal-deep" />
        )}

        {/* A dark groove at the very rim and a bright hairline just inside it —
            the two edges that make a flat circle read as a pressed record. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-black/45" />
        <span aria-hidden className="pointer-events-none absolute inset-[2.5%] rounded-full ring-1 ring-inset ring-white/12" />

        {/* A single sheen sweeping across the face, like light on lacquer. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(118deg,transparent_38%,rgba(255,255,255,0.16)_48%,transparent_58%)]"
        />

        {/* The spindle: a small dark hub with a punched hole, so the middle
            reads as the record's centre without masking the cover. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 grid size-[10%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-void/75 ring-1 ring-white/15 backdrop-blur-sm"
        >
          <span className="size-[26%] rounded-full bg-void ring-1 ring-white/25" />
        </span>
      </div>

      {/* The tonearm, over the record. Swings down onto it on play, lifts on
          pause. Pivots about the mounting post at the top-right. */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 size-full overflow-visible drop-shadow-[0_6px_12px_rgba(0,0,0,0.55)]"
      >
        <g
          style={{
            transformOrigin: '86px 14px',
            transform: `rotate(${armAngle}deg)`,
            transition: reduced ? 'none' : 'transform 700ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          {/* Counterweight behind the pivot, then the arm reaching to the
              headshell that rests near the outer groove. */}
          <line x1="86" y1="14" x2="94" y2="7" stroke="#cfcfd4" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="95" cy="6" r="3.2" fill="#e7e7ea" />
          <line x1="86" y1="14" x2="52" y2="44" stroke="#e7e7ea" strokeWidth="2.4" strokeLinecap="round" />
          {/* Headshell + needle at the reaching end. */}
          <g transform="translate(52 44)">
            <rect x="-4" y="-3.4" width="8" height="6.8" rx="1.6" fill="#d5d5da" transform="rotate(-42)" />
            <circle cx="0" cy="3" r="1.5" fill="var(--color-signal)" />
          </g>
        </g>
        {/* The mounting post the arm turns on. Drawn after, so it caps the arm. */}
        <circle cx="86" cy="14" r="5.5" fill="#17171b" stroke="#3a3a42" strokeWidth="1" />
        <circle cx="86" cy="14" r="1.8" fill="#54545c" />
      </svg>
    </div>
  )
}
