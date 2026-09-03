import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Express 4 doesn't forward rejected promises to the error middleware, so an
 * async controller that throws would hang the request instead of returning a
 * status. Every async route handler is wrapped in this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}
