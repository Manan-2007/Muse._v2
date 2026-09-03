/**
 * Live playback state, per room.
 *
 * Deliberately in memory, for the same reason presence is: "we are 14 minutes
 * into this video" is only true while people are actually watching, and a value
 * like that left in SQLite after a crash is a lie the next session inherits.
 * The queue is the durable half of the feature and lives in the database.
 *
 * This module is the only clock that matters. Clients report what they *want*
 * to happen; the server decides when it happened, so two people hitting play a
 * few hundred milliseconds apart resolve the same way for everybody.
 */

export const WATCH_SOURCES = ['youtube', 'file', 'external'] as const
export type WatchSource = (typeof WATCH_SOURCES)[number]

export type WatchItem = {
  id: string
  source: WatchSource
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
  /** Published WebVTT tracks, resolved when the item is loaded. */
  subtitles?: { language: string; label: string; url: string }[]
}

export const WATCH_ACTIONS = [
  'load',
  'play',
  'pause',
  'seek',
  'rate',
  'advance',
  'open',
] as const
export type WatchAction = (typeof WATCH_ACTIONS)[number]

/** Keyed by socket id in `Session.viewers`; see `addViewer`. */
type Viewer = { userId: string; name: string }

type Session = {
  item: WatchItem | null
  playing: boolean
  /** Seconds into `item` as of `at`. */
  position: number
  rate: number
  /** Server clock (ms) when position/playing last changed. */
  at: number
  /** Monotonic *within an epoch*. Clients drop anything already applied. */
  seq: number
  /**
   * Identifies this run of the session.
   *
   * `seq` restarts at zero whenever the session map is rebuilt — a server
   * restart, or the room's last viewer leaving and coming back much later.
   * Without something to tell those apart, a client that had reached seq 40
   * would silently discard every snapshot of the new session as stale and sit
   * there frozen. The epoch is what makes "this is a different run, take it"
   * expressible.
   */
  epoch: number
  by: { id: string; name: string; action: WatchAction } | null
  viewers: Map<string, Viewer>
}

const sessions = new Map<string, Session>()

/* Monotonic across the process, so two sessions created in the same
   millisecond still differ. */
let epochCounter = 0

