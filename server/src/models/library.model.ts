import { prisma } from './prisma.js'

/**
 * The room's kept music: its playlists, and each person's saved songs.
 *
 * Distinct from the queue, which is what is playing next and is emptied as it
 * plays. This is what survives the session — the reason to come back to a room
 * rather than start again from a search box.
 */

/** The fields a song carries wherever it is stored. */
const trackFields = {
  source: true,
  ref: true,
  title: true,
  artist: true,
  album: true,
  artwork: true,
  duration: true,
} as const

export type TrackInput = {
  source: string
  ref: string
  title: string
  artist?: string | null
  album?: string | null
  artwork?: string | null
  duration?: number | null
}

function normalise(track: TrackInput) {
  return {
    source: track.source,
    ref: track.ref,
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    artwork: track.artwork ?? null,
    duration: track.duration ?? null,
  }
}

/* ── Playlists ─────────────────────────────────────────────────────────── */

const playlistSelect = {
  id: true,
  name: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  tracks: {
    orderBy: { position: 'asc' },
    select: { id: true, position: true, ...trackFields },
  },
} as const

export function listPlaylists(roomId: string) {
  return prisma.playlist.findMany({
    where: { roomId },
    orderBy: { createdAt: 'desc' },
    select: playlistSelect,
  })
}

export function findPlaylist(roomId: string, id: string) {
  return prisma.playlist.findFirst({ where: { id, roomId }, select: playlistSelect })
}

export function createPlaylist(roomId: string, createdById: string, name: string) {
  return prisma.playlist.create({
    data: { roomId, createdById, name },
    select: playlistSelect,
  })
}

export async function deletePlaylist(roomId: string, id: string) {
  await prisma.playlist.deleteMany({ where: { id, roomId } })
}

export async function addToPlaylist(roomId: string, playlistId: string, track: TrackInput) {
  /* Scoped through the room so a playlist id from elsewhere cannot be written
     into — the id alone is not proof of belonging. */
  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, roomId },
    select: { id: true },
  })
  if (!playlist) return null

  /*
   * Adding the same song twice is a slip, not an intention.
   *
   * The menu that reaches this offers every playlist at once with no memory of
   * what is already in them, so the same track lands twice by simply being
   * clicked twice. Answering with the unchanged playlist is quieter than an
   * error and truer than a second row: what was asked for — this song, in
   * this playlist — is already the case.
   */
  const already = await prisma.playlistTrack.findFirst({
    where: { playlistId, source: track.source, ref: track.ref },
    select: { id: true },
  })
  if (already) return findPlaylist(roomId, playlistId)

  const last = await prisma.playlistTrack.findFirst({
    where: { playlistId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  await prisma.playlistTrack.create({
    data: { ...normalise(track), playlistId, position: (last?.position ?? -1) + 1 },
  })

  return findPlaylist(roomId, playlistId)
}

export async function removeFromPlaylist(roomId: string, playlistId: string, trackId: string) {
  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, roomId },
    select: { id: true },
  })
  if (!playlist) return null

  await prisma.playlistTrack.deleteMany({ where: { id: trackId, playlistId } })
  return findPlaylist(roomId, playlistId)
}

/* ── Liked ─────────────────────────────────────────────────────────────── */

const likedSelect = { id: true, createdAt: true, ...trackFields } as const

export function listLiked(roomId: string, userId: string) {
  return prisma.likedTrack.findMany({
    where: { roomId, userId },
    orderBy: { createdAt: 'desc' },
    select: likedSelect,
  })
}

/**
 * Save or unsave, in one call.
 *
 * A toggle rather than separate add and remove endpoints because the client
 * only ever knows "this heart was pressed" — it would otherwise have to hold a
 * correct like-state for every song on screen to pick the right verb, and be
 * wrong the moment another tab changed it.
 */
export async function toggleLiked(roomId: string, userId: string, track: TrackInput) {
  /*
   * Delete first, and let the result decide.
   *
   * Reading the row and then writing based on what was read is two steps with
   * a gap in the middle, and a double-click or a second tab fits neatly into
   * that gap: both see "not liked", both insert, and the second one hits the
   * unique constraint as an unhandled error. `deleteMany` reports how many
   * rows it actually removed, which turns the whole decision into one
   * statement the database resolves on its own.
   */
  const removed = await prisma.likedTrack.deleteMany({
    where: { userId, roomId, source: track.source, ref: track.ref },
  })

  if (removed.count > 0) return { liked: false }

  try {
    await prisma.likedTrack.create({ data: { ...normalise(track), roomId, userId } })
  } catch {
    /* Someone else's insert landed between the delete and this one. The row
       exists and is liked, which is the state this call was asking for. */
  }

  return { liked: true }
}

/** Just the keys, for painting hearts across a long list cheaply. */
export async function likedKeys(roomId: string, userId: string) {
  const rows = await prisma.likedTrack.findMany({
    where: { roomId, userId },
    select: { source: true, ref: true },
  })
  return rows.map((row) => `${row.source}:${row.ref}`)
}

/* ── Suggestions ───────────────────────────────────────────────────────── */

/**
 * What the room has been playing, most recent first, de-duplicated.
 *
 * The honest basis for "suggested": this room's own history, not a model of
 * anyone's taste. Everything in the queue and every playlist has been chosen
 * by someone here, which makes it a better guess than nothing and an honest
 * one to label.
 */
export async function recentlyPlayed(roomId: string, limit = 40) {
  const [queued, playlisted] = await Promise.all([
    prisma.trackItem.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { createdAt: true, ...trackFields },
    }),
    prisma.playlistTrack.findMany({
      where: { playlist: { roomId } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { createdAt: true, ...trackFields },
    }),
  ])

  const seen = new Set<string>()
  return [...queued, ...playlisted]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((track) => {
      const key = `${track.source}:${track.ref}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
