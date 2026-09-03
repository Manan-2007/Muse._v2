/**
 * Auto-discovery for the character roster.
 *
 * Drop files into `src/assets/characters/` and they become selectable avatars.
 * Two kinds, and a character can have both:
 *
 * - `arjun.glb` — a rigged 3D character. Its animation clips drive the idle,
 *   so this is the one that actually breathes and shifts weight.
 * - `arjun.png` — a flat cutout, used when there is no `.glb` for that id, or
 *   while the 3D chunk is still downloading.
 *
 * See `src/assets/characters/README.md`.
 */

const glbModules = import.meta.glob('../assets/characters/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const pngModules = import.meta.glob('../assets/characters/*.{png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export type Character = {
  id: string
  label: string
  /** Rigged model. Present means this character can be animated properly. */
  glb?: string
  /** Flat cutout. The fallback, and what a `.glb`-less roster runs on. */
  png?: string
}

function basename(filePath: string) {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
}

function prettify(id: string) {
  /* Numbered files are the fast way to add a roster — `1.glb`, `2.glb` — so
     they get a readable name instead of a bare digit. */
  if (/^\d+$/.test(id)) return `Character ${Number(id)}`

  return id
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const drafts = new Map<string, Character>()

function draft(id: string): Character {
  const existing = drafts.get(id)
  if (existing) return existing
  const created: Character = { id, label: prettify(id) }
  drafts.set(id, created)
  return created
}

for (const [filePath, url] of Object.entries(glbModules)) {
  draft(basename(filePath)).glb = url
}

for (const [filePath, url] of Object.entries(pngModules)) {
  draft(basename(filePath)).png = url
}

/** The roster, alphabetical so the picker doesn't reshuffle between builds. */
export const ROSTER: Character[] = [...drafts.values()].sort((a, b) => a.id.localeCompare(b.id))

export const hasRoster = ROSTER.length > 0

/**
 * True once any character ships a rigged model. Gates the lazy three.js import,
 * so a project with a PNG-only roster never downloads the 3D chunk.
 */
export const hasRiggedCharacters = ROSTER.some((entry) => Boolean(entry.glb))

/** Stable, well-spread index from a user id — same person, same character. */
function hash(seed: string) {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return Math.abs(value)
}

/**
 * Which character to draw for a member.
 *
 * Your own choice comes from settings and wins. Everyone else is derived from
 * their user id, so a room looks consistent to everybody without the server
 * knowing anything about avatars yet — swap this for a real `characterId` on
 * the User model when that column lands.
 */
export function characterFor(userId: string, preferredId?: string | null): Character | undefined {
  if (ROSTER.length === 0) return undefined
  if (preferredId) {
    const match = ROSTER.find((entry) => entry.id === preferredId)
    if (match) return match
  }
  return ROSTER[hash(userId) % ROSTER.length]
}
