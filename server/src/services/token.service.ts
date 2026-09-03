import jwt from 'jsonwebtoken'

import { SESSION_COOKIE, SESSION_TTL, env } from '../config/env.js'

type TokenPayload = { sub: string }

export function signSession(userId: string) {
  return jwt.sign({ sub: userId } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: SESSION_TTL,
  })
}

/**
 * Pull the session token off a request, cookie or header.
 *
 * Two carriers on purpose. The cookie is the nicer mechanism — httpOnly, so a
 * script can't read it — and it works whenever the frontend and API share an
 * origin. It stops working the moment they don't: the cookie becomes
 * third-party, and Safari drops those on the floor. The `Authorization` header
 * is unaffected by any of that, so a split deployment leans on it instead.
 */
export function tokenFrom(source: {
  cookies?: Record<string, string | undefined>
  headers?: { authorization?: string } | Record<string, unknown>
}): string | undefined {
  const cookie = source.cookies?.[SESSION_COOKIE]
  if (cookie) return cookie

  const raw = (source.headers as { authorization?: string } | undefined)?.authorization
  if (typeof raw !== 'string') return undefined

  const [scheme, value] = raw.split(' ')
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined
}

/** The user id inside a session token, or null if missing, invalid or expired. */
export function readSession(token: string | undefined): string | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload
    return payload.sub ?? null
  } catch {
    return null
  }
}
