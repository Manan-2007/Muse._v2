import { useEffect, useState } from 'react'
import { Coffee, Pause, Play, RotateCcw, SkipForward } from 'lucide-react'

import type { TimerPhase, useStudyTimer } from '@/features/study/useStudyTimer'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * The room's focus timer.
 *
 * The one part of Study that is genuinely live, and the one place the signal
 * accent belongs: a running countdown is exactly the shared state the palette
 * reserves red for, the same as a playhead or a presence dot.
 */

const PHASE_LABEL: Record<TimerPhase, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
}

const PRESETS: { label: string; durations: Partial<Record<TimerPhase, number>> }[] = [
  { label: '25 / 5', durations: { focus: 25 * 60, short: 5 * 60 } },
  { label: '50 / 10', durations: { focus: 50 * 60, short: 10 * 60 } },
  { label: '90 / 20', durations: { focus: 90 * 60, short: 20 * 60 } },
]

function clock(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(whole / 60)
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export function FocusTimer({ timer }: { timer: ReturnType<typeof useStudyTimer> }) {
  const { snapshot, remaining, send } = timer
  const reduced = usePrefersReducedMotion()

  /*
   * Ticked here rather than driven by the server.
   *
   * The server only sends on a change — start, pause, skip — because a message
   * a second for every room would be traffic for something the client can work
   * out from a number it already has. This re-renders once a second and asks
   * the hook where the count actually is.
   */
  const [, tick] = useState(0)
  useEffect(() => {
    if (!snapshot?.running) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [snapshot?.running])

  if (!snapshot) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-[0.82rem] text-[var(--study-faint)]">Syncing the timer…</p>
      </div>
    )
  }

  const left = remaining()
  const total = snapshot.durations[snapshot.phase]
  const done = total > 0 ? 1 - left / total : 0
  const finished = left <= 0
  const resting = snapshot.phase !== 'focus'

  return (
    <div data-lenis-prevent className="grid h-full place-items-center overflow-y-auto px-4 py-6">
      <div className="w-full max-w-md text-center">
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[0.75rem]',
            resting
              ? 'border-[var(--study-line)] bg-[var(--study-card)] text-[var(--study-soft)]'
              : 'border-[var(--study-accent)] bg-[var(--study-bad-soft)] text-[var(--study-bad)]',
          )}
        >
          {resting && <Coffee aria-hidden className="size-3.5" />}
          {PHASE_LABEL[snapshot.phase]}
          {snapshot.running && !reduced && (
            <span className="size-1.5 animate-signal-pulse rounded-full bg-[var(--study-accent)]" />
          )}
        </span>

        <p
          className={cn(
            'mt-6 font-display text-[4.5rem] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[6rem]',
            finished ? 'text-[var(--study-bad)]' : 'text-[var(--study-text)]',
          )}
          /* Announced only when it changes phase or finishes — a live region
             reading every second would be unusable with a screen reader. */
          aria-live="off"
        >
          {clock(left)}
        </p>

        <p className="mt-2 text-[0.8rem] text-[var(--study-faint)]">
          {finished
            ? `${PHASE_LABEL[snapshot.phase]} done — next up, ${PHASE_LABEL[snapshot.next].toLowerCase()}`
            : `${snapshot.completed} ${snapshot.completed === 1 ? 'sitting' : 'sittings'} done`}
        </p>

        <div className="mt-6 h-1 overflow-hidden rounded-full bg-[var(--study-card-strong)]">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-1000 ease-linear',
              resting ? 'bg-[var(--study-line-strong)]' : 'bg-[var(--study-accent)]',
            )}
            style={{ width: `${Math.min(100, Math.max(0, done * 100))}%` }}
          />
        </div>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Control
            label="Reset"
            onClick={() => send({ action: 'reset' })}
            icon={<RotateCcw aria-hidden className="size-4" />}
          />

          <button
            type="button"
            onClick={() => send({ action: snapshot.running ? 'pause' : 'start' })}
            aria-label={snapshot.running ? 'Pause' : 'Start'}
            className="grid size-16 place-items-center rounded-full bg-[var(--study-accent)] text-[var(--study-on-accent)] outline-none transition-transform duration-200 hover:scale-[1.04]"
          >
            {snapshot.running ? (
              <Pause aria-hidden className="size-6 fill-current" />
            ) : (
              <Play aria-hidden className="size-6 translate-x-0.5 fill-current" />
            )}
          </button>

          <Control
            label={`Skip to ${PHASE_LABEL[snapshot.next].toLowerCase()}`}
            onClick={() => send({ action: 'skip' })}
            icon={<SkipForward aria-hidden className="size-4" />}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {PRESETS.map((preset) => {
            const active = snapshot.durations.focus === preset.durations.focus
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => send({ action: 'configure', durations: preset.durations })}
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[0.76rem] outline-none transition-colors duration-300',
                  '',
                  active
                    ? 'border-[var(--study-line-strong)] bg-[var(--study-card-strong)] text-[var(--study-text)]'
                    : 'border-[var(--study-line)] bg-[var(--study-card)] text-[var(--study-soft)] hover:text-[var(--study-text)]',
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        {snapshot.by && (
          <p className="mt-5 text-[0.74rem] text-[var(--study-faint)]">
            {snapshot.by.name} {verb(snapshot.by.action)}
          </p>
        )}
      </div>
    </div>
  )
}

function verb(action: string) {
  switch (action) {
    case 'start':
      return 'started it'
    case 'pause':
      return 'paused it'
    case 'reset':
      return 'reset it'
    case 'skip':
      return 'skipped ahead'
    case 'configure':
      return 'changed the length'
    default:
      return 'opened it'
  }
}

function Control({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-full border border-[var(--study-line)] bg-[var(--study-card)] text-[var(--study-soft)] outline-none transition-colors hover:bg-[var(--study-card-strong)] hover:text-[var(--study-text)]"
    >
      {icon}
    </button>
  )
}
