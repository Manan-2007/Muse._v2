import { io, type Socket } from 'socket.io-client'

import { API_BASE, getToken } from '@/lib/config'

let socket: Socket | null = null

/**
 * One socket for the whole tab, opened lazily.
 *
 * Socket.IO multiplexes rooms and events over a single connection, so presence
 * and watch share this rather than opening one each — and because they share
 * it, the server can treat "joined to the room" as the permission for both.
 *
 * The handshake carries the session cookie automatically when same-origin. It
 * also carries the bearer token, because cross-origin that cookie is
 * third-party and may be dropped before it ever reaches the server.
 */
export function getSocket() {
  if (!socket) {
    const options = {
      path: '/socket.io',
      withCredentials: true,
      auth: { token: getToken() ?? undefined },
      /*
       * WebSocket only, no HTTP long-polling fallback.
       *
       * Socket.IO normally starts on polling and upgrades. Through an ngrok
       * free tunnel those polling requests collect the browser-warning HTML
       * page instead of a handshake, so the connection never establishes.
       * WebSocket bypasses that path entirely.
       */
      transports: ['websocket'] as string[],
    }
    socket = API_BASE ? io(API_BASE, { ...options }) : io({ ...options })
  }
  return socket
}

/**
 * Drop the connection so the next one re-handshakes.
 *
 * Signing in or out changes who the socket is, and Socket.IO only reads `auth`
 * when it connects — without this a fresh session would keep talking over the
 * previous user's authenticated connection.
 */
export function resetSocket() {
  socket?.disconnect()
  socket = null
}
