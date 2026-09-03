/**
 * Time-synced lyrics, from LRCLIB.
 *
 * Chosen because it is the only source that can legally be used this way. The
 * synced lyrics behind Apple Music and Spotify are licensed from Musixmatch,
 * whose free tier returns a third of the text and no timings at all — the one
 * thing a karaoke view is made of. Genius has the words but never the clock.
 * LRCLIB is community-contributed, needs no key, and asks only that callers
 * identify themselves.
 *
 * Fetched here rather than from the browser so the app can cache a result the
 * whole room will ask for, and so a source that is occasionally slow or down
 * degrades in one place instead of in everybody's player.
 */

const ENDPOINT = 'https://lrclib.net/api/get'
const SEARCH = 'https://lrclib.net/api/search'
/* Their guidance: say who you are and where to complain. */
const AGENT = 'Huddle (https://github.com/tzxh45dhff-art/FEE-PROJECT)'

export type LyricLine = { at: number; text: string }
export type LyricsResult =
  | { kind: 'synced'; lines: LyricLine[]; plain: string | null }
  | { kind: 'plain'; plain: string }
  | { kind: 'none' }

/**
 * Strip the decoration a video title carries and a lyric database does not.
 *
 * A track that arrived from YouTube is titled for a thumbnail, not for a
 * lookup: "Kesariya (Official Video) [4K] | Arijit Singh | Brahmastra". Every
 * one of those extras is a reason the exact-match endpoint misses, so they
 * come off before asking. Deliberately conservative — cutting real words out
 * of a title loses the match just as surely as leaving the noise in.
 */
export function cleanTitle(raw: string): string {
  let out = raw

  /* Bracketed asides, but only the ones that are plainly not part of a name.
     "(Live)" and "(Remix)" are removed as decoration; "(Part 2)" is not. */
  out = out.replace(
    /[([]\s*(official\s*)?(music\s*)?(lyric[s]?\s*)?(video|audio|visualiser|visualizer|hd|4k|full\s*song|lyrics?)\s*[)\]]/gi,
    ' ',
  )
  out = out.replace(/[([]\s*(official|remaster(ed)?|explicit|clean)\s*(\d{4})?\s*[)\]]/gi, ' ')

  /* Trailing pipe sections are almost always credits on YouTube. */
  out = out.replace(/\s*\|.*$/, ' ')

  /*
   * Trailing decoration after a dash — "Levitating - Official Audio".
   *
   * Runs before any prefix handling. Done the other way round, a title whose
   * only dash is this one is read as "artist - title" and the decoration is
   * kept as the title, which is precisely backwards.
   */
  out = out.replace(/\s*[-\u2013\u2014]\s*(official|lyric[s]?|audio|video|visuali[sz]er)\b.*$/i, ' ')

  out = out.replace(/["\u201c\u201d]/g, ' ')
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * The forms of a title worth asking about, best first.
 *
 * "Artist - Title" and "Title - Subtitle" are the same shape, and nothing in
 * the string says which one it is: splitting "T-Series - Kesariya" on its
 * first dash yields "Series - Kesariya", and refusing to split at all leaves a
 * label name in front of every Bollywood track. Rather than guess once and be
 * wrong half the time, both readings are offered and the lookup takes
 * whichever actually finds words.
 *
 * Only ever asked in order, so the unsplit title — the safe reading — is what
 * a match is found on when both would work.
 */
export function titleCandidates(raw: string, artist: string): string[] {
  const base = cleanTitle(raw)
  const out = [base]

  /* A dash with spaces around it. "T-Series" has none, so it survives. */
  const split = base.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/)
  if (split?.[1] && split[2]) {
    const [, before, after] = split
    /* When the part before the dash is the artist we already know, the rest
       is unambiguously the title and goes first. */
    const known = artist && before.toLowerCase().includes(artist.toLowerCase().slice(0, 12))
    if (known) out.unshift(after)
    else out.push(after)
  }

  return [...new Set(out.map((entry) => entry.trim()).filter(Boolean))]
}

/** The artist, minus the "topic" and "VEVO" suffixes YouTube channels carry. */
export function cleanArtist(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s*official$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse an LRC body into timed lines.
 *
 * One timestamp per line is the common case, but the format allows several on
 * a single line to repeat a chorus, so each is expanded into its own entry.
 * Blank lyrics are kept: they are the instrumental gaps, and dropping them is
 * what makes a view jump from the end of one verse to the next with nothing in
 * between.
 */
export function parseLrc(body: string): LyricLine[] {
  const lines: LyricLine[] = []

  for (const raw of body.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (stamps.length === 0) continue

    const text = raw.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim()

    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      /* Hundredths in the usual case, but the field may be milliseconds. */
      const fraction = stamp[3] ? Number(stamp[3]) / (stamp[3].length === 3 ? 1000 : 100) : 0
      lines.push({ at: minutes * 60 + seconds + fraction, text })
    }
  }

  /* Multiple stamps on one line arrive out of order by construction. */
  return lines.sort((a, b) => a.at - b.at)
}

type LrcRecord = {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
}

function toResult(record: LrcRecord | undefined): LyricsResult {
  if (!record || record.instrumental) return { kind: 'none' }

  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics)
    if (lines.length > 0) {
      return { kind: 'synced', lines, plain: record.plainLyrics ?? null }
    }
  }
  if (record.plainLyrics?.trim()) return { kind: 'plain', plain: record.plainLyrics }
  return { kind: 'none' }
}

