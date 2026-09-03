import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Vector3, type Group } from 'three'

import {
  DESK,
  PEN_LENGTH,
  PEN_RADIUS,
  atRest,
  flick,
  makePen,
  step,
  type Pen,
} from '@/features/games/penfight/physics'
import type { WirePen } from '@/features/games/types'

/**
 * Lazily imported — this is the module that pulls three.js into the Play tab,
 * so nothing 3D is downloaded until somebody actually opens a game.
 */

/** How far the drag can be pulled, in metres on the desk, before it caps. */
const MAX_PULL = 0.26
/** Live pen positions go out at this rate while something is moving. */
const MOTION_HZ = 20

const PEN_COLOURS = ['#2f6fd0', '#d0452f'] as const

function toPen(wire: WirePen): Pen {
  return { ...wire, vx: 0, vz: 0, omega: 0 }
}

function toWire(pen: Pen): WirePen {
  return { x: pen.x, z: pen.z, angle: pen.angle, onDesk: pen.onDesk }
}

/**
 * One pen.
 *
 * A capsule laid on its side, with a cap at the clicky end so it reads as a
 * pen rather than a lozenge — and so you can tell which way yours is pointing,
 * which matters, because the direction the barrel already faces is what
 * decides how much spin a flick puts on it.
 */
function PenMesh({ pen, colour, mine }: { pen: Pen; colour: string; mine: boolean }) {
  const group = useRef<Group>(null)

  useFrame(() => {
    const node = group.current
    if (!node) return
    node.position.set(pen.x, PEN_RADIUS, pen.z)
    /* Three rotates +X toward −Z about Y, so the sign is flipped to match the
       solver's (cos a, sin a) → (x, z) convention. */
    node.rotation.y = -pen.angle
    node.visible = pen.onDesk
  })

  const barrel = PEN_LENGTH - PEN_RADIUS * 2

  return (
    <group ref={group}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[PEN_RADIUS, barrel, 4, 12]} />
        <meshStandardMaterial color={colour} roughness={0.42} metalness={0.05} />
      </mesh>
      {/* The cap, a little proud of the barrel at one end. */}
      <mesh position={[barrel / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[PEN_RADIUS * 1.18, PEN_RADIUS * 1.18, PEN_RADIUS * 2.4, 12]} />
        <meshStandardMaterial color={mine ? '#f4f1e8' : '#c9c4b8'} roughness={0.55} />
      </mesh>
    </group>
  )
}

/** The slingshot line, drawn back from your pen while you aim. */
function AimLine({ from, to }: { from: [number, number] | null; to: [number, number] | null }) {
  if (!from || !to) return null

  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const length = Math.hypot(dx, dz)
  if (length < 0.004) return null

  const angle = Math.atan2(dz, dx)
  const strength = Math.min(1, length / MAX_PULL)

  return (
    <group position={[from[0] + dx / 2, PEN_RADIUS * 0.6, from[1] + dz / 2]} rotation={[0, -angle, 0]}>
      <mesh>
        <boxGeometry args={[length, 0.0016, 0.0032]} />
        {/* Warms toward the danger end of the pull, so power is legible
            without a number on the screen. */}
        <meshBasicMaterial
          color={strength > 0.8 ? '#e0552f' : strength > 0.45 ? '#e0a02f' : '#7fb3e8'}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  )
}

