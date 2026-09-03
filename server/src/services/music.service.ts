/**
 * Live listening state, per room.
 *
 * The same shape as the watch session and for the same reasons: in memory,
 * because "we are 90 seconds into this song" is only true while people are
 * listening; server-authoritative, because two people hitting play a moment
 * apart must resolve identically for everyone.
 *
 * Kept as its own module rather than generalised with `watch.service`. They
 * agree today, but a room can watch a film and listen to music at different
 * moments and the two must not share a position, a queue, or a set of
 * listeners — merging them would mean every change to one reasoning about the
 * other.
 */

export const MUSIC_SOURCES = ['file', 'youtube'] as const
export type MusicSource = (typeof MUSIC_SOURCES)[number]

export type Track = {
  id: string
  source: MusicSource
  ref: string
  title: string
  artist: string | null
  album: string | null
  /** Cover art. The client derives the whole page's palette from it. */
  artwork: string | null
  duration: number | null
}

export const MUSIC_ACTIONS = [
  'load',
  'play',
  'pause',
  'seek',
  'advance',
  'open',
  'singalong',
] as const
export type MusicAction = (typeof MUSIC_ACTIONS)[number]

type Listener = { userId: string; name: string; singing: boolean; recording: boolean }

type Session = {
  track: Track | null
  playing: boolean
  /** Seconds into `track` as of `at`. */
  position: number
  /** Server clock (ms) when position/playing last changed. */
  at: number
  /** Monotonic within an epoch. Clients drop anything already applied. */
  seq: number
  /** Identifies this run, so a restarted session isn't read as stale. */
  epoch: number
  by: { id: string; name: string; action: MusicAction } | null
  listeners: Map<string, Listener>
}

const sessions = new Map<string, Session>()

let epochCounter = 0

function blank(): Session {
  epochCounter += 1
  return {
    track: null,
    playing: false,
    position: 0,
    at: Date.now(),
    seq: 0,
    epoch: Date.now() * 1000 + (epochCounter % 1000),
    by: null,
    listeners: new Map(),
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

/** Where the track actually is now, projected from the last known point. */
function project(state: Session) {
  if (!state.playing) return state.position
  const elapsed = (Date.now() - state.at) / 1000
  const position = state.position + elapsed
  if (state.track?.duration != null) return Math.min(position, state.track.duration)
  return position
}

export type MusicSnapshot = {
  roomId: string
  track: Track | null
  playing: boolean
  position: number
  seq: number
  epoch: number
  by: Session['by']
  listeners: { id: string; name: string; singing: boolean; recording: boolean }[]
  serverTime: number
}

export function snapshot(roomId: string): MusicSnapshot {
  const state = session(roomId)
  return {
    roomId,
    track: state.track,
    playing: state.playing,
    position: project(state),
    seq: state.seq,
    epoch: state.epoch,
    by: state.by,
    /* One entry per person, not per socket — a second tab is not a second
       person in the room, and would otherwise show up singing along. */
    listeners: [
      ...new Map([...state.listeners.values()].map((one) => [one.userId, one])).values(),
    ].map((one) => ({
      id: one.userId,
      name: one.name,
      singing: one.singing,
      recording: one.recording,
    })),
    serverTime: Date.now(),
  }
}

function distinctListeners(state: Session) {
  return new Set([...state.listeners.values()].map((one) => one.userId)).size
}

export function isListening(roomId: string) {
  const state = sessions.get(roomId)
  return state ? distinctListeners(state) > 0 : false
}

/** Freeze playback where it is. Called when the last listener leaves. */
function park(state: Session) {
  state.position = project(state)
  state.playing = false
  state.at = Date.now()
}

/** Keyed by socket id for the same idempotency reason as the watch session. */
export function addListener(roomId: string, socketId: string, userId: string, name: string) {
  const state = session(roomId)
  const existing = state.listeners.get(socketId)
  state.listeners.set(socketId, {
    userId,
    name,
    singing: existing?.singing ?? false,
    recording: existing?.recording ?? false,
  })
  return distinctListeners(state)
}

export function removeListener(roomId: string, socketId: string) {
  const state = sessions.get(roomId)
  if (!state) return 0

  state.listeners.delete(socketId)
  const remaining = distinctListeners(state)
  if (remaining === 0) park(state)
  return remaining
}

/**
 * Who is singing, and who is capturing it.
 *
 * Recording is announced to the room rather than kept to the recorder. Anyone
 * whose voice is being captured is entitled to know it is happening, and a
 * per-person indicator is the only honest way to say so — the capture is local
 * to each listener, so there is no single recording of the room to point at.
 */
export function setSinging(roomId: string, socketId: string, singing: boolean) {
  const one = sessions.get(roomId)?.listeners.get(socketId)
  if (one) one.singing = singing
}

export function setRecording(roomId: string, socketId: string, recording: boolean) {
  const one = sessions.get(roomId)?.listeners.get(socketId)
  if (one) one.recording = recording
}

/** Forget a socket everywhere. The disconnect safety net. */
export function dropSocket(socketId: string): string[] {
  const touched: string[] = []
  for (const [roomId, state] of sessions) {
    if (state.listeners.delete(socketId)) {
      touched.push(roomId)
      if (distinctListeners(state) === 0) park(state)
    }
  }
  return touched
}

export function dropRoom(roomId: string) {
  sessions.delete(roomId)
}

export type MusicControl =
  | { action: 'load'; track: Track; position?: number }
  | { action: 'play'; position?: number }
  | { action: 'pause'; position?: number }
  | { action: 'seek'; position: number }
  | { action: 'advance'; track: Track | null }
  | { action: 'open' }
  | { action: 'singalong' }

function clampPosition(state: Session, seconds: number) {
  if (!Number.isFinite(seconds)) return state.position
  const max = state.track?.duration ?? Number.MAX_SAFE_INTEGER
  return Math.min(Math.max(seconds, 0), max)
}

/**
 * Apply a control and return the new snapshot.
 *
 * No host: anyone in the room can drive, so arrival order at the server is the
 * only ordering that everybody can agree on.
 */
export function apply(
  roomId: string,
  user: { id: string; name: string },
  control: MusicControl,
): MusicSnapshot {
  const state = session(roomId)
  const now = Date.now()

  switch (control.action) {
    case 'load':
    case 'advance': {
      state.track = control.action === 'load' ? control.track : control.track
      state.position = control.action === 'load' ? clampPosition(state, control.position ?? 0) : 0
      /* Choosing a track is the intent to hear it, and a queue that has
         advanced should keep playing rather than stop between songs. */
      state.playing = state.track !== null
      state.at = now
      break
    }

    case 'play': {
      state.position =
        control.position !== undefined ? clampPosition(state, control.position) : project(state)
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

    case 'open':
    case 'singalong':
      /* Neither moves playback. They exist so the room learns someone arrived,
         or picked up a microphone, through the same path as everything else. */
      break
  }

  if (control.action !== 'open') state.seq += 1
  state.by = { id: user.id, name: user.name, action: control.action }

  return snapshot(roomId)
}

/** A duration discovered by a client, folded into the live session. */
export function noteDuration(roomId: string, trackId: string, duration: number) {
  const state = sessions.get(roomId)
  if (state?.track && state.track.id === trackId && state.track.duration == null) {
    state.track = { ...state.track, duration }
  }
}
