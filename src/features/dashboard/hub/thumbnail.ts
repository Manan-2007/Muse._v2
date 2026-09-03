import {
  AmbientLight,
  AnimationMixer,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { measure, standUp } from '@/features/dashboard/hub/measure'

/**
 * Portrait thumbnails, rendered from the models themselves.
 *
 * The picker needs a picture per character, but a character is a `.glb` — there
 * is no image to point at. Requiring a matching PNG per model would mean the
 * roster silently half-works whenever someone drops in a model and forgets the
 * artwork. So the thumbnail is generated: load the model, frame it, render one
 * frame offscreen, keep the pixels.
 *
 * Lazily imported. It pulls in a second renderer and the loader, and nothing
 * needs either until somebody actually opens the picker.
 */

const SIZE = 512

const cache = new Map<string, string>()
let renderer: WebGLRenderer | null = null

function getRenderer() {
  if (!renderer) {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      /* Required: without it the drawing buffer may be cleared before
         `toDataURL` runs, and the thumbnail comes back blank. */
      preserveDrawingBuffer: true,
    })
    renderer.setSize(SIZE, SIZE, false)
    renderer.setClearColor(0x000000, 0)
  }
  return renderer
}

/** Composite onto a warm backdrop so a disc reads as a tile, not a floating head. */
function onBackdrop(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE

  const ctx = canvas.getContext('2d')
  if (!ctx) return source.toDataURL('image/png')

  const wash = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.32, 0, SIZE * 0.5, SIZE * 0.5, SIZE * 0.75)
  wash.addColorStop(0, '#3a3340')
  wash.addColorStop(0.6, '#20202a')
  wash.addColorStop(1, '#101015')
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.drawImage(source, 0, 0, SIZE, SIZE)

  return canvas.toDataURL('image/png')
}

/**
 * Every texture hanging off a material, whatever slot it sits in.
 *
 * `material.dispose()` does *not* cascade to its maps — that is the one thing
 * about three's disposal that consistently surprises, and it matters here more
 * than anywhere else in the app: a character's textures are the largest single
 * thing this codebase puts on the GPU, and baking the picker's thumbnails
 * touches every model in the roster at once. Missing them meant opening the
 * picker pinned the whole roster's texture memory for the life of the tab.
 */
function disposeTextures(material: unknown) {
  if (!material || typeof material !== 'object') return

  for (const value of Object.values(material as Record<string, unknown>)) {
    const texture = value as { isTexture?: boolean; dispose?: () => void } | null
    if (texture?.isTexture) texture.dispose?.()
  }
  ;(material as { dispose?: () => void }).dispose?.()
}

function dispose(root: Object3D) {
  root.traverse((node) => {
    const mesh = node as { geometry?: { dispose: () => void }; material?: unknown }
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const entry of material) disposeTextures(entry)
    } else {
      disposeTextures(material)
    }
  })
}

/**
 * A head-and-shoulders still of one character.
 *
 * Returns null rather than throwing when a model can't be read — a compressed
 * or corrupt file should cost that one tile its picture, not take the picker
 * down with it.
 */
export async function characterThumbnail(url: string): Promise<string | null> {
  const hit = cache.get(url)
  if (hit) return hit

  let model: Object3D | null = null
  try {
    const gltf = await new GLTFLoader().loadAsync(url)
    model = gltf.scene

    /*
     * Pose it before measuring.
     *
     * A rigged model at rest is in its bind pose — arms straight out in a T.
     * That is not what the character looks like in the app, and it is a poor
     * thing to pick from, so the first clip is advanced a little to settle the
     * skeleton into a natural stance.
     */
    if (gltf.animations?.length) {
      const mixer = new AnimationMixer(model)
      mixer.clipAction(gltf.animations[0]!).play()
      mixer.update(0.7)
    }

    standUp(model)
    const size = measure(model).getSize(new Vector3())
    if (size.y > 1e-6) model.scale.multiplyScalar(1.58 / size.y)

    const placed = measure(model)
    const centre = placed.getCenter(new Vector3())
    model.position.x -= centre.x
    model.position.z -= centre.z
    model.position.y -= placed.min.y

    model.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) node.frustumCulled = false
    })

    const scene = new Scene()
    scene.add(model)
    scene.add(new AmbientLight(0xffffff, 0.85))

    /* Same key/rim pairing as the hub, so a face in the picker looks like the
       face that ends up standing in the scene. */
    const key = new DirectionalLight(0xffd7a3, 2.6)
    key.position.set(2.4, 3.2, 3)
    scene.add(key)
    const rim = new DirectionalLight(0x8fb0ff, 1.1)
    rim.position.set(-2.6, 1.4, -2)
    scene.add(rim)

    /* Head and shoulders. A whole body shrunk into a disc this size is a
       smudge — you cannot tell two roster entries apart by their shoes. */
    const camera = new PerspectiveCamera(30, 1, 0.1, 100)
    const eye = 1.42
    camera.position.set(0, eye, 0.98)
    camera.lookAt(0, eye - 0.07, 0)

    const gl = getRenderer()
    gl.render(scene, camera)

    const dataUrl = onBackdrop(gl.domElement)
    cache.set(url, dataUrl)
    return dataUrl
  } catch {
    return null
  } finally {
    if (model) dispose(model)
  }
}
