import { useCallback, useEffect, useRef, useState } from 'react'

import { getSocket } from '@/lib/socket'

/**
 * The room's focus timer.
 *
 * Deliberately lighter than `useWatchSession`/`useMusicSession`. Those measure
 * the clock across several round trips and keep the fastest, because a film
 * has to hold everyone on the same frame and a tenth of a second is visible.
 * A countdown shown to the second is not that: the offset from a single
 * message is already far inside what anybody could notice, and the repeated
 * ping/pong would be machinery bought for nothing. `useGameSession` makes the
 * same call for the same reason.
 */

export type TimerPhase = 'focus' | 'short' | 'long'

export type TimerSnapshot = {
  roomId: string
  phase: TimerPhase
  durations: Record<TimerPhase, number>
  remaining: number
  running: boolean
  completed: number
  next: TimerPhase
  seq: number
  epoch: number
  by: { id: string; name: string; action: string } | null
  serverTime: number
}

export type TimerControl =
  | { action: 'start' | 'pause' | 'reset' | 'skip' }
  | { action: 'configure'; durations: Partial<Record<TimerPhase, number>> }

export function useStudyTimer(roomId: string | null, open: boolean) {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null)
  const [connected, setConnected] = useState(true)

  /** Server clock minus ours, from the last snapshot that arrived. */
  const offset = useRef(0)
  const epoch = useRef(-1)
  const appliedSeq = useRef(-1)

  useEffect(() => {
    if (!roomId || !open) return

    const socket = getSocket()

    const onTimer = (incoming: TimerSnapshot) => {
      if (incoming.roomId !== roomId) return

      /* A new epoch means the session was rebuilt — a restart, or the room
         emptying and filling again. Without this the guard below would read
         every fresh snapshot as ancient and the display would freeze. */
      if (epoch.current !== incoming.epoch) {
        epoch.current = incoming.epoch
        appliedSeq.current = -1
      }
      if (incoming.seq < appliedSeq.current) return
      appliedSeq.current = incoming.seq

      offset.current = incoming.serverTime - Date.now()
      setSnapshot(incoming)
    }

    const onConnect = () => {
      setConnected(true)
      socket.emit('study:open', { roomId })
      socket.emit('study:sync-request', { roomId })
    }
    const onDisconnect = () => setConnected(false)

    socket.on('study:timer', onTimer)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    socket.emit('study:open', { roomId })

    return () => {
      socket.emit('study:close', { roomId })
      socket.off('study:timer', onTimer)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [roomId, open])

  /**
   * Seconds left right now.
   *
   * Projected rather than stored, so the display ticks between messages
   * instead of waiting for one. The server only sends on a change; everything
   * in between is this arithmetic.
   */
  const remaining = useCallback(() => {
    if (!snapshot) return 0
    if (!snapshot.running) return snapshot.remaining
    const nowOnServer = Date.now() + offset.current
    const elapsed = (nowOnServer - snapshot.serverTime) / 1000
    return Math.max(0, snapshot.remaining - elapsed)
  }, [snapshot])

  const send = useCallback(
    (control: TimerControl) => {
      if (!roomId) return
      getSocket().emit('study:timer-control', { roomId, ...control })
    },
    [roomId],
  )

  return { snapshot, connected, remaining, send }
}

/**
 * Tell the room something was generated, so a second screen updates itself.
 *
 * Separate from the timer because it has nothing to do with it — but it rides
 * the same socket and the same page lifecycle, so it lives beside it.
 */
export function useStudySync(roomId: string | null, onChanged: (kind: string) => void) {
  const handler = useRef(onChanged)
  handler.current = onChanged

  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()

    const onChange = (payload: { roomId: string; kind: string }) => {
      if (payload.roomId !== roomId) return
      handler.current(payload.kind)
    }

    socket.on('study:changed', onChange)
    return () => {
      socket.off('study:changed', onChange)
    }
  }, [roomId])

  return useCallback(
    (kind: string, subjectId?: string | null) => {
      if (!roomId) return
      getSocket().emit('study:changed', { roomId, kind, subjectId: subjectId ?? null })
    },
    [roomId],
  )
}
