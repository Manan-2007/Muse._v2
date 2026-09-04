import * as libraryModel from '../models/library.model.js'
import * as trackModel from '../models/track.model.js'
import * as userModel from '../models/user.model.js'
import { getOrCreatePersonalRoom } from './room.service.js'
import { searchYouTube } from './sources.service.js'
import { cleanTrackName } from './trackName.js'

/**
 * The welcome mix.
 *
 * A new account arrives empty, and an empty music app is a search box and a
 * shrug. So the first thing we do with the artists and genres someone picks is
 * turn them into something already playing: a "Starter Mix" playlist in their
 * personal room, seeded into the queue so pressing Listen has music waiting.
 *
 * This is a starting point, not a recommendation engine — it searches for the
 * names they gave us and nothing more. After this the library is theirs to
 * build, which is the honest shape of it.
 */

type StarterTrack = {
  source: 'youtube'
  ref: string
  title: string
  artist: string | null
  album: null
  artwork: string | null
  duration: null
}

const MAX_TRACKS = 15

/** The queries worth asking, best signal first: the artists they named, then a
    couple of genre nets to widen it. */
function queriesFor(genres: string[], artists: string[]): string[] {
  return [
    ...artists.slice(0, 6).map((artist) => artist.trim()).filter(Boolean),
    ...genres.slice(0, 4).map((genre) => `best ${genre.trim()} songs`),
  ]
}

/**
 * Search everything at once and fold the answers into a de-duplicated mix.
 *
 * Parallel because these are several searches against volunteer Piped servers,
 * and doing them in turn would leave a new account watching a spinner for the
 * better part of a minute. A query that fails takes nothing with it — the mix
 * is however much came back.
 */
async function gatherTracks(queries: string[]): Promise<StarterTrack[]> {
  const settled = await Promise.allSettled(queries.map((query) => searchYouTube(query)))

  const seen = new Set<string>()
  const tracks: StarterTrack[] = []

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    /* Two per query keeps one prolific artist from filling the whole mix. */
    for (const hit of result.value.slice(0, 2)) {
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      const named = cleanTrackName(hit.title, hit.channel)
      tracks.push({
        source: 'youtube',
        ref: hit.id,
        title: named.title,
        artist: named.artist ?? hit.channel,
        album: null,
        artwork: hit.thumbnail,
        duration: null,
      })
      if (tracks.length >= MAX_TRACKS) return tracks
    }
  }

  return tracks
}

export async function onboard(
  userId: string,
  input: { genres: string[]; artists: string[] },
): Promise<{ user: userModel.PublicUser; roomId: string; count: number }> {
  const updated = await userModel.markOnboarded(userId, input.genres, input.artists)
  const room = await getOrCreatePersonalRoom(userId)

  const tracks = await gatherTracks(queriesFor(input.genres, input.artists))

  if (tracks.length > 0) {
    const playlist = await libraryModel.createPlaylist(room.id, userId, 'Starter Mix')
    /* Into the playlist to keep, and into the queue so it is already on when
       they walk in. Sequential rather than parallel: both write a position
       counter that reads the current max, and racing them collides. */
    for (const track of tracks) {
      await libraryModel.addToPlaylist(room.id, playlist.id, track)
    }
    for (const track of tracks) {
      await trackModel.addTrack({ roomId: room.id, addedById: userId, ...track })
    }
  }

  return { user: userModel.toPublicUser(updated), roomId: room.id, count: tracks.length }
}
