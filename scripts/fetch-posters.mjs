#!/usr/bin/env node
/**
 * Pulls poster art for well-known films and shows from TMDB and writes
 * src/data/posters.json.
 *
 * Runs at build time, never in the browser: the API key stays on your machine
 * and the app only ever imports the resulting list of image URLs.
 *
 *   npm run posters
 *
 * If src/data/posters.json is empty or an image fails to load, PosterWall
 * falls back to its procedural CSS posters — the page never breaks.
 */

import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_FILE = path.join(ROOT, 'src/data/posters.json')

/** Rendered at ~140px wide, dimmed and blurred — w185 is plenty. */
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w185'
/** 16:9 stills for the device mockups — larger, since these are shown big. */
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780'
const TARGET_COUNT = 140
const PAGES = 5
/** One trailer per device on the landing page, plus spares. */
const SCREEN_COUNT = 6

/**
 * Vote count is the best available proxy for "famous". TV thresholds are lower
 * because TMDB TV entries collect far fewer votes than films.
 */
const SOURCES = [
  { path: 'movie/top_rated', minVotes: 4000 },
  { path: 'movie/popular', minVotes: 3000 },
  { path: 'tv/top_rated', minVotes: 1200 },
  { path: 'tv/popular', minVotes: 900 },
]

function loadEnv() {
  const envPath = path.join(ROOT, '.env')
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath)
    } catch {
      /* Malformed .env — fall through to the missing-key message below. */
    }
  }
  return process.env.TMDB_API_KEY?.trim()
}

function buildRequest(key, endpoint, page) {
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}`)
  url.searchParams.set('language', 'en-US')
  // The /videos endpoint is unpaginated; sending page=undefined 422s it.
  if (page !== undefined) url.searchParams.set('page', String(page))

  // v4 read tokens are JWTs and go in the header; v3 keys go in the query.
  const isV4Token = key.startsWith('eyJ')
  if (!isV4Token) url.searchParams.set('api_key', key)

  return {
    url,
    headers: isV4Token ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : {},
  }
}

/** Trailers for one title. Returns [] rather than throwing — a title with no
    video should not fail the whole build. */
async function fetchVideos(key, mediaType, id) {
  try {
    const { url, headers } = buildRequest(key, `${mediaType}/${id}/videos`)
    const response = await fetch(url, { headers })
    if (!response.ok) return []
    const body = await response.json()
    return body.results ?? []
  } catch {
    return []
  }
}

async function fetchPage(key, endpoint, page) {
  const { url, headers } = buildRequest(key, endpoint, page)
  const response = await fetch(url, { headers })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `TMDB ${endpoint} page ${page} failed: ${response.status} ${response.statusText}\n${detail.slice(0, 300)}`,
    )
  }

  const body = await response.json()
  return body.results ?? []
}

/** Seeded shuffle, so the wall composes the same way on every build. */
function shuffle(items, seed) {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

async function main() {
  const key = loadEnv()

  if (!key) {
    console.error(
      [
        '',
        '  No TMDB_API_KEY found.',
        '',
        '  1. Grab a key: https://www.themoviedb.org/settings/api',
        '  2. Put it in .env:  TMDB_API_KEY=your_key_here',
        '  3. Re-run:  npm run posters',
        '',
        '  Until then the poster wall renders its procedural CSS posters.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  const collected = new Map()

  for (const source of SOURCES) {
    const mediaType = source.path.startsWith('tv/') ? 'tv' : 'movie'

    const pages = await Promise.all(
      Array.from({ length: PAGES }, (_, i) => fetchPage(key, source.path, i + 1)),
    )

    for (const entry of pages.flat()) {
      if (!entry.poster_path) continue
      if ((entry.vote_count ?? 0) < source.minVotes) continue
      if (collected.has(entry.poster_path)) continue

      collected.set(entry.poster_path, {
        id: entry.id,
        path: entry.poster_path,
        backdrop: entry.backdrop_path ?? null,
        title: entry.title ?? entry.name ?? 'Untitled',
        mediaType,
        votes: entry.vote_count ?? 0,
      })
    }
  }

  // Rank by fame, keep the top slice, then shuffle so the wall isn't ordered
  // most-famous-first (which would cluster all the blockbusters in row one).
  const ranked = [...collected.values()].sort((a, b) => b.votes - a.votes).slice(0, TARGET_COUNT)
  const posters = shuffle(ranked, 0x5ec0).map(({ path: posterPath, title, mediaType }) => ({
    path: posterPath,
    title,
    mediaType,
  }))

  /*
   * 16:9 stills for the device screens. Taken from the most-voted titles that
   * actually have a backdrop, so the mockups look like something is playing
   * even before real video files are dropped in.
   */
  const backdropSource = [...collected.values()]
    .filter((entry) => entry.backdrop)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 12)

  const backdrops = backdropSource.map(({ backdrop, title }) => ({ path: backdrop, title }))

  /*
   * Real footage for the device mockups. TMDB doesn't host video, but it does
   * index each title's official YouTube trailer — publisher-uploaded and
   * embeddable, which is the honest way to show actual film footage without
   * hosting anyone's content ourselves.
   */
  const screens = []
  for (const entry of backdropSource) {
    if (screens.length >= SCREEN_COUNT) break

    const videos = await fetchVideos(key, entry.mediaType, entry.id)
    const trailer =
      videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ??
      videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ??
      videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser')

    if (!trailer?.key) continue
    screens.push({ youtubeId: trailer.key, backdrop: entry.backdrop, title: entry.title })
  }

  if (posters.length === 0) {
    console.error('  TMDB returned no usable posters. Leaving posters.json untouched.')
    process.exit(1)
  }

  await writeFile(
    OUT_FILE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'The Movie Database (TMDB)',
        imageBase: IMAGE_BASE,
        backdropBase: BACKDROP_BASE,
        posters,
        backdrops,
        screens,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const films = posters.filter((p) => p.mediaType === 'movie').length
  console.log(
    `  Wrote ${posters.length} posters (${films} films, ${posters.length - films} shows) ` +
      `${backdrops.length} backdrops and ${screens.length} trailers → src/data/posters.json`,
  )

  if (posters.length < 90) {
    console.warn(
      `  Heads up: fewer than 90 posters, so the hero wall will repeat some titles.`,
    )
  }
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
})
