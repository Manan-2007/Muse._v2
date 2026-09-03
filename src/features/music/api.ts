import { api } from '@/lib/api'
import { API_BASE, API_HEADERS, getToken } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import type {
  AudioLibraryEntry,
  LibraryTrack,
  Lyrics,
  LikedTrack,
  Playlist,
  QueuedTrack,
  ResolvedTrack,
  TrackSearchResult,
} from '@/features/music/types'

/**
 * Tell the room the listening queue moved.
 *
 * Queue mutations are REST, but everyone else only learns about them over the
 * socket — without this ping the person who added a song is the only one who
 * can see it.
 */
function announce(roomId: string) {
  getSocket().emit('music:queue-sync', { roomId })
}

export function fetchCapabilities(roomId: string) {
  return api.get<{ search: boolean; sources: string[] }>(`/rooms/${roomId}/music`)
}

export function searchTracks(roomId: string, query: string) {
  return api
    .get<{ results: TrackSearchResult[] }>(
      `/rooms/${roomId}/music/search?q=${encodeURIComponent(query)}`,
    )
    .then((response) => response.results)
}

export function resolveInput(roomId: string, input: string) {
  return api
    .post<{ resolved: ResolvedTrack }>(`/rooms/${roomId}/music/resolve`, { input })
    .then((response) => response.resolved)
}

export function fetchLibrary(roomId: string) {
  return api
    .get<{ items: AudioLibraryEntry[] }>(`/rooms/${roomId}/music/library`)
    .then((response) => response.items)
}

export function fetchQueue(roomId: string) {
  return api.get<{ items: QueuedTrack[] }>(`/rooms/${roomId}/music/queue`).then((r) => r.items)
}

/** Returns the created track as well as the list — see the watch equivalent. */
export function addToQueue(roomId: string, track: ResolvedTrack) {
  return api
    .post<{ item: QueuedTrack; items: QueuedTrack[] }>(`/rooms/${roomId}/music/queue`, track)
    .then((response) => {
      announce(roomId)
      return response
    })
}

export function reorderQueue(roomId: string, ids: string[]) {
  return api
    .post<{ items: QueuedTrack[] }>(`/rooms/${roomId}/music/queue/reorder`, { ids })
    .then((response) => {
      announce(roomId)
      return response.items
    })
}

export function removeFromQueue(roomId: string, trackId: string) {
  return api
    .del<{ items: QueuedTrack[] }>(`/rooms/${roomId}/music/queue/${trackId}`)
    .then((response) => {
      announce(roomId)
      return response.items
    })
}

export function clearQueue(roomId: string) {
  return api.del<{ items: QueuedTrack[] }>(`/rooms/${roomId}/music/queue`).then((response) => {
    announce(roomId)
    return response.items
  })
}

/**
 * Send a local track to the server.
 *
 * XHR rather than fetch purely for `upload.onprogress` — see the watch
 * uploader, which this mirrors.
 */
export function uploadTrack(
  roomId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ResolvedTrack> {
  return new Promise((resolve, reject) => {
    const body = new FormData()
    body.append('audio', file)

    const request = new XMLHttpRequest()
    request.open('POST', `${API_BASE}/api/rooms/${roomId}/music/upload`)
    request.withCredentials = true

    const token = getToken()
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`)
    for (const [key, value] of Object.entries(API_HEADERS)) {
      request.setRequestHeader(key, value)
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }

    request.onload = () => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(request.responseText)
      } catch {
        /* Falls through to the generic message below. */
      }

      if (request.status >= 200 && request.status < 300) {
        resolve((parsed as { resolved: ResolvedTrack }).resolved)
      } else {
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : 'Upload failed'
        reject(new Error(message))
      }
    }

    request.onerror = () => reject(new Error('Upload failed — is the server running?'))
    request.onabort = () => reject(new Error('Upload cancelled'))

    request.send(body)
  })
}

/* ── Library: playlists, likes, suggestions ───────────────────────────── */

export function fetchPlaylists(roomId: string) {
  return api
    .get<{ items: Playlist[] }>(`/rooms/${roomId}/music/playlists`)
    .then((response) => response.items)
}

export function createPlaylist(roomId: string, name: string) {
  return api
    .post<{ item: Playlist }>(`/rooms/${roomId}/music/playlists`, { name })
    .then((response) => response.item)
}

export function deletePlaylist(roomId: string, playlistId: string) {
  return api
    .del<{ items: Playlist[] }>(`/rooms/${roomId}/music/playlists/${playlistId}`)
    .then((response) => response.items)
}

export function addToPlaylist(roomId: string, playlistId: string, track: LibraryTrack) {
  return api
    .post<{ item: Playlist }>(`/rooms/${roomId}/music/playlists/${playlistId}/tracks`, track)
    .then((response) => response.item)
}

export function removeFromPlaylist(roomId: string, playlistId: string, trackId: string) {
  return api
    .del<{ item: Playlist }>(
      `/rooms/${roomId}/music/playlists/${playlistId}/tracks/${trackId}`,
    )
    .then((response) => response.item)
}

export function fetchLiked(roomId: string) {
  return api.get<{ items: LikedTrack[]; keys: string[] }>(`/rooms/${roomId}/music/liked`)
}

/** Save or unsave in one call — see the note on the server's toggle. */
export function toggleLiked(roomId: string, track: LibraryTrack) {
  return api.post<{ liked: boolean; keys: string[] }>(`/rooms/${roomId}/music/liked`, track)
}

export function fetchSuggestions(roomId: string, artist?: string | null) {
  const query = artist ? `?artist=${encodeURIComponent(artist)}` : ''
  return api.get<{ history: LibraryTrack[]; more: TrackSearchResult[] }>(
    `/rooms/${roomId}/music/suggestions${query}`,
  )
}

/**
 * Lyrics for a track.
 *
 * The whole track is sent rather than an id: the lyrics source knows nothing
 * about this room's library, and matches on title, artist and length.
 */
export function fetchLyrics(
  roomId: string,
  track: { title: string; artist: string | null; album: string | null; duration: number | null },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ title: track.title })
  if (track.artist) params.set('artist', track.artist)
  if (track.album) params.set('album', track.album)
  if (track.duration) params.set('duration', String(Math.round(track.duration)))
  return api.get<Lyrics>(`/rooms/${roomId}/music/lyrics?${params}`, signal)
}
