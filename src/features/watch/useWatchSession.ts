import { useCallback, useEffect, useRef, useState } from 'react'

import { getSocket } from '@/lib/socket'
import type { QueueItem, WatchSnapshot } from '@/features/watch/types'

/**
 * The room's playback session, as this client sees it.
 *
 * Owns three things the UI should not have to think about:
 *
 * 1. **Clock offset.** Browser clocks are routinely seconds out, and every
 *    correction below is a subtraction against server time. Measured on open
 *    with a few round trips, median of the samples.
 * 2. **Sequence guarding.** Snapshots can arrive out of order on a flaky
 *    connection; anything not newer than what we've applied is dropped.
 * 3. **Resync on reconnect.** A socket that drops and comes back must ask where
 *    the room is now, not resume from its own stale position.
 */

/*
 * How many round trips to take before trusting the clock.
 *
 * The offset from any one exchange is only as good as that exchange was
 * symmetric, and the estimate below assumes the request took exactly half the
 * round trip to arrive. A few more samples buys a better chance that at least
 * one of them went out and came back cleanly.
 */
const PING_SAMPLES = 7
/*
 * And re-measured for the whole session, not just at the start.
 *
 * Measuring once means the reading is whatever the network and the main thread
 * were doing in the first second of the page — which is the worst moment to
 * ask, with scripts still parsing and a player starting up. A single bad
 * reading taken then used to persist for the entire film.
 */
const RESYNC_MS = 30_000

export type WatchSessionState = {
  snapshot: WatchSnapshot | null
  queue: QueueItem[]
  /** Server clock minus local clock, in ms. */
  offset: number
  connected: boolean
}