async function ask(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`lrclib ${response.status}`)
  return response.json()
}

/**
 * Cached in memory, by the cleaned query.
 *
 * A room of six asks for the same track at the same moment, and asks again
 * every time somebody reopens the view. Nothing here changes on a timescale
 * worth re-fetching for, and being a considerate client of a free community
 * service is part of being allowed to use one.
 */
const cache = new Map<string, { at: number; value: LyricsResult }>()
const TTL_MS = 1000 * 60 * 60 * 6
const MAX_ENTRIES = 500

export async function lyricsFor(input: {
  title: string
  artist: string | null
  album?: string | null
  duration?: number | null
}): Promise<LyricsResult> {
  const artist = cleanArtist(input.artist)
  const candidates = titleCandidates(input.title, artist)
  if (candidates.length === 0) return { kind: 'none' }

  const key = `${candidates.join('|').toLowerCase()}::${artist.toLowerCase()}::${Math.round(input.duration ?? 0)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const remember = (value: LyricsResult) => {
    if (cache.size >= MAX_ENTRIES) {
      /* Oldest insertion first — Map preserves it, and this runs rarely
         enough that a real LRU would be machinery for its own sake. */
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, { at: Date.now(), value })
    return value
  }

  const wanted = input.duration ?? 0

  try {
    /* Anything with timings beats anything without, whichever reading of the
       title found it — so a plain hit on the first candidate is held rather
       than returned, in case the second turns up a synced one. */
    let fallback: LyricsResult = { kind: 'none' }

    for (const title of candidates) {
      /*
       * The exact endpoint first: it is the only one that takes a duration,
       * and a duration is what separates a cover, a live take and a remix
       * from the recording actually playing.
       */
      if (artist) {
        const exact = new URL(ENDPOINT)
        exact.searchParams.set('track_name', title)
        exact.searchParams.set('artist_name', artist)
        if (input.album) exact.searchParams.set('album_name', input.album)
        if (input.duration) exact.searchParams.set('duration', String(Math.round(input.duration)))

        const record = (await ask(exact.toString())) as LrcRecord | null
        const result = toResult(record ?? undefined)
        if (result.kind === 'synced') return remember(result)
        if (result.kind === 'plain' && fallback.kind === 'none') fallback = result
      }

      /* Then search, which is fuzzy and unordered by length, so the closest
         duration wins rather than the first row returned. */
      const search = new URL(SEARCH)
      search.searchParams.set('track_name', title)
      if (artist) search.searchParams.set('artist_name', artist)

      const rows = ((await ask(search.toString())) ?? []) as (LrcRecord & { duration?: number })[]
      if (!Array.isArray(rows) || rows.length === 0) continue

      const ranked = [...rows].sort((a, b) => {
        const synced = Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics))
        if (synced !== 0) return synced
        if (!wanted) return 0
        return Math.abs((a.duration ?? 0) - wanted) - Math.abs((b.duration ?? 0) - wanted)
      })

      const best = ranked[0]
      /* A match more than fifteen seconds out is a different recording, and
         its timings would run further adrift with every line. Its words may
         still be right, so it is kept as plain rather than thrown away. */
      if (wanted && best?.duration && Math.abs(best.duration - wanted) > 15) {
        const plain = ranked.find((row) => row.plainLyrics)?.plainLyrics
        if (plain && fallback.kind === 'none') fallback = { kind: 'plain', plain }
        continue
      }

      const result = toResult(best)
      if (result.kind === 'synced') return remember(result)
      if (result.kind === 'plain' && fallback.kind === 'none') fallback = result
    }

    return remember(fallback)
  } catch {
    /* Timeout, offline, or the service having a bad day. Not an error worth
       showing — the view simply says it has nothing, and a later track will
       try again. Deliberately not cached, so it is not a lasting "no". */
    return { kind: 'none' }
  }
}
