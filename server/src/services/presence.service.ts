export type Present = {
  userId: string
  name: string
  /**
   * Which character they are wearing.
   *
   * Travels with presence rather than living in the database, because it is
   * only meaningful alongside "is here" — and carrying it here means everyone
   * sees the same person the moment they change, with no fetch and nothing to
   * invalidate. The backdrop deliberately does *not* come along: that one is
   * private to each viewer.
   */
  characterId?: string
}

/**
 * Who is in which room, right now.
 *
 * Deliberately in memory: presence is only true while a socket is open, so it
 * has no meaning across a restart, and writing it to SQLite would leave ghosts
 * behind after a crash. The tradeoff is that it doesn't survive running more
 * than one server process — that's the point at which this moves to Redis.
 *
 * roomId → socketId → who.
 *
 * Keyed by **socket**, not by user with a reference count. A counter has to be
 * incremented and decremented exactly once, and it cannot be: the join handler
 * awaits a membership check, so a leave arriving mid-flight is a no-op and the
 * retried join increments a second time. The count then never falls back to
 * zero and the person is stuck in the room forever. A socket id is idempotent —
 * registering it twice is the same as registering it once — which removes the
 * failure mode instead of trying to sequence around it.
 *
 * One person in two tabs is two sockets and still one entry in the result,
 * because the read collapses by user.
 */
const rooms = new Map<string, Map<string, Present>>()

export function presenceFor(roomId: string): Present[] {
  const room = rooms.get(roomId)
  if (!room) return []

  const byUser = new Map<string, Present>()
  for (const person of room.values()) byUser.set(person.userId, person)
  return [...byUser.values()]
}

export function addPresence(
  roomId: string,
  socketId: string,
  userId: string,
  name: string,
  characterId?: string,
) {
  let room = rooms.get(roomId)
  if (!room) {
    room = new Map()
    rooms.set(roomId, room)
  }
  room.set(socketId, { userId, name, characterId })
}

/** Someone changed character while standing in the room. */
export function setCharacter(roomId: string, socketId: string, characterId?: string) {
  const entry = rooms.get(roomId)?.get(socketId)
  if (!entry) return false
  entry.characterId = characterId
  return true
}

export function removePresence(roomId: string, socketId: string) {
  const room = rooms.get(roomId)
  if (!room) return

  room.delete(socketId)
  if (room.size === 0) rooms.delete(roomId)
}

/**
 * Forget a socket everywhere.
 *
 * The disconnect safety net: whatever the socket believed it had joined, this
 * guarantees nothing of it is left behind in any room.
 */
export function dropSocket(socketId: string): string[] {
  const touched: string[] = []

  for (const [roomId, room] of rooms) {
    if (room.delete(socketId)) {
      touched.push(roomId)
      if (room.size === 0) rooms.delete(roomId)
    }
  }

  return touched
}
