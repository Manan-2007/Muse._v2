import type { Server, Socket } from 'socket.io'

import * as messageModel from '../models/message.model.js'
import { socketUser } from './presence.gateway.js'
import { roomGuard } from './roomAuth.js'

/**
 * Room chat.
 *
 * Persisted, unlike presence or playback position: people expect to scroll back
 * through a conversation, and a message that vanishes on refresh is a bug
 * rather than a design choice.
 */

const MAX_LENGTH = 2000
/** Typing flags expire on their own, so a dropped socket can't leave one stuck. */
const TYPING_TTL_MS = 4000

export function attachChatGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self = { id: state.userId, name: state.name }
    const may = roomGuard(socket, self.id)
    const typingTimers = new Map<string, NodeJS.Timeout>()

    socket.on('chat:history', async (raw: unknown) => {
      const roomId = await may((raw as { roomId?: unknown })?.roomId)
      if (!roomId) return
      socket.emit('chat:history', {
        roomId,
        messages: await messageModel.recentMessages(roomId),
      })
    })

    socket.on('chat:send', async (raw: unknown) => {
      const body = (raw ?? {}) as { roomId?: unknown; body?: unknown }
      const roomId = await may(body.roomId)
      if (!roomId) return

      const text = typeof body.body === 'string' ? body.body.trim() : ''
      if (!text || text.length > MAX_LENGTH) return

      const message = await messageModel.createMessage({
        roomId,
        authorId: self.id,
        body: text,
      })

      /* Sending implies you stopped typing — otherwise your own indicator
         lingers on everyone else's screen until it times out. */
      io.to(roomId).emit('chat:typing', { roomId, user: self, typing: false })
      io.to(roomId).emit('chat:message', { roomId, message })
    })

    socket.on('chat:typing', async (raw: unknown) => {
      const body = (raw ?? {}) as { roomId?: unknown; typing?: unknown }
      const roomId = await may(body.roomId)
      if (!roomId) return

      const typing = body.typing === true
      socket.to(roomId).emit('chat:typing', { roomId, user: self, typing })

      clearTimeout(typingTimers.get(roomId))
      if (typing) {
        typingTimers.set(
          roomId,
          setTimeout(() => {
            socket.to(roomId).emit('chat:typing', { roomId, user: self, typing: false })
            typingTimers.delete(roomId)
          }, TYPING_TTL_MS),
        )
      }
    })

    socket.on('disconnecting', () => {
      for (const [roomId, timer] of typingTimers) {
        clearTimeout(timer)
        socket.to(roomId).emit('chat:typing', { roomId, user: self, typing: false })
      }
      typingTimers.clear()
    })
  })
}
