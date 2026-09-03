import { useEffect } from 'react'
import { useMotionValue, useSpring, type MotionValue } from 'framer-motion'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

export type PointerTilt = {
  /** −1 (left edge) → 1 (right edge), spring-damped. */
  x: MotionValue<number>
  /** −1 (top) → 1 (bottom), spring-damped. */
  y: MotionValue<number>
}

/* Loose and heavy: the scene should trail the cursor like something with mass,
   not track it exactly. Tight springs here read as jitter. */
const SPRING = { stiffness: 55, damping: 22, mass: 0.9 } as const

/**
 * The viewport-normalised pointer, for parallax.
 *
 * Returns motion values rather than state on purpose — a `setState` per
 * mousemove would re-render the whole hub (a 3D canvas included) at pointer
 * rate. These drive transforms outside React instead.
 *
 * Under reduced motion both values stay pinned at 0, so every consumer
 * flattens automatically without needing its own check.
 */
export function usePointerTilt(): PointerTilt {
  const reduced = usePrefersReducedMotion()
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const x = useSpring(rawX, SPRING)
  const y = useSpring(rawY, SPRING)

  useEffect(() => {
    if (reduced) {
      rawX.set(0)
      rawY.set(0)
      return
    }

    const onMove = (event: PointerEvent) => {
      rawX.set((event.clientX / window.innerWidth) * 2 - 1)
      rawY.set((event.clientY / window.innerHeight) * 2 - 1)
    }

    /* Recentre when the pointer leaves rather than freezing mid-tilt — a scene
       held off-axis with no cursor on screen looks broken. */
    const onLeave = () => {
      rawX.set(0)
      rawY.set(0)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [reduced, rawX, rawY])

  return { x, y }
}
