import type { Socket } from 'socket.io'

import { assertMembership } from '../services/room.service.js'

/**
 * "Is this socket allowed to act in this room?"
 *
 * Checked against the database rather than against `socket.rooms`, and cached
 * per socket. The membership set is the durable truth; `socket.rooms` only
 * reflects whether an async join has landed yet, and gating on it produces
 * failures that depend purely on how fast the user clicked.
 */
export function roomGuard(socket: Socket, userId: string) {
  const verified = new Set<string>()

  return async function may(roomId: unknown): Promise<string | null> {
    if (typeof roomId !== 'string' || !roomId) return null
    if (verified.has(roomId)) return roomId
    try {
      await assertMembership(userId, roomId)
      verified.add(roomId)
      return roomId
    } catch {
      return null
    }
  }
}
