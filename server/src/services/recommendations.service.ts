import * as libraryModel from '../models/library.model.js'
import { topCovers } from './charts.service.js'
import { searchCatalog, type MusicSearchResult } from './sources.service.js'

/**
 * Recommendations, from a person's own taste.
 *
 * This is honest content-based recommendation, not a black box: it reads what
 * you have actually played, liked, saved to playlists and picked at sign-up,
 * builds a weighted list of the artists you lean on, and offers more from them
 * plus — the point of it — songs by *related* artists you have not heard.
 *
 * The "related" graph is Deezer's, reached keyless (only Deezer's track search
 * is blocked from here; the artist graph answers fine). The songs themselves,
 * with covers and durations, come from the iTunes catalogue. Nothing is
 * invented and nothing needs an account: it is your taste, followed outward.
 */

export type RecShelf = {
  id: string
  title: string
  subtitle?: string
  tracks: MusicSearchResult[]
}

const timeout = () => AbortSignal.timeout(6000)

/** `artist|title`, lowercased — the key two copies of a song collapse to. */
function songKey(t: { artist?: string | null; title: string }) {
  return `${(t.artist ?? '').toLowerCase()}|${t.title.toLowerCase()}`
}

/**
 * Artists similar to a name, from Deezer's related graph.
 *
 * Two calls: resolve the name to an id, then read its neighbours. Both are the
 * artist endpoints, which answer without a key even though track search does
 * not.
 */
async function relatedArtists(name: string): Promise<string[]> {
  try {
    const found = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`,
      { signal: timeout() },
    )
    if (!found.ok) return []
    const id = ((await found.json()) as { data?: { id?: number }[] }).data?.[0]?.id
    if (!id) return []

    const related = await fetch(`https://api.deezer.com/artist/${id}/related?limit=12`, {
      signal: timeout(),
    })
    if (!related.ok) return []
    const body = (await related.json()) as { data?: { name?: string }[] }
    return (body.data ?? []).map((a) => a.name).filter((n): n is string => Boolean(n))
  } catch {
    return []
  }
}

/** A person's taste, as weighted artists and the songs they already know. */
async function tasteProfile(roomId: string, userId: string, favArtists: string[]) {
  const [played, liked, playlists] = await Promise.all([
    libraryModel.recentlyPlayed(roomId, 100),
    libraryModel.listLiked(roomId, userId),
    libraryModel.listPlaylists(roomId),
  ])

  const weight = new Map<string, number>()
  const known = new Set<string>()

  const note = (
    track: { artist?: string | null; title: string; source: string; ref: string },
    w: number,
  ) => {
    known.add(`${track.source}:${track.ref}`)
    known.add(songKey(track))
    const artist = track.artist?.trim()
    if (artist) weight.set(artist, (weight.get(artist) ?? 0) + w)
  }

  /* Liked counts most, then played, then merely saved to a playlist. */
  for (const t of liked) note(t, 3)
  for (const t of played) note(t, 2)
  for (const p of playlists) for (const t of p.tracks) note(t, 1)

  /* Explicit picks at sign-up outrank everything inferred. */
  for (const name of favArtists) {
    const clean = name.trim()
    if (clean) weight.set(clean, (weight.get(clean) ?? 0) + 5)
  }

  const seedArtists = [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  return { seedArtists, known }
}

/** An artist's catalogue songs, minus anything already known. */
async function freshTracks(
  artist: string,
  known: Set<string>,
  limit: number,
): Promise<MusicSearchResult[]> {
  const songs = await searchCatalog(artist)
  const out: MusicSearchResult[] = []
  for (const song of songs) {
    if (known.has(songKey(song))) continue
    known.add(songKey(song))
    out.push(song)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Build the "made for you" shelves.
 *
 * Falls back to what is popular for someone the app knows nothing about yet, so
 * the section is never empty; grows into real, personal discovery as soon as
 * there is any taste to read.
 */
export async function recommend(
  roomId: string,
  userId: string,
  favArtists: string[],
  favGenres: string[],
): Promise<RecShelf[]> {
  const { seedArtists, known } = await tasteProfile(roomId, userId, favArtists)

  /* Nothing to go on: hand back what's popular rather than an empty page. */
  if (seedArtists.length === 0) {
    const covers = await topCovers()
    const popular: MusicSearchResult[] = covers.slice(0, 14).map((c, i) => ({
      id: `cat:pop:${i}:${c.title.toLowerCase()}`,
      title: c.title,
      artist: c.artist,
      album: null,
      artwork: c.artwork,
      duration: null,
      q: `${c.artist} ${c.title}`,
    }))
    return popular.length ? [{ id: 'popular', title: 'Popular right now', tracks: popular }] : []
  }

  const shelves: RecShelf[] = []
  const top = seedArtists[0]!

  /* Discovery — the whole point. Related artists to your top one, a few songs
     each, none of them things you already have. */
  const related = (await relatedArtists(top)).slice(0, 6)
  if (related.length > 0) {
    const lists = await Promise.all(related.map((name) => freshTracks(name, known, 3)))
    /* Round-robin, so the shelf mixes the related artists instead of front-
       loading everything by whoever Deezer happened to rank first. */
    const discovery: MusicSearchResult[] = []
    for (let i = 0; i < 3; i += 1) {
      for (const list of lists) if (list[i]) discovery.push(list[i]!)
    }
    if (discovery.length >= 4) {
      shelves.push({
        id: 'discovery',
        title: `Because you like ${top}`,
        subtitle: 'New artists picked from who you listen to',
        tracks: discovery,
      })
    }
  }

  /* More from the two artists you lean on most. */
  for (const artist of seedArtists.slice(0, 2)) {
    const more = await freshTracks(artist, known, 12)
    if (more.length >= 4) {
      shelves.push({ id: `more:${artist}`, title: `More from ${artist}`, tracks: more })
    }
  }

  /* One genre shelf, if a genre was ever chosen — songs in it, fresh. */
  const genre = favGenres[0]?.trim()
  if (genre) {
    const inGenre = await freshTracks(genre, known, 12)
    if (inGenre.length >= 4) {
      shelves.push({ id: `genre:${genre}`, title: `${genre} you might like`, tracks: inGenre })
    }
  }

  return shelves
}
