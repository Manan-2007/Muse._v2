import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Pause, Play } from 'lucide-react'

import { RevealBlock, SweepHeading } from '@/features/landing/components/Reveal'
import { cn } from '@/lib/utils'

/**
 * The one claim a screenshot cannot make — so this one is playable.
 *
 * Everything on this page reduces to "it happens on both screens at once",
 * and a picture can only ever show one of them agreeing with itself. So the
 * visitor gets the control: drag the scrubber, press pause, and watch the
 * second screen answer in the same gesture. Nobody has to believe a caption.
 *
 * Both screens read the same piece of state, which is not a trick — it is
 * exactly what the real thing does, with a server in the middle instead of a
 * `useState`.
 */

const RUNTIME = 7471 // 2:04:31, in seconds.

function clockOf(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function Screen({
  who,
  where,
  position,
  playing,
  /** Only one screen carries the controls — the other is the proof. */
  live,
  onScrub,
  onToggle,
}: {
  who: string
  where: string
  position: number
  playing: boolean
  live?: boolean
  onScrub?: (seconds: number) => void
  onToggle?: () => void
}) {
  const percent = (position / RUNTIME) * 100

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-3 pb-2.5">
        <span className="truncate text-[0.78rem] text-chalk">
          {who} <span className="text-dusk">· {where}</span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] transition-colors duration-300',
            live ? 'bg-signal/15 text-signal-bright' : 'bg-white/[0.06] text-dusk',
          )}
        >
          {live ? 'you' : 'following'}
        </span>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-void transition-colors duration-300',
          live ? 'border-white/20' : 'border-white/10',
        )}
      >
        <div className="relative aspect-video w-full bg-[linear-gradient(160deg,#1d2733,#0d1218_60%)]">
          {/* Something that visibly changes with position, so scrubbing reads
              as scrubbing rather than as a number ticking. */}
          <span
            aria-hidden
            className="absolute inset-0 transition-[background-position] duration-100"
            style={{
              backgroundImage:
                'radial-gradient(60% 70% at 30% 40%, rgb(224 160 47 / 0.28), transparent 70%), radial-gradient(50% 60% at 75% 60%, rgb(47 111 208 / 0.3), transparent 70%)',
              backgroundPosition: `${-percent * 1.6}% 0%, ${percent * 1.2}% 0%`,
            }}
          />
          <span className="absolute inset-0 grid place-items-center">
            <span
              className={cn(
                'grid size-9 place-items-center rounded-full bg-chalk/95 text-void transition-transform duration-300',
                playing && 'scale-90 opacity-0',
              )}
            >
              <Pause aria-hidden className="size-4 fill-current" />
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2.5 px-3 py-2.5">
          {live && onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-label={playing ? 'Pause for the room' : 'Play for the room'}
              /* Grows to a real target on touch. A 28px control is fine under a
                 mouse and too small for a thumb, and this is the one thing on
                 the page a visitor is actually invited to press. */
              className="grid size-7 shrink-0 place-items-center rounded-full bg-chalk text-void outline-none transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal pointer-coarse:size-11"
            >
              {playing ? (
                <Pause aria-hidden className="size-3 fill-current" />
              ) : (
                <Play aria-hidden className="size-3 translate-x-px fill-current" />
              )}
            </button>
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-mist">
              {playing ? (
                <Pause aria-hidden className="size-3 fill-current" />
              ) : (
                <Play aria-hidden className="size-3 translate-x-px fill-current" />
              )}
            </span>
          )}

          <div className="relative h-1 flex-1 rounded-full bg-white/12">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-signal"
              style={{ width: `${percent}%` }}
            />
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chalk ring-2 ring-void"
              style={{ left: `${percent}%` }}
            />
            {live && onScrub && (
              /* A real range input over the top: it brings keyboard support,
                 pointer capture and touch dragging with it, none of which are
                 worth hand-rolling to make a demo draggable. */
              <input
                type="range"
                min={0}
                max={RUNTIME}
                step={1}
                value={Math.round(position)}
                aria-label="Scrub the room's film"
                onChange={(event) => onScrub(Number(event.target.value))}
                className="absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent outline-none [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent"
              />
            )}
          </div>

          {/* The two identical timestamps are the entire argument. */}
          <span className="shrink-0 font-mono text-[0.68rem] tabular-nums text-chalk">
            {clockOf(position)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function TogetherProof() {
  const [position, setPosition] = useState(3138)
  const [playing, setPlaying] = useState(false)
  const [touched, setTouched] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  /* One piece of state, read by both screens — which is the whole point, and
     also why there is nothing here to keep in sync by hand. */
  const scrub = useCallback((seconds: number) => {
    setPosition(seconds)
    setTouched(true)
  }, [])

  const toggle = useCallback(() => {
    setTouched(true)
    setPlaying((was) => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
      if (!was) {
        timer.current = setInterval(() => {
          setPosition((at) => (at >= RUNTIME ? RUNTIME : at + 1))
        }, 1000)
      }
      return !was
    })
  }, [])

  return (
    <section id="together" className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28">
      <div className="mx-auto max-w-5xl">
        <div className="max-w-2xl">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-dusk">
            Try it
          </span>
          <SweepHeading className="mt-3 font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            Drag one. Watch the other.
          </SweepHeading>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-mist">
            Not a watch party where everybody counts down and hopes. The room holds the
            position, so anyone who joins late arrives exactly where the rest of you are.
          </p>
        </div>

        <RevealBlock delay={80} className="mt-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:gap-5">
          <Screen
            who="Your screen"
            where="you are driving"
            position={position}
            playing={playing}
            live
            onScrub={scrub}
            onToggle={toggle}
          />
          <Screen who="Their screen" where="somebody else in the room" position={position} playing={playing} />
          </div>
        </RevealBlock>

        <p
          className={cn(
            'mt-5 text-center text-[0.78rem] transition-colors duration-500 sm:text-left',
            touched ? 'text-signal-bright' : 'text-dusk',
          )}
        >
          {touched
            ? 'The other screen never had to do anything.'
            : 'Drag the bar on the left, or press play.'}
        </p>
      </div>
    </section>
  )
}

export function ClosingInvite() {
  return (
    <section className="relative px-5 pb-28 pt-10 sm:px-8 md:px-12 md:pb-36 lg:pl-28">
      <div className="mx-auto max-w-3xl text-center">
        <SweepHeading className="font-display text-[clamp(1.9rem,5.5vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.025em]">
          The room is already open.
        </SweepHeading>
        <p className="mx-auto mt-4 max-w-md text-[0.95rem] leading-relaxed text-mist">
          Make one, send the link, and whoever turns up is in. Nothing to install.
        </p>
        <Link
          to="/?signup"
          className="group mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-chalk px-7 text-[0.9rem] font-medium text-void outline-none transition-transform duration-300 hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Start a room
          <ArrowRight
            aria-hidden
            className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </section>
  )
}
