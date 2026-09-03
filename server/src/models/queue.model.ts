import { prisma } from './prisma.js'

/** Every queue read returns items in this shape. */
const queueSelect = {
  id: true,
  source: true,
  ref: true,
  title: true,
  duration: true,
  thumbnail: true,
  position: true,
  addedBy: { select: { id: true, name: true } },
} as const

export function listQueue(roomId: string) {
  return prisma.queueItem.findMany({
    where: { roomId },
    orderBy: { position: 'asc' },
    select: queueSelect,
  })
}

export async function addToQueue(input: {
  roomId: string
  addedById: string
  source: string
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
}) {
  /* Append. Taking max+1 rather than a count keeps the ordering stable after
     removals, which leave gaps in `position`. */
  const last = await prisma.queueItem.findFirst({
    where: { roomId: input.roomId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })

  return prisma.queueItem.create({
    data: { ...input, position: (last?.position ?? -1) + 1 },
    select: queueSelect,
  })
}

export function removeFromQueue(roomId: string, id: string) {
  // Scoped by room so an id from another room can't be used to delete across it.
  return prisma.queueItem.deleteMany({ where: { id, roomId } })
}

export function clearQueue(roomId: string) {
  return prisma.queueItem.deleteMany({ where: { roomId } })
}

/**
 * Rewrite the order from a list of ids.
 *
 * Ids not belonging to the room are dropped rather than trusted, and anything
 * the caller forgot keeps its relative place at the end — a reorder should
 * never silently delete a row.
 */
export async function reorderQueue(roomId: string, ids: string[]) {
  const existing = await prisma.queueItem.findMany({
    where: { roomId },
    orderBy: { position: 'asc' },
    select: { id: true },
  })

  const known = new Set(existing.map((item) => item.id))
  const ordered = ids.filter((id) => known.has(id))
  for (const item of existing) {
    if (!ordered.includes(item.id)) ordered.push(item.id)
  }

  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.queueItem.update({ where: { id }, data: { position: index } }),
    ),
  )

  return listQueue(roomId)
}

export function findQueueItem(roomId: string, id: string) {
  return prisma.queueItem.findFirst({ where: { id, roomId }, select: queueSelect })
}

/** The item after `afterId`, or the first one when nothing is playing. */
export async function nextInQueue(roomId: string, afterId: string | null) {
  const items = await listQueue(roomId)
  if (items.length === 0) return null
  if (!afterId) return items[0] ?? null

  const index = items.findIndex((item) => item.id === afterId)
  if (index === -1) return items[0] ?? null
  return items[index + 1] ?? null
}
