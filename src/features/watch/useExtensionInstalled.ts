import { useEffect, useState } from 'react'

/**
 * Whether the Huddle browser extension is installed in *this* browser.
 *
 * Answered by the extension itself, through the DOM. An extension's content
 * script runs in an isolated world — it can read this page's elements but not
 * one of its JavaScript objects, and the page cannot see its either — so the
 * only thing the two genuinely share is the document. `ExtensionBridge`
 * renders an element carrying what the extension needs; the extension writes
 * its version back onto the same element, and that attribute is this answer.
 *
 * Observed rather than read once, because all three orderings really happen:
 * the element can render before the extension runs, the extension can run
 * before the element renders, and somebody can install it with the tab
 * already open. Watching covers all of them without any being a special case.
 */

/** The element both sides agree to meet at. */
export const BRIDGE_ID = 'huddle-extension-bridge'

/** What the extension writes onto it, once it has read the element. */
export const INSTALLED_ATTR = 'data-extension'

export function useExtensionInstalled(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    const read = () =>
      setVersion(document.getElementById(BRIDGE_ID)?.getAttribute(INSTALLED_ATTR) ?? null)

    read()

    /* The whole subtree, because the element may not exist yet when this
       runs — a narrower target would have nothing to attach to. */
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [INSTALLED_ATTR],
    })
    return () => observer.disconnect()
  }, [])

  return version
}
