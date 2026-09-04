import * as libraryModel from '../models/library.model.js'

/**
 * Listening stats — the "your taste" / Wrapped view.
 *
 * All from real play history: how much has been played, the artists and songs
 * played most, and a genre breakdown for the radar. Genres are inferred from
 * the top artists (iTunes files each under one), weighted by how much each
 * artist is played — so the shape of the chart is the shape of the listening.
 */

export type TasteStats = {
  totalPlays: number
  totalMinutes: number
  topArtists: { name: string; count: number }[]
  topSongs: { title: string; artist: string | null; artwork: string | null; count: number }[]
  genres: { genre: string; count: number }[]
}

const genreCache = new Map<string, string | null>()

/** The genre iTunes files an artist under, memoised. */
async function artistGenre(name: string): Promise<string | null> {
  if (genreCache.has(name)) return genreCache.get(name)!
  let genre: string | null = null
  try {
    const url = new URL('https://itunes.apple.com/search')
    url.searchParams.set('term', name)
    url.searchParams.set('entity', 'song')
    url.searchParams.set('limit', '1')
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (response.ok) {
      const body = (await response.json()) as { results?: { primaryGenreName?: string }[] }
      genre = body.results?.[0]?.primaryGenreName ?? null
    }
  } catch {
    /* Leave it null — a missing genre just doesn't feed the radar. */
  }
  /* Normalise a couple of iTunes' slashed labels to the words people use. */
  if (genre === 'Hip-Hop/Rap') genre = 'Hip-Hop'
  if (genre === 'R&B/Soul') genre = 'R&B'
  genreCache.set(name, genre)
  return genre
}

export async function taste(roomId: string): Promise<TasteStats> {
  const rows = await libraryModel.playRows(roomId, 1500)

  let totalSeconds = 0
  const artists = new Map<string, number>()
  const songs = new Map<
    string,
    { title: string; artist: string | null; artwork: string | null; count: number }
  >()

  for (const row of rows) {
    totalSeconds += row.duration ?? 0
    const artist = row.artist?.trim()
    if (artist) artists.set(artist, (artists.get(artist) ?? 0) + 1)
    const key = `${row.source}:${row.ref}`
    const song = songs.get(key)
    if (song) song.count += 1
    else songs.set(key, { title: row.title, artist: row.artist, artwork: row.artwork, count: 1 })
  }

  const topArtists = [...artists.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const topSongs = [...songs.values()].sort((a, b) => b.count - a.count).slice(0, 8)

  /* Genre breakdown: the top artists' genres, each carrying that artist's
     weight, so a genre grows with how much of it is actually played. */
  const genreWeight = new Map<string, number>()
  await Promise.all(
    topArtists.slice(0, 10).map(async (a) => {
      const genre = await artistGenre(a.name)
      if (genre) genreWeight.set(genre, (genreWeight.get(genre) ?? 0) + a.count)
    }),
  )
  const genres = [...genreWeight.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  return {
    totalPlays: rows.length,
    totalMinutes: Math.round(totalSeconds / 60),
    topArtists,
    topSongs,
    genres,
  }
}
