/**
 * Art for the background poster wall.
 *
 * Two layers, in order of preference:
 *
 *  1. Real poster art from TMDB, pulled at build time by `npm run posters`
 *     into `src/data/posters.json`.
 *  2. A procedural CSS fallback — colour grades, light washes and grain — used
 *     when that file is empty (no API key yet) or an image fails to load.
 *
 * Everything is derived from a fixed seed so the wall composes identically on
 * every render, and between the hero and any other surface that reuses it.
 */
import posterData from '@/data/posters.json'

export type PosterGrade = {
  name: string
  base: string
  mid: string
  glow: string
}

/** Deep, desaturated grades — blue, red, green, amber, violet, teal. */
export const POSTER_GRADES: PosterGrade[] = [
  { name: 'blue', base: '#08132e', mid: '#1d4291', glow: '#5a8cf0' },
  { name: 'red', base: '#26080f', mid: '#8a1c30', glow: '#f0687e' },
  { name: 'green', base: '#051b12', mid: '#14603d', glow: '#45d199' },
  { name: 'amber', base: '#241405', mid: '#8a5514', glow: '#f5b74a' },
  { name: 'violet', base: '#170828', mid: '#4d2476', glow: '#b478f5' },
  { name: 'teal', base: '#041920', mid: '#115468', glow: '#4cc3e0' },
]

export type PosterShape = 'streak' | 'halo' | 'arc' | 'plain'

export type Poster = {
  id: string
  grade: PosterGrade
  /** Angle of the base gradient wash, in degrees. */
  angle: number
  /** Light-source position within the poster, in percent. */
  lightX: number
  lightY: number
  /** How strongly the grade's glow colour reads. */
  intensity: number
  shape: PosterShape
  /** Offset of the abstract shape, in percent. */
  shapeX: number
  shapeY: number
  shapeScale: number
  /** Real artwork, when a TMDB pull is available. Absent → CSS fallback shows. */
  imageSrc?: string
}

/** Small, fast, seedable PRNG (mulberry32). */
function makeRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded Fisher–Yates, so the wall composes identically on every load. */
function shuffle<T>(items: T[], seed: number): T[] {
  const random = makeRandom(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Flat deck of poster image URLs. Rows deal from it in order, so a title never
 * lands twice in the same row — or next to itself in the row above — as long
 * as the deck is larger than the wall.
 */
type PosterManifest = {
  generatedAt: string | null
  source: string
  imageBase: string
  posters: { path: string; title: string; mediaType: 'movie' | 'tv' }[]
}

/* Cast because the checked-in manifest starts empty, which TS reads as never[]. */
const manifest = posterData as PosterManifest

const POSTER_DECK: string[] = shuffle(
  manifest.posters.map((poster) => `${manifest.imageBase}${poster.path}`),
  0x51ce,
)

/** True once `npm run posters` has been run with a TMDB key in place. */
export const hasRealPosters = POSTER_DECK.length > 0

const SHAPES: PosterShape[] = ['streak', 'halo', 'arc', 'plain', 'halo', 'streak']

export function buildPosterRow(rowIndex: number, count: number, deckStart = 0): Poster[] {
  const random = makeRandom(0x5ec0 + rowIndex * 7919)

  return Array.from({ length: count }, (_, i) => {
    const grade = POSTER_GRADES[Math.floor(random() * POSTER_GRADES.length)]

    return {
      id: `r${rowIndex}-p${i}`,
      grade,
      angle: 120 + Math.round(random() * 130),
      lightX: 18 + Math.round(random() * 64),
      lightY: 12 + Math.round(random() * 45),
      intensity: 0.3 + random() * 0.5,
      shape: SHAPES[Math.floor(random() * SHAPES.length)],
      shapeX: 10 + Math.round(random() * 70),
      shapeY: 20 + Math.round(random() * 60),
      shapeScale: 0.7 + random() * 0.9,
      imageSrc: POSTER_DECK.length
        ? POSTER_DECK[(deckStart + i) % POSTER_DECK.length]
        : undefined,
    }
  })
}

export type PosterRow = {
  index: number
  posters: Poster[]
  /** Poster height in px — rows vary a little so the wall reads as depth. */
  height: number
  /** Seconds for one full marquee cycle. */
  duration: number
  /** Odd rows drift right, even rows drift left. */
  reverse: boolean
  /** Horizontal stagger so poster edges never line up between rows. */
  offset: number
}

const ROW_HEIGHTS = [188, 156, 212, 172, 196, 164]
const ROW_DURATIONS = [118, 96, 142, 104, 128, 88]
const ROW_OFFSETS = [0, -70, -35, -110, -18, -88]

/**
 * @param deckOffset Where in the shuffled poster deck this wall starts dealing.
 *   Lets a second wall on the same page (the closing CTA) show different titles
 *   from the hero.
 */
export function buildPosterRows(
  rowCount: number,
  postersPerRow = 12,
  deckOffset = 0,
): PosterRow[] {
  return Array.from({ length: rowCount }, (_, index) => ({
    index,
    posters: buildPosterRow(index, postersPerRow, deckOffset + index * postersPerRow),
    height: ROW_HEIGHTS[index % ROW_HEIGHTS.length],
    duration: ROW_DURATIONS[index % ROW_DURATIONS.length],
    reverse: index % 2 === 1,
    offset: ROW_OFFSETS[index % ROW_OFFSETS.length],
  }))
}
