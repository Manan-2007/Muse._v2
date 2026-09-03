import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Tracks the user's reduced-motion preference.
 *
 * CSS-driven idle animation (poster marquee, glow drift, orbits) is switched
 * off in `index.css`; this hook covers the Framer Motion loops, which CSS
 * media queries can't reach.
 */
export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(QUERY)
    const onChange = () => setPrefersReducedMotion(mediaQuery.matches)

    onChange()
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  return prefersReducedMotion
}
