export type MusicSource = 'file' | 'youtube'

export type MusicAction = 'load' | 'play' | 'pause' | 'seek' | 'advance' | 'open' | 'singalong'

export type Track = {
  id: string
  source: MusicSource
  /** A YouTube video id, or a URL to the audio itself. */
  ref: string
  title: string
  artist: string | null
  album: string | null
  /** Cover art. The page derives its whole palette from this when present. */
  artwork: string | null
  duration: number | null
}

export type QueuedTrack = Track & {
  position: number
  addedBy: { id: string; name: string }
}

/** Someone on the music page, and what their microphone is doing. */
export type Listener = {
  id: string
  name: string
  singing: boolean
  recording: boolean
}

/** The server's authoritative view, as it arrives on the socket. */
export type MusicSnapshot = {
  roomId: string
  track: Track | null
  playing: boolean
  position: number
  /** Monotonic within an epoch. Anything below what we've applied is stale. */
  seq: number
  /** Changes when `seq` restarts, so a restarted session isn't read as stale. */
  epoch: number
  by: { id: string; name: string; action: MusicAction } | null
  listeners: Listener[]
  serverTime: number
}

/** What `resolve` and `upload` hand back, ready for the queue. */
export type ResolvedTrack = {
  source: MusicSource
  ref: string
  title: string
  artist: string | null
  album: string | null
  artwork: string | null
  duration: number | null
}

/** A file already sitting in the server's uploads folder. */
export type AudioLibraryEntry = {
  file: string
  title: string
  ref: string
  bytes: number
  modifiedAt: number
}

export type TrackSearchResult = {
  id: string
  title: string
  channel: string
  thumbnail: string
}

/** A song as the library stores it, before it is anywhere in particular. */
export type LibraryTrack = {
  source: MusicSource
  ref: string
  title: string
  artist: string | null
  album: string | null
  artwork: string | null
  duration: number | null
}

export type PlaylistTrack = LibraryTrack & { id: string; position: number }

export type Playlist = {
  id: string
  name: string
  createdAt: string
  createdBy: { id: string; name: string }
  tracks: PlaylistTrack[]
}

export type LikedTrack = LibraryTrack & { id: string; createdAt: string }

/** `source:ref`, the key a heart is painted from. */
export const trackKey = (track: { source: string; ref: string }) =>
  `${track.source}:${track.ref}`

/**
 * What a music player adapter has to be able to do.
 *
 * Same shape of contract as the watch feature's `PlayerHandle`, and for the
 * same reason: the sync engine drives a `<audio>` element and a YouTube iframe
 * through one interface, so neither the room's clock nor the UI has to know
 * which is playing.
 */
export type AudioHandle = {
  play: () => void
  pause: () => void
  seek: (seconds: number) => void
  /**
   * Nudge playback speed to soak up small drift.
   *
   * Safe on audio, which is not obvious: `preservesPitch` is on by default
   * everywhere, so a percent or two is time-stretched rather than transposed
   * — the song keeps its key and simply arrives a fraction sooner. Without
   * this the only way to correct was to seek, which is why Listen used to
   * tolerate being a second and a half out.
   */
  setRate: (rate: number) => void
  getPosition: () => number
  getDuration: () => number
  isBuffering: () => boolean
  /** True when this player is stopped, whatever the room believes. */
  isPaused: () => boolean
  /** False for YouTube, which honours only its own fixed list of rates. */
  supportsFineRate: boolean
  setVolume: (level: number) => void
  /**
   * The live audio graph node for this source, when one can exist.
   *
   * Null for YouTube: its audio lives inside a cross-origin iframe, which the
   * Web Audio API cannot reach into. That is the whole reason the visualiser
   * has a synthetic fallback — the bars have to keep moving for a source whose
   * waveform is genuinely unreadable.
   */
  getAnalyserSource: () => MediaElementAudioSourceNode | null
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`
}

/** One line of time-synced lyrics, stamped in seconds from the start. */
export type LyricLine = { at: number; text: string }

/**
 * What a lyrics lookup came back with.
 *
 * Three outcomes rather than a nullable string, because they are three
 * different things to show: a karaoke view, a page of words with no
 * highlighting possible, and an honest nothing.
 */
export type Lyrics =
  | { kind: 'synced'; lines: LyricLine[]; plain: string | null }
  | { kind: 'plain'; plain: string }
  | { kind: 'none' }
