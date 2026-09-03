export type WatchSource = 'youtube' | 'file' | 'external'

export type WatchAction = 'load' | 'play' | 'pause' | 'seek' | 'rate' | 'advance' | 'open'

/** One WebVTT subtitle track published alongside a video. */
export type SubtitleTrack = { language: string; label: string; url: string }

export type WatchItem = {
  id: string
  source: WatchSource
  /** YouTube video id, a direct media URL, or a free-text title. */
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
  /** Absent for anything not published with subtitles. */
  subtitles?: SubtitleTrack[]
}

export type QueueItem = WatchItem & {
  position: number
  addedBy: { id: string; name: string }
}

export type Viewer = { id: string; name: string }

/** The server's authoritative view, as it arrives on the socket. */
export type WatchSnapshot = {
  roomId: string
  item: WatchItem | null
  playing: boolean
  position: number
  rate: number
  /** Monotonic within an epoch. Anything below what we've applied is stale. */
  seq: number
  /** Changes when `seq` restarts, so a restarted session isn't read as stale. */
  epoch: number
  by: { id: string; name: string; action: WatchAction } | null
  viewers: Viewer[]
  serverTime: number
}

export type ResolvedSource = {
  source: WatchSource
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
  /** Present when a platform can't be embedded, explaining what happens instead. */
  note?: string
}

/** A file already sitting in the server's uploads folder. */
export type LibraryEntry = {
  file: string
  title: string
  ref: string
  bytes: number
  /** False for containers no browser will play — .mkv, .avi and friends. */
  playable: boolean
  /**
   * False when an MP4's index sits at the end of the file, so playback stalls
   * before it starts. The file is fine; it just needs remuxing.
   */
  fastStart: boolean
  modifiedAt: number
  /** A frame from the film itself, once it's been published. Null until then. */
  thumbnail: string | null
  /**
   * Master playlist on the CDN, once this file has been published.
   *
   * Present means it streams properly: playback starts on a playlist of a few
   * kilobytes instead of the file's whole index, and the segments come from
   * the CDN rather than the machine running the server. Absent means the only
   * way to play it is the file itself — which works, and drags on anything
   * long or anything watched by more than one person at once.
   */
  hls: string | null
  /** Known only for published files — read while repackaging. */
  duration: number | null
  audio: { language: string; label: string }[] | null
}

/** One alternate audio track, as offered by the source. */
export type AudioTrackInfo = { id: number; language: string; label: string }

export type SearchResult = {
  id: string
  title: string
  channel: string
  thumbnail: string
}

/**
 * What a player adapter has to be able to do.
 *
 * Every source implements the same handle, so the sync engine never needs to
 * know whether it is driving a YouTube iframe, an HTML5 `<video>`, or nothing
 * at all — which is what leaves room for Vimeo or Twitch to drop in later.
 */
export type PlayerHandle = {
  play: () => void
  pause: () => void
  seek: (seconds: number) => void
  setRate: (rate: number) => void
  /** Seconds into the media, or 0 before it is ready. */
  getPosition: () => number
  getDuration: () => number
  /**
   * True while stalled. Drift correction has to stand down during a buffer, or
   * it fights the loading and seek-loops.
   */
  isBuffering: () => boolean
  /**
   * True when the player itself is stopped, whatever the room believes.
   *
   * The two can disagree — the OS player's pause button in fullscreen, a
   * blocked autoplay, a headphone click — and while they do, correcting drift
   * means seeking a stopped video, which paints a new still frame per attempt
   * instead of catching anything up.
   */
  isPaused: () => boolean
  /**
   * Whether arbitrary playback rates are honoured. HTML5 video can be nudged
   * to 1.03 to soak up small drift; YouTube only accepts a fixed set, so it
   * has to correct by seeking instead.
   */
  supportsFineRate: boolean
  /**
   * Alternate audio tracks, if the source has any. Empty for a single-track
   * file, a plain MP4, or YouTube — this is not the same as an error, it just
   * means there is nothing to switch between.
   */
  getAudioTracks: () => AudioTrackInfo[]
  getAudioTrack: () => number
  setAudioTrack: (id: number) => void
  /**
   * Which subtitle track is showing, by index into the item's list, or -1 for
   * none. Separate from the audio API because subtitles are `<track>`
   * elements on the video rather than anything the streaming layer owns.
   */
  getSubtitleTrack: () => number
  setSubtitleTrack: (index: number) => void
  /**
   * The underlying `<video>` element, for sources that have one. iOS Safari
   * blacks out a `<video>` when a non-video ancestor is fullscreened — the
   * fix is fullscreening the element itself, which needs a reference to it.
   * Absent for sources with no native element to hand back, like YouTube's
   * cross-origin iframe.
   */
  getVideoElement?: () => HTMLVideoElement | null
}

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(secs).padStart(2, '0')}`
}