function blank(): Session {
  epochCounter += 1
  return {
    item: null,
    playing: false,
    position: 0,
    rate: 1,
    at: Date.now(),
    seq: 0,
    epoch: Date.now() * 1000 + (epochCounter % 1000),
    by: null,
    viewers: new Map(),
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

/** Where the video actually is right now, projected from the last known point. */
function project(state: Session) {
  if (!state.playing) return state.position
  const elapsed = (Date.now() - state.at) / 1000
  const position = state.position + elapsed * state.rate
  /* Never project past the end — a finished video would otherwise report an
     ever-growing position and every late joiner would try to seek past it. */
  if (state.item?.duration != null) return Math.min(position, state.item.duration)
  return position
}

export type WatchSnapshot = {
  roomId: string
  item: WatchItem | null
  playing: boolean
  position: number
  rate: number
  seq: number
  /** Changes whenever `seq` restarts. See the note on `Session.epoch`. */
  epoch: number
  by: Session['by']
  viewers: { id: string; name: string }[]
  /** Server clock at the moment of sending, for the client's offset estimate. */
  serverTime: number
}

export function snapshot(roomId: string): WatchSnapshot {
  const state = session(roomId)
  return {
    roomId,
    item: state.item,
    playing: state.playing,
    position: project(state),
    rate: state.rate,
    seq: state.seq,
    epoch: state.epoch,
    by: state.by,
    /* One entry per person, not per socket — a second tab must not appear as
       a second viewer. */
    viewers: [
      ...new Map(
        [...state.viewers.values()].map((viewer) => [viewer.userId, viewer]),
      ).values(),
    ].map((viewer) => ({ id: viewer.userId, name: viewer.name })),
    serverTime: Date.now(),
  }
}

/** Distinct people, not sockets — two tabs is one person watching. */
function distinctViewers(state: Session) {
  return new Set([...state.viewers.values()].map((viewer) => viewer.userId)).size
}

export function isWatching(roomId: string) {
  const state = sessions.get(roomId)
  return state ? distinctViewers(state) > 0 : false
}

/**
 * Park the video where it is.
 *
 * Called when the stage empties. Freezing the projected position rather than
 * clearing it is what makes walking back in resume from the same frame instead
 * of restarting — and it has to happen the moment the last person leaves, or
 * the video "plays" to an empty room and everyone returns to find it minutes
 * ahead of where they left it.
 */
function park(state: Session) {
  state.position = project(state)
  state.playing = false
  state.at = Date.now()
}

/**
 * Somebody opened the stage.
 *
 * Keyed by socket id, deliberately. The obvious version keeps a per-user count
 * and increments it — but the open handler awaits a membership check, so a
 * close arriving mid-flight no-ops and the retried open increments twice. The
 * count then never falls back to zero: the room shows phantom viewers forever
 * and, worse, never parks the video because "everyone left" never becomes true.
 * A socket id is idempotent, so the whole failure mode disappears.
 */
export function addViewer(roomId: string, socketId: string, userId: string, name: string) {
  const state = session(roomId)
  state.viewers.set(socketId, { userId, name })
  return distinctViewers(state)
}

export function removeViewer(roomId: string, socketId: string) {
  const state = sessions.get(roomId)
  if (!state) return 0

  state.viewers.delete(socketId)
  const remaining = distinctViewers(state)
  if (remaining === 0) park(state)

  return remaining
}

/** Forget a socket in every room. The disconnect safety net. */
export function dropSocket(socketId: string): string[] {
  const touched: string[] = []

  for (const [roomId, state] of sessions) {
    if (state.viewers.delete(socketId)) {
      touched.push(roomId)
      if (distinctViewers(state) === 0) park(state)
    }
  }

  return touched
}

export function dropRoom(roomId: string) {
  sessions.delete(roomId)
}

export type WatchControl =
  | { action: 'load'; item: WatchItem; position?: number }
  | { action: 'play'; position?: number }
  | { action: 'pause'; position?: number }
  | { action: 'seek'; position: number }
  | { action: 'rate'; rate: number }
  | { action: 'advance'; item: WatchItem | null }
  | { action: 'open' }

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function clampPosition(state: Session, seconds: number) {
  if (!Number.isFinite(seconds)) return state.position
  const max = state.item?.duration ?? Number.MAX_SAFE_INTEGER
  return Math.min(Math.max(seconds, 0), max)
}

/**
 * Apply a control and return the new snapshot.
 *
 * Last write wins, and "last" is decided here rather than by whoever's clock
 * was fastest. There is no host: anyone in the room can drive, so the only
 * ordering guarantee worth having is the server's arrival order.
 */
export function apply(
  roomId: string,
  user: { id: string; name: string },
  control: WatchControl,
): WatchSnapshot {
  const state = session(roomId)
  const now = Date.now()

  switch (control.action) {
    case 'load':
    case 'advance': {
      state.item = control.action === 'load' ? control.item : control.item
      state.position = control.action === 'load' ? clampPosition(state, control.position ?? 0) : 0
      /* A queue advance keeps rolling; an explicit load starts playing too,
         because choosing something is the intent to watch it. */
      state.playing = state.item !== null
      state.at = now
      break
    }

    case 'play': {
      if (control.position !== undefined) state.position = clampPosition(state, control.position)
      else state.position = project(state)
      state.playing = true
      state.at = now
      break
    }

    case 'pause': {
      state.position =
        control.position !== undefined ? clampPosition(state, control.position) : project(state)
      state.playing = false
      state.at = now
      break
    }

    case 'seek': {
      state.position = clampPosition(state, control.position)
      state.at = now
      break
    }

    case 'rate': {
      /* Snapped to the set every player agrees on — YouTube rejects anything
         else, and a rate one client can't honour desynchronises the room. */
      const nearest = RATES.reduce((best, rate) =>
        Math.abs(rate - control.rate) < Math.abs(best - control.rate) ? rate : best,
      )
      state.position = project(state)
      state.rate = nearest
      state.at = now
      break
    }

    case 'open':
      /* No state change — it exists so opening the stage announces itself and
         gets a snapshot back through the same path as everything else. */
      break
  }

  if (control.action !== 'open') state.seq += 1
  state.by = { id: user.id, name: user.name, action: control.action }

  return snapshot(roomId)
}
