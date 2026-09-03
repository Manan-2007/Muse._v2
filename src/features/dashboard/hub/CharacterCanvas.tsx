import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, useAnimations, useGLTF } from '@react-three/drei'
import { MathUtils, Vector3, type Group, type PerspectiveCamera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { measure, standUp } from '@/features/dashboard/hub/measure'
import type { PointerTilt } from '@/hooks/usePointerTilt'

/**
 * Lazily imported — this module is what pulls in three.js, so it must only be
 * reached once `hasRiggedCharacters` is true.
 */

export type PartyMember = {
  id: string
  name: string
  /** A rigged `.glb`. Members without one are drawn flat, not here. */
  url: string
}

/**
 * Bones stop at the head *joint*, not the crown, so a skeleton measures a little
 * shorter than the body it drives. Normalising the skeleton to this lands the
 * rendered character at roughly 1.75 units.
 */
const TARGET_SKELETON_HEIGHT = 1.58
const SPACING = 1.08

/*
 * Mixamo names every downloaded clip "mixamo.com", so by the time three actions
 * reach a single GLB they're whatever Blender called the actions. Matching on
 * keywords rather than exact names means the rig works whether you named them
 * `idle`, `Breathing Idle`, or `Armature|idle`.
 */
const IDLE_WORDS = ['idle', 'breath', 'stand']
const GREET_WORDS = ['wave', 'greet', 'hello', 'look', 'glance']

function pick(names: string[], words: string[]) {
  return names.find((name) => {
    const lower = name.toLowerCase()
    return words.some((word) => lower.includes(word))
  })
}

function Character({
  member,
  index,
  count,
  tilt,
  still,
}: {
  member: PartyMember
  index: number
  count: number
  tilt: PointerTilt
  still: boolean
}) {
  const { scene, animations } = useGLTF(member.url)
  const group = useRef<Group>(null)
  const [greeting, setGreeting] = useState(false)

  /*
   * `SkeletonUtils.clone`, not `scene.clone()` — a plain clone copies the mesh
   * but keeps pointing at the original skeleton, so two instances of the same
   * character would drive each other's bones and both would collapse.
   */
  const object = useMemo(() => {
    const copy = cloneSkinned(scene)

    standUp(copy)

    const size = measure(copy).getSize(new Vector3())
    if (size.y > 1e-6) {
      copy.scale.multiplyScalar(TARGET_SKELETON_HEIGHT / size.y)
    } else {
      console.warn(
        `[Huddle] ${member.url.split('/').pop()} has no measurable height — left at its export scale.`,
      )
    }

    // Feet on the floor, centred on its own X/Z.
    const placed = measure(copy)
    const centre = placed.getCenter(new Vector3())
    copy.position.x -= centre.x
    copy.position.z -= centre.z
    copy.position.y -= placed.min.y

    /* A skinned mesh animating away from its bind pose gets culled against a
       bounding sphere that no longer matches it — cheaper to just never cull a
       character we know is on screen. */
    copy.traverse((node) => {
      if ((node as { isMesh?: boolean }).isMesh) node.frustumCulled = false
    })

    return copy
  }, [scene, member.url])

  const { actions, names } = useAnimations(animations, group)

  const idleName = useMemo(() => pick(names, IDLE_WORDS) ?? names[0], [names])
  const greetName = useMemo(() => pick(names, GREET_WORDS), [names])

  /* Crossfade rather than cut. A hard swap between two idles is the single
     most puppet-like thing a rig can do. */
  useEffect(() => {
    if (names.length === 0) return
    const target = (greeting && greetName) || idleName
    if (!target) return

    for (const name of names) {
      const action = actions[name]
      if (!action) continue
      if (name === target) action.reset().fadeIn(0.4).play()
      else action.fadeOut(0.4)
    }
  }, [actions, names, greeting, greetName, idleName])

  /* Drop back to idle once the greeting has played through once. */
  useEffect(() => {
    if (!greeting || !greetName) return
    const clip = actions[greetName]?.getClip()
    const ms = Math.max(600, (clip?.duration ?? 1.2) * 1000)
    const timer = setTimeout(() => setGreeting(false), ms)
    return () => clearTimeout(timer)
  }, [greeting, greetName, actions])

  const restX = (index - (count - 1) / 2) * SPACING
  const hasClips = names.length > 0
  const breathe = useRef(Math.random() * Math.PI * 2)

  useFrame((state, delta) => {
    const node = group.current
    if (!node || still) return

    /*
     * The turn is applied to the outer group, never to a bone. The animation
     * mixer rewrites every bone it owns each frame, so a head rotation set here
     * would be silently overwritten; rotating the parent composes with the clip
     * instead of fighting it.
     */
    const towardCursor = tilt.x.get() * 0.3
    node.rotation.y = MathUtils.damp(node.rotation.y, towardCursor, 3.2, delta)
    node.rotation.x = MathUtils.damp(node.rotation.x, tilt.y.get() * 0.035, 3.2, delta)

    /* Only fake a breath when the model brought no clips of its own —
       doubling up on a real breathing idle looks seasick. */
    if (!hasClips) {
      breathe.current += delta
      const wave = Math.sin(breathe.current * 1.15)
      node.position.y = wave * 0.012
      node.scale.setScalar(1 + wave * 0.006)
    }

    void state
  })

  return (
    <group
      ref={group}
      position={[restX, 0, 0]}
      onPointerOver={() => setGreeting(true)}
    >
      <primitive object={object} />
    </group>
  )
}

/** Rendered height of a character, plus a little headroom above the crown. */
const FRAME_HEIGHT = 1.95
/**
 * Silhouette width to keep clear around the outermost character.
 *
 * Generous on purpose. A standing idle swings the arms out well past the
 * shoulders, and the cost of guessing low is an arm sliced off at the canvas
 * edge — which is exactly what a tight value produced once the side panel
 * narrowed the stage.
 */
const BODY_WIDTH = 1.2
/** Breathing room on top of the computed fit, so nothing grazes the edge. */
const FIT_MARGIN = 1.07

/**
 * Frames the party as large as the canvas allows.
 *
 * A fixed camera distance can only be right at one party size and one aspect
 * ratio — everywhere else it either crops people or leaves them small and
 * distant. This solves for the distance that just fits the group, vertically
 * and horizontally, and takes whichever is further back.
 */
function Rig({ count }: { count: number }) {
  const { camera, size } = useThree()

  useEffect(() => {
    const lens = camera as PerspectiveCamera
    const vFov = (lens.fov * Math.PI) / 180
    const halfV = Math.tan(vFov / 2)

    const width = (count - 1) * SPACING + BODY_WIDTH
    const forHeight = FRAME_HEIGHT / 2 / halfV
    const forWidth = width / 2 / (halfV * (size.width / size.height))

    lens.position.set(0, 0.95, Math.max(forHeight, forWidth) * FIT_MARGIN)
    lens.lookAt(0, 0.9, 0)
    lens.updateProjectionMatrix()
  }, [camera, count, size.width, size.height])

  return null
}

export default function CharacterCanvas({
  members,
  tilt,
  still = false,
}: {
  members: PartyMember[]
  tilt: PointerTilt
  still?: boolean
}) {
  /*
   * Let go of models nobody in the room is wearing any more.
   *
   * `useGLTF` caches by URL for the life of the page, which is right while a
   * character is on screen and wrong once its owner has left: a long evening
   * of people coming and going would otherwise accumulate every character the
   * room had ever seen, textures and all, with no way back.
   *
   * Compared against the *previous* party rather than the current one, because
   * the question being asked is which models just stopped being needed. Only
   * URLs gone from the party are dropped, so this can never pull a model out
   * from under someone still standing there — including the common case of two
   * people wearing the same character, where the URL stays live until the last
   * of them leaves.
   */
  const urls = members.map((member) => member.url).join('\n')
  const previous = useRef<string[]>([])
  useEffect(() => {
    const current = urls.length > 0 ? urls.split('\n') : []
    /* A party that is briefly empty mid-refetch is not a party nobody is in;
       evicting on that would drop every model and reload it a frame later. */
    if (current.length === 0) return

    for (const url of previous.current) {
      if (!current.includes(url)) useGLTF.clear(url)
    }
    previous.current = current
  }, [urls])

  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.95, 3.6], fov: 30 }}
      gl={{ alpha: true, antialias: true }}
      frameloop={still ? 'demand' : 'always'}
      style={{ background: 'transparent' }}
    >
      <Rig count={members.length} />
      {/* Golden-hour key with a cool rim, to sit in the same light as the
          nature backdrops rather than looking pasted on top of them. */}
      <ambientLight intensity={0.62} />
      <directionalLight position={[3.2, 4.4, 3.6]} intensity={2.5} color="#ffd7a3" />
      <directionalLight position={[-3.6, 1.8, -2.8]} intensity={1.05} color="#8fb0ff" />

      <ContactShadows
        position={[0, 0.001, 0]}
        scale={12}
        opacity={0.55}
        blur={2.8}
        far={2.2}
        resolution={512}
        color="#000000"
      />

      <Suspense fallback={null}>
        {members.map((member, index) => (
          <Character
            /*
             * Keyed by the model too, not just the person.
             *
             * The animation mixer resolves its bone bindings once, against the
             * scene under this group. Swapping the model without remounting
             * leaves those bindings pointing at nodes that are no longer there,
             * so the new character renders in its bind pose — a T-pose that
             * only fixed itself on reload. Changing the key rebuilds the mixer
             * with the model it belongs to.
             */
            key={`${member.id}:${member.url}`}
            member={member}
            index={index}
            count={members.length}
            tilt={tilt}
            still={still}
          />
        ))}
      </Suspense>
    </Canvas>
  )
}
