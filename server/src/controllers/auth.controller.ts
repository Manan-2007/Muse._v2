import type { Request, Response } from 'express'
import { z } from 'zod'

import * as authService from '../services/auth.service.js'
import { signSession } from '../services/token.service.js'
import { HttpError } from '../utils/HttpError.js'
import { clearSessionCookie, setSessionCookie } from '../utils/cookies.js'

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const registration = credentials.extend({
  name: z.string().trim().min(1, 'Tell us what to call you').max(40),
})

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw HttpError.badRequest(result.error.issues[0]?.message ?? 'Invalid details')
  }
  return result.data
}

/*
 * The token comes back in the body as well as in the cookie.
 *
 * Same-origin clients ignore it and let the cookie do the work. A client on
 * another origin cannot rely on that cookie surviving the round trip, so it
 * keeps this and sends it as a bearer header instead.
 */
export async function register(req: Request, res: Response) {
  const input = parse(registration, req.body)
  const user = await authService.register(input)

  const token = signSession(user.id)
  setSessionCookie(res, token)
  res.status(201).json({ user, token })
}

export async function login(req: Request, res: Response) {
  const input = parse(credentials, req.body)
  const user = await authService.login(input)

  const token = signSession(user.id)
  setSessionCookie(res, token)
  res.json({ user, token })
}

/**
 * A bearer token for the current session, minted on request.
 *
 * Every login already returns one of these in its body — same-origin clients
 * simply have no reason to keep it, since the cookie does the same job and
 * does it more safely. That leaves nothing for anything *outside* the page to
 * borrow, which is exactly the gap a browser extension sits in: it can run
 * inside a Huddle tab and read what that tab hands it, but it has no cookie of
 * its own to send back.
 *
 * Minting a fresh one here rather than storing every login's token in
 * `localStorage` is the deliberate half of this: it keeps the token out of
 * script-readable storage for everyone who never asked for it, and only
 * exists on a page that explicitly requested it for that purpose.
 */
export function extensionToken(req: Request, res: Response) {
  res.json({ token: signSession(req.userId!) })
}

export function logout(_req: Request, res: Response) {
  clearSessionCookie(res)
  res.json({ ok: true })
}

export async function me(req: Request, res: Response) {
  try {
    const user = await authService.getUser(req.userId!)
    res.json({ user })
  } catch (error) {
    // The token is valid but the account is gone — drop the stale cookie.
    clearSessionCookie(res)
    throw error
  }
}
