import path from 'node:path'
import type { Request, Response } from 'express'
import { z } from 'zod'

import * as libraryModel from '../models/library.model.js'
import { lyricsFor } from '../services/lyrics.service.js'
import * as trackModel from '../models/track.model.js'
import { MUSIC_SOURCES } from '../services/music.service.js'
import { assertMembership } from '../services/room.service.js'
import {
  searchAvailable,
  searchYouTube,
  youtubeIdFrom,
  youtubeOEmbed,
} from '../services/sources.service.js'
import { cleanArtist, cleanTrackName } from '../services/trackName.js'
import {
  discardUpload,
  finishUpload,
  listAudioLibrary,
  UPLOAD_ROUTE,
} from '../services/upload.service.js'
import { HttpError } from '../utils/HttpError.js'

/**
 * The listening queue and its lookups.
 *
 * Playback itself is on the socket, for the same reason the watch feature
 * splits that way: a stream of small timing events is a poor fit for HTTP, and
 * a queue is durable state with an obvious REST shape.
 */

async function gate(req: Request) {
  const roomId = req.params.id!
  await assertMembership(req.userId!, roomId)
  return roomId
}

/**
 * Lyrics for whatever is playing.
 *
 * A read, and a personal one — the room does not agree on whether the lyrics
 * are showing any more than it agrees on who is fullscreen, so this is a plain
 * fetch rather than anything that travels over the socket.
 */
export async function lyrics(req: Request, res: Response) {
  await assertMembership(req.userId!, req.params.id!)

  const title = typeof req.query.title === 'string' ? req.query.title : ''
  if (!title.trim()) throw HttpError.badRequest('A title is needed to find lyrics')

  const artist = typeof req.query.artist === 'string' ? req.query.artist : null
  const album = typeof req.query.album === 'string' ? req.query.album : null
  const duration = Number(req.query.duration)

  res.json(
    await lyricsFor({
      title,
      artist,
      album,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    }),
  )
}

export async function capabilities(req: Request, res: Response) {
  await gate(req)
  res.json({ search: searchAvailable(), sources: MUSIC_SOURCES })
}

export async function search(req: Request, res: Response) {
  await gate(req)

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) throw HttpError.badRequest('Type something to search for')

  /* The same YouTube search the watch feature uses, nudged towards music.
     Without the hint the top results for a song title are as likely to be
     reaction videos and lyric edits as the track itself. */
  const results = await searchYouTube(`${query} audio`)

  /* Cleaned here rather than in the client, so a song carries the same name
     whether it was searched for, pasted, or suggested. */
  res.json({
    results: results.map((result) => {
      const named = cleanTrackName(result.title, result.channel)
      return { ...result, title: named.title, channel: named.artist ?? result.channel }
    }),
  })
}

/**
 * Turn a pasted link into something queueable.
 *
 * Narrower than the watch resolver on purpose: a room's listening queue takes
 * a YouTube link or a direct audio file, and nothing else. The walled-platform
 * countdown mode that `resolveSource` offers has no meaning here — there is no
 * "start the album together on Spotify" that this app could honour.
 */
const resolveBody = z.object({
  input: z.string().trim().min(1, 'Paste a link').max(600),
})

