import * as cookie from 'cookie'
import { Server, type Socket } from 'socket.io'
import type { Server as HttpServer } from 'node:http'

import { SESSION_COOKIE, env } from '../config/env.js'
import * as userModel from '../models/user.model.js'
import {
  addPresence,
  dropSocket,
  presenceFor,
  removePresence,
  setCharacter,
} from '../services/presence.service.js'
import { assertMembership } from '../services/room.service.js'
import { readSession, tokenFrom } from '../services/token.service.js'

type SocketState = { userId: string; name: string; joined: Set<string> }
const state = new WeakMap<Socket, SocketState>()

/**
 * The authenticated user behind a socket.
 *
 * Exported so other gateways can register their own handlers on the same
 * connection without repeating the handshake — the auth middleware here runs
 * before any `connection` listener, so this is populated by the time they see
 * the socket.
 */
export function socketUser(socket: Socket) {
  return state.get(socket)
}

function roomIdFrom(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as { roomId?: unknown }).roomId
  return typeof value === 'string' ? value : null
}

/* Namespaced so a watch channel can never collide with a real room id. */
const WATCH_PREFIX = 'watch:'
const watchChannel = (roomId: string) => `${WATCH_PREFIX}${roomId}`

function characterIdFrom(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = (raw as { characterId?: unknown }).characterId
  return typeof value === 'string' && value.length <= 80 ? value : undefined
}

/** Real-time presence. Who is in a room, updated the moment it changes. */
export function attachPresenceGateway(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    serveClient: false,
    /* Same-origin in dev through the Vite proxy; a split deployment needs the
       frontend's origin named explicitly, same as the REST API. */
    cors: { origin: env.clientOrigins, credentials: true },
  })

  /*
   * The handshake carries the same httpOnly session cookie as the REST API,
   * so there is no second auth mechanism to keep in step.
   */
  io.use(async (socket, next) => {
    /*
     * Cookie first, then the handshake token.
     *
     * Cross-origin the cookie may never arrive — Safari drops third-party
     * cookies — so the client also hands the token to `io({ auth })`, and that
     * is what keeps the socket authenticating when the REST calls are using a
     * bearer header.
     */
    const header = socket.handshake.headers.cookie
    const fromCookie = header ? cookie.parse(header)[SESSION_COOKIE] : undefined
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token
    const token =
      fromCookie ??
      (typeof fromAuth === 'string' ? fromAuth : undefined) ??
      tokenFrom({ headers: socket.handshake.headers as Record<string, unknown> })

    const userId = readSession(token)
    if (!userId) return next(new Error('Not signed in'))

    const user = await userModel.findById(userId)
    if (!user) return next(new Error('Not signed in'))

    state.set(socket, { userId: user.id, name: user.name, joined: new Set() })
    next()
  })

  io.on('connection', (socket) => {
    const self = state.get(socket)!

    /*
     * To the people standing in the room, and to anyone merely watching it.
     *
     * `to().to()` unions the two and socket.io de-duplicates, so a socket in
     * both — which is every member who has the room open — still receives one
     * copy.
     */
    const broadcast = (roomId: string) => {
      const present = presenceFor(roomId)
      io.to(roomId).to(watchChannel(roomId)).emit('presence:update', { roomId, present })
    }

    /*
     * Join and leave are *intents*, reconciled toward a desired state.
     *
     * They cannot be handled as immediate commands, because the membership
     * check is async and React fires join → leave → join on mount. Handling
     * each in isolation loses whichever one lands mid-flight: guarding drops
     * the final join, not guarding double-registers. Recording what the client
     * last asked for and converging on it is the only version that ends in the
     * right place regardless of ordering or how many arrive at once.
     */
    const desired = new Map<string, boolean>()
    const settling = new Set<string>()
    /** Last character this socket reported, replayed on (re)join. */
    let character: string | undefined

    const reconcile = async (roomId: string) => {
      if (settling.has(roomId)) return
      settling.add(roomId)

      try {
        /* Loops because the desired state can change while we await below;
           each pass re-reads it, so the last intent is the one that sticks. */
        for (;;) {
          const want = desired.get(roomId) ?? false
          const have = self.joined.has(roomId)
          if (want === have) return

          if (!want) {
            self.joined.delete(roomId)
            socket.leave(roomId)
            removePresence(roomId, socket.id)
            broadcast(roomId)
            continue
          }

          try {
            // Presence is membership-gated, exactly like the REST route.
            await assertMembership(self.userId, roomId)
          } catch {
            socket.emit('room:error', { roomId, error: 'You are not in this room' })
            desired.set(roomId, false)
            return
          }

          // They may have left while that was in flight.
          if (!(desired.get(roomId) ?? false)) continue

          self.joined.add(roomId)
          socket.join(roomId)
          addPresence(roomId, socket.id, self.userId, self.name, character)
          broadcast(roomId)
        }
      } finally {
        settling.delete(roomId)
      }
    }

    socket.on('room:join', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      /* Carried on the join so a late arrival is drawn correctly the first
         time, rather than popping from a fallback to their real character. */
      character = characterIdFrom(raw) ?? character
      desired.set(roomId, true)
      void reconcile(roomId)
    })

    /*
     * Watching a room without being in it.
     *
     * The room list needs live counts for every room you belong to, and the
     * obvious way to get them — joining them all — is exactly wrong: the join
     * is what puts you in the presence map, so anyone with the dashboard open
     * would appear to be standing in every room at once.
     *
     * So this subscribes to the updates and nothing else. No `addPresence`,
     * which means a watcher is counted by nobody, including themselves.
     * Membership is still required: the counts are a fact about a room you
     * belong to, not a public one.
     */
    socket.on('presence:watch', (raw: unknown) => {
      const ids = (raw as { roomIds?: unknown })?.roomIds
      if (!Array.isArray(ids)) return

      void (async () => {
        /* Leave whatever was being watched before, so a stale list does not
           keep delivering updates for rooms this socket has moved on from. */
        for (const room of socket.rooms) {
          if (room.startsWith(WATCH_PREFIX)) socket.leave(room)
        }

        for (const value of ids.slice(0, 60)) {
          if (typeof value !== 'string') continue
          try {
            await assertMembership(self.userId, value)
          } catch {
            continue
          }
          socket.join(watchChannel(value))
          /* Answer immediately rather than waiting for the next change —
             otherwise a room that nobody touches reads as empty until
             somebody happens to move. */
          socket.emit('presence:update', { roomId: value, present: presenceFor(value) })
        }
      })()
    })

    socket.on('presence:character', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return

      /*
       * An absent id means "I don't know yet", never "take my character away".
       *
       * The client computes this from the signed-in user, so it is briefly
       * undefined on a remount or while the session is re-fetched. Writing
       * that through replaced a character somebody had chosen with nothing at
       * all, and because every other client falls back to an id-derived
       * character when presence carries none, the room would suddenly draw
       * them as someone else entirely — the wrong avatar, on everyone else's
       * screen but their own, until they changed it again.
       *
       * There is no way to be wearing no character, so there is nothing this
       * could legitimately be clearing.
       */
      const announced = characterIdFrom(raw)
      if (!announced) return

      character = announced
      if (setCharacter(roomId, socket.id, character)) broadcast(roomId)
    })

    socket.on('room:leave', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      desired.set(roomId, false)
      void reconcile(roomId)
    })

    socket.on('disconnect', () => {
      /* Swept by socket id rather than by what this connection *believed* it
         had joined, so a room it never finished leaving still gets cleaned. */
      for (const roomId of dropSocket(socket.id)) broadcast(roomId)
      self.joined.clear()
    })
  })

  return io
}
