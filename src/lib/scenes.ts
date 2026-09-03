/**
 * Auto-discovery for the hub's backdrops.
 *
 * Drop artwork into `src/assets/scenes/` and it appears in the backdrop picker.
 * Nothing to register — the folder is globbed at build time.
 *
 * A scene is a *set of depth planes that share a name*, because that is what
 * parallax actually needs: `lake-far.png` + `lake-mid.png` + `lake-near.png`
 * is one scene called "lake" with three planes that move at different rates.
 * A lone `lake.png` is still a valid scene — it just gets one plane, so the
 * tilt is a single flat drift rather than real depth.
 *
 * See `src/assets/scenes/README.md`.
 */

/** Back to front. The order here is the order they stack and how far they move. */
const LAYER_ORDER = ['far', 'mid', 'near'] as const

export type LayerName = (typeof LAYER_ORDER)[number]

export type SceneLayer = {
  name: LayerName
  url: string
  /** How much this plane shifts relative to the pointer — near moves most. */
  depth: number
  /** Overscan, so a shifted plane never exposes the page behind its edge. */
  scale: number
}

export type Scene = {
  id: string
  label: string
  layers: SceneLayer[]
  /** A looping video for this scene, used instead of the still planes. */
  video?: string
}

const DEPTH: Record<LayerName, { depth: number; scale: number }> = {
  far: { depth: 1, scale: 1.06 },
  mid: { depth: 2.4, scale: 1.1 },
  near: { depth: 4.6, scale: 1.18 },
}

const imageModules = import.meta.glob('../assets/scenes/*.{png,jpg,jpeg,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const videoModules = import.meta.glob('../assets/scenes/*.{mp4,webm,mov}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function basename(filePath: string) {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
}

/** `lake-dusk-near` → scene `lake-dusk`, plane `near`. No suffix means `far`. */
function parse(base: string): { id: string; layer: LayerName } {
  const at = base.lastIndexOf('-')
  if (at > 0) {
    const suffix = base.slice(at + 1)
    if ((LAYER_ORDER as readonly string[]).includes(suffix)) {
      return { id: base.slice(0, at), layer: suffix as LayerName }
    }
  }
  return { id: base, layer: 'far' }
}

function prettify(id: string) {
  /* Numbered files are the fast way to add backdrops — `1.png`, `2.png`. */
  if (/^\d+$/.test(id)) return `Scene ${Number(id)}`

  const words = id.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const drafts = new Map<string, { layers: SceneLayer[]; video?: string }>()

for (const [filePath, url] of Object.entries(imageModules)) {
  const { id, layer } = parse(basename(filePath))
  const draft = drafts.get(id) ?? { layers: [] }
  draft.layers.push({ name: layer, url, ...DEPTH[layer] })
  drafts.set(id, draft)
}

for (const [filePath, url] of Object.entries(videoModules)) {
  const id = basename(filePath)
  const draft = drafts.get(id) ?? { layers: [] }
  draft.video = url
  drafts.set(id, draft)
}

/** Every scene found, alphabetical so the picker order is stable across builds. */
export const SCENES: Scene[] = [...drafts.entries()]
  .map(([id, draft]) => ({
    id,
    label: prettify(id),
    video: draft.video,
    layers: draft.layers.sort(
      (a, b) => LAYER_ORDER.indexOf(a.name) - LAYER_ORDER.indexOf(b.name),
    ),
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

export const hasScenes = SCENES.length > 0

/** The named scene, or the first one, or nothing at all if the folder is empty. */
export function findScene(id?: string | null): Scene | undefined {
  if (id) {
    const match = SCENES.find((entry) => entry.id === id)
    if (match) return match
  }
  return SCENES[0]
}
