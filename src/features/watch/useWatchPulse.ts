import { useEffect, useState } from 'react'

import { getSocket } from '@/lib/socket'
import type { Viewer } from '@/features/watch/types'

/**
 * What the hub needs to know about a watch session it is not part of.
 *
 * Opening the stage is a room event, not a private UI toggle — if one person
 * starts watching and nobody else is told, the "synchronised" part has nothing
 * to synchronise. This carries the badge and the invite, and nothing else.
 */
export function useWatchPulse(roomId: string | null) {
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [invite, setInvite] = useState<{ name: string } | null>(null)

  useEffect(() => {
    setViewers([])
    setInvite(null)
    if (!roomId) return

    const socket = getSocket()

    const onViewers = ({ roomId: id, viewers: list }: { roomId: string; viewers: Viewer[] }) => {
      if (id !== roomId) return
      setViewers(list)
      /* Nobody left watching means the invite is stale — drop it rather than
         leave a banner offering to join an empty stage. */
      if (list.length === 0) setInvite(null)
    }

    const onInvite = ({ roomId: id, by }: { roomId: string; by: { name: string } }) => {
      if (id === roomId) setInvite({ name: by.name })
    }

    socket.on('watch:viewers', onViewers)
    socket.on('watch:invite', onInvite)
    return () => {
      socket.off('watch:viewers', onViewers)
      socket.off('watch:invite', onInvite)
    }
  }, [roomId])

  return { viewers, invite, dismiss: () => setInvite(null) }
}
