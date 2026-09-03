import { useEffect, useRef } from 'react'

/**
 * The corridor you fly through on the way into a room.
 *
 * Canvas 2D, not WebGL. three.js is a ~250 kB chunk, and this fires the instant
 * a login resolves — waiting on a download at exactly that moment would put a
 * stall where the payoff belongs. A few hundred projected points and rings cost
 * a fraction of a millisecond a frame and start on the very next paint.
 *
 * It also bridges two palettes on purpose: it opens in the near-black of the
 * auth screen, and blooms to white so it can hand off to the off-white canvas
 * the dashboard sits on. The white flash is the cut.
 */

const DURATION = 2500

/* Field of view. Bigger reads as a wider corridor. */
const FOCAL = 620
const RING_COUNT = 44
const PARTICLE_COUNT = 260
const FAR = 20

const INK = ['#ff1f3d', '#2b3bff', '#a01aff', '#00c2b8', '#ffffff']

type Ring = { z: number; radius: number; colour: string; gap: number; spin: number }
type Particle = { angle: number; radius: number; z: number; colour: string }

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

/** Slow, then a long flat sprint, then hard on the brakes. */
function speedAt(progress: number) {
  if (progress < 0.32) {
    // ease-in cubic off the line
    const t = progress / 0.32
    return 2 + t * t * t * 26
  }
  if (progress < 0.74) return 28
  // ease-out quart into the arrival
  const t = (progress - 0.74) / 0.26
  return 28 * (1 - t) ** 4 + 1.5
}

export function TunnelTransition({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const random = makeRandom(0x51e4)
    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const rings: Ring[] = Array.from({ length: RING_COUNT }, (_, index) => ({
      z: 0.4 + (index / RING_COUNT) * FAR,
      radius: 190 + random() * 120,
      colour: INK[Math.floor(random() * INK.length)]!,
      /* A gap turns a plain circle into a broken arc — reads as built rather
         than generated, and the varying rotation keeps them from lining up. */
      gap: random() < 0.55 ? 0.6 + random() * 1.5 : 0,
      spin: random() * Math.PI * 2,
    }))

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      angle: random() * Math.PI * 2,
      radius: 40 + random() * 340,
      z: 0.4 + random() * FAR,
      colour: INK[Math.floor(random() * INK.length)]!,
    }))

    /* Scripted colour bursts. They land during the sprint, never at the start
       or the stop, so they read as things rushing past rather than decoration. */
    const flashes = [
      { at: 0.36, colour: '#2b3bff' },
      { at: 0.48, colour: '#ff1f3d' },
      { at: 0.58, colour: '#a01aff' },
      { at: 0.67, colour: '#ff1f3d' },
    ]

    let start = 0
    let last = 0
    let frame = 0
    let finished = false

    const render = (now: number) => {
      if (!start) {
        start = now
        last = now
      }
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now

      const progress = Math.min((now - start) / DURATION, 1)
      const speed = speedAt(progress)
      const cx = width / 2
      const cy = height / 2
      /* The whole corridor rolls very slightly — the difference between
         "flying" and "being pulled on rails". */
      const roll = progress * 0.55

      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#04050a'
      context.fillRect(0, 0, width, height)

      // Everything inside the tunnel is light, so it adds rather than covers.
      context.globalCompositeOperation = 'lighter'

      // ── Streaks ────────────────────────────────────────────────
      context.lineCap = 'round'
      for (const particle of particles) {
        const previousZ = particle.z
        particle.z -= speed * dt
        if (particle.z < 0.35) {
          particle.z = FAR
          particle.angle = random() * Math.PI * 2
          particle.radius = 40 + random() * 340
        }

        const project = (z: number) => {
          const scale = FOCAL / z
          return {
            x: cx + Math.cos(particle.angle + roll) * particle.radius * (scale / FOCAL) * 1.6,
            y: cy + Math.sin(particle.angle + roll) * particle.radius * (scale / FOCAL) * 1.6,
            scale,
          }
        }

        const head = project(particle.z)
        const tail = project(Math.min(previousZ + speed * dt * 2.2, FAR))
        const depth = 1 - particle.z / FAR

        context.globalAlpha = Math.min(depth * 0.9, 0.85)
        context.strokeStyle = particle.colour
        context.lineWidth = Math.max(0.6, depth * 2.6)
        context.beginPath()
        context.moveTo(tail.x, tail.y)
        context.lineTo(head.x, head.y)
        context.stroke()
      }

      // ── Rings ──────────────────────────────────────────────────
      for (const ring of rings) {
        ring.z -= speed * dt
        if (ring.z < 0.35) {
          ring.z = FAR
          ring.colour = INK[Math.floor(random() * INK.length)]!
          ring.gap = random() < 0.55 ? 0.6 + random() * 1.5 : 0
        }

        const scale = FOCAL / ring.z
        const radius = (ring.radius * scale) / FOCAL
        if (radius > Math.max(width, height) * 1.6) continue

        const depth = 1 - ring.z / FAR
        // Fade in from the far end, and out again as it swallows the camera.
        const near = Math.min(1, ring.z / 1.6)
        context.globalAlpha = depth * near * 0.85
        context.strokeStyle = ring.colour
        context.lineWidth = Math.max(0.8, depth * 3.4)

        const from = ring.spin + roll * 1.4
        const to = from + Math.PI * 2 - ring.gap

        context.beginPath()
        context.arc(cx, cy, radius, from, to)
        context.stroke()
      }

      // ── Flashes ────────────────────────────────────────────────
      for (const flash of flashes) {
        const delta = progress - flash.at
        if (delta < 0 || delta > 0.06) continue
        context.globalAlpha = (1 - delta / 0.06) * 0.3
        context.fillStyle = flash.colour
        context.fillRect(0, 0, width, height)
      }

      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1

      // ── Vignette ───────────────────────────────────────────────
      const vignette = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.75)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.75)')
      context.fillStyle = vignette
      context.fillRect(0, 0, width, height)

      // ── Arrival bloom ──────────────────────────────────────────
      if (progress > 0.62) {
        const t = (progress - 0.62) / 0.38
        const eased = t * t
        const bloom = context.createRadialGradient(
          cx,
          cy,
          0,
          cx,
          cy,
          Math.max(width, height) * (0.1 + eased * 1.3),
        )
        bloom.addColorStop(0, `rgba(255,255,255,${Math.min(1, eased * 1.6)})`)
        bloom.addColorStop(0.55, `rgba(255,255,255,${Math.min(1, eased * 1.1)})`)
        bloom.addColorStop(1, 'rgba(255,255,255,0)')
        context.fillStyle = bloom
        context.fillRect(0, 0, width, height)
      }

      if (progress >= 1) {
        if (!finished) {
          finished = true
          doneRef.current()
        }
        return
      }

      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100]">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  )
}
