import { useEffect, useRef } from 'react'

import { getSocket } from '@/lib/socket'

export type Present = {
  userId: string
  name: string
  /** Which character they're wearing, so everyone sees the same person. */
  characterId?: string
}

type PresenceEvent = { roomId: string; present: Present[] }

/**
 * Joins every given room and reports who is in them, live.
 *
 * Joining is what puts *you* in the presence list too, so this is both a read
 * and a write — leaving the page removes you on disconnect.
 *
 * Reports whole people, not just ids. Presence is the only *live* roster the
 * client has; the member list from the REST fetch is a snapshot that goes stale
 * the moment anyone else joins the room. Callers that render who is here should
 * render from this.
 */
export function usePresence(
  roomIds: string[],
  onUpdate: (roomId: string, present: Present[]) => void,
  /** Your character, announced to the room so others draw you correctly. */
  characterId?: string,
) {
  /* Depend on the joined ids, not the array identity — a re-render that
     produces an equal-but-new array must not re-join every room. */
  const key = roomIds.join(',')

  /* Read through a ref inside `join`, so changing character announces itself
     (below) rather than tearing down and rebuilding the whole subscription. */
  const characterRef = useRef(characterId)
  characterRef.current = characterId

  /**
   * Announce a change of character to every room you're standing in.
   *
   * Silent until there is something to say. This is derived from the signed-in
   * user, so it is undefined on the first render and again whenever the
   * session is re-read — and an announcement carrying nothing is not a
   * different character, it is an absence of information. The server now
   * ignores those, but not sending them is what keeps the two ends honest.
   */
  useEffect(() => {
    if (!key || !characterId) return
    const connection = getSocket()
    for (const roomId of key.split(',')) {
      connection.emit('presence:character', { roomId, characterId })
    }
  }, [key, characterId])

  useEffect(() => {
    if (!key) return

    const ids = key.split(',')
    const connection = getSocket()

    const handleUpdate = (event: PresenceEvent) => {
      onUpdate(event.roomId, event.present)
    }

    const join = () => {
      for (const roomId of ids) {
        connection.emit('room:join', { roomId, characterId: characterRef.current })
      }
    }

    /*
     * Re-join on reconnect.
     *
     * A dropped socket comes back as a fresh connection server-side, with an
     * empty room set and no presence entry — so without this you silently
     * vanish from the room you are still looking at, and anything gated on
     * membership (the watch stage, the call) quietly stops working.
     */
    connection.on('presence:update', handleUpdate)
    connection.on('connect', join)
    join()

    return () => {
      connection.off('presence:update', handleUpdate)
      connection.off('connect', join)
      for (const roomId of ids) connection.emit('room:leave', { roomId })
    }
    // `onUpdate` is a stable useCallback from useRooms.
  }, [key, onUpdate])
}
