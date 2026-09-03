import type { NextFunction, Request, Response } from 'express'

import { readSession, tokenFrom } from '../services/token.service.js'

declare global {
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

/** Rejects the request unless it carries a valid session, by cookie or header. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = readSession(tokenFrom(req))
  if (!userId) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }

  req.userId = userId
  next()
}
