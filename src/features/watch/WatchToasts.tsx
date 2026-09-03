import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { formatTime, type WatchSnapshot } from '@/features/watch/types'

/**
 * Who just did that.
 *
 * With no host, anyone can pause or jump the video — and a player that stops on
 * its own, with no visible cause, reads as broken rather than shared. Naming
 * the person is the difference between "we're watching together" and "something
 * is wrong with my connection".
 */

type Toast = { id: number; text: string }

function describe(snapshot: WatchSnapshot): string | null {
  const { by, action, name } = { by: snapshot.by, action: snapshot.by?.action, name: snapshot.by?.name }
  if (!by || !action || !name) return null

  switch (action) {
    case 'play':
      return `${name} pressed play`
    case 'pause':
      return `${name} paused`
    case 'seek':
      return `${name} jumped to ${formatTime(snapshot.position)}`
    case 'rate':
      return `${name} set the speed to ${snapshot.rate}×`
    case 'load':
      return `${name} put on ${snapshot.item?.title ?? 'something new'}`
    case 'advance':
      return snapshot.item ? `Up next: ${snapshot.item.title}` : 'That was the last one'
    default:
      return null
  }
}

export function WatchToasts({
  snapshot,
  selfId,
}: {
  snapshot: WatchSnapshot | null
  /** Your own actions need no narration — you know what you just pressed. */
  selfId: string | undefined
}) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const lastSeq = useRef(-1)
  /* One timer per toast, tracked outside React state entirely — see below. */
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    if (!snapshot || snapshot.seq === lastSeq.current) return

    const first = lastSeq.current === -1
    lastSeq.current = snapshot.seq
    /* Skip whatever was already in flight when the stage opened — arriving to
       a burst of narration about things that happened before you got here. */
    if (first) return
    if (!snapshot.by || snapshot.by.id === selfId) return

    const text = describe(snapshot)
    if (!text) return

    const toast = { id: snapshot.seq, text }
    setToasts((current) => [...current.slice(-2), toast])

    /*
     * Scheduled here, once, rather than through the effect's own cleanup.
     *
     * The stage's snapshot gets a new object identity for reasons that have
     * nothing to do with a toast worth showing — someone else merely closing
     * the stage re-broadcasts the current state to everyone still watching,
     * with the same `seq`. That re-runs this effect, and cleanup fires on
     * every re-run whose dependencies changed, timer included — so a toast's
     * countdown was being cancelled by an unrelated viewer leaving, and
     * nothing here ever rescheduled it, because the early return above never
     * reaches a fresh `setTimeout`. The toast then sat until the next real
     * action happened to push it out by volume.
     *
     * A timer keyed to the toast's own id, outside this effect's lifecycle,
     * cannot be touched by any of that — it fires exactly 3.2s after the toast
     * it belongs to was created, whatever else the snapshot does meanwhile.
     */
    const timer = setTimeout(() => {
      timers.current.delete(toast.id)
      setToasts((current) => current.filter((entry) => entry.id !== toast.id))
    }, 3200)
    timers.current.set(toast.id, timer)
  }, [snapshot, selfId])

  /* Every pending timer is this component's, not the effect's — cleared once,
     on unmount, rather than reset on every snapshot. */
  useEffect(() => {
    const live = timers.current
    return () => {
      for (const timer of live.values()) clearTimeout(timer)
      live.clear()
    }
  }, [])

  return (
    <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.p
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="glass-pill-ink whitespace-nowrap rounded-full px-4 py-2 text-[0.8rem] text-chalk"
          >
            {toast.text}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  )
}
