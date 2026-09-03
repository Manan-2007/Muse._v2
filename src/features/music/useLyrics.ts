import { useEffect, useState } from 'react'

import { fetchLyrics } from '@/features/music/api'
import type { Lyrics, Track } from '@/features/music/types'

/**
 * The words for whatever is playing.
 *
 * Keyed on the track's identity rather than the object, because the snapshot
 * is rebuilt for things that have nothing to do with the song — somebody
 * joining the room, the queue moving — and re-fetching on each of those would
 * be a request per listener per event for a result that cannot have changed.
 *
 * A track that has been skipped past is not worth waiting for, so an in-flight
 * lookup is abandoned when the track changes.
 */
export function useLyrics(roomId: string | null, track: Track | null) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [loading, setLoading] = useState(false)

  const key = track ? `${track.id}` : null

  useEffect(() => {
    /*
     * Fetched for whatever is playing, whether or not the view is open.
     *
     * The button that opens it is only offered when there is something behind
     * it, and there is no way to know that without asking — a button that
     * leads to "no lyrics" half the time is worse than no button. The server
     * caches, so a room of six asks once and a re-listen asks nothing.
     */
    if (!roomId || !track) {
      setLyrics(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setLyrics(null)

    fetchLyrics(roomId, track, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setLyrics(result)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        /* A failed lookup and a track with no lyrics are the same thing to
           look at, and the view already says that plainly. */
        setLyrics({ kind: 'none' })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    /* `track` itself is deliberately not a dependency — see the note above. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, key])

  /* Whether there is anything worth opening. Null while the answer is still
     unknown, so the button can stay away rather than flicker in and out. */
  const available = lyrics === null ? null : lyrics.kind !== 'none'

  return { lyrics, loading, available }
}

/**
 * Which line is being sung at `position`.
 *
 * Binary search rather than a scan: this runs on every position sample, four
 * times a second, against a list that can run to a couple of hundred lines.
 *
 * Returns the last line at or before the position, or -1 before the first —
 * songs open with an instrumental bar more often than not, and highlighting
 * the first line through it is the single most obvious way to look wrong.
 */
export function activeLineAt(lines: { at: number }[], position: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid]!.at <= position) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return found
}