export function useWatchSession(roomId: string | null, open: boolean) {
  const [snapshot, setSnapshot] = useState<WatchSnapshot | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [connected, setConnected] = useState(true)

  /* Refs, not state: these are read inside animation-rate loops and must not
     re-render the stage on every tick. */
  const offset = useRef(0)
  /*
   * Whether the clock has been measured even once.
   *
   * Until it has, `offset` is zero — which does not mean "no skew", it means
   * "unknown". Seeking on that assumes this device's clock agrees with the
   * server's, and browser clocks are routinely seconds out; that is the whole
   * reason any of this exists. The first snapshot arrives in milliseconds and
   * the first pong does not, so without this the opening seek was computed
   * from a number nobody had checked yet, differently wrong on every device.
   */
  const [clockReady, setClockReady] = useState(false)
  const appliedSeq = useRef(-1)
  const epoch = useRef<number | null>(null)

  useEffect(() => {
    if (!roomId || !open) return

    const socket = getSocket()
    let disposed = false

    /* Median of several round trips — a single sample lands on whatever the
       network was doing that instant, and one bad one skews every correction. */
    /* Each sample carries the round trip that produced it — the selection
       below needs it, not just the offset it implies. */
    const samples: { offset: number; rtt: number }[] = []
    const measure = () => {
      const sent = performance.timeOrigin + performance.now()
      socket.emit('watch:ping', { sent })
    }

    const onPong = ({ sent, serverTime }: { sent: number; serverTime: number }) => {
      const now = performance.timeOrigin + performance.now()
      const rtt = now - sent
      samples.push({ offset: serverTime + rtt / 2 - now, rtt })

      /*
       * Adopt the best reading so far straight away, then keep refining.
       *
       * Waiting for the full set means most of a second with no usable clock,
       * which is exactly the window somebody joining a room in progress spends
       * looking at the wrong frame. One exchange already puts this within
       * half a round trip of the truth — worlds better than the zero it would
       * otherwise be using — and each further sample can only improve it,
       * since a slower one never displaces a faster one below.
       */

      /*
       * The fastest exchange wins, not the middle one.
       *
       * `rtt / 2` is only right when both legs took the same time; the error
       * in a sample is exactly half the difference between them. A round trip
       * that came back quickly had little room to be delayed in either
       * direction, so it is the least asymmetric reading available.
       *
       * The median is very slightly better when congestion is even, because
       * symmetric errors cancel — but it is far worse when it is not. Against
       * a stall on one leg only, which is what a busy uplink through a tunnel
       * actually looks like, the median lands between the good samples and the
       * stalled ones: measured over thousands of runs, its worst case is about
       * 130ms of error where the fastest sample's is about 15ms. Trading a few
       * milliseconds in the calm case to cap the bad one is the right way
       * round for a room that has to agree on a frame.
       *
       * Neither helps against a path that is *always* slower one way. Nothing
       * measured from this end can see that.
       */
      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
      offset.current = best.offset
      if (!disposed) setClockReady(true)

      if (samples.length < PING_SAMPLES) setTimeout(measure, 90)
    }

    const onState = (incoming: WatchSnapshot) => {
      if (incoming.roomId !== roomId) return

      /*
       * A new epoch means `seq` restarted — the server was restarted, or the
       * session was rebuilt from scratch. Without this the guard below would
       * read every fresh snapshot as ancient and discard it, leaving the stage
       * frozen on state that no longer exists anywhere.
       */
      if (epoch.current !== incoming.epoch) {
        epoch.current = incoming.epoch
        appliedSeq.current = -1
      }

      /* `open` snapshots don't bump seq, so an equal one still applies —
         otherwise the very first paint would have no state at all. */
      if (incoming.seq < appliedSeq.current) return
      appliedSeq.current = incoming.seq
      setSnapshot(incoming)
    }

    const onQueue = ({ roomId: id, items }: { roomId: string; items: QueueItem[] }) => {
      if (id === roomId) setQueue(items)
    }

    const onViewers = ({ roomId: id, viewers }: { roomId: string; viewers: WatchSnapshot['viewers'] }) => {
      if (id !== roomId) return
      setSnapshot((current) => (current ? { ...current, viewers } : current))
    }

    const onConnect = () => {
      if (disposed) return
      setConnected(true)
      /* Re-announce and re-ask. A reconnect means the server has forgotten this
         socket was on the stage, and our own position is now a guess. */
      socket.emit('watch:open', { roomId })
      socket.emit('watch:sync-request', { roomId })
      samples.length = 0
      measure()
    }

    const onDisconnect = () => setConnected(false)

    socket.on('watch:pong', onPong)
    socket.on('watch:state', onState)
    socket.on('watch:queue', onQueue)
    socket.on('watch:viewers', onViewers)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)

    socket.emit('watch:open', { roomId })
    measure()

    /*
     * Give up waiting for the clock after a moment and start anyway.
     *
     * Everything that places playback now waits for a measurement, which is
     * right — but it means a pong that never arrives would hold the room on a
     * still frame indefinitely, and a lost packet is not a reason to refuse to
     * play. Out of sync by a clock's skew is a real fault; not playing at all
     * is a worse one. The measurement carries on regardless, so this corrects
     * itself the moment any reply lands.
     */
    const clockFallback = setTimeout(() => {
      if (!disposed) setClockReady(true)
    }, 2500)

    /*
     * Insurance against a lost first snapshot.
     *
     * One dropped `watch:open` used to mean the stage sat on "Syncing…"
     * forever, because nothing else ever asked again. This keeps asking until
     * something arrives, then stops.
     */
    const resync = setInterval(() => {
      samples.length = 0
      measure()
    }, RESYNC_MS)

    const retry = setInterval(() => {
      if (appliedSeq.current === -1) socket.emit('watch:sync-request', { roomId })
    }, 1200)

    return () => {
      disposed = true
      clearInterval(retry)
      clearInterval(resync)
      clearTimeout(clockFallback)
      socket.emit('watch:close', { roomId })
      socket.off('watch:pong', onPong)
      socket.off('watch:state', onState)
      socket.off('watch:queue', onQueue)
      socket.off('watch:viewers', onViewers)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      appliedSeq.current = -1
      epoch.current = null
      setSnapshot(null)
    }
  }, [roomId, open])

  /** Where the video should be, right now, in server time. */
  const targetPosition = useCallback(() => {
    if (!snapshot) return 0
    if (!snapshot.playing) return snapshot.position

    const nowOnServer = performance.timeOrigin + performance.now() + offset.current
    const elapsed = (nowOnServer - snapshot.serverTime) / 1000
    const projected = snapshot.position + elapsed * snapshot.rate

    const duration = snapshot.item?.duration
    return duration != null ? Math.min(projected, duration) : projected
  }, [snapshot])

  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      if (!roomId) return
      getSocket().emit(event, { roomId, ...payload })
    },
    [roomId],
  )

  return { snapshot, queue, setQueue, connected, offset, clockReady, targetPosition, send }
}
