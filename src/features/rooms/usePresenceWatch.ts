import { useEffect } from 'react'

import { getSocket } from '@/lib/socket'
import type { Present } from '@/features/rooms/usePresence'

/**
 * Live presence for rooms you are *not* standing in.
 *
 * The room list has to show who is in each room before you walk into any of
 * them, and it cannot get that by subscribing the way the active room does:
 * joining a room is what puts you in its presence map, so watching all of
 * them that way would have anyone with the dashboard open appear to be in
 * every room at once.
 *
 * This subscribes to the updates and nothing else. Nobody is counted for
 * watching, so the number a list shows is the number of people actually
 * there — which is what made the counts read as empty until you joined.
 *
 * Paired with `usePresence`, not a replacement for it: that one announces you,
 * this one only listens.
 */
export function usePresenceWatch(
  roomIds: string[],
  onUpdate: (roomId: string, present: Present[]) => void,
) {
  /* Keyed on the ids themselves — a re-render that rebuilds an equal array
     must not re-subscribe the whole list. */
  const key = roomIds.join(',')

  useEffect(() => {
    if (!key) return

    const connection = getSocket()
    const ids = key.split(',')

    const handle = (event: { roomId: string; present: Present[] }) => {
      onUpdate(event.roomId, event.present)
    }

    const watch = () => connection.emit('presence:watch', { roomIds: ids })

    connection.on('presence:update', handle)
    /* A reconnect is a fresh socket server-side, subscribed to nothing. */
    connection.on('connect', watch)
    watch()

    return () => {
      connection.off('presence:update', handle)
      connection.off('connect', watch)
      connection.emit('presence:watch', { roomIds: [] })
    }
  }, [key, onUpdate])
}
