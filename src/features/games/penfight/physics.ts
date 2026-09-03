/**
 * Two pens sliding on a desk.
 *
 * A pen fight is a flat problem — everything happens on the surface of the
 * desk until something goes over the edge — so this is a 2D rigid-body solver
 * on the XZ plane rather than a general 3D engine. That is not a shortcut for
 * its own sake: it means the whole simulation is a few hundred lines of plain
 * arithmetic with no WebAssembly to download, no engine to initialise, and no
 * floating-point behaviour that varies with how a third-party build was
 * compiled. The last point is what makes it safe to hand a flick to another
 * browser and trust it to land in the same place.
 *
 * Units are metres, kilograms and seconds throughout, at the size of a real
 * pen on a real desk. Keeping real units means the constants below can be
 * reasoned about rather than tuned blindly: a pen really is about 14 cm long
 * and about 14 g, and it behaves like it.
 */

/** A pen, as the solver sees it: a capsule lying flat, free to slide and spin. */
export type Pen = {
  /** Centre of mass, on the desk plane. */
  x: number
  z: number
  /** Linear velocity, m/s. */
  vx: number
  vz: number
  /** Heading in radians — which way the barrel points. */
  angle: number
  /** Spin about the vertical axis, rad/s. */
  omega: number
  /** False once it has gone over an edge; it stops taking part. */
  onDesk: boolean
}

export type Desk = {
  /** Full width across the near edge (X). */
  width: number
  /** Full depth from near to far edge (Z). */
  depth: number
}

export const PEN_LENGTH = 0.145
export const PEN_RADIUS = 0.0052
/** Roughly a real ballpoint: ~14 g for a 14.5 cm barrel. */
export const PEN_MASS = 0.0137

export const DESK: Desk = { width: 0.7, depth: 0.45 }

/**
 * A thin rod about its own centre: I = mL²/12.
 *
 * This is what makes a hit off the tip spin a pen instead of shoving it, and
 * it is the single value most responsible for the game feeling like pens
 * rather than pucks.
 */
const INERTIA = (PEN_MASS * PEN_LENGTH * PEN_LENGTH) / 12

/** Sliding friction against the desk, as a deceleration. */
const FRICTION_A = 2.35
/** Spin dies faster than travel — a spinning pen scrubs along its whole side. */
const ANGULAR_DAMPING = 3.1
/** How bouncy a pen-on-pen hit is. Plastic on plastic is lively but not springy. */
const RESTITUTION = 0.34

const FIXED_DT = 1 / 120
/** Below this, a pen is treated as stopped rather than crawling forever. */
const REST_SPEED = 0.012
const REST_SPIN = 0.12

export function makePen(x: number, z: number, angle: number): Pen {
  return { x, z, vx: 0, vz: 0, angle, omega: 0, onDesk: true }
}

/** The two ends of a pen's barrel, as points on the desk. */
function endpoints(pen: Pen) {
  const half = (PEN_LENGTH - PEN_RADIUS * 2) / 2
  const dx = Math.cos(pen.angle) * half
  const dz = Math.sin(pen.angle) * half
  return {
    ax: pen.x - dx,
    az: pen.z - dz,
    bx: pen.x + dx,
    bz: pen.z + dz,
  }
}

/**
 * Closest points between two segments.
 *
 * Capsules are segments with a radius, so the entire collision question is
 * "how close do the two centre-lines get, and where" — which is this, and then
 * a comparison against the summed radii.
 */
