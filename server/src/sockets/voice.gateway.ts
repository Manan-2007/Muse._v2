import type { Server, Socket } from 'socket.io'

import { socketUser } from './presence.gateway.js'
import { roomGuard } from './roomAuth.js'

/**
 * The hub's quick, always-easy voice — relayed through this server rather than
 * peer-to-peer.
 *
 * Deliberately not WebRTC. A mesh call needs the two browsers to actually
 * reach each other, which across different networks means a TURN relay — and
 * that relay is a paid, metered resource meant for the deliberate "Chat &
 * call" panel, not something an ambient always-on button should spend on
 * every toggle. A server relay sidesteps NAT traversal entirely: both ends
 * already have a working connection to *this* server, the same one presence
 * and chat ride, so there is nothing to negotiate. The cost is bandwidth
 * (raw PCM, not compressed Opus) and no P2P shortcut when two people happen
 * to share a network — an acceptable trade for a feature meant to be simple
 * and free to use, not maximally efficient.
 *
 * This file only ever forwards opaque binary frames. It has no idea what's in
 * them — encoding is entirely the client's concern.
 */

const voiceRoom = (roomId: string) => `voice:${roomId}`

function roomIdFrom(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as { roomId?: unknown }).roomId
  return typeof value === 'string' ? value : null
}

export function attachVoiceGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self = { id: state.userId, name: state.name }
    const may = roomGuard(socket, self.id)
    const joined = new Set<string>()

    socket.on('voice:join', async (raw: unknown) => {
      const roomId = await may(roomIdFrom(raw))
      if (!roomId || joined.has(roomId)) return

      joined.add(roomId)
      await socket.join(voiceRoom(roomId))
    })

    const leave = (roomId: string) => {
      if (!joined.delete(roomId)) return
      void socket.leave(voiceRoom(roomId))
    }

    socket.on('voice:leave', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (roomId) leave(roomId)
    })

    /*
     * The relay itself: one small binary frame in, forwarded to everyone else
     * already on the voice channel for that room. `from` lets each recipient
     * route the frame to the right per-peer playback buffer without the
     * server needing to know anything about audio.
     */
    socket.on('voice:chunk', (raw: unknown) => {
      const body = raw as { roomId?: unknown; chunk?: unknown } | undefined
      const roomId = body?.roomId
      if (typeof roomId !== 'string' || !joined.has(roomId)) return

      /*
       * Not `instanceof ArrayBuffer`.
       *
       * A browser sending binary over Socket.IO always reconstructs it as an
       * ArrayBuffer on receipt — but this server is Node, and Node's side of
       * the protocol reconstructs the identical bytes as a `Buffer` instead.
       * `Buffer instanceof ArrayBuffer` is false, so that check silently
       * dropped every real chunk before it ever reached `.emit()`. Accepting
       * any binary-ish view and relaying it as-is works regardless of which
       * runtime is on either end — Socket.IO re-encodes it correctly for
       * whatever the *next* hop happens to be.
       */
      const chunk = body?.chunk
      const isBinary =
        chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk as ArrayBufferView)
      if (!isBinary) return

      socket.to(voiceRoom(roomId)).emit('voice:chunk', {
        roomId,
        from: self.id,
        chunk,
      })
    })

    socket.on('disconnecting', () => {
      for (const roomId of [...joined]) leave(roomId)
    })
  })
}
