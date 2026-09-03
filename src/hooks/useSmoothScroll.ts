import { useEffect } from 'react'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { createLenis, destroyLenis } from '@/lib/smoothScroll'

/**
 * Mounts Lenis for the lifetime of the app. Skipped entirely when the user
 * prefers reduced motion — native scrolling is the accessible default, and
 * hijacking it is exactly what that preference asks us not to do.
 */
export function useSmoothScroll() {
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced) return

    const lenis = createLenis()
    let frame = 0

    const raf = (time: number) => {
      lenis.raf(time)
      frame = requestAnimationFrame(raf)
    }
    frame = requestAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(frame)
      destroyLenis()
    }
  }, [reduced])
}
