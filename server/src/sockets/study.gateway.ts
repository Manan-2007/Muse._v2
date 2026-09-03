import type { Server, Socket } from 'socket.io'

import * as timer from '../services/timer.service.js'
import { assertMembership } from '../services/room.service.js'
import { socketUser } from './presence.gateway.js'

/**
 * The live half of the study page.
 *
 * One gateway for the whole activity rather than one per piece. Most of Study
 * is generated content that is written once and then read — a set of
 * questions, a page of notes, a shelf of documents — and none of that wants a
 * socket; it is REST and a table. Only two things here are genuinely live: the
 * timer everyone is sitting to, and telling the room that something new was
 * generated so a second screen does not have to be refreshed to see it.
 *
 * So this file owns the page's presence lifecycle (`study:open`/`close`), the
 * timer, and a nudge for the rest.
 */

const stageRoom = (roomId: string) => `study:${roomId}`

function roomIdFrom(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as { roomId?: unknown }).roomId
  return typeof value === 'string' ? value : null
}

function numberFrom(raw: unknown, key: string): number | undefined {
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** What changed, so a client knows which list to refetch rather than all of them. */
const SYNC_KINDS = ['subjects', 'resources', 'mcq', 'notes', 'coding'] as const
type SyncKind = (typeof SYNC_KINDS)[number]

export function attachStudyGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self = { id: state.userId, name: state.name }

    const staged = new Set<string>()
    const opening = new Set<string>()
    const closePending = new Set<string>()
    const verified = new Set<string>()

    /* Checked against the database rather than `socket.rooms`, for the same
       reason every other gateway here does: the presence join is async, so a
       client that walks in and immediately opens the page would otherwise have
       every event silently dropped. */
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

    socket.on('study:open', async (raw: unknown) => {
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

      /* A close raced ahead of the join — honour it rather than leave a ghost
         sitting in the stage room forever. */
      if (closePending.delete(roomId)) {
        staged.delete(roomId)
        void socket.leave(stageRoom(roomId))
        return
      }

      socket.emit('study:timer', timer.apply(roomId, self, { action: 'open' }))
    })

    socket.on('study:close', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      if (opening.has(roomId)) {
        closePending.add(roomId)
        return
      }
      staged.delete(roomId)
      void socket.leave(stageRoom(roomId))
    })

    socket.on('study:sync-request', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return
      socket.emit('study:timer', timer.snapshot(roomId))
    })

    socket.on('study:timer-control', (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !staged.has(roomId)) return

      const body = (raw ?? {}) as Record<string, unknown>
      let control: timer.TimerControl | null = null

      switch (body.action) {
        case 'start':
        case 'pause':
        case 'reset':
        case 'skip':
          control = { action: body.action }
          break

        case 'configure': {
          const raw_ = body.durations
          if (typeof raw_ !== 'object' || raw_ === null) return
          const durations: Partial<Record<timer.TimerPhase, number>> = {}
          for (const phase of timer.TIMER_PHASES) {
            const seconds = numberFrom(raw_, phase)
            if (seconds !== undefined) durations[phase] = seconds
          }
          if (Object.keys(durations).length === 0) return
          control = { action: 'configure', durations }
          break
        }

        default:
          return
      }

      if (!control) return
      io.to(stageRoom(roomId)).emit('study:timer', timer.apply(roomId, self, control))
    })

    /**
     * Something was created over REST; everyone else only learns of it here.
     *
     * The generators are HTTP calls — they take seconds and return a whole
     * object, which is a request, not a stream. But a second person with the
     * page open should not have to refresh to see the set that just appeared,
     * so the client that made it says so and everyone refetches that one list.
     *
     * The whole room, not just the stage: the hub can show that a subject grew
     * something new without anybody having walked into Study yet.
     */
    socket.on('study:changed', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return

      const kind = (raw as { kind?: unknown }).kind
      if (typeof kind !== 'string' || !SYNC_KINDS.includes(kind as SyncKind)) return

      const subjectId = (raw as { subjectId?: unknown }).subjectId
      socket.to(roomId).emit('study:changed', {
        roomId,
        kind,
        subjectId: typeof subjectId === 'string' ? subjectId : null,
      })
    })

    socket.on('disconnecting', () => {
      staged.clear()
    })
  })
}
