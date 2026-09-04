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

/** A played/library track in the shape the recommendation cards use. Its ref
    is real and playable, so the id carries it straight through (no `cat:`). */
function toRec(t: {
  source: string
  ref: string
  title: string
  artist: string | null
  album: string | null
  artwork: string | null
  duration: number | null
}): MusicSearchResult {
  return {
    id: t.ref,
    title: t.title,
    artist: t.artist ?? '',
    album: t.album,
    artwork: t.artwork,
    duration: t.duration,
    q: '',
  }
}

/** The genre iTunes files an artist under — for inferring taste from listening. */
async function primaryGenre(artist: string): Promise<string | null> {
  try {
    const url = new URL('https://itunes.apple.com/search')
    url.searchParams.set('term', artist)
    url.searchParams.set('entity', 'song')
    url.searchParams.set('limit', '1')
    const response = await fetch(url, { signal: timeout() })
    if (!response.ok) return null
    const body = (await response.json()) as { results?: { primaryGenreName?: string }[] }
    return body.results?.[0]?.primaryGenreName ?? null
  } catch {
    return null
  }
}

/** Genres to recommend from — inferred from who you play, plus your picks. */
async function tasteGenres(topArtists: string[], favGenres: string[]): Promise<string[]> {
  const inferred = await Promise.all(topArtists.slice(0, 2).map((a) => primaryGenre(a)))
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of [...favGenres, ...inferred]) {
    const clean = g?.trim()
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    out.push(clean)
  }
  return out
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

  const shelves: RecShelf[] = []

  /* On repeat — the songs actually returned to. Real refs, plays straight. */
  const repeat = (await libraryModel.mostPlayed(roomId, 12)).filter((t) => t.source === 'youtube')
  if (repeat.length >= 4) {
    shelves.push({
      id: 'onrepeat',
      title: 'On repeat',
      subtitle: 'The songs you keep coming back to',
      tracks: repeat.map(toRec),
    })
  }

  /* Nothing to go on: hand back what's popular rather than an empty page. */
  if (seedArtists.length === 0) {
    if (shelves.length > 0) return shelves
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

  /* One genre shelf, from the genre you actually lean on (inferred from your
     top artists) as much as from what you picked at sign-up. */
  const genres = await tasteGenres(seedArtists, favGenres)
  const genre = genres[0]
  if (genre) {
    const inGenre = await freshTracks(genre, known, 12)
    if (inGenre.length >= 4) {
      shelves.push({ id: `genre:${genre}`, title: `${genre} you might like`, tracks: inGenre })
    }
  }

  return shelves
}

/**
 * Songs to add to a playlist — the "recommended" strip Spotify shows at the
 * bottom of one.
 *
 * Reads the playlist's own artists, follows them out through the related graph,
 * and offers songs by those neighbours that aren't already in the playlist —
 * so it extends the playlist in its own spirit rather than at random.
 */
export async function playlistSuggestions(
  roomId: string,
  playlistId: string,
): Promise<MusicSearchResult[]> {
  const playlist = await libraryModel.findPlaylist(roomId, playlistId)
  if (!playlist || playlist.tracks.length === 0) return []

  const weight = new Map<string, number>()
  const known = new Set<string>()
  for (const t of playlist.tracks) {
    known.add(songKey(t))
    const artist = t.artist?.trim()
    if (artist) weight.set(artist, (weight.get(artist) ?? 0) + 1)
  }

  const seeds = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 2)
  if (seeds.length === 0) return []

  /* Related artists to the playlist's core, a couple of songs each. */
  const relatedNames = [...new Set((await Promise.all(seeds.map(relatedArtists))).flat())].slice(0, 8)
  const lists = await Promise.all(relatedNames.map((name) => freshTracks(name, known, 2)))
  const out: MusicSearchResult[] = []
  for (let i = 0; i < 2; i += 1) for (const list of lists) if (list[i]) out.push(list[i]!)

  /* Top up from the playlist's own artists if related came up short. */
  if (out.length < 8) {
    for (const seed of seeds) {
      for (const song of await freshTracks(seed, known, 6)) out.push(song)
      if (out.length >= 12) break
    }
  }

  return out.slice(0, 12)
}

/**
 * A song's "radio" — more like this one.
 *
 * The song's artist plus their related artists, a few tracks each, so it plays
 * on in the same vein. Used by "more like this" on a track.
 */
export async function songRadio(artist: string, title: string): Promise<MusicSearchResult[]> {
  const known = new Set<string>([`${artist.toLowerCase()}|${title.toLowerCase()}`])
  const names = [artist, ...(await relatedArtists(artist))].slice(0, 7)
  const lists = await Promise.all(names.map((name) => freshTracks(name, known, 3)))
  const out: MusicSearchResult[] = []
  for (let i = 0; i < 3; i += 1) for (const list of lists) if (list[i]) out.push(list[i]!)
  return out.slice(0, 20)
}
