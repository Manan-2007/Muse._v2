import { Router } from 'express'

import * as watchController from '../controllers/watch.controller.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { authRoutes } from './auth.routes.js'
import { roomRoutes } from './room.routes.js'

export const apiRoutes = Router()

apiRoutes.get('/health', (_req, res) => {
  res.json({ ok: true })
})

/* Not room-scoped: the same relay serves every call, and the client needs it
   before it has picked a room. */
apiRoutes.get('/ice', requireAuth, asyncHandler(watchController.ice))

apiRoutes.use('/auth', authRoutes)
apiRoutes.use('/rooms', roomRoutes)
