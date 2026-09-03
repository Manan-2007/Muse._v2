import Lenis from 'lenis'

let instance: Lenis | null = null

/**
 * The page's smooth-scroll engine.
 *
 * Lenis drives the real window scroll position each frame, so Framer Motion's
 * `useScroll` and every parallax transform stay in sync with it for free.
 */
export function getLenis() {
  return instance
}

export function createLenis() {
  if (instance) return instance

  instance = new Lenis({
    duration: 1.15,
    // Long, flat tail — the glide that makes it feel weighty rather than slippery.
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 0.9,
    touchMultiplier: 1.6,
    // Header and footer links glide instead of jumping.
    anchors: { offset: 0, duration: 1.5 },
  })

  return instance
}

export function destroyLenis() {
  instance?.destroy()
  instance = null
}

/** Smoothly scroll to an absolute Y offset, with or without Lenis running. */
export function scrollToY(y: number, duration = 1.4) {
  if (instance) {
    instance.scrollTo(y, { duration })
  } else {
    window.scrollTo({ top: y, behavior: 'smooth' })
  }
}