function closestPoints(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx2: number, dz2: number,
) {
  const ux = bx - ax
  const uz = bz - az
  const vx = dx2 - cx
  const vz = dz2 - cz
  const wx = ax - cx
  const wz = az - cz

  const a = ux * ux + uz * uz
  const b = ux * vx + uz * vz
  const c = vx * vx + vz * vz
  const d = ux * wx + uz * wz
  const e = vx * wx + vz * wz

  const denom = a * c - b * b
  let s = 0
  let t = 0

  /* Parallel barrels give a zero determinant — common when two pens line up
     side by side, so it has to be handled rather than divided by. */
  if (Math.abs(denom) > 1e-12) {
    s = (b * e - c * d) / denom
    t = (a * e - b * d) / denom
  } else {
    s = 0
    t = c > 1e-12 ? e / c : 0
  }

  s = Math.max(0, Math.min(1, s))
  t = Math.max(0, Math.min(1, t))

  /* Clamping one parameter can move the true closest point on the other, so
     each is re-solved against the clamped partner. */
  t = c > 1e-12 ? Math.max(0, Math.min(1, (b * s + e) / c)) : 0
  s = a > 1e-12 ? Math.max(0, Math.min(1, (b * t - d) / a)) : 0

  return {
    p1x: ax + ux * s,
    p1z: az + uz * s,
    p2x: cx + vx * t,
    p2z: cz + vz * t,
  }
}

/** 2D cross product of two vectors — a scalar, standing in for the Y torque. */
const cross = (x1: number, z1: number, x2: number, z2: number) => x1 * z2 - z1 * x2

function collide(a: Pen, b: Pen) {
  if (!a.onDesk || !b.onDesk) return

  const ea = endpoints(a)
  const eb = endpoints(b)
  const { p1x, p1z, p2x, p2z } = closestPoints(
    ea.ax, ea.az, ea.bx, ea.bz,
    eb.ax, eb.az, eb.bx, eb.bz,
  )

  let nx = p2x - p1x
  let nz = p2z - p1z
  let dist = Math.hypot(nx, nz)
  const minDist = PEN_RADIUS * 2

  if (dist >= minDist) return

  /* Exactly concentric — pick any axis rather than divide by zero. */
  if (dist < 1e-9) {
    nx = 1
    nz = 0
    dist = 1e-9
  } else {
    nx /= dist
    nz /= dist
  }

  /* Contact sits between the two surfaces, and the lever arms are measured
     from each centre of mass to it — that is where the spin comes from. */
  const contactX = (p1x + p2x) / 2
  const contactZ = (p1z + p2z) / 2
  const r1x = contactX - a.x
  const r1z = contactZ - a.z
  const r2x = contactX - b.x
  const r2z = contactZ - b.z

  /* Velocity *at the contact point*, which includes what the spin is doing
     there: ω × r, which in 2D is ω(-r.z, r.x). */
  const v1x = a.vx - a.omega * r1z
  const v1z = a.vz + a.omega * r1x
  const v2x = b.vx - b.omega * r2z
  const v2z = b.vz + b.omega * r2x

  const relN = (v2x - v1x) * nx + (v2z - v1z) * nz
  /* Already separating: let it go rather than yanking it back together. */
  if (relN > 0) return

  const rn1 = cross(r1x, r1z, nx, nz)
  const rn2 = cross(r2x, r2z, nx, nz)
  const invMass = 1 / PEN_MASS

  const denom =
    invMass * 2 + (rn1 * rn1) / INERTIA + (rn2 * rn2) / INERTIA
  const j = (-(1 + RESTITUTION) * relN) / denom

  a.vx -= (j * nx) * invMass
  a.vz -= (j * nz) * invMass
  a.omega -= (rn1 * j) / INERTIA

  b.vx += (j * nx) * invMass
  b.vz += (j * nz) * invMass
  b.omega += (rn2 * j) / INERTIA

  /* Push the overlap out directly. Without this the pair can settle inside
     each other, where every later step reads as a fresh collision. */
  const overlap = minDist - dist
  const correct = overlap / 2 + 1e-5
  a.x -= nx * correct
  a.z -= nz * correct
  b.x += nx * correct
  b.z += nz * correct
}

