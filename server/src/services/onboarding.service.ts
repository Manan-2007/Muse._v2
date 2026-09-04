import * as libraryModel from '../models/library.model.js'
import * as trackModel from '../models/track.model.js'
import * as userModel from '../models/user.model.js'
import { getOrCreatePersonalRoom } from './room.service.js'
import { resolveYouTubeAudio, searchCatalog } from './sources.service.js'

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
  album: string | null
  artwork: string | null
  duration: number | null
}

const MAX_TRACKS = 14

/** The queries worth asking, best signal first: the artists they named, then a
    couple of genre nets to widen it. */
function queriesFor(genres: string[], artists: string[]): string[] {
  return [
    ...artists.slice(0, 6).map((artist) => artist.trim()).filter(Boolean),
    ...genres.slice(0, 4).map((genre) => genre.trim()).filter(Boolean),
  ]
}

/**
 * Build the mix from the music catalogue, then make it playable.
 *
 * The catalogue (iTunes) is searched first, not YouTube: a query for "Charlie
 * Puth" there returns his actual songs with real titles, not "King of Pop" or
 * "We Don't…" cut off mid-word, which is what a raw YouTube search hands back.
 * Each clean song is then resolved once to a YouTube id so it can actually
 * play, keeping the catalogue's title, artist, album and cover over YouTube's.
 */
async function gatherTracks(queries: string[]): Promise<StarterTrack[]> {
  const settled = await Promise.allSettled(queries.map((query) => searchCatalog(query)))

  const seen = new Set<string>()
  const picks: { title: string; artist: string; album: string | null; artwork: string | null; duration: number | null }[] = []

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue
    /* Three per query keeps one prolific artist from filling the whole mix. */
    for (const song of result.value.slice(0, 3)) {
      const key = `${song.artist.toLowerCase()}|${song.title.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      picks.push(song)
      if (picks.length >= MAX_TRACKS) break
    }
    if (picks.length >= MAX_TRACKS) break
  }

  /* Resolve to playable audio in parallel — this runs once, on sign-up. Songs
     that can't be found on YouTube are simply left out. */
  const resolved = await Promise.all(
    picks.map(async (song): Promise<StarterTrack | null> => {
      const match = await resolveYouTubeAudio(`${song.artist} ${song.title}`)
      if (!match) return null
      return {
        source: 'youtube',
        ref: match.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: song.artwork ?? match.thumbnail,
        duration: song.duration,
      }
    }),
  )

  return resolved.filter((track): track is StarterTrack => track !== null)
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
