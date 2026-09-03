/**
 * The room's focus timer, per room.
 *
 * In memory for the same reason playback position is: "we are eleven minutes
 * into this sitting" is only true while people are sitting, and a value like
 * that left in SQLite after a crash is a lie the next session inherits.
 *
 * The same shape as `watch.service.ts` and for the same reason — the server
 * owns the clock. Clients say what they want to happen; when it happened is
 * decided here, so two people starting the timer a few hundred milliseconds
 * apart resolve identically for everybody watching.
 */

export const TIMER_PHASES = ['focus', 'short', 'long'] as const
export type TimerPhase = (typeof TIMER_PHASES)[number]

export const TIMER_ACTIONS = ['start', 'pause', 'reset', 'skip', 'configure', 'open'] as const
export type TimerAction = (typeof TIMER_ACTIONS)[number]

/** Defaults are the pomodoro ones people already expect, in seconds. */
const DEFAULTS: Record<TimerPhase, number> = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 }

/** How many focus sittings before the long break. */
const LONG_BREAK_EVERY = 4

/** Nobody wants a nine-hour timer, and a zero-second one is a division by it. */
const MIN_SECONDS = 60
const MAX_SECONDS = 4 * 60 * 60

type Session = {
  phase: TimerPhase
  durations: Record<TimerPhase, number>
  /** Seconds left as of `at`. */
  remaining: number
  running: boolean
  /** Server clock (ms) when remaining/running last changed. */
  at: number
  /** Focus sittings finished — drives when the long break comes round. */
  completed: number
  seq: number
  /** See the note on `Session.epoch` in watch.service.ts. */
  epoch: number
  by: { id: string; name: string; action: TimerAction } | null
}

const sessions = new Map<string, Session>()

let epochCounter = 0

function blank(): Session {
  epochCounter += 1
  return {
    phase: 'focus',
    durations: { ...DEFAULTS },
    remaining: DEFAULTS.focus,
    running: false,
    at: Date.now(),
    completed: 0,
    seq: 0,
    epoch: Date.now() * 1000 + (epochCounter % 1000),
    by: null,
  }
}

function session(roomId: string): Session {
  let found = sessions.get(roomId)
  if (!found) {
    found = blank()
    sessions.set(roomId, found)
  }
  return found
}

/**
 * Seconds left right now, projected from the last known point.
 *
 * Clamped at zero and left there rather than rolling into the next phase on
 * its own. A timer that advanced itself server-side would move for a room
 * with nobody in it, and everyone would come back to a sitting that had run
 * three phases without them. The client sees zero, says so, and somebody
 * presses the next thing.
 */
function project(state: Session) {
  if (!state.running) return state.remaining
  const elapsed = (Date.now() - state.at) / 1000
  return Math.max(0, state.remaining - elapsed)
}

export type TimerSnapshot = {
  roomId: string
  phase: TimerPhase
  durations: Record<TimerPhase, number>
  remaining: number
  running: boolean
  completed: number
  /** Which phase `skip` would move to, so the client can name the button. */
  next: TimerPhase
  seq: number
  epoch: number
  by: Session['by']
  /** Server clock at send, for the client's offset estimate. */
  serverTime: number
}

function nextPhase(state: Session): TimerPhase {
  if (state.phase !== 'focus') return 'focus'
  return (state.completed + 1) % LONG_BREAK_EVERY === 0 ? 'long' : 'short'
}

export function snapshot(roomId: string): TimerSnapshot {
  const state = session(roomId)
  return {
    roomId,
    phase: state.phase,
    durations: { ...state.durations },
    remaining: project(state),
    running: state.running,
    completed: state.completed,
    next: nextPhase(state),
    seq: state.seq,
    epoch: state.epoch,
    by: state.by,
    serverTime: Date.now(),
  }
}

export type TimerControl =
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'reset' }
  | { action: 'skip' }
  | { action: 'configure'; durations: Partial<Record<TimerPhase, number>> }
  | { action: 'open' }

function clampDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return null
  return Math.min(Math.max(Math.round(seconds), MIN_SECONDS), MAX_SECONDS)
}

/**
 * Apply a control and return the new snapshot.
 *
 * Last write wins, and "last" is the server's arrival order. There is no host
 * here either — anyone in the room can start or stop the sitting, which is
 * the point of it being the room's timer rather than one person's.
 */
export function apply(
  roomId: string,
  user: { id: string; name: string },
  control: TimerControl,
): TimerSnapshot {
  const state = session(roomId)
  const now = Date.now()

  switch (control.action) {
    case 'start': {
      /* Starting a finished phase restarts it rather than doing nothing —
         pressing play on 00:00 obviously means "go again". */
      state.remaining = project(state) > 0 ? project(state) : state.durations[state.phase]
      state.running = true
      state.at = now
      break
    }

    case 'pause': {
      state.remaining = project(state)
      state.running = false
      state.at = now
      break
    }

    case 'reset': {
      state.remaining = state.durations[state.phase]
      state.running = false
      state.at = now
      break
    }

    case 'skip': {
      /* A finished focus sitting counts even when it is skipped past — the
         count is of sittings begun and left behind, and treating a skip as
         nothing would let a room reach the long break without ever passing
         four of them. */
      const target = nextPhase(state)
      if (state.phase === 'focus') state.completed += 1
      state.phase = target
      state.remaining = state.durations[target]
      state.running = false
      state.at = now
      break
    }

    case 'configure': {
      for (const phase of TIMER_PHASES) {
        const wanted = control.durations[phase]
        if (wanted === undefined) continue
        const clamped = clampDuration(wanted)
        if (clamped !== null) state.durations[phase] = clamped
      }
      /* A stopped timer takes the new length immediately; a running one keeps
         counting down the sitting already underway, because moving the goal
         posts mid-sitting is not what "change the default" means. */
      if (!state.running) {
        state.remaining = state.durations[state.phase]
        state.at = now
      }
      break
    }

    case 'open':
      /* No state change. It exists so opening the page announces itself and
         gets a snapshot back down the same path as everything else. */
      break
  }

  if (control.action !== 'open') state.seq += 1
  state.by = { id: user.id, name: user.name, action: control.action }

  return snapshot(roomId)
}

export function dropRoom(roomId: string) {
  sessions.delete(roomId)
}