/** True once a pen's whole body has cleared an edge of the desk. */
function fallenOff(pen: Pen, desk: Desk) {
  const halfW = desk.width / 2
  const halfD = desk.depth / 2
  const { ax, az, bx, bz } = endpoints(pen)

  /* Both ends have to be past the edge. A pen teetering with one end over
     the side is still on the desk, which is exactly the moment worth
     watching and would be spoiled by calling it early. */
  const outX = (x: number) => x < -halfW || x > halfW
  const outZ = (z: number) => z < -halfD || z > halfD

  return (outX(ax) && outX(bx)) || (outZ(az) && outZ(bz))
}

function integrate(pen: Pen, dt: number, desk: Desk) {
  if (!pen.onDesk) return

  pen.x += pen.vx * dt
  pen.z += pen.vz * dt
  pen.angle += pen.omega * dt

  /* Coulomb friction: a constant deceleration opposing travel, not a
     proportional decay. A pen shoved hard and a pen nudged gently lose speed
     at the same rate, which is why a hard flick carries so much further. */
  const speed = Math.hypot(pen.vx, pen.vz)
  if (speed > 0) {
    const drop = FRICTION_A * dt
    const next = Math.max(0, speed - drop)
    const scale = next / speed
    pen.vx *= scale
    pen.vz *= scale
  }

  pen.omega -= pen.omega * Math.min(1, ANGULAR_DAMPING * dt)

  if (fallenOff(pen, desk)) {
    pen.onDesk = false
    pen.vx = 0
    pen.vz = 0
    pen.omega = 0
  }
}

/** Whether everything has come to rest, so the turn can be handed over. */
export function atRest(pens: Pen[]) {
  return pens.every(
    (pen) =>
      !pen.onDesk ||
      (Math.hypot(pen.vx, pen.vz) < REST_SPEED && Math.abs(pen.omega) < REST_SPIN),
  )
}

/**
 * Advance the world by `elapsed` seconds.
 *
 * Stepped at a fixed rate regardless of the frame it was called from: a solver
 * fed variable timesteps gives different answers on a 60 Hz screen and a 120 Hz
 * one, and two players watching the same flick would see it end differently.
 * The accumulator is capped so a backgrounded tab returning after a stall
 * catches up in a few steps instead of freezing while it replays a minute.
 */
export function step(pens: Pen[], elapsed: number, desk: Desk = DESK) {
  let remaining = Math.min(elapsed, 0.25)

  while (remaining > 0) {
    const dt = Math.min(FIXED_DT, remaining)
    remaining -= dt

    for (const pen of pens) integrate(pen, dt, desk)

    for (let i = 0; i < pens.length; i += 1) {
      for (let k = i + 1; k < pens.length; k += 1) {
        collide(pens[i]!, pens[k]!)
      }
    }
  }
}

/**
 * Turn a drag into a shove.
 *
 * The pull is expressed as a fraction of the way to the maximum, so the caller
 * can measure it in whatever units its pointer works in. The curve is the
 * important part: squaring-ish the input means a short tug is gentle and the
 * last quarter of the pull is where the dangerous power lives, which is what
 * makes aiming feel like a decision instead of a slider.
 */
export function flick(pen: Pen, dirX: number, dirZ: number, pull: number) {
  if (!pen.onDesk) return

  const clamped = Math.max(0, Math.min(1, pull))
  const power = Math.pow(clamped, 1.45)
  /* Tops out around a metre and a half a second — enough to cross the desk
     and knock something off, not enough to fire a pen across the room. */
  const speed = power * 1.55

  const len = Math.hypot(dirX, dirZ) || 1
  pen.vx = (dirX / len) * speed
  pen.vz = (dirZ / len) * speed

  /* A flick that is not through the centre sets the pen spinning. Kept small
     and deterministic — derived from how far the aim is off the barrel's own
     heading, so the same drag always produces the same spin. */
  const heading = Math.atan2(dirZ, dirX)
  let offset = heading - pen.angle
  while (offset > Math.PI) offset -= Math.PI * 2
  while (offset < -Math.PI) offset += Math.PI * 2
  pen.omega = Math.sin(offset * 2) * power * 5.5
}
