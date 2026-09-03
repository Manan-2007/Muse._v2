import type { Server, Socket } from 'socket.io'

import * as queueModel from '../models/queue.model.js'
import { subtitlesForRef } from '../services/publish.service.js'
import { assertMembership } from '../services/room.service.js'
import * as watch from '../services/watch.service.js'
import { socketUser } from './presence.gateway.js'

/**
 * Synchronised playback.
 *
 * Rides the presence socket rather than opening its own: the connection is
 * already authenticated and already joined to the room, and `socket.rooms` is
 * therefore the membership check — you can only drive a room you are standing
 * in, with no extra database round trip per keystroke on a scrubber.
 */

/** Watchers get playback events; everyone else in the room only gets invites. */
const stageRoom = (roomId: string) => `watch:${roomId}`

function toItem(row: {
  id: string
  source: string
  ref: string
  title: string
  duration: number | null
  thumbnail: string | null
}): watch.WatchItem {
  return {
    id: row.id,
    source: row.source as watch.WatchSource,
    ref: row.ref,
    title: row.title,
    duration: row.duration,
    thumbnail: row.thumbnail,
  }
}

/**
 * The same item, plus whatever subtitles were published alongside it.
 *
 * Only the item actually going on screen is enriched — the queue behind it
 * doesn't need its subtitle lists, and looking them all up would read the
 * index once per row for something nobody is reading yet.
 */
async function toItemWithTracks(row: Parameters<typeof toItem>[0]): Promise<watch.WatchItem> {
  const item = toItem(row)
  return { ...item, subtitles: await subtitlesForRef(item.ref) }
}

function roomIdFrom(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as { roomId?: unknown }).roomId
  return typeof value === 'string' ? value : null
}

