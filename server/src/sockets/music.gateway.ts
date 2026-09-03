import type { Server, Socket } from 'socket.io'

import * as trackModel from '../models/track.model.js'
import * as music from '../services/music.service.js'
import { assertMembership } from '../services/room.service.js'
import { socketUser } from './presence.gateway.js'

/**
 * Synchronised listening, and the singalong on top of it.
 *
 * Rides the presence socket like every other gateway. Two separate things live
 * here because they are two halves of one feature: the room agreeing on where
 * the song is, and the room hearing each other sing over it.
 *
 * The voices themselves never touch this server. Singalong is peer-to-peer,
 * so all that passes through here is the offer/answer/candidate handshake and
 * the fact of who has a microphone open — the audio goes directly between
 * browsers, which is what keeps it as close to live as the network allows.
 */

const stageRoom = (roomId: string) => `music:${roomId}`

function toTrack(row: {
  id: string
  source: string
  ref: string
  title: string
  artist: string | null
  album: string | null
  artwork: string | null
  duration: number | null
}): music.Track {
  return {
    id: row.id,
    source: row.source as music.MusicSource,
    ref: row.ref,
    title: row.title,
    artist: row.artist,
    album: row.album,
    artwork: row.artwork,
    duration: row.duration,
  }
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

export function attachMusicGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self = { id: state.userId, name: state.name }

    const staged = new Set<string>()
    const opening = new Set<string>()
    const closePending = new Set<string>()
    const verified = new Set<string>()

    /* Checked against the database, not `socket.rooms` — the presence join is
       async, so a client that walks in and immediately opens the page would
       otherwise have every event silently dropped. */
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
      io.to(stageRoom(roomId)).emit('music:state', music.snapshot(roomId))
    }

    const pushQueue = async (roomId: string) => {
      io.to(roomId).emit('music:queue', { roomId, items: await trackModel.listTracks(roomId) })
    }

    const pushListeners = (roomId: string) => {
      const { listeners } = music.snapshot(roomId)
      /* The whole room, not just the page — the hub shows a live badge on the
         Listen button for people who haven't come in yet. */
      io.to(roomId).emit('music:listeners', { roomId, listeners })
    }

    socket.on('music:ping', (raw: unknown) => {
      const sent = numberFrom(raw ?? {}, 'sent')
      socket.emit('music:pong', { sent, serverTime: Date.now() })
    })

    const leaveStage = (roomId: string) => {
      if (!staged.has(roomId)) return
      staged.delete(roomId)
      void socket.leave(stageRoom(roomId))
      music.removeListener(roomId, socket.id)
      /* Tell the room the microphone is gone as well as the person. */
      socket.to(stageRoom(roomId)).emit('music:singalong-left', { roomId, socketId: socket.id })
      pushListeners(roomId)
      pushState(roomId)
    }

    socket.on('music:open', async (raw: unknown) => {
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

      /* A close raced ahead of the join — honour it rather than leave a ghost. */
      if (closePending.delete(roomId)) {
        leaveStage(roomId)
        return
      }

      const first = music.addListener(roomId, socket.id, self.id, self.name) === 1
      if (first) {
        socket.to(roomId).emit('music:invite', { roomId, by: { id: self.id, name: self.name } })
      }

      socket.emit('music:state', music.apply(roomId, self, { action: 'open' }))
      await pushQueue(roomId)
      pushListeners(roomId)
    })

    socket.on('music:close', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      if (opening.has(roomId)) {
        closePending.add(roomId)
        return
      }
      leaveStage(roomId)
    })

    socket.on('music:sync-request', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return
      socket.emit('music:state', music.snapshot(roomId))
      socket.emit('music:queue', { roomId, items: await trackModel.listTracks(roomId) })
    })

    /** The queue changed over REST; everyone else only learns of it here. */
    socket.on('music:queue-sync', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return
      await pushQueue(roomId)
    })

    socket.on('music:control', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const body = (raw ?? {}) as Record<string, unknown>

      let control: music.MusicControl | null = null
      switch (body.action) {
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
        default:
          return
      }

      io.to(stageRoom(roomId)).emit('music:state', music.apply(roomId, self, control))
    })

    /** Put a specific track on, now. */
    socket.on('music:load', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const trackId = (raw as { trackId?: unknown }).trackId
      if (typeof trackId !== 'string') return

      const row = await trackModel.findTrack(roomId, trackId)
      if (!row) return

      io.to(stageRoom(roomId)).emit(
        'music:state',
        music.apply(roomId, self, { action: 'load', track: toTrack(row) }),
      )
    })

    /**
     * A duration the client discovered on load.
     *
     * Only the browser that decoded the file knows how long it is, and without
     * it the scrubber has no scale and the queue shows no running time. Stored
     * once, then it is known for everyone.
     */
    socket.on('music:duration', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const body = (raw ?? {}) as Record<string, unknown>
      const trackId = body.trackId
      const duration = numberFrom(body, 'duration')
      if (typeof trackId !== 'string' || duration === undefined || duration <= 0) return

      music.noteDuration(roomId, trackId, Math.round(duration))
      await trackModel.setTrackDuration(roomId, trackId, Math.round(duration))
      await pushQueue(roomId)
    })

    /** Step through the queue. `seq` stamps which track it was, so five clients
        firing at the end of a song still only advance once. */
    const step = async (raw: unknown, direction: 'next' | 'previous') => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const seq = numberFrom((raw ?? {}) as Record<string, unknown>, 'seq')
      const current = music.snapshot(roomId)
      if (seq !== undefined && seq !== current.seq) return

      const row =
        direction === 'next'
          ? await trackModel.nextTrack(roomId, current.track?.id ?? null)
          : await trackModel.previousTrack(roomId, current.track?.id ?? null)

      /* Running off the end stops the room rather than looping it. */
      io.to(stageRoom(roomId)).emit(
        'music:state',
        music.apply(roomId, self, { action: 'advance', track: row ? toTrack(row) : null }),
      )
    }

    socket.on('music:ended', (raw: unknown) => void step(raw, 'next'))
    socket.on('music:next', (raw: unknown) => void step(raw, 'next'))
    socket.on('music:previous', (raw: unknown) => void step(raw, 'previous'))

    /*
     * Singalong.
     *
     * Announcing a microphone is what starts the mesh: everyone already
     * singing is told to offer a connection to the newcomer, and the audio
     * itself then flows browser-to-browser. Recording is announced the same
     * way for a different reason — so nobody's voice is captured without the
     * room being able to see that it is happening.
     */
    socket.on('music:singalong', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const singing = Boolean((raw as { singing?: unknown }).singing)
      music.setSinging(roomId, socket.id, singing)

      if (singing) {
        socket.to(stageRoom(roomId)).emit('music:singalong-joined', {
          roomId,
          socketId: socket.id,
          user: self,
        })
      } else {
        socket.to(stageRoom(roomId)).emit('music:singalong-left', { roomId, socketId: socket.id })
      }

      pushListeners(roomId)
      io.to(stageRoom(roomId)).emit('music:state', music.apply(roomId, self, { action: 'singalong' }))
    })

    socket.on('music:recording', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return
      music.setRecording(roomId, socket.id, Boolean((raw as { recording?: unknown }).recording))
      pushListeners(roomId)
    })

    /* Signalling passthrough. The server never inspects these beyond checking
       the sender is on the page — the payloads are SDP and ICE candidates,
       which mean nothing to it. */
    for (const event of ['music:offer', 'music:answer', 'music:candidate'] as const) {
      socket.on(event, (raw: unknown) => {
        const roomId = roomIdFrom(raw)
        if (!roomId || !staged.has(roomId)) return
        const to = (raw as { to?: unknown }).to
        if (typeof to !== 'string') return
        io.to(to).emit(event, { ...(raw as object), from: socket.id, user: self })
      })
    }

    socket.on('disconnecting', () => {
      for (const roomId of music.dropSocket(socket.id)) {
        const snapshot = music.snapshot(roomId)
        io.to(roomId).emit('music:listeners', { roomId, listeners: snapshot.listeners })
        io.to(stageRoom(roomId)).emit('music:singalong-left', { roomId, socketId: socket.id })
        io.to(stageRoom(roomId)).emit('music:state', snapshot)
      }
      staged.clear()
    })
  })
}
