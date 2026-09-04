/**
 * The current charts, for the front door's cover wall.
 *
 * The landing page dresses itself in real album art rather than stock shapes,
 * so it needs a live-ish list of covers. iTunes' top-songs feed is keyless and
 * gives high-res artwork; it is fetched at most once an hour and served from
 * memory in between, because a marketing wall does not need to be to the minute
 * and the feed should not be hit on every page load.
 */

export type ChartCover = {
  title: string
  artist: string
  artwork: string
}

let cache: { at: number; covers: ChartCover[] } | null = null
const TTL = 60 * 60 * 1000

type Entry = {
  'im:name'?: { label?: string }
  'im:artist'?: { label?: string }
  'im:image'?: { label?: string }[]
}

async function load(): Promise<ChartCover[]> {
  try {
    const response = await fetch('https://itunes.apple.com/us/rss/topsongs/limit=48/json', {
      signal: AbortSignal.timeout(7000),
    })
    if (!response.ok) return []
    const body = (await response.json()) as { feed?: { entry?: Entry[] } }
    return (body.feed?.entry ?? [])
      .map((entry) => {
        const images = entry['im:image'] ?? []
        const artwork = images[images.length - 1]?.label
        return {
          title: entry['im:name']?.label ?? '',
          artist: entry['im:artist']?.label ?? '',
          /* The feed's largest is 170px; the CDN serves any size from the same
             path, so ask for something worth showing full-bleed. */
          artwork: artwork ? artwork.replace(/\/\d+x\d+bb\.(png|jpg)$/, '/600x600bb.$1') : '',
        }
      })
      .filter((cover) => cover.artwork)
  } catch {
    return []
  }
}

export async function topCovers(): Promise<ChartCover[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.covers
  const covers = await load()
  /* Keep the last good list if a refresh fails — better a stale wall than none. */
  if (covers.length > 0) cache = { at: Date.now(), covers }
  return cache?.covers ?? []
}
