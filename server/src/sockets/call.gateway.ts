import type { Server, Socket } from 'socket.io'

import { socketUser } from './presence.gateway.js'
import { roomGuard } from './roomAuth.js'

/**
 * Signalling for the mesh call.
 *
 * The server never touches media. It introduces peers to each other and relays
 * the SDP and ICE they exchange; the audio and video go directly between
 * browsers. That is what "mesh" means here, and it is why this file is small —
 * the alternative, an SFU, would mean running a media server.
 *
 * Mesh cost grows with the square of the room: every participant holds a
 * connection to every other. Fine for the handful of people a room is designed
 * for, which is why `MAX_PEERS` is a real limit rather than a formality.
 */

const MAX_PEERS = 8

const callRoom = (roomId: string) => `call:${roomId}`

type Peer = { socketId: string; userId: string; name: string; muted: boolean; cameraOff: boolean }

/** roomId → socketId → peer. Keyed by socket, because two tabs are two peers. */
const calls = new Map<string, Map<string, Peer>>()

/**
 * The peers actually still connected, pruning any that are not.
 *
 * The roster is maintained by explicit join/leave events, and those can be
 * missed — a tab killed without a clean close, a socket dropped mid-handler.
 * A stale entry is worse than a missing one here, because it inflates the
 * badge and, at the limit, can wedge a room at "call full" with nobody in it.
 * Reconciling against the live socket set makes the count self-healing.
 */
function peersIn(io: Server, roomId: string) {
  const peers = calls.get(roomId)
  if (!peers) return []

  for (const socketId of [...peers.keys()]) {
    if (!io.sockets.sockets.has(socketId)) peers.delete(socketId)
  }
  if (peers.size === 0) calls.delete(roomId)

  return [...peers.values()]
}

export function attachCallGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self = { id: state.userId, name: state.name }
    const may = roomGuard(socket, self.id)
    const joined = new Set<string>()

    const roster = (roomId: string) => {
      io.to(callRoom(roomId)).emit('call:roster', { roomId, peers: peersIn(io, roomId) })
      /* The whole room, not just the call — the panel badges how many are on a
         call you have not joined. */
      io.to(roomId).emit('call:count', { roomId, count: peersIn(io, roomId).length })
    }

    socket.on('call:join', async (raw: unknown) => {
      const roomId = await may((raw as { roomId?: unknown })?.roomId)
      if (!roomId || joined.has(roomId)) return

      /* Prune first, so a room can never be wedged at "full" by peers that
         are no longer connected. */
      const existing = peersIn(io, roomId)
      if (existing.length >= MAX_PEERS) {
        socket.emit('call:full', { roomId, limit: MAX_PEERS })
        return
      }

      /* Existing peers go to the joiner *before* anyone is told about them, so
         the joiner has somewhere to put the offers that are about to arrive. */
      socket.emit('call:peers', { roomId, peers: existing })

      /* Re-read: pruning an empty room drops the map entry entirely. */
      let peers = calls.get(roomId)
      if (!peers) {
        peers = new Map()
        calls.set(roomId, peers)
      }

      peers.set(socket.id, {
        socketId: socket.id,
        userId: self.id,
        name: self.name,
        muted: false,
        cameraOff: false,
      })
      joined.add(roomId)
      await socket.join(callRoom(roomId))

      socket.to(callRoom(roomId)).emit('call:peer-joined', {
        roomId,
        peer: peers.get(socket.id),
      })

      /*
       * Starting a call is news to the room, not just to the call.
       *
       * Without this, one person presses Start and everyone else sees nothing
       * — the call is technically working and looks completely broken, because
       * nobody was told there was something to join.
       */
      if (existing.length === 0) {
        socket.to(roomId).emit('call:started', {
          roomId,
          by: { id: self.id, name: self.name },
        })
      }

      roster(roomId)
    })

    /** Opaque relay: SDP and ICE mean nothing to the server. */
    socket.on('call:signal', async (raw: unknown) => {
      const body = (raw ?? {}) as { roomId?: unknown; to?: unknown; data?: unknown }
      const roomId = await may(body.roomId)
      if (!roomId || typeof body.to !== 'string') return
      /* Only relay between peers actually in this call, so a socket can't use
         the server to reach an arbitrary other socket. */
      if (!calls.get(roomId)?.has(socket.id) || !calls.get(roomId)?.has(body.to)) return

      io.to(body.to).emit('call:signal', { roomId, from: socket.id, data: body.data })
    })

    socket.on('call:state', async (raw: unknown) => {
      const body = (raw ?? {}) as { roomId?: unknown; muted?: unknown; cameraOff?: unknown }
      const roomId = await may(body.roomId)
      if (!roomId) return

      const peer = calls.get(roomId)?.get(socket.id)
      if (!peer) return

      peer.muted = body.muted === true
      peer.cameraOff = body.cameraOff === true
      roster(roomId)
    })

    const leave = (roomId: string) => {
      if (!joined.has(roomId)) return
      joined.delete(roomId)

      const peers = calls.get(roomId)
      peers?.delete(socket.id)
      if (peers && peers.size === 0) calls.delete(roomId)

      void socket.leave(callRoom(roomId))
      io.to(callRoom(roomId)).emit('call:peer-left', { roomId, socketId: socket.id })
      roster(roomId)
    }

    socket.on('call:leave', async (raw: unknown) => {
      const roomId = (raw as { roomId?: unknown })?.roomId
      if (typeof roomId === 'string') leave(roomId)
    })

    socket.on('disconnecting', () => {
      for (const roomId of [...joined]) leave(roomId)
    })
  })
}
