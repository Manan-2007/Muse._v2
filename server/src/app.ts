import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'

import { env } from './config/env.js'

import { errorHandler, notFound } from './middleware/errorHandler.js'
import { apiRoutes } from './routes/index.js'
import { UPLOAD_DIR, UPLOAD_ROUTE } from './services/upload.service.js'

/**
 * The Express application, with no server attached — so tests can import this
 * without opening a port. `server.ts` is what actually listens.
 */
export function createApp() {
  const app = express()

  /*
   * Behind a tunnel or a platform proxy, the real protocol arrives in
   * `X-Forwarded-Proto`. Without trusting it, Express thinks every request is
   * plain HTTP and refuses to set a `Secure` cookie — so sign-in appears to
   * work and then no session is ever stored.
   */
  app.set('trust proxy', 1)

  /*
   * A split deployment is cross-origin by definition. `credentials` is what
   * allows the cookie and the `Authorization` header through; the origin list
   * is explicit rather than `*` because the two cannot be combined.
   */
  app.use(
    cors({
      origin: (origin, done) => {
        // Same-origin requests and curl send no Origin header at all.
        if (!origin) return done(null, true)
        /* Refuse by withholding the headers rather than by throwing. The
           browser blocks it either way, but an error here would surface as a
           500 and bury real failures in the log. */
        done(null, env.clientOrigins.includes(origin.replace(/\/$/, '')))
      },
      credentials: true,
    }),
  )

  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  /*
   * Uploaded room videos.
   *
   * Static serving gives range requests for free, which a `<video>` element
   * needs in order to seek — without them, scrubbing would re-download from
   * the top every time.
   */
  app.use(UPLOAD_ROUTE, express.static(UPLOAD_DIR, { maxAge: '1h' }))

  app.use('/api', apiRoutes)
  app.use('/api', notFound)
  app.use(errorHandler)

  return app
}
