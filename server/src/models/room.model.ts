import { prisma } from './prisma.js'

/** Every query that returns a room pulls its members in this shape. */
export const memberSelect = {
  select: {
    role: true,
    joinedAt: true,
    lastSeen: true,
    user: { select: { id: true, name: true, email: true } },
  },
} as const

export type RoomWithMembers = {
  id: string
  slug: string
  name: string
  type: string
  /** open | private — see ROOM_VISIBILITIES. */
  visibility: string
  createdAt: Date
  ownerId: string
  members: {
    role: string
    joinedAt: Date
    lastSeen: Date
    user: { id: string; name: string; email: string }
  }[]
}

export function createRoom(data: {
  name: string
  type: string
  visibility: string
  slug: string
  ownerId: string
}): Promise<RoomWithMembers> {
  return prisma.room.create({
    data: {
      ...data,
      // The creator is a member from the moment the room exists.
      members: { create: { userId: data.ownerId, role: 'owner' } },
    },
    include: { members: memberSelect },
  })
}

export function findRoomById(id: string): Promise<RoomWithMembers | null> {
  return prisma.room.findUnique({ where: { id }, include: { members: memberSelect } })
}

/** The slug is the room code people share, so joining resolves through it. */
export function findRoomBySlug(slug: string): Promise<RoomWithMembers | null> {
  return prisma.room.findUnique({ where: { slug }, include: { members: memberSelect } })
}

/** Rooms the user belongs to, most recently active first. */
export async function findRoomsForUser(userId: string): Promise<RoomWithMembers[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { lastSeen: 'desc' },
    select: { room: { include: { members: memberSelect } } },
  })
  return memberships.map((membership) => membership.room)
}

/**
 * Every room, for the public directory.
 *
 * Newest first and capped, because this is a browse list rather than a search —
 * an unbounded query here would grow into the slowest request in the app.
 */
/**
 * The rooms a given person may see on Discover.
 *
 * Open rooms, plus any private one they are already in — a room you belong to
 * should not vanish from your own listing because it is unlisted to everyone
 * else. Filtered in the query rather than after it, so a private room's name
 * never leaves the database on a request that had no business seeing it.
 */
export function findDiscoverableRooms(userId: string, limit = 60): Promise<RoomWithMembers[]> {
  return prisma.room.findMany({
    where: {
      OR: [{ visibility: 'open' }, { members: { some: { userId } } }],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { members: memberSelect },
  })
}

export function findMembership(userId: string, roomId: string) {
  return prisma.membership.findUnique({ where: { userId_roomId: { userId, roomId } } })
}

export function joinRoom(userId: string, roomId: string) {
  return prisma.membership.upsert({
    where: { userId_roomId: { userId, roomId } },
    create: { userId, roomId },
    update: { lastSeen: new Date() },
  })
}

export function touchMembership(id: string) {
  return prisma.membership.update({ where: { id }, data: { lastSeen: new Date() } })
}
