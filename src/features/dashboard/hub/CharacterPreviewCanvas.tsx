import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { Vector3, type Group, type PerspectiveCamera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { measure, standUp } from '@/features/dashboard/hub/measure'
import { usePageVisible } from '@/hooks/usePageVisible'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * Lazily imported alongside the hub's own canvas — both sit behind the same
 * `hasRiggedCharacters` gate, so neither pulls three.js in on its own.
 */

/**
 * Vertical extent the tile frames, in world units.
 *
 * Head-and-shoulders, not a full body: a picker tile is a couple of hundred
 * pixels tall, and a whole character shrunk into that is unreadable — you
 * cannot tell two roster entries apart from their shoes.
 */
const PORTRAIT_HEIGHT = 0.62

function Figure({ url, sway }: { url: string; sway: number }) {
  const { scene, animations } = useGLTF(url)
  const group = useRef<Group>(null)
  const clock = useRef(0)

  const object = useMemo(() => {
    const copy = cloneSkinned(scene)
    standUp(copy)

    const bounds = measure(copy)
    const size = bounds.getSize(new Vector3())
    if (size.y > 1e-6) copy.scale.multiplyScalar(1.58 / size.y)

    const placed = measure(copy)
    const centre = placed.getCenter(new Vector3())
    copy.position.x -= centre.x
    copy.position.z -= centre.z
    copy.position.y -= placed.min.y

    copy.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) node.frustumCulled = false
    })

    return copy
  }, [scene])

  /* The idle plays here too — a picker showing a frozen T-pose tells you
     nothing about whether the character is actually rigged. */
  const { actions, names } = useAnimations(animations, group)
  useEffect(() => {
    const first = names[0]
    if (first) actions[first]?.reset().fadeIn(0.3).play()
  }, [actions, names])

  /* A sway, not a turntable. A full rotation spends half its time showing the
     back of someone's head, which tells you nothing about who you're picking. */
  useFrame((_, delta) => {
    if (!group.current) return
    clock.current += delta
    group.current.rotation.y = Math.sin(clock.current * 0.55) * sway
  })

  return (
    <group ref={group}>
      <primitive object={object} />
    </group>
  )
}

/** Frames the head and shoulders regardless of tile size. */
function Rig() {
  const { camera, size } = useThree()

  useEffect(() => {
    const lens = camera as PerspectiveCamera
    const halfV = Math.tan(((lens.fov * Math.PI) / 180) / 2)
    /* Eye level, looking straight ahead — a portrait framed from the floor
       looks up someone's nose. */
    const eye = 1.46
    lens.position.set(0, eye, PORTRAIT_HEIGHT / 2 / halfV)
    lens.lookAt(0, eye - 0.08, 0)
    lens.updateProjectionMatrix()
  }, [camera, size.width, size.height])

  return null
}

export default function CharacterPreviewCanvas({
  url,
  /** Peak turn either side of facing you, in radians. */
  sway = 0.38,
}: {
  url: string
  sway?: number
}) {
  const reduced = usePrefersReducedMotion()
  const visible = usePageVisible()
  const still = reduced || !visible

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.42, 2.2], fov: 26 }}
      gl={{ alpha: true, antialias: true }}
      /* A settings panel left open in a backgrounded tab was still turning a
         character on the GPU. Held on its last frame instead. */
      frameloop={still ? 'demand' : 'always'}
      style={{ background: 'transparent' }}
    >
      <Rig />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.4, 3.2, 3]} intensity={2.4} color="#ffd7a3" />
      <directionalLight position={[-2.6, 1.4, -2]} intensity={1} color="#8fb0ff" />
      <Suspense fallback={null}>
        <Figure url={url} sway={sway} />
      </Suspense>
    </Canvas>
  )
}
