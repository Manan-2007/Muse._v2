import { Router } from 'express'

import * as authController from '../controllers/auth.controller.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

export const authRoutes = Router()

authRoutes.post('/register', asyncHandler(authController.register))
authRoutes.post('/login', asyncHandler(authController.login))
authRoutes.post('/logout', authController.logout)
authRoutes.get('/me', requireAuth, asyncHandler(authController.me))
authRoutes.get('/extension-token', requireAuth, authController.extensionToken)
