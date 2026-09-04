/**
 * Artists, with faces.
 *
 * Onboarding asks who you listen to, and a name in a box is a poor way to ask —
 * you recognise Dua Lipa's face a beat before you'd read her name. So the picker
 * shows photos, which means resolving a name to an image.
 *
 * The portrait comes from TheAudioDB (keyless, real artist photos); when it has
 * none, an iTunes album cover stands in — not a portrait, but recognisably the
 * artist. Every lookup is memoised for the life of the process, because the
 * same twenty names are asked for on every sign-up and neither source needs to
 * be troubled twice for them.
 */

export type ArtistCard = {
  name: string
  photo: string | null
}

/** The starter grid — popular across the pop, hip-hop, K-pop and desi worlds. */
const CURATED = [
  'The Weeknd',
  'Drake',
  'Travis Scott',
  'Don Toliver',
  'Future',
  'Metro Boomin',
  'Justin Timberlake',
  'Michael Jackson',
  'Tate McRae',
  'Billie Eilish',
  'Dua Lipa',
  'Taylor Swift',
  'SZA',
  'Ed Sheeran',
  'Anitta',
  'BTS',
  'Jungkook',
  'Arijit Singh',
  'Pritam',
  'Yo Yo Honey Singh',
  'A. R. Rahman',
  'Diljit Dosanjh',
]

const photoCache = new Map<string, string | null>()

async function fromAudioDB(name: string): Promise<string | null> {
  try {
    const url = new URL('https://www.theaudiodb.com/api/v1/json/2/search.php')
    url.searchParams.set('s', name)
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const body = (await response.json()) as {
      artists?: { strArtistThumb?: string; strArtistCutout?: string }[]
    }
    const artist = body.artists?.[0]
    return artist?.strArtistThumb || artist?.strArtistCutout || null
  } catch {
    return null
  }
}

async function fromITunes(name: string): Promise<string | null> {
  try {
    const url = new URL('https://itunes.apple.com/search')
    url.searchParams.set('term', name)
    url.searchParams.set('entity', 'song')
    url.searchParams.set('limit', '1')
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const body = (await response.json()) as { results?: { artworkUrl100?: string }[] }
    return body.results?.[0]?.artworkUrl100?.replace('100x100bb', '400x400bb') ?? null
  } catch {
    return null
  }
}

async function photoFor(name: string): Promise<string | null> {
  if (photoCache.has(name)) return photoCache.get(name)!
  const photo = (await fromAudioDB(name)) ?? (await fromITunes(name))
  photoCache.set(name, photo)
  return photo
}

/** Attach a photo to each name, in parallel, keeping the order given. */
async function withPhotos(names: string[]): Promise<ArtistCard[]> {
  const photos = await Promise.all(names.map((name) => photoFor(name)))
  return names.map((name, i) => ({ name, photo: photos[i]! }))
}

/** The fixed starter grid, resolved once and then served from cache. */
export function curatedArtists(): Promise<ArtistCard[]> {
  return withPhotos(CURATED)
}

/**
 * Artists matching a typed query, with faces.
 *
 * iTunes names the matches (it has the fullest catalogue and answers reliably);
 * the photos are resolved the same way as the curated grid. Bounded to a
 * handful, because each is a portrait lookup.
 */
export async function searchArtists(query: string): Promise<ArtistCard[]> {
  try {
    const url = new URL('https://itunes.apple.com/search')
    url.searchParams.set('term', query)
    url.searchParams.set('entity', 'musicArtist')
    url.searchParams.set('limit', '10')
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!response.ok) return []
    const body = (await response.json()) as { results?: { artistName?: string }[] }

    const seen = new Set<string>()
    const names: string[] = []
    for (const row of body.results ?? []) {
      const name = row.artistName?.trim()
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      names.push(name)
      if (names.length >= 8) break
    }
    return withPhotos(names)
  } catch {
    return []
  }
}
