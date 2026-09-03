import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { findActivity, type ActivityId } from '@/features/dashboard/hub/activities'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The frame an activity plays inside.
 *
 * It is empty, and says so. None of the four activities are built yet, so this
 * shows the shell they will mount into rather than a mock player — a fake
 * timeline that never moves is worse than an honest empty stage, both to demo
 * and to build against.
 */
export function ActivityStage({ id, onClose }: { id: ActivityId; onClose: () => void }) {
  const activity = findActivity(id)
  const Icon = activity.icon

  /* Portalled for the same reason as the drawer — the hub's fade leaves a
     stacking context that would pin this under the fixed header. */
  return createPortal(
    <motion.div
      className="pointer-events-auto fixed inset-0 z-[135] grid place-items-center p-6 md:p-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <button
        type="button"
        aria-label="Close activity"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-void/60 backdrop-blur-md"
      />

      <motion.section
        className="screen-panel relative w-full max-w-3xl overflow-hidden rounded-panel"
        initial={{ opacity: 0, scale: 0.94, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="absolute right-4 top-4">
          <Button variant="outline" size="icon" onClick={onClose} aria-label="Close" plain>
            <X aria-hidden />
          </Button>
        </div>

        <div className="flex flex-col items-start gap-5 p-8 md:p-12">
          <span className="grid size-12 place-items-center rounded-full bg-signal/15 text-signal-bright ring-1 ring-inset ring-signal/30">
            <Icon aria-hidden className="size-5" />
          </span>

          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-dusk">
              {activity.hint}
            </p>
            <h2 className="mt-2 font-display text-[clamp(1.7rem,4vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-chalk">
              {activity.label}
            </h2>
          </div>

          <p className="max-w-xl text-[0.95rem] leading-relaxed text-mist">{activity.blurb}</p>

          <div className="mt-2 flex w-full items-center gap-3 rounded-card border border-white/[0.08] bg-white/[0.02] px-5 py-4">
            <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />
            <p className="text-[0.85rem] text-mist">
              Not built yet — this is the stage it mounts into.
            </p>
          </div>
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  )
}
