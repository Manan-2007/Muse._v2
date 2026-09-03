import { useCallback, useEffect, useState } from 'react'

import * as roomsApi from '@/features/rooms/api'
import type { Room, RoomVisibility } from '@/features/rooms/api'

/**
 * The caller's rooms, plus a `create` that folds the new room into the list
 * without a refetch — the API already returns the created room in full.
 */
export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRooms(await roomsApi.fetchRooms())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your rooms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = useCallback(async (input: { name: string; type: string; visibility: RoomVisibility }) => {
      const room = await roomsApi.createRoom(input)
      setRooms((current) => [room, ...current])
      return room
    },
    [],
  )

  /** Join by shared code. Replaces the room if you were already a member. */
  const join = useCallback(async (code: string) => {
    const room = await roomsApi.joinRoomByCode(code)
    setRooms((current) => [room, ...current.filter((entry) => entry.id !== room.id)])
    return room
  }, [])

  /** Patch one room's live member list from a presence event. */
  const setOnline = useCallback((roomId: string, online: string[]) => {
    setRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, online } : room)),
    )
  }, [])

  return { rooms, loading, error, reload: load, create, join, setOnline }
}
