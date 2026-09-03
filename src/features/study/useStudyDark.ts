import { useEffect, useState } from 'react'

/**
 * Whether the Study tab is currently dark.
 *
 * Read off the DOM rather than passed down, because the one component that
 * needs it is the code editor — nine props deep, inside a lazy chunk, and the
 * only thing in the tab that cannot be themed with a CSS variable. Threading a
 * boolean through every pane to reach it would cost more than this does.
 */
export function useStudyDark() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    const scope = document.querySelector('.study-scope')
    if (!scope) return

    const read = () => setDark(scope.getAttribute('data-study-theme') !== 'light')
    read()

    const watcher = new MutationObserver(read)
    watcher.observe(scope, { attributes: true, attributeFilter: ['data-study-theme'] })
    return () => watcher.disconnect()
  }, [])

  return dark
}
