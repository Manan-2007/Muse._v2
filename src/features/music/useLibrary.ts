import { useCallback, useEffect, useMemo, useState } from 'react'

import * as musicApi from '@/features/music/api'
import type { LibraryTrack, LikedTrack, Playlist } from '@/features/music/types'
import { trackKey } from '@/features/music/types'

/**
 * The room's kept music, as this client holds it.
 *
 * Playlists are shared and likes are personal, but they are loaded together
 * because every screen that shows one shows the other — a song row needs its
 * heart and its "add to playlist" menu at the same moment, and splitting the
 * two would mean every list waiting on two round trips instead of one.
 */
export function useLibrary(roomId: string | null) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [liked, setLiked] = useState<LikedTrack[]>([])
  const [likedKeys, setLikedKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!roomId) return
    const [lists, likes] = await Promise.all([
      musicApi.fetchPlaylists(roomId).catch(() => []),
      musicApi.fetchLiked(roomId).catch(() => ({ items: [], keys: [] })),
    ])
    setPlaylists(lists)
    setLiked(likes.items)
    setLikedKeys(new Set(likes.keys))
    setLoading(false)
  }, [roomId])

  useEffect(() => {
    setLoading(true)
    void reload()
  }, [reload])

  const isLiked = useCallback((track: LibraryTrack) => likedKeys.has(trackKey(track)), [likedKeys])

  /**
   * Toggle a heart, optimistically.
   *
   * The set is updated before the request lands because the heart is the
   * feedback — waiting a round trip to fill it in makes a button that works
   * feel like one that did not register. The server's own list replaces it
   * either way, so a failed call self-corrects.
   */
  const toggleLike = useCallback(
    async (track: LibraryTrack) => {
      if (!roomId) return
      const key = trackKey(track)

      setLikedKeys((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })

      try {
        const result = await musicApi.toggleLiked(roomId, track)
        setLikedKeys(new Set(result.keys))
        setLiked(await musicApi.fetchLiked(roomId).then((r) => r.items))
      } catch {
        /* Put it back the way the server still sees it. */
        void reload()
      }
    },
    [roomId, reload],
  )

  const createPlaylist = useCallback(
    async (name: string) => {
      if (!roomId) return null
      const created = await musicApi.createPlaylist(roomId, name)
      setPlaylists((current) => [created, ...current])
      return created
    },
    [roomId],
  )

  const removePlaylist = useCallback(
    async (playlistId: string) => {
      if (!roomId) return
      setPlaylists(await musicApi.deletePlaylist(roomId, playlistId))
    },
    [roomId],
  )

  const addToPlaylist = useCallback(
    async (playlistId: string, track: LibraryTrack) => {
      if (!roomId) return
      const updated = await musicApi.addToPlaylist(roomId, playlistId, track)
      setPlaylists((current) => current.map((one) => (one.id === updated.id ? updated : one)))
    },
    [roomId],
  )

  const removeFromPlaylist = useCallback(
    async (playlistId: string, trackId: string) => {
      if (!roomId) return
      const updated = await musicApi.removeFromPlaylist(roomId, playlistId, trackId)
      setPlaylists((current) => current.map((one) => (one.id === updated.id ? updated : one)))
    },
    [roomId],
  )

  return useMemo(
    () => ({
      playlists,
      liked,
      loading,
      isLiked,
      toggleLike,
      createPlaylist,
      removePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      reload,
    }),
    [
      playlists,
      liked,
      loading,
      isLiked,
      toggleLike,
      createPlaylist,
      removePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      reload,
    ],
  )
}
