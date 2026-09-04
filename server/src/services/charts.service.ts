/**
 * Recognisable album art, for the front door's cover wall.
 *
 * The landing page dresses itself in real, *known* covers — not a regional
 * top-50 nobody recognises. So rather than the charts feed, it pulls a handful
 * of each of a curated set of big-name artists from iTunes (keyless, reliable),
 * then interleaves them so the wall reads as a mix rather than one artist at a
 * time. Fetched at most once a day and served from memory in between.
 */

export type ChartCover = {
  title: string
  artist: string
  artwork: string
}

/** Names people know at a glance — the wall should be instantly familiar. */
const ARTISTS = [
  'The Weeknd',
  'Charlie Puth',
  'Ariana Grande',
  'Michael Jackson',
  'Don Toliver',
  'Travis Scott',
  'The Kid LAROI',
  'Drake',
  'SZA',
  'Billie Eilish',
  'Dua Lipa',
  'Kendrick Lamar',
]

let cache: { at: number; covers: ChartCover[] } | null = null
const TTL = 24 * 60 * 60 * 1000

type ITunesSong = {
  trackName?: string
  artistName?: string
  collectionName?: string
  artworkUrl100?: string
}

async function coversFor(artist: string): Promise<ChartCover[]> {
  try {
    const url = new URL('https://itunes.apple.com/search')
    url.searchParams.set('term', artist)
    url.searchParams.set('entity', 'song')
    url.searchParams.set('limit', '8')
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!response.ok) return []
    const body = (await response.json()) as { results?: ITunesSong[] }

    const seen = new Set<string>()
    const out: ChartCover[] = []
    for (const song of body.results ?? []) {
      const artwork = song.artworkUrl100?.replace('100x100bb', '600x600bb')
      const key = song.collectionName ?? song.trackName ?? ''
      if (!artwork || seen.has(key)) continue
      seen.add(key)
      out.push({ title: song.trackName ?? '', artist: song.artistName ?? artist, artwork })
      if (out.length >= 5) break
    }
    return out
  } catch {
    return []
  }
}

/** Round-robin the per-artist lists so no two neighbours share an artist. */
function interleave(lists: ChartCover[][]): ChartCover[] {
  const out: ChartCover[] = []
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i += 1) {
    for (const list of lists) if (list[i]) out.push(list[i]!)
  }
  return out
}

async function load(): Promise<ChartCover[]> {
  const lists = await Promise.all(ARTISTS.map((artist) => coversFor(artist)))
  return interleave(lists)
}

export async function topCovers(): Promise<ChartCover[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.covers
  const covers = await load()
  /* Keep the last good list if a refresh fails — better a stale wall than none. */
  if (covers.length > 0) cache = { at: Date.now(), covers }
  return cache?.covers ?? []
}
