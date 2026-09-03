import { env } from '../config/env.js'
import { HttpError } from '../utils/HttpError.js'
import type { WatchSource } from './watch.service.js'

/**
 * Turning what someone pasted into something the room can play.
 *
 * Three sources, and the difference between them is not cosmetic — it is
 * whether the platform gives us any way to observe and drive playback:
 *
 * - `youtube` — the IFrame Player API exposes play/pause/seek/rate, so the room
 *   can genuinely stay on the same frame.
 * - `file`    — a direct media URL in an HTML5 `<video>`. Same story, plus
 *   arbitrary playback rates, which makes drift correction smoother.
 * - `external` — Netflix, Prime, Disney+, Hotstar and friends. These expose no
 *   playback API and their players are DRM-sandboxed, so nothing can embed or
 *   drive them. Pretending otherwise would mean a player that silently
 *   desyncs. Instead the room syncs a countdown and a shared clock, and
 *   everyone drives their own tab.
 */

export type ResolvedSource = {
  source: WatchSource
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
  /** Shown in the UI when a platform can't be embedded, so the mode makes sense. */
  note?: string
}

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

/** Platforms with no public playback API — recognised so we can say so by name. */
const WALLED: Record<string, string> = {
  'netflix.com': 'Netflix',
  'primevideo.com': 'Prime Video',
  'amazon.com': 'Prime Video',
  'hotstar.com': 'JioHotstar',
  'disneyplus.com': 'Disney+',
  'hulu.com': 'Hulu',
  'max.com': 'Max',
  'hbomax.com': 'Max',
  'appletv.com': 'Apple TV+',
  'tv.apple.com': 'Apple TV+',
  'sonyliv.com': 'SonyLIV',
  'zee5.com': 'ZEE5',
}

const MEDIA_EXTENSIONS = /\.(mp4|webm|ogg|ogv|m4v|mov)(\?|#|$)/i

/** An 11-character YouTube id, which is also what people paste on its own. */
const BARE_ID = /^[\w-]{11}$/

export function youtubeIdFrom(raw: string): string | null {
  const trimmed = raw.trim()
  if (BARE_ID.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return null

  if (host.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0] ?? ''
    return BARE_ID.test(id) ? id : null
  }

  const param = url.searchParams.get('v')
  if (param && BARE_ID.test(param)) return param

  /* /embed/ID, /shorts/ID and /live/ID all carry the id as the last segment. */
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments.at(-1) ?? ''
  if (segments.length >= 2 && BARE_ID.test(last)) return last

  return null
}

function walledPlatform(raw: string): string | null {
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    for (const [domain, label] of Object.entries(WALLED)) {
      if (host === domain || host.endsWith(`.${domain}`)) return label
    }
  } catch {
    /* Not a URL at all — handled by the caller as a free-text title. */
  }
  return null
}

/**
 * A video's real title, without an API key.
 *
 * oEmbed is public and unauthenticated, which is why it is worth the round
 * trip: the alternative is showing "YouTube track" until the iframe loads and
 * volunteers its own metadata, and by then it is already in the queue under
 * the wrong name for everybody else in the room.
 */
export async function youtubeOEmbed(id: string) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!response.ok) return null
    return (await response.json()) as {
      title?: string
      thumbnail_url?: string
      /* The uploading channel. For music this is usually the artist, or close
         enough to be a better guess than nothing. */
      author_name?: string
    }
  } catch {
    return null
  }
}

export async function resolveSource(raw: string): Promise<ResolvedSource> {
  const input = raw.trim()
  if (!input) throw HttpError.badRequest('Paste a link or a title')

  const youtubeId = youtubeIdFrom(input)
  if (youtubeId) {
    const meta = await youtubeOEmbed(youtubeId)
    return {
      source: 'youtube',
      ref: youtubeId,
      title: meta?.title ?? 'YouTube video',
      duration: null,
      thumbnail: meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    }
  }

  const walled = walledPlatform(input)
  if (walled) {
    return {
      source: 'external',
      ref: input,
      title: walled,
      duration: null,
      thumbnail: null,
      note: `${walled} has no public playback API, so it can't be embedded or driven from here. The room will sync a countdown and a shared clock instead — everyone plays it in their own tab.`,
    }
  }

  if (MEDIA_EXTENSIONS.test(input) && /^https?:\/\//i.test(input)) {
    const name = decodeURIComponent(input.split('/').pop() ?? 'Video').replace(
      MEDIA_EXTENSIONS,
      '',
    )
    return { source: 'file', ref: input, title: name || 'Video', duration: null, thumbnail: null }
  }

  if (/^https?:\/\//i.test(input)) {
    return {
      source: 'external',
      ref: input,
      title: new URL(input).hostname.replace(/^www\./, ''),
      duration: null,
      thumbnail: null,
      note: "That link isn't a YouTube video or a direct video file, so it can't be embedded. The room will sync a countdown and a shared clock instead.",
    }
  }

  /* Free text: someone naming what everyone is about to put on themselves. */
  return {
    source: 'external',
    ref: input,
    title: input,
    duration: null,
    thumbnail: null,
    note: 'Nothing to embed for a plain title — the room will sync a countdown and a shared clock so you all start together.',
  }
}

