import { API_BASE } from '@/lib/config'
import { BRIDGE_ID } from '@/features/watch/useExtensionInstalled'

/**
 * How the app and the browser extension find each other.
 *
 * They cannot simply talk. An extension's content script runs in an isolated
 * world: it can read this page's DOM, but not a single one of its JavaScript
 * objects — so no amount of `window.huddle = ...` here would be visible over
 * there. The document is the one surface both sides genuinely share.
 *
 * So this renders an empty element carrying what the extension needs in order
 * to configure itself, and the extension writes its version back onto the
 * same element to say it is installed. One element, two attributes, nothing
 * to get out of step.
 *
 * The point of it is that nobody should ever type an API URL, a room code and
 * a session token into a popup by hand. This page already holds all three —
 * it is signed in, it is standing in a room, and it knows its own API. The
 * extension reading that is the difference between a setup step and none.
 *
 * Note what is deliberately *not* here: the session token. The extension asks
 * the server for its own instead, over a request carrying this page's
 * cookies — so it can only ever be given one for a session this page had
 * already proven, and nothing sensitive has to sit in the DOM to be passed on.
 */
export function ExtensionBridge({
  roomId,
  roomName,
}: {
  roomId: string | null
  roomName: string | null
}) {
  if (!roomId) return null

  return (
    <div
      id={BRIDGE_ID}
      hidden
      /* Empty in development, where the API is same-origin behind Vite's
         proxy — so the extension resolves it against this page instead. */
      data-api={API_BASE}
      data-room-id={roomId}
      data-room-name={roomName ?? ''}
    />
  )
}