function Table({
  pens,
  seat,
  myTurn,
  canPlay,
  onFlick,
}: {
  pens: Pen[]
  seat: 0 | 1
  myTurn: boolean
  canPlay: boolean
  onFlick: (dirX: number, dirZ: number, pull: number) => void
}) {
  const { camera } = useThree()
  const [aimFrom, setAimFrom] = useState<[number, number] | null>(null)
  const [aimTo, setAimTo] = useState<[number, number] | null>(null)
  const dragging = useRef(false)

  const deskPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), [])

  /* Pointer → a point on the desk, via the camera. Doing it this way rather
     than from screen deltas means the drag keeps meaning the same thing when
     the camera is flipped for the far seat. */
  const pointOnDesk = useCallback(
    (event: ThreeEvent<PointerEvent>): [number, number] | null => {
      const hit = new Vector3()
      const found = event.ray.intersectPlane(deskPlane, hit)
      if (!found) return null
      return [hit.x, hit.z]
    },
    [deskPlane],
  )

  const mine = pens[seat]
  const startAim = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!canPlay || !myTurn || !mine?.onDesk) return
      const point = pointOnDesk(event)
      if (!point) return
      dragging.current = true
      setAimFrom([mine.x, mine.z])
      setAimTo(point)
    },
    [canPlay, myTurn, mine, pointOnDesk],
  )

  const moveAim = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return
      const point = pointOnDesk(event)
      if (point) setAimTo(point)
    },
    [pointOnDesk],
  )

  const release = useCallback(() => {
    if (!dragging.current || !aimFrom || !aimTo) {
      dragging.current = false
      setAimFrom(null)
      setAimTo(null)
      return
    }

    const dx = aimFrom[0] - aimTo[0]
    const dz = aimFrom[1] - aimTo[1]
    const pull = Math.min(1, Math.hypot(dx, dz) / MAX_PULL)

    dragging.current = false
    setAimFrom(null)
    setAimTo(null)

    /* A twitch is not a shot. Below this the direction is mostly noise, and
       firing on it costs someone their turn for a misplaced finger. */
    if (pull > 0.06) onFlick(dx, dz, pull)
  }, [aimFrom, aimTo, onFlick])

  /* The far player sits opposite, so their camera is on the other side and
     their own pen is the near one — the same view of the same desk, turned
     around, rather than a second layout to reason about. */
  useEffect(() => {
    const side = seat === 0 ? 1 : -1
    camera.position.set(0, 0.46, 0.52 * side)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, seat])

  return (
    <>
      <hemisphereLight args={[0xfff3e4, 0x5c574e, 1.05]} />
      <directionalLight
        position={[0.35, 0.8, 0.3]}
        intensity={2.1}
        color="#ffe6c2"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-0.4, 0.5, -0.35]} intensity={0.6} color="#9db9e8" />

      {/* The desk. Its top sits at y = 0, which is the plane the solver and
          every pointer raycast both work on. */}
      <mesh position={[0, -DESK.width * 0.0215, 0]} receiveShadow>
        <boxGeometry args={[DESK.width, 0.03, DESK.depth]} />
        <meshStandardMaterial color="#9a6b3f" roughness={0.86} />
      </mesh>

      {/* Catches pointer moves anywhere over the desk, including past its
          edge — a pull-back often ends outside the wood. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={startAim}
        onPointerMove={moveAim}
        onPointerUp={release}
        onPointerLeave={release}
      >
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {pens.map((pen, index) => (
        <PenMesh
          key={index}
          pen={pen}
          colour={PEN_COLOURS[index] ?? '#888'}
          mine={index === seat}
        />
      ))}

      <AimLine from={aimFrom} to={aimTo} />
    </>
  )
}

/**
 * Runs the simulation, but only when it is this client's turn.
 *
 * Whoever is flicking is the one authority on where the pens go: they step the
 * solver locally, so their own shot has no network latency in it at all, and
 * publish the result. Everybody else runs no physics whatsoever and simply
 * moves the pens to the positions they are sent. That is the whole sync model,
 * and it works because a pen fight is strictly one-at-a-time.
 */
function Simulation({
  pens,
  live,
  simulating,
  onMotion,
  onSettled,
}: {
  pens: Pen[]
  live: React.RefObject<[WirePen, WirePen] | null>
  simulating: boolean
  onMotion: (pens: [WirePen, WirePen]) => void
  onSettled: (pens: [WirePen, WirePen]) => void
}) {
  const lastSent = useRef(0)
  const wasMoving = useRef(false)

  useFrame((_, delta) => {
    if (simulating) {
      step(pens, delta)

      const moving = !atRest(pens)
      const now = performance.now()

      if (moving) {
        wasMoving.current = true
        if (now - lastSent.current > 1000 / MOTION_HZ) {
          lastSent.current = now
          onMotion([toWire(pens[0]!), toWire(pens[1]!)])
        }
      } else if (wasMoving.current) {
        /* Came to rest this frame — report once, and only once. */
        wasMoving.current = false
        onSettled([toWire(pens[0]!), toWire(pens[1]!)])
      }
      return
    }

    /* Not simulating: follow what the other side is sending. Eased rather than
       snapped, because frames arrive 20 times a second and the screen is
       drawing 60 — without this the pens visibly step. */
    const target = live.current
    if (!target) return

    for (let i = 0; i < pens.length; i += 1) {
      const pen = pens[i]!
      const to = target[i]!
      const k = Math.min(1, delta * 18)
      pen.x += (to.x - pen.x) * k
      pen.z += (to.z - pen.z) * k

      /* Angles are eased the short way round, or a pen crossing π spins all
         the way back through a full turn. */
      let diff = to.angle - pen.angle
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      pen.angle += diff * k

      pen.onDesk = to.onDesk
    }
  })

  return null
}

export default function PenFightTable({
  pens: wirePens,
  seat,
  myTurn,
  canPlay,
  live,
  onFlick,
  onMotion,
  onSettled,
  paused = false,
}: {
  pens: [WirePen, WirePen]
  seat: 0 | 1
  myTurn: boolean
  canPlay: boolean
  live: React.RefObject<[WirePen, WirePen] | null>
  onFlick: () => void
  onMotion: (pens: [WirePen, WirePen]) => void
  onSettled: (pens: [WirePen, WirePen]) => void
  paused?: boolean
}) {
  /*
   * The solver's pens are mutable objects held across frames, not React state.
   * They are rewritten sixty times a second by the physics; putting them in
   * state would re-render the whole tree on every step for no benefit, since
   * the meshes read them directly in `useFrame`.
   */
  const pens = useRef<Pen[]>([makePen(-0.06, 0.14, 0.18), makePen(0.06, -0.14, Math.PI - 0.18)])
  const [simulating, setSimulating] = useState(false)

  /*
   * Adopt each new resting position wholesale — that is the version of the
   * world everyone agreed on, and it is what a round reset arrives as.
   *
   * Skipped while simulating: this client is mid-flick and is itself the
   * authority for those frames, so taking the server's older copy would drag
   * the pens backwards through the shot being played.
   *
   * The dependency is a flattened string rather than the array, because a
   * fresh `pens` array arrives on every snapshot and comparing by identity
   * would re-seed the solver constantly.
   */
  const resting = `${wirePens[0].x},${wirePens[0].z},${wirePens[0].angle},${wirePens[0].onDesk},${wirePens[1].x},${wirePens[1].z},${wirePens[1].angle},${wirePens[1].onDesk}`
  const latest = useRef(wirePens)
  latest.current = wirePens
  useEffect(() => {
    if (simulating) return
    pens.current = [toPen(latest.current[0]), toPen(latest.current[1])]
  }, [resting, simulating])

  const doFlick = useCallback(
    (dirX: number, dirZ: number, pull: number) => {
      const mine = pens.current[seat]
      if (!mine) return
      flick(mine, dirX, dirZ, pull)
      setSimulating(true)
      onFlick()
    },
    [seat, onFlick],
  )

  const finish = useCallback(
    (settled: [WirePen, WirePen]) => {
      setSimulating(false)
      onSettled(settled)
    },
    [onSettled],
  )

  return (
    <Canvas
      dpr={[1, 1.75]}
      shadows
      camera={{ position: [0, 0.46, 0.52], fov: 34 }}
      gl={{ alpha: true, antialias: true }}
      /* Held still while the tab is away or a dialog covers the table — the
         same rule the hub's party follows. */
      frameloop={paused ? 'demand' : 'always'}
      style={{ background: 'transparent' }}
    >
      <Table
        pens={pens.current}
        seat={seat}
        myTurn={myTurn}
        canPlay={canPlay}
        onFlick={doFlick}
      />
      <Simulation
        pens={pens.current}
        live={live}
        simulating={simulating}
        onMotion={onMotion}
        onSettled={finish}
      />
    </Canvas>
  )
}
