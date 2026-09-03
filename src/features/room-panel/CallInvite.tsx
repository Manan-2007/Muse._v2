import { motion } from 'framer-motion'
import { PhoneCall, X } from 'lucide-react'

/**
 * "Someone started a call."
 *
 * The counterpart to the watch invite, and it exists for the same reason: a
 * call nobody is told about looks identical to a call that is broken. Joining
 * opens the panel and connects in one step, because the two are never wanted
 * separately.
 */
export function CallInvite({
  name,
  onJoin,
  onDismiss,
}: {
  name: string
  onJoin: () => void
  onDismiss: () => void
}) {
  return (
    <motion.div
      className="pointer-events-auto absolute inset-x-0 top-24 z-30 flex justify-center px-4"
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="glass-pill-ink flex items-center gap-3 rounded-full py-2 pl-4 pr-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
          <PhoneCall aria-hidden className="size-4" />
        </span>

        <p className="text-[0.85rem] text-chalk">
          <span className="font-semibold">{name}</span> started a call
        </p>

        <button
          type="button"
          onClick={onJoin}
          className="rounded-full bg-chalk px-4 py-2 text-[0.8rem] font-medium text-void outline-none transition-transform duration-300 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-95"
        >
          Join
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-8 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </motion.div>
  )
}
