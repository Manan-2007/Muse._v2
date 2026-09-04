import { useCallback, useRef } from 'react'

import * as musicApi from '@/features/music/api'
import { useMusic } from '@/features/music/MusicContext'
import type { LibraryTrack, MusicSearchResult, ResolvedTrack } from '@/features/music/types'

/**
 * A catalogue song in the shape the app stores songs in.
 *
 * The ref is a `cat:` placeholder, not a video — it is swapped for real YouTube
 * audio by `ensureResolved` the first time the song is played or saved.
 */
export const fromCatalog = (song: MusicSearchResult): LibraryTrack => ({
  source: 'youtube',
  ref: song.id,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artwork: song.artwork,
  duration: song.duration,
})

const isUnresolved = (track: LibraryTrack) => track.ref.startsWith('cat:')

/**
 * Play or queue a song, from anywhere.
 *
 * The one place that turns a `LibraryTrack` — a search result, a catalogue
 * card, a recommendation — into something the room is playing. Catalogue songs
 * are resolved to real YouTube audio lazily and once, cached here, so the same
 * song touched twice is only ever looked up once. Reads the room and the play
 * signal from the music context, so callers just hand it a track.
 */
export function useEnqueue() {
  const { roomId, onQueued } = useMusic()
  const cache = useRef(new Map<string, ResolvedTrack>())

  const ensureResolved = useCallback(
    async (track: LibraryTrack): Promise<LibraryTrack> => {
      if (!isUnresolved(track) || !roomId) return track
      const hit = cache.current.get(track.ref)
      if (hit) return hit
      const resolved = await musicApi.resolveMusic(roomId, {
        id: track.ref,
        title: track.title,
        artist: track.artist ?? '',
        album: track.album,
        artwork: track.artwork,
        duration: track.duration,
        q: `${track.artist ?? ''} ${track.title}`.trim(),
      })
      cache.current.set(track.ref, resolved)
      return resolved
    },
    [roomId],
  )

  const enqueue = useCallback(
    async (track: LibraryTrack, playNow: boolean) => {
      if (!roomId) return
      const real = await ensureResolved(track)
      const queued = await musicApi.addToQueue(roomId, {
        source: real.source,
        ref: real.ref,
        title: real.title,
        artist: real.artist,
        album: real.album,
        artwork: real.artwork,
        duration: real.duration,
      })
      onQueued(queued, playNow)
    },
    [roomId, onQueued, ensureResolved],
  )

  const play = useCallback((track: LibraryTrack) => enqueue(track, true), [enqueue])

  return { enqueue, play, ensureResolved }
}
