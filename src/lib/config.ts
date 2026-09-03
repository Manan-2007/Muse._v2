/**
 * Where the backend lives, and how we prove who we are.
 *
 * In local development this is empty: Vite proxies `/api`, `/socket.io` and
 * `/uploads` to the server, so everything is same-origin and the session cookie
 * does the work on its own.
 *
 * A deployed frontend has no proxy. `VITE_API_URL` points it at the API's real
 * origin, and from that moment every request is cross-site — which is why the
 * token below exists.
 *
 * It can also be set at runtime, with `?api=…` once. That exists because the
 * API here is a laptop behind a tunnel: baking its address in at build time
 * means a redeploy of the frontend every time that address moves, to change
 * one string. Stored per browser, so it survives reloads and outlives the
 * link that set it.
 */

const STORED_API_KEY = 'syncroom.apiBase'

/** Only an absolute http(s) origin is worth storing. */
function readable(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Take `?api=…` off the URL, once, with the person's say-so.
 *
 * Confirmed rather than applied silently, and this is not ceremony: a link
 * that repoints the app at another origin is a link that sends whatever gets
 * typed into the sign-in form there instead. Naming the host and asking is
 * the difference between a setup shortcut and a way to phish somebody with a
 * URL. Stripped from the address bar afterwards either way, so a refusal is
 * not re-asked on every reload.
 */
function captureFromUrl(): string | null {
  if (typeof window === 'undefined') return null

  const params = new URLSearchParams(window.location.search)
  const asked = readable(params.get('api'))
  if (!asked) return null

  const clean = () => {
    params.delete('api')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    )
  }

  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(STORED_API_KEY)
  } catch {
    /* Storage refused. The confirm below still decides this session. */
  }

  /* Already pointed there — nothing changes, so nothing to ask about. */
  if (stored === asked) {
    clean()
    return asked
  }

  const ok = window.confirm(
    `Point Huddle at ${new URL(asked).host}?\n\n` +
      'Everything you do here, including signing in, will go to that server. ' +
      'Only continue if it is yours.',
  )
  clean()
  if (!ok) return null

  try {
    window.localStorage.setItem(STORED_API_KEY, asked)
  } catch {
    /* Private browsing. It holds for this page load and no longer. */
  }
  return asked
}

function resolveApiBase(): string {
  const fromUrl = captureFromUrl()
  if (fromUrl) return fromUrl

  try {
    const stored = readable(window.localStorage.getItem(STORED_API_KEY))
    if (stored) return stored
  } catch {
    /* Fall through to the built-in default. */
  }

  const raw = import.meta.env.VITE_API_URL as string | undefined
  return (raw ?? '').trim().replace(/\/$/, '')
}

/** Absolute API origin, or `''` when same-origin. Never has a trailing slash. */
export const API_BASE = resolveApiBase()

/** Forget a runtime override and fall back to however this was built. */
export function clearStoredApiBase() {
  try {
    window.localStorage.removeItem(STORED_API_KEY)
  } catch {
    /* Nothing stored to forget. */
  }
}

/** True when the API is on another origin, so cookies can't be relied on. */
export const IS_CROSS_ORIGIN = API_BASE.length > 0

const TOKEN_KEY = 'syncroom.token'

/**
 * The session token, for cross-origin use.
 *
 * Deliberately *not* used when same-origin: there the httpOnly cookie is
 * strictly better, because script can't read it. Cross-origin that cookie is
 * third-party and Safari discards it, so the token in `localStorage` is what
 * keeps sign-in working. The tradeoff is that it *is* script-readable, so an
 * XSS bug would expose it — acceptable here only because the app renders no
 * user-supplied HTML anywhere.
 */
export function getToken(): string | null {
  if (!IS_CROSS_ORIGIN) return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    /* Private browsing can throw on access. */
    return null
  }
}

export function setToken(token: string | null) {
  if (!IS_CROSS_ORIGIN) return
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* Nothing to do — the cookie may still carry the session. */
  }
}

/**
 * Headers every API call needs, beyond auth.
 *
 * ngrok's free tier answers browser-looking requests with an HTML warning page
 * instead of proxying — and that page carries no CORS headers, so a
 * cross-origin `fetch` fails with a bare "Failed to fetch" that looks exactly
 * like the server being down. This header opts out of it. Harmless everywhere
 * else, so it is not conditional.
 */
export const API_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': 'true',
}

/** Absolute URL for something the API serves, such as an uploaded video. */
export function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}
