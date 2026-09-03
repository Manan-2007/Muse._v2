import type { Request, Response } from 'express'
import { z } from 'zod'

import { ROOM_TYPES, ROOM_VISIBILITIES } from '../config/env.js'
import * as roomService from '../services/room.service.js'
import { HttpError } from '../utils/HttpError.js'

const newRoom = z.object({
  name: z.string().trim().min(1, 'Give the room a name').max(48),
  type: z.enum(ROOM_TYPES, { errorMap: () => ({ message: 'Pick a room type' }) }),
  /* Defaulted rather than required, so an older client that does not send it
     still creates the closed kind instead of failing or falling open. */
  visibility: z
    .enum(ROOM_VISIBILITIES, { errorMap: () => ({ message: 'Pick who can join' }) })
    .default('private'),
})

export async function list(req: Request, res: Response) {
  res.json({ rooms: await roomService.listRooms(req.userId!) })
}

export async function create(req: Request, res: Response) {
  const parsed = newRoom.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid room')
  }

  const room = await roomService.createRoom(req.userId!, parsed.data)
  res.status(201).json({ room })
}

export async function discover(req: Request, res: Response) {
  res.json({ rooms: await roomService.discoverRooms(req.userId!) })
}

export async function show(req: Request, res: Response) {
  const room = await roomService.getRoom(req.userId!, req.params.id!)
  res.json({ room })
}

export async function join(req: Request, res: Response) {
  const room = await roomService.joinRoom(req.userId!, req.params.id!)
  res.json({ room })
}

const joinByCodeBody = z.object({
  code: z.string().trim().min(1, 'Enter a room code').max(80),
})

export async function joinByCode(req: Request, res: Response) {
  const parsed = joinByCodeBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Enter a room code')
  }

  const room = await roomService.joinRoomByCode(req.userId!, parsed.data.code)
  res.json({ room })
}