const AUDIO_URL = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)(\?|#|$)/i

export async function resolve(req: Request, res: Response) {
  await gate(req)

  const parsed = resolveBody.safeParse(req.body)
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Paste a link')

  const input = parsed.data.input
  const youtubeId = youtubeIdFrom(input)

  if (youtubeId) {
    /* oEmbed is public and needs no key, so there is no excuse for queueing a
       song under a placeholder name — see the note on `youtubeOEmbed`. */
    const meta = await youtubeOEmbed(youtubeId)
    /* Uploads are titled for search, not for a sleeve — see `cleanTrackName`. */
    const named = meta?.title
      ? cleanTrackName(meta.title, meta.author_name)
      : { title: 'YouTube track', artist: cleanArtist(meta?.author_name) }

    res.json({
      resolved: {
        source: 'youtube' as const,
        ref: youtubeId,
        title: named.title,
        artist: named.artist,
        album: null,
        artwork: meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
        duration: null,
      },
    })
    return
  }

  if (/^https?:\/\//i.test(input) && AUDIO_URL.test(input)) {
    const name = decodeURIComponent(new URL(input).pathname.split('/').pop() ?? 'Track')
    res.json({
      resolved: {
        source: 'file' as const,
        ref: input,
        title: path.parse(name).name || 'Track',
        artist: null,
        album: null,
        artwork: null,
        duration: null,
      },
    })
    return
  }

  throw HttpError.badRequest(
    'That link is not something this can play. Paste a YouTube link, or a direct link to an audio file.',
  )
}

/** Audio already sitting in the uploads folder. */
export async function library(req: Request, res: Response) {
  await gate(req)
  res.json({ items: await listAudioLibrary() })
}

/**
 * A local file, now hosted.
 *
 * Every exit from here owns the file multer already wrote — see the note on
 * the watch controller's upload, which has the same contract.
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

  const title = path.parse(file.originalname).name || 'Track'
  const stored = await finishUpload(req, file)

  res.status(201).json({
    resolved: {
      source: 'file' as const,
      ref: `${UPLOAD_ROUTE}/${encodeURIComponent(stored)}`,
      title,
      artist: null,
      album: null,
      artwork: null,
      duration: null,
    },
  })
}

export async function queue(req: Request, res: Response) {
  const roomId = await gate(req)
  res.json({ items: await trackModel.listTracks(roomId) })
}

const addBody = z.object({
  source: z.enum(MUSIC_SOURCES),
  ref: z.string().trim().min(1).max(600),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(200).nullable().optional(),
  album: z.string().trim().max(200).nullable().optional(),
  artwork: z.string().trim().max(600).nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
})

export async function add(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = addBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Could not add that')
  }

  const item = await trackModel.addTrack({
    roomId,
    addedById: req.userId!,
    source: parsed.data.source,
    ref: parsed.data.ref,
    title: parsed.data.title,
    artist: parsed.data.artist ?? null,
    album: parsed.data.album ?? null,
    artwork: parsed.data.artwork ?? null,
    duration: parsed.data.duration ?? null,
  })

  res.status(201).json({ item, items: await trackModel.listTracks(roomId) })
}

export async function remove(req: Request, res: Response) {
  const roomId = await gate(req)
  await trackModel.removeTrack(roomId, req.params.trackId!)
  res.json({ items: await trackModel.listTracks(roomId) })
}

export async function clear(req: Request, res: Response) {
  const roomId = await gate(req)
  await trackModel.clearTracks(roomId)
  res.json({ items: [] })
}

/* ── Library: playlists, likes, suggestions ───────────────────────────── */

const trackBody = z.object({
  source: z.enum(MUSIC_SOURCES),
  ref: z.string().trim().min(1).max(600),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(200).nullable().optional(),
  album: z.string().trim().max(200).nullable().optional(),
  artwork: z.string().trim().max(600).nullable().optional(),
  duration: z.number().int().positive().nullable().optional(),
})

export async function playlists(req: Request, res: Response) {
  const roomId = await gate(req)
  res.json({ items: await libraryModel.listPlaylists(roomId) })
}

const nameBody = z.object({ name: z.string().trim().min(1, 'Name it something').max(120) })

export async function createPlaylist(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = nameBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Name it something')
  }

  res.status(201).json({
    item: await libraryModel.createPlaylist(roomId, req.userId!, parsed.data.name),
  })
}

export async function deletePlaylist(req: Request, res: Response) {
  const roomId = await gate(req)
  await libraryModel.deletePlaylist(roomId, req.params.playlistId!)
  res.json({ items: await libraryModel.listPlaylists(roomId) })
}

export async function addToPlaylist(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = trackBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Could not add that')
  }

  const item = await libraryModel.addToPlaylist(roomId, req.params.playlistId!, parsed.data)
  if (!item) throw HttpError.notFound('No such playlist')
  res.json({ item })
}

export async function removeFromPlaylist(req: Request, res: Response) {
  const roomId = await gate(req)
  const item = await libraryModel.removeFromPlaylist(
    roomId,
    req.params.playlistId!,
    req.params.trackId!,
  )
  if (!item) throw HttpError.notFound('No such playlist')
  res.json({ item })
}

export async function liked(req: Request, res: Response) {
  const roomId = await gate(req)
  res.json({
    items: await libraryModel.listLiked(roomId, req.userId!),
    keys: await libraryModel.likedKeys(roomId, req.userId!),
  })
}

export async function toggleLiked(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = trackBody.safeParse(req.body)
  if (!parsed.success) {
    throw HttpError.badRequest(parsed.error.issues[0]?.message ?? 'Could not save that')
  }

  const result = await libraryModel.toggleLiked(roomId, req.userId!, parsed.data)
  res.json({ ...result, keys: await libraryModel.likedKeys(roomId, req.userId!) })
}

/**
 * What to play next, and why.
 *
 * Two honest sources, in order. The room's own history is first because it is
 * real: these are songs someone here actually chose. Beyond that, a YouTube
 * search for more from the current artist — which is a continuation rather
 * than a recommendation, and is labelled as such in the UI.
 *
 * There is deliberately no taste model. Building one needs listening data
 * across many people that this app does not have and should not pretend to.
 */
export async function suggestions(req: Request, res: Response) {
  const roomId = await gate(req)

  const seedArtist = typeof req.query.artist === 'string' ? req.query.artist.trim() : ''
  const [history, more] = await Promise.all([
    libraryModel.recentlyPlayed(roomId, 24),
    seedArtist && searchAvailable()
      ? searchYouTube(`${seedArtist} songs`).catch(() => [])
      : Promise.resolve([]),
  ])

  res.json({
    history,
    /* Excludes the seed itself — offering the song you are listening to as the
       thing to listen to next is the classic tell of a fake recommender. */
    more: more.filter((result) => result.channel.trim() !== seedArtist).slice(0, 12),
  })
}

const reorderBody = z.object({ ids: z.array(z.string()).max(500) })

export async function reorder(req: Request, res: Response) {
  const roomId = await gate(req)

  const parsed = reorderBody.safeParse(req.body)
  if (!parsed.success) throw HttpError.badRequest('Could not reorder the queue')

  res.json({ items: await trackModel.reorderTracks(roomId, parsed.data.ids) })
}
