import { createContext, useContext } from 'react'

import type { AudioHandle, MusicSnapshot, QueuedTrack } from '@/features/music/types'
import type { SingalongState } from '@/features/music/useSingalong'

/**
 * The room's listening session, shared by everything that shows it.
 *
 * It lives above the page rather than inside it because the audio has to
 * outlive the page: closing the record view drops you back to the hub with the
 * music still going, and the floating dock is the same session seen small.
 * Two components each running their own `useMusicSession` would mean two
 * sockets, two `<audio>` elements, and one room hearing itself twice.
 */
export type MusicContextValue = {
  roomId: string | null
  snapshot: MusicSnapshot | null
  queue: QueuedTrack[]
  setQueue: (items: QueuedTrack[]) => void
  connected: boolean
  targetPosition: () => number
  send: (event: string, payload?: Record<string, unknown>) => void

  handle: AudioHandle | null
  /** Live position and duration, sampled for the UI four times a second. */
  position: number
  duration: number
  /** True while the browser has refused to start audio without a gesture. */
  needsGesture: boolean
  acknowledgeGesture: () => void
  error: string | null
  setError: (message: string | null) => void

  volume: number
  setVolume: (level: number) => void

  /** Null for YouTube, whose audio cannot be tapped. See `AudioHandle`. */
  analyserSource: MediaElementAudioSourceNode | null
  singalong: SingalongState & { toggleSinging: () => void; toggleRecording: () => void }

  playNow: (track: QueuedTrack) => void
  onQueued: (
    queued: { item: QueuedTrack; items: QueuedTrack[] },
    playImmediately: boolean,
  ) => void
  canSearch: boolean
}

export const MusicContext = createContext<MusicContextValue | null>(null)

export function useMusic() {
  const value = useContext(MusicContext)
  if (!value) throw new Error('useMusic must be used inside a MusicProvider')
  return value
}