function numberFrom(raw: unknown, key: string): number | undefined {
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function attachWatchGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    /* The presence gateway stores `userId`; attribution wants a plain actor. */
    const self = { id: state.userId, name: state.name }

    /** Rooms whose stage this socket currently has open. */
    const staged = new Set<string>()
    /** Opens still awaiting their join, so a double-fire can't double-count. */
    const opening = new Set<string>()
    /** A close that arrived while the matching open was still in flight. */
    const closePending = new Set<string>()
    /** Rooms this socket has already proved membership of. */
    const verified = new Set<string>()

    /*
     * Membership is checked against the database, not against `socket.rooms`.
     *
     * The obvious version — "you must already be in the socket.io room" — has a
     * race that shows up constantly in practice: the presence join is async, so
     * a client that walks into a room and immediately opens the stage arrives
     * before its own join has resolved, and every watch event is silently
     * dropped. That is the difference between the stage working and the stage
     * showing nothing, on the same code, depending on how fast you clicked.
     */
    const may = async (roomId: string | null): Promise<boolean> => {
      if (!roomId) return false
      if (verified.has(roomId)) return true
      try {
        await assertMembership(self.id, roomId)
        verified.add(roomId)
        return true
      } catch {
        return false
      }
    }

    const pushState = (roomId: string) => {
      io.to(stageRoom(roomId)).emit('watch:state', watch.snapshot(roomId))
    }

    const pushQueue = async (roomId: string) => {
      const items = await queueModel.listQueue(roomId)
      io.to(roomId).emit('watch:queue', { roomId, items })
    }

    const pushViewers = (roomId: string) => {
      const { viewers } = watch.snapshot(roomId)
      /* The whole room, not just the stage — the hub shows a live badge on the
         Watch button for people who haven't come in yet. */
      io.to(roomId).emit('watch:viewers', { roomId, viewers })
    }

    /*
     * Clock offset.
     *
     * Playback correctness rests on every client agreeing what "now" is, and
     * browser clocks are routinely seconds out. The client pings a few times,
     * halves the round trip, and works from the offset — so a skewed machine
     * corrects against real elapsed time rather than its own wrong wall clock.
     */
    socket.on('watch:ping', (raw: unknown) => {
      const sent = numberFrom(raw ?? {}, 'sent')
      socket.emit('watch:pong', { sent, serverTime: Date.now() })
    })

    const leaveStage = (roomId: string) => {
      if (!staged.has(roomId)) return
      staged.delete(roomId)
      void socket.leave(stageRoom(roomId))
      watch.removeViewer(roomId, socket.id)
      pushViewers(roomId)
      /* Emptying the stage pauses the room, so tell whoever is left. */
      pushState(roomId)
    }

    /*
     * Idempotent, and safe against React mounting the stage twice.
     *
     * StrictMode fires open → close → open, and the `await` in here means those
     * can interleave. Counting the viewer only after the await, behind an
     * in-flight guard, is what stops one person being counted twice and the
     * session never emptying.
     */
    socket.on('watch:open', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || staged.has(roomId) || opening.has(roomId)) return
      if (!(await may(roomId))) return

      opening.add(roomId)
      try {
        await socket.join(stageRoom(roomId))
        staged.add(roomId)
      } finally {
        opening.delete(roomId)
      }

      /* A close raced ahead of us — honour it rather than leaving a ghost. */
      if (closePending.delete(roomId)) {
        leaveStage(roomId)
        return
      }

      const first = watch.addViewer(roomId, socket.id, self.id, self.name) === 1
      /* Only the first person opening it is news. After that the stage is
         already live and the badge in the hub says so. */
      if (first) {
        socket.to(roomId).emit('watch:invite', {
          roomId,
          by: { id: self.id, name: self.name },
        })
      }

      socket.emit('watch:state', watch.apply(roomId, self, { action: 'open' }))
      await pushQueue(roomId)
      pushViewers(roomId)
    })

    socket.on('watch:close', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      if (opening.has(roomId)) {
        closePending.add(roomId)
        return
      }
      leaveStage(roomId)
    })

    /** A late joiner, or a socket that just reconnected, asking where we are. */
    socket.on('watch:sync-request', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return
      socket.emit('watch:state', watch.snapshot(roomId))
      socket.emit('watch:queue', { roomId, items: await queueModel.listQueue(roomId) })
    })

    /**
     * The queue changed over REST.
     *
     * Adding is a plain HTTP call, so without this the person who added
     * something is the only one who sees it — everyone else's panel stays
     * stale until they reopen the stage.
     */
    socket.on('watch:queue-sync', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return
      await pushQueue(roomId)
    })

    socket.on('watch:control', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const body = (raw ?? {}) as Record<string, unknown>
      const action = body.action

      let control: watch.WatchControl | null = null
      switch (action) {
        case 'play':
          control = { action: 'play', position: numberFrom(body, 'position') }
          break
        case 'pause':
          control = { action: 'pause', position: numberFrom(body, 'position') }
          break
        case 'seek': {
          const position = numberFrom(body, 'position')
          if (position === undefined) return
          control = { action: 'seek', position }
          break
        }
        case 'rate': {
          const rate = numberFrom(body, 'rate')
          if (rate === undefined) return
          control = { action: 'rate', rate }
          break
        }
        default:
          return
      }

      io.to(stageRoom(roomId)).emit('watch:state', watch.apply(roomId, self, control))
    })

    /** Put a specific queue item on, now. */
    socket.on('watch:load', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const itemId = (raw as { itemId?: unknown }).itemId
      if (typeof itemId !== 'string') return

      const row = await queueModel.findQueueItem(roomId, itemId)
      if (!row) return

      io.to(stageRoom(roomId)).emit(
        'watch:state',
        watch.apply(roomId, self, { action: 'load', item: await toItemWithTracks(row) }),
      )
    })

    /**
     * The current item finished.
     *
     * Every client's player fires this at roughly the same moment, so advancing
     * is a request, not a decision — the first one in wins and the rest are
     * dropped by the sequence guard, which is what stops five clients each
     * skipping the queue forward by one.
     */
    socket.on('watch:ended', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const seq = numberFrom((raw ?? {}) as Record<string, unknown>, 'seq')
      const current = watch.snapshot(roomId)
      if (seq !== undefined && seq !== current.seq) return
      if (!current.item) return

      const next = await queueModel.nextInQueue(roomId, current.item.id)
      io.to(stageRoom(roomId)).emit(
        'watch:state',
        watch.apply(roomId, self, {
          action: 'advance',
          item: next ? await toItemWithTracks(next) : null,
        }),
      )
    })

    socket.on('disconnecting', () => {
      /* Swept by socket id across every room, not just the ones this
         connection thinks it staged — a close that never landed would
         otherwise leave a phantom viewer holding the room open forever. */
      for (const roomId of watch.dropSocket(socket.id)) {
        const state = watch.snapshot(roomId)
        io.to(roomId).emit('watch:viewers', { roomId, viewers: state.viewers })
        io.to(stageRoom(roomId)).emit('watch:state', state)
      }
      staged.clear()
    })
  })
}
