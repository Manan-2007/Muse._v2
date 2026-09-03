/**
 * Configuring the extension from the page that already knows everything.
 *
 * The popup can still be filled in by hand, and for a while that was the only
 * way: paste an API URL, a room code and a session token into three boxes.
 * Every one of those is something the Huddle tab is already holding — it is
 * signed in, it is standing in a room, and it knows its own API — so asking a
 * person to copy them across was a setup step that existed only because
 * nothing had been written to carry them.
 *
 * This carries them. The app renders an element with the API and the room on
 * it (see `ExtensionBridge.tsx` for why the DOM is the only surface the two
 * sides share), this reads it, asks the server for a token of its own, and
 * hands the lot to the worker. Opening the app is the entire setup.
 *
 * The token is fetched rather than read off the page on purpose. This request
 * carries the page's own cookies, so the server will only ever mint one for a
 * session the page had already proven — nothing is granted here that the
 * person was not already holding, and nothing sensitive has to sit in the DOM
 * to be passed along.
 */

const BRIDGE_ID = 'huddle-extension-bridge'

/** What this writes back, so the app can say whether it is installed. */
const INSTALLED_ATTR = 'data-extension'

const VERSION = chrome.runtime.getManifest().version

/** The last thing successfully configured, so a re-read is not a re-connect. */
let applied = ''

async function mintToken(api) {
  /* Relative when the app is same-origin with its API (development behind
     Vite's proxy); absolute when it is not (any real deployment). Both are
     the page's own fetch, so both are subject to the same CORS the app
     itself already passes. */
  const response = await fetch(`${api}/api/auth/extension-token`, { credentials: 'include' })
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  return typeof body?.token === 'string' ? body.token : null
}

async function sync() {
  const node = document.getElementById(BRIDGE_ID)
  if (!node) return

  /* Say we are here first, and unconditionally. The app shows the person
     whether the extension is installed, and that answer must not depend on
     whether a room happens to be open or the token round trip succeeded. */
  if (node.getAttribute(INSTALLED_ATTR) !== VERSION) {
    node.setAttribute(INSTALLED_ATTR, VERSION)
  }

  const api = (node.dataset.api || location.origin).replace(/\/$/, '')
  const roomId = node.dataset.roomId || ''
  const roomName = node.dataset.roomName || ''
  if (!roomId) return

  /* Nothing has changed since the last successful configure. Re-sending it
     would tear down a working socket to build the identical one. */
  const key = `${api}|${roomId}`
  if (key === applied) return

  const token = await mintToken(api)
  if (!token) return

  const result = await chrome.runtime
    .sendMessage({ kind: 'configure', server: api, roomId, roomName, token })
    .catch(() => null)

  if (result?.ok) applied = key
}

/*
 * Watched rather than read once.
 *
 * Three things can happen in any order: this script runs, the app renders the
 * element, and the person walks into a different room. An observer covers all
 * three the same way, where a single read on load would only ever catch the
 * first one — and only if it won the race.
 */
const observer = new MutationObserver(() => void sync())
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['data-room-id', 'data-api'],
})

void sync()
