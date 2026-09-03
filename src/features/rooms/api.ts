import { api } from '@/lib/api'

export type RoomMember = {
  id: string
  name: string
  role: string
  joinedAt: string
  lastSeen: string
}

export type RoomVisibility = 'open' | 'private'

export type Room = {
  id: string
  slug: string
  name: string
  type: string
  /** `open` is listed on Discover; `private` is reachable only by its code. */
  visibility: RoomVisibility
  createdAt: string
  ownerId: string
  members: RoomMember[]
  /** Member ids with a socket open right now. */
  online: string[]
}

export function fetchRooms() {
  return api.get<{ rooms: Room[] }>('/rooms').then((r) => r.rooms)
}

export function createRoom(input: { name: string; type: string; visibility: RoomVisibility }) {
  return api.post<{ room: Room }>('/rooms', input).then((r) => r.room)
}

export function fetchRoom(id: string) {
  return api.get<{ room: Room }>(`/rooms/${id}`).then((r) => r.room)
}

export type DiscoverableRoom = {
  id: string
  slug: string
  name: string
  type: string
  visibility: RoomVisibility
  createdAt: string
  memberCount: number
  onlineCount: number
  joined: boolean
}

/** Rooms anyone signed in can walk into, without needing a code. */
export function fetchDiscoverable() {
  return api.get<{ rooms: DiscoverableRoom[] }>('/rooms/discover').then((r) => r.rooms)
}

/** Join by the shared room code (the slug), not the internal id. */
export function joinRoomByCode(code: string) {
  return api.post<{ room: Room }>('/rooms/join', { code }).then((r) => r.room)
}
