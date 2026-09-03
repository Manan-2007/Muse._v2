import { prisma } from './prisma.js'

/** Every track read returns this shape. */
const trackSelect = {
  id: true,
  source: true,
  ref: true,
  title: true,
  artist: true,
  album: true,
  artwork: true,
  duration: true,
  position: true,
  addedBy: { select: { id: true, name: true } },
} as const

export function listTracks(roomId: string) {
  return prisma.trackItem.findMany({
    where: { roomId },
    orderBy: { position: 'asc' },
    select: trackSelect,
  })
}

export async function addTrack(input: {
  roomId: string
  addedById: string
  source: string
  ref: string
  title: string
  artist: string | null
  album: string | null
  artwork: string | null
  duration: number | null
}) {
  /* Append by max+1 rather than count — removals leave gaps, and counting
     would start reusing positions and silently reorder the queue. */
  const last = await prisma.trackItem.findFirst({
    where: { roomId: input.roomId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  return prisma.trackItem.create({
    data: { ...input, position: (last?.position ?? -1) + 1 },
    select: trackSelect,
  })
}

export function removeTrack(roomId: string, id: string) {
  // Scoped by room so an id from elsewhere can't reach across into this one.
  return prisma.trackItem.deleteMany({ where: { id, roomId } })
}

export function clearTracks(roomId: string) {
  return prisma.trackItem.deleteMany({ where: { roomId } })
}

/** Rewrite the order from a list of ids, keeping anything the caller forgot. */
export async function reorderTracks(roomId: string, ids: string[]) {
  const existing = await prisma.trackItem.findMany({
    where: { roomId },
    orderBy: { position: 'asc' },
    select: { id: true },
  })

  const known = new Set(existing.map((track) => track.id))
  const ordered = ids.filter((id) => known.has(id))
  for (const track of existing) {
    if (!ordered.includes(track.id)) ordered.push(track.id)
  }

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.trackItem.update({ where: { id }, data: { position: index } }),
    ),
  )

  return listTracks(roomId)
}

export function findTrack(roomId: string, id: string) {
  return prisma.trackItem.findFirst({ where: { id, roomId }, select: trackSelect })
}

/** The track after `afterId`, or the first one when nothing is playing. */
export async function nextTrack(roomId: string, afterId: string | null) {
  const tracks = await listTracks(roomId)
  if (tracks.length === 0) return null
  if (!afterId) return tracks[0] ?? null

  const index = tracks.findIndex((track) => track.id === afterId)
  if (index === -1) return tracks[0] ?? null
  return tracks[index + 1] ?? null
}

/** The track before `beforeId` — "previous" on the controls. */
export async function previousTrack(roomId: string, beforeId: string | null) {
  const tracks = await listTracks(roomId)
  if (tracks.length === 0 || !beforeId) return null

  const index = tracks.findIndex((track) => track.id === beforeId)
  if (index <= 0) return null
  return tracks[index - 1] ?? null
}

/** Fill in a duration the client discovered once the file actually loaded. */
export function setTrackDuration(roomId: string, id: string, duration: number) {
  return prisma.trackItem.updateMany({ where: { id, roomId }, data: { duration } })
}
