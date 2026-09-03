import type { NextFunction, Request, Response } from 'express'

import { HttpError } from '../utils/HttpError.js'

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Unknown endpoint' })
}

/**
 * Expected failures are thrown as HttpError by the services and become their
 * own status. Anything else is a bug: it gets logged in full server-side and
 * the client only ever sees a generic message.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message })
    return
  }

  /*
   * Logged by hand rather than by handing the value to `console.error`.
   *
   * An error handler that throws while reporting an error is the worst kind
   * of bug: every failure downstream of it becomes an unexplained 500 with
   * nothing in the log, and the thing that actually broke is invisible.
   * `util.inspect` walks property descriptors and throws on some of them —
   * which is exactly what happened here, and it hid the real fault behind
   * "Something went wrong" for as long as it took to read the stack.
   */
  try {
    console.error('[syncroom]', error instanceof Error ? (error.stack ?? error.message) : error)
  } catch {
    console.error('[syncroom] a thrown value could not be printed')
  }

  res.status(500).json({ error: 'Something went wrong' })
}