export type SearchResult = {
  id: string
  title: string
  channel: string
  thumbnail: string
}

/**
 * Public Piped instances, used when there is no API key.
 *
 * Piped is an open-source YouTube front end whose search endpoint needs no
 * credentials, which is the only reason searching works out of the box here.
 * It is a real dependency on somebody else's volunteer server, so: they are
 * asked in parallel, each gets a short timeout, and the whole thing is a
 * fallback rather than the primary path.
 *
 * The API key remains the better answer. This exists so that "search for a
 * song" works the moment the app is cloned, not because it is more reliable.
 */
const PIPED_INSTANCES = [
  /* Ordered by what was actually answering when this was last checked. They
     are raced, so a dead one costs nothing but a wasted socket — the order is
     only a hint about which is likeliest to win. */
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.ducks.party',
  'https://pipedapi.drgns.space',
]

/** Piped returns `/watch?v=…`; the id is all we keep. */
function pipedVideoId(url: string | undefined): string | null {
  if (!url) return null
  const match = /[?&]v=([\w-]{11})/.exec(url)
  return match?.[1] ?? null
}

/**
 * Ask every instance at once and take the first real answer.
 *
 * Tried in turn, one unresponsive instance spent its whole timeout before the
 * next was even contacted — three of those in a row is nearly twenty seconds
 * of someone watching a spinner to search for a song. Raced, the slowest
 * instance costs nothing at all: the first one to answer wins and the rest are
 * abandoned. They are volunteer servers being asked one small question, which
 * is the case where racing is courteous rather than greedy.
 */
async function searchViaPiped(query: string): Promise<SearchResult[]> {
  const attempts = PIPED_INSTANCES.map((instance) => askPiped(instance, query))

  try {
    /* `any` resolves on the first *fulfilled* attempt, ignoring rejections —
       exactly the semantics wanted, unlike `race`, which would surrender to
       the first instance to fail. */
    return await Promise.any(attempts)
  } catch {
    throw HttpError.badRequest(
      'Search is temporarily unavailable. Add YOUTUBE_API_KEY to server/.env for reliable search — pasting a link always works.',
    )
  }
}

async function askPiped(instance: string, query: string): Promise<SearchResult[]> {
  const url = new URL(`${instance}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('filter', 'videos')

  const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!response.ok) throw new Error(`${instance} answered ${response.status}`)

  const body = (await response.json()) as {
    items?: {
      url?: string
      title?: string
      uploaderName?: string
      thumbnail?: string
      duration?: number
    }[]
  }

  const results = (body.items ?? [])
    .map((item) => ({ ...item, id: pipedVideoId(item.url) }))
    .filter((item): item is typeof item & { id: string } => Boolean(item.id))
    /* Live streams report a duration of zero or less and behave badly in a
       queue that assumes songs end. */
    .filter((item) => (item.duration ?? 0) > 0)
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.title ?? 'Untitled',
      channel: item.uploaderName ?? '',
      /*
       * Deliberately not the thumbnail Piped hands back. That URL points at
       * the instance's own image proxy, which is the least reliable part of a
       * volunteer-run service — a dead proxy leaves every result showing a
       * broken image, and the artwork is most of what makes this grid
       * readable. YouTube's own CDN serves this path for any video id.
       */
      thumbnail: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    }))

  /* An empty answer is not a usable one — let a slower instance win instead. */
  if (results.length === 0) throw new Error(`${instance} returned nothing`)
  return results
}

export async function searchYouTube(query: string): Promise<SearchResult[]> {
  /* No key: fall back to a keyless instance rather than refusing outright. */
  if (!env.youtubeApiKey) return searchViaPiped(query)

  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('maxResults', '12')
  /* Embeddable-only: a result that refuses to play in an iframe is worse than
     no result, because it fails after everyone has already committed to it. */
  url.searchParams.set('videoEmbeddable', 'true')
  url.searchParams.set('q', query)
  url.searchParams.set('key', env.youtubeApiKey)

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) {
    /*
     * A dead key should not mean a dead search box.
     *
     * 403 covers both a misconfigured key and the daily quota running out —
     * and quota exhaustion is the common one, since a search costs 100 of the
     * free tier's 10,000 daily units. Falling through keeps the feature
     * working on the day it matters most.
     */
    if (response.status === 403) return searchViaPiped(query)
    throw HttpError.badRequest('YouTube search is unavailable right now.')
  }

  const body = (await response.json()) as {
    items?: {
      id?: { videoId?: string }
      snippet?: {
        title?: string
        channelTitle?: string
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
      }
    }[]
  }

  return (body.items ?? [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      id: item.id!.videoId!,
      title: item.snippet?.title ?? 'Untitled',
      channel: item.snippet?.channelTitle ?? '',
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        `https://i.ytimg.com/vi/${item.id!.videoId!}/hqdefault.jpg`,
    }))
}

/**
 * Whether the client should offer a search box at all.
 *
 * Always true now: without a key there is still the keyless fallback above.
 * The client's job is to show the box; saying whether any given query worked
 * is the response's job, and it says so with a message rather than by having
 * the field never appear.
 */
export const searchAvailable = () => true

/** Whether search is running on the reliable path. Surfaced for diagnostics. */
export const searchIsKeyed = () => Boolean(env.youtubeApiKey)
