/**
 * Proxy service-worker for cross-origin media.
 *
 * The only job here is to slip the `ngrok-skip-browser-warning` header onto
 * requests that a plain `<video>` element can't add itself. Without it,
 * ngrok's free-tier interstitial replaces the video bytes with an HTML page
 * and the element errors out.
 *
 * `self.skipWaiting()` + `clients.claim()` make the worker take over the page
 * it was registered from without waiting for a reload.
 */

/* Activate immediately — the video may already be trying to load. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  /* Same-origin requests don't need the header — leave them alone. */
  if (url.origin === self.location.origin) return

  /* Only touch requests heading for an ngrok tunnel. */
  if (
    !url.hostname.endsWith('.ngrok-free.app') &&
    !url.hostname.endsWith('.ngrok-free.dev') &&
    !url.hostname.endsWith('.ngrok.app') &&
    !url.hostname.endsWith('.ngrok.io')
  ) {
    return
  }

  /*
   * Only intercept requests that lack the header already.
   *
   * The app's own `fetch()` calls (API, socket upgrades) attach
   * `ngrok-skip-browser-warning` through `API_HEADERS` in lib/config.ts, so
   * they arrive here with the header already set. Touching them would strip
   * the body, the credentials, and the auth token — breaking every POST and
   * authenticated request.
   *
   * Requests from `<video>`, `<img>`, and other HTML elements cannot set
   * headers at all, so they arrive *without* it. Those are the only ones that
   * need this proxy.
   */
  if (event.request.headers.has('ngrok-skip-browser-warning')) return

  const headers = new Headers(event.request.headers)
  headers.set('ngrok-skip-browser-warning', 'true')

  /*
   * The `<video>` element sends its requests with `mode: "no-cors"`. In that
   * mode the browser silently strips any non-simple header — including ours.
   * Re-issuing as `mode: "cors"` lets the custom header through. The Express
   * CORS middleware on the backend already allows the Vercel origin, so the
   * response carries the right `Access-Control-Allow-Origin` and the browser
   * accepts it.
   */
  event.respondWith(
    fetch(event.request.url, {
      method: event.request.method,
      headers,
      mode: 'cors',
      credentials: 'omit',
    }),
  )
})
