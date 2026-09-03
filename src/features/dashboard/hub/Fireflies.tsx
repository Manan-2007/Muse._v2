import { useEffect, useRef } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

type Mote = {
  x: number
  y: number
  /** Drift velocity, in px/second. */
  vx: number
  vy: number
  radius: number
  /** Phase offset so the whole field doesn't pulse in unison. */
  phase: number
  hz: number
}

const COUNT = 46
/** Cursor influence radius, in px. */
const REACH = 260

function seed(width: number, height: number): Mote[] {
  return Array.from({ length: COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 10,
    vy: -6 - Math.random() * 12,
    radius: 0.9 + Math.random() * 1.9,
    phase: Math.random() * Math.PI * 2,
    hz: 0.4 + Math.random() * 0.9,
  }))
}

/**
 * The scene's ambient life, and the cheapest interactivity on the hub.
 *
 * Motes drift upward on their own. Near the cursor they brighten and lean
 * toward it — so the *world* acknowledges you, which reads as presence without
 * touching the character rig at all.
 *
 * Canvas rather than DOM nodes: fifty independently-animated elements is fifty
 * composited layers, and this has to share the frame with a 3D canvas.
 */
export function Fireflies({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (reduced) return

    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let width = 0
    let height = 0
    let motes: Mote[] = []
    /* Off-screen until the pointer actually arrives, so nothing lights up
       under a cursor that isn't there. */
    const pointer = { x: -9999, y: -9999 }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      motes = seed(width, height)
    }

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
    }
    const onLeave = () => {
      pointer.x = -9999
      pointer.y = -9999
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)

    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      /* Clamped: a backgrounded tab resumes with a huge delta, which would
         teleport every mote across the screen on the first frame back. */
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now
      const seconds = now / 1000

      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'

      for (const mote of motes) {
        const dx = pointer.x - mote.x
        const dy = pointer.y - mote.y
        const distance = Math.hypot(dx, dy)
        const near = distance < REACH ? 1 - distance / REACH : 0

        /* Lean toward the cursor, easing in on the square so the pull is
           barely there at the edge of reach and clear up close. */
        if (near > 0) {
          const pull = near * near * 34
          mote.vx += (dx / (distance || 1)) * pull * delta
          mote.vy += (dy / (distance || 1)) * pull * delta
        }

        mote.x += mote.vx * delta
        mote.y += mote.vy * delta

        /* Drag, so the cursor's nudges bleed off instead of accumulating into
           a slingshot. */
        mote.vx *= 0.985
        mote.vy = mote.vy * 0.985 - 3 * delta

        // Wrap, so the field never empties out the top.
        if (mote.y < -20) {
          mote.y = height + 20
          mote.x = Math.random() * width
        }
        if (mote.x < -20) mote.x = width + 20
        if (mote.x > width + 20) mote.x = -20

        const flicker = 0.45 + 0.55 * Math.sin(seconds * mote.hz * Math.PI * 2 + mote.phase)
        const alpha = (0.1 + flicker * 0.3) * (1 + near * 2.4)
        const radius = mote.radius * (1 + near * 0.7)

        const glow = context.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, radius * 7)
        glow.addColorStop(0, `rgba(255, 236, 178, ${Math.min(alpha, 1)})`)
        glow.addColorStop(0.35, `rgba(255, 198, 112, ${Math.min(alpha * 0.4, 1)})`)
        glow.addColorStop(1, 'rgba(255, 176, 80, 0)')

        context.fillStyle = glow
        context.beginPath()
        context.arc(mote.x, mote.y, radius * 7, 0, Math.PI * 2)
        context.fill()
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [reduced])

  if (reduced) return null

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
