import { useEffect, useState } from 'react'

/**
 * Whether this tab is actually on screen.
 *
 * A backgrounded tab keeps running its animation loops — the browser throttles
 * `requestAnimationFrame`, but it does not stop the work, and a 3D scene left
 * turning behind a switched-away tab is pure heat on a laptop and pure battery
 * on a phone. Anything expensive enough to be worth pausing asks this first.
 *
 * Deliberately not `blur`/`focus`: those fire when the window merely loses
 * keyboard focus, which happens constantly while the tab is still perfectly
 * visible beside another window.
 */
export function usePageVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')

    onChange()
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return visible
}
