import type { RoomType, RoomVisibility } from '../config/env.js'
import * as roomModel from '../models/room.model.js'
import type { RoomWithMembers } from '../models/room.model.js'
import { HttpError } from '../utils/HttpError.js'
import { slugify } from '../utils/slug.js'
import { presenceFor } from './presence.service.js'

/** Database row → the shape the client consumes, with live presence folded in. */
export function serialiseRoom(room: RoomWithMembers) {
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    type: room.type,
    visibility: room.visibility,
    createdAt: room.createdAt,
    ownerId: room.ownerId,
    members: room.members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      role: member.role,
      joinedAt: member.joinedAt,
      lastSeen: member.lastSeen,
    })),
    /** Ids of members with a socket open, from the presence map not the DB. */
    online: presenceFor(room.id).map((present) => present.userId),
  }
}

export async function listRooms(userId: string) {
  const rooms = await roomModel.findRoomsForUser(userId)
  return rooms.map(serialiseRoom)
}

/**
 * Rooms anyone signed in can walk into.
 *
 * Deliberately does not leak the member list — only counts. Knowing a room
 * exists and how busy it is, is all the directory needs; who is inside is for
 * people who have actually joined.
 */
export async function discoverRooms(userId: string) {
  const rooms = await roomModel.findDiscoverableRooms(userId)

  return rooms.map((room) => ({
    id: room.id,
    slug: room.slug,
    name: room.name,
    type: room.type,
    visibility: room.visibility,
    createdAt: room.createdAt,
    memberCount: room.members.length,
    onlineCount: presenceFor(room.id).length,
    joined: room.members.some((member) => member.user.id === userId),
  }))
}

export async function createRoom(
  userId: string,
  input: { name: string; type: RoomType; visibility: RoomVisibility },
) {
  const room = await roomModel.createRoom({
    name: input.name,
    type: input.type,
    visibility: input.visibility,
    slug: slugify(input.name),
    ownerId: userId,
  })
  return serialiseRoom(room)
}

export async function getRoom(userId: string, roomId: string) {
  const room = await roomModel.findRoomById(roomId)
  if (!room) throw HttpError.notFound('Room not found')

  // Membership is the read permission — don't leak who else is in a room.
  const isMember = room.members.some((member) => member.user.id === userId)
  if (!isMember) throw HttpError.forbidden('You are not in this room')

  return serialiseRoom(room)
}

/**
 * Walk into a room found on Discover.
 *
 * Gated on the room being open, which it previously was not: any signed-in
 * person holding an id could join anything, and ids are handed out by the
 * discover listing itself. A private room is reachable only through its code,
 * where holding the code is the permission.
 *
 * Reported as "not found" rather than "forbidden" on purpose — the id of a
 * private room should not be confirmable by probing this route.
 */
export async function joinRoom(userId: string, roomId: string) {
  const room = await roomModel.findRoomById(roomId)
  if (!room) throw HttpError.notFound('Room not found')

  const isMember = room.members.some((member) => member.user.id === userId)
  if (room.visibility !== 'open' && !isMember) throw HttpError.notFound('Room not found')

  await roomModel.joinRoom(userId, roomId)

  const updated = await roomModel.findRoomById(roomId)
  return serialiseRoom(updated!)
}

/**
 * Join by the code people actually pass around — the slug, not the internal id.
 *
 * Deliberately not membership-gated: this *is* how you become a member. Holding
 * the code is the permission, which is the same model as an invite link.
 */
export async function joinRoomByCode(userId: string, code: string) {
  const slug = code.trim().toLowerCase()
  const room = await roomModel.findRoomBySlug(slug)
  if (!room) throw HttpError.notFound('No room with that code')

  await roomModel.joinRoom(userId, room.id)

  const updated = await roomModel.findRoomById(room.id)
  return serialiseRoom(updated!)
}

/** Used by the socket gateway to gate presence on membership. */
export async function assertMembership(userId: string, roomId: string) {
  const membership = await roomModel.findMembership(userId, roomId)
  if (!membership) throw HttpError.forbidden('You are not in this room')
  await roomModel.touchMembership(membership.id)
  return membership
}
