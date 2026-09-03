import { useCallback, useEffect, useRef, useState } from 'react'

import { getSocket } from '@/lib/socket'
import type { GameMotion, GameSnapshot, WirePen } from '@/features/games/types'

/**
 * The room's match, as this client sees it.
 *
 * Deliberately thinner than `useWatchSession`. A film needs a shared clock and
 * constant drift correction because every viewer is independently playing the
 * same timeline; a pen fight has no timeline. Only one person is simulating at
 * any moment, and the rest are watching what that person reports, so there is
 * nothing to correct and no clock to agree on.
 *
 * What it does own is the split between *settled* state and *motion*: the
 * snapshot is where the pens came to rest and is authoritative, while motion
 * frames are a live relay that exists only while something is moving and is
 * dropped the instant it stops.
 */
export function useGameSession(roomId: string | null, open: boolean) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [connected, setConnected] = useState(true)

  /* Motion lands in a ref, not state: it arrives many times a second while a
     flick plays out, and re-rendering the whole stage on each one would cost
     more than the animation it is driving. The scene reads it per frame. */
  const motion = useRef<[WirePen, WirePen] | null>(null)
  const appliedSeq = useRef(-1)
  const epoch = useRef<number | null>(null)

  useEffect(() => {
    if (!roomId || !open) return

    const socket = getSocket()

    const onState = (incoming: GameSnapshot | null) => {
      if (incoming === null) {
        setSnapshot(null)
        motion.current = null
        appliedSeq.current = -1
        epoch.current = null
        return
      }
      if (incoming.roomId !== roomId) return

      /* A new match restarts `seq`, so the ordering guard has to be reset with
         it or every fresh snapshot reads as ancient and is thrown away. */
      if (epoch.current !== incoming.epoch) {
        epoch.current = incoming.epoch
        appliedSeq.current = -1
      }
      if (incoming.seq <= appliedSeq.current) return

      appliedSeq.current = incoming.seq
      /* Settled state supersedes whatever the pens were doing on the way
         here — otherwise a late motion frame would drag them back. */
      motion.current = null
      setSnapshot(incoming)
    }

    const onMotion = (incoming: GameMotion) => {
      if (incoming.roomId !== roomId) return
      /* Frames from a match that has already been replaced are not just stale,
         they belong to a different game. */
      if (epoch.current !== null && incoming.epoch !== epoch.current) return
      motion.current = incoming.pens
    }

    const onConnect = () => {
      setConnected(true)
      /* Reopening asks where the match is now; resuming from our own stale
         copy is how a reconnect ends up playing a game nobody else is in. */
      socket.emit('game:open', { roomId })
    }
    const onDisconnect = () => setConnected(false)

    socket.on('game:state', onState)
    socket.on('game:motion', onMotion)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    socket.emit('game:open', { roomId })

    return () => {
      socket.emit('game:close', { roomId })
      socket.off('game:state', onState)
      socket.off('game:motion', onMotion)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      motion.current = null
      setSnapshot(null)
      appliedSeq.current = -1
      epoch.current = null
    }
  }, [roomId, open])

  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      if (!roomId) return
      getSocket().emit(event, { roomId, ...payload })
    },
    [roomId],
  )

  return { snapshot, motion, connected, send }
}
