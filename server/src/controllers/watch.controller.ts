import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { Request, Response } from 'express'
import { z } from 'zod'

import { iceConfig } from '../services/turn.service.js'
import {
  isPublishing,
  publishInBackground,
  readPublished,
  unpublish,
} from '../services/publish.service.js'
import {
  discardUpload,
  finishUpload,
  listLibrary,
  UPLOAD_DIR,
  UPLOAD_ROUTE,
} from '../services/upload.service.js'

import * as queueModel from '../models/queue.model.js'
import { resolveSource, searchAvailable, searchYouTube } from '../services/sources.service.js'
import { assertMembership } from '../services/room.service.js'
import { WATCH_SOURCES } from '../services/watch.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * Everything about the watch feature that isn't playback.
 *
 * Playback lives on the socket because it is a stream of small events; the
 * queue lives here because it is durable state with an obvious REST shape.
 */

async function gate(req: Request) {
  const roomId = req.params.id!
  await assertMembership(req.userId!, roomId)
  return roomId
}

export async function search(req: Request, res: Response) {
  await gate(req)

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) throw HttpError.badRequest('Type something to search for')

  res.json({ results: await searchYouTube(query) })
}

export async function capabilities(req: Request, res: Response) {
  await gate(req)
  /* The client needs to know whether to show a search box or go straight to
     the paste field, and saying so beats letting search fail on first use. */
  res.json({ search: searchAvailable(), sources: WATCH_SOURCES })
}

const resolveBody = z.object({
  input: z.string().trim().min(1, 'Paste a link or a title').max(600),
})

export async function resolve(req: Request, res: Response) {
  await gate(req)

  const parsed = resolveBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Paste a link or a title')
  }

  res.json({ resolved: await resolveSource(parsed.data.input) })
}

/**
 * A local file, now hosted.
 *
 * Returns the same shape as `resolve`, so the client can hand it straight to
 * the queue without a second code path for uploads.
 *
 * Multer has already written the bytes by the time this runs — it has to, the
 * body is the file — so every exit from here is responsible for the file it
 * inherited. It is either promoted to a real name or deleted; nothing is left
 * half-named in the uploads folder for the library to offer up later.
 */
export async function upload(req: Request, res: Response) {
  const file = (req as Request & { file?: Express.Multer.File }).file

  try {
    await gate(req)
  } catch (cause) {
    if (file) await discardUpload(req, file)
    throw cause
  }

  if (!file) throw HttpError.badRequest('No file was uploaded')

  const title = path.parse(file.originalname).name || 'Uploaded video'
  const stored = await finishUpload(req, file)

  /*
   * Start the CDN version, but answer now.
   *
   * The path below is playable the moment the file is on disk, so the room is
   * never blocked on repackaging — which for a long film takes minutes. The
   * library picks up the HLS URL once it exists, and anyone who queues this
   * before then simply gets the direct file.
   */
  publishInBackground(stored)

  res.status(201).json({
    resolved: {
      source: 'file' as const,
      ref: `${UPLOAD_ROUTE}/${stored}`,
      title,
      duration: null,
      thumbnail: null,
    },
  })
}

/**
 * ICE servers for a call.
 *
 * Auth-gated because it can hand out relay credentials, and those cost money
 * to use — an open endpoint would let anyone mine them.
 */
export async function ice(_req: Request, res: Response) {
  res.json(await iceConfig())
}

/**
 * What's already sitting on the server, ready to play.
 *
 * The uploads folder is the interface: drop a file in over SSH, Finder, or
 * the upload form and it shows up here — no link to paste, no database row to
 * keep in step with what's actually on disk.
 *
 * Each entry is matched against what has been published to the CDN. A file
 * with an HLS version should be played from there rather than from this
 * machine, and the client can only make that choice if it is told which is
 * which — so the published URL and its duration ride along with the listing.
 */
export async function library(req: Request, res: Response) {
  await gate(req)

  const [items, published] = await Promise.all([listLibrary(), readPublished()])

  res.json({
    items: items.map((item) => {
      const live = published[item.file]
      return {
        ...item,
        hls: live?.url ?? null,
        duration: live?.durationSeconds ?? null,
        audio: live?.audio ?? null,
        thumbnail: live?.thumbnail ?? null,
      }
    }),
  })
}

/**
 * Remove a film from the server: the file, its published segments, its entry.
 *
 * All three, because any one left behind is a different kind of wrong. The
 * file alone leaves a few thousand R2 objects nothing points at; the index
 * entry alone leaves the library offering something that will not play.
 *
 * The name is matched against what the folder actually holds rather than
 * being joined onto a path. A request is a string from outside, and the only
 * safe way to turn one into a filesystem path is to refuse to build a path at
 * all until it has been found in a listing that was made here.
 */
export async function removeFromLibrary(req: Request, res: Response) {
  await gate(req)

  const requested = String(req.params.file ?? '')
  const items = await listLibrary()
  const match = items.find((item) => item.file === requested)
  if (!match) throw HttpError.notFound('No such file on the server')

  /* Publishing reads the source and writes thousands of objects under a
     prefix this would be deleting from — let it finish rather than racing it
     into a half-published state nothing can clean up. */
  if (isPublishing(match.file)) {
    throw HttpError.badRequest('That one is still being published. Try again once it finishes.')
  }

  const { removed, wasPublished } = await unpublish(match.file)
  await rm(path.join(UPLOAD_DIR, match.file), { force: true })

  res.json({ file: match.file, wasPublished, objectsRemoved: removed })
}

export async function queue(req: Request, res: Response) {
  const roomId = await gate(req)
  res.json({ items: await queueModel.listQueue(roomId) })
}

const addBody = z.object({
  source: z.enum(WATCH_SOURCES),
  ref: z.string().trim().min(1).max(600),
  title: z.string().trim().min(1).max(300),
  duration: z.number().int().positive().nullable().optional(),
  thumbnail: z.string().trim().max(600).nullable().optional(),
})

export async function add(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = addBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Could not add that')
  }

  const item = await queueModel.addToQueue({
    roomId,
    addedById: req.userId!,
    source: parsed.data.source,
    ref: parsed.data.ref,
    title: parsed.data.title,
    duration: parsed.data.duration ?? null,
    thumbnail: parsed.data.thumbnail ?? null,
  })

  res.status(201).json({ item, items: await queueModel.listQueue(roomId) })
}

export async function remove(req: Request, res: Response) {
  const roomId = await gate(req)
  await queueModel.removeFromQueue(roomId, req.params.itemId!)
  res.json({ items: await queueModel.listQueue(roomId) })
}

export async function clear(req: Request, res: Response) {
  const roomId = await gate(req)
  await queueModel.clearQueue(roomId)
  res.json({ items: [] })
}

const reorderBody = z.object({ ids: z.array(z.string()).max(200) })

export async function reorder(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = reorderBody.safeParse(req.body)
  if (!parsed.success) throw HttpError.badRequest('Could not reorder the queue')

  res.json({ items: await queueModel.reorderQueue(roomId, parsed.data.ids) })
}
