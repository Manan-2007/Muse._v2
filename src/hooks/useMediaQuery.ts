import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches.
 *
 * For the handful of decisions that cannot be expressed in CSS because a
 * number has to travel through JavaScript — a layout inset passed to several
 * components, say. Anything that *can* be a Tailwind breakpoint should be one;
 * this is the escape hatch, not the habit.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}
