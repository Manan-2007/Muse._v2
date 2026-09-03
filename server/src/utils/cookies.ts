import type { Response } from 'express'

import { SESSION_COOKIE, SESSION_MAX_AGE_MS, env } from '../config/env.js'

/**
 * The session cookie.
 *
 * Same-origin (local dev through the Vite proxy) gets `SameSite=Lax`, which is
 * the safer default. A split deployment has to relax that to `None` or the
 * browser simply won't attach it — and `None` is only honoured alongside
 * `Secure`, so both ends must be HTTPS.
 *
 * Even then this is a best-effort path: Safari blocks third-party cookies by
 * default and Chrome is heading the same way, so a cross-origin client should
 * be relying on the bearer token rather than on this.
 */
export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // unreadable from JS, so XSS can't lift the session
    sameSite: env.crossSite ? 'none' : 'lax',
    secure: env.crossSite || env.isProd,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  })
}

export function clearSessionCookie(res: Response) {
  /* The attributes must match the ones it was set with, or the browser keeps
     the original cookie and "sign out" silently does nothing. */
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    sameSite: env.crossSite ? 'none' : 'lax',
    secure: env.crossSite || env.isProd,
  })
}
