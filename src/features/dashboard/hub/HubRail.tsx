import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type RailItem = {
  key: string
  label: string
  hint?: string
  icon: LucideIcon
  /** Given this control's box, so a screen can open *from* where it sits. */
  onClick: (from?: DOMRect) => void
  active?: boolean
  /** Something is happening in here right now, even if you aren't in it. */
  live?: boolean
  /** Leaving a room is destructive-ish; it should not look like the others. */
  danger?: boolean
}

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * A rail of controls down one edge of the hub.
 *
 * Frosted rather than filled on purpose: these sit over live artwork, and a
 * solid button would punch a hole in the scene. The blur keeps the background
 * readable through the control while the hairline edge and the top-edge
 * highlight are what make it legible against both bright sky and dark water.
 */
export function HubRail({
  side,
  items,
  className,
  insetRight = 0,
}: {
  side: 'left' | 'right'
  items: RailItem[]
  className?: string
  /** Rem the side panel occupies. The right rail slides in front of it. */
  insetRight?: number
}) {
  if (items.length === 0) return null

  return (
    <motion.nav
      className={cn(
        /*
         * Two rails face each other across the scene, so each can only ever
         * have somewhat under half the width — which on a phone is about 150px,
         * and after the icon and padding leaves barely enough for a word. The
         * cap is loosened a little there and the labels below are allowed to
         * wrap rather than truncate, which is what actually buys the room.
         */
        /*
         * Lower on a phone. Centred vertically the two rails meet in the
         * middle of the screen, which on a narrow one is exactly where the
         * character's head and chest are — the thing the hub is built to
         * show. Dropping them towards the legs keeps the figure readable
         * without moving the controls out of thumb reach.
         */
        'pointer-events-auto absolute top-[62%] z-20 flex w-[15.5rem] max-w-[46vw] flex-col gap-2.5 sm:top-1/2',
        'sm:max-w-[42vw] sm:gap-3',
        'transition-[right] duration-500 ease-glass',
        side === 'left' ? 'left-4 md:left-8' : 'items-end',
        className,
      )}
      style={
        side === 'right'
          ? { right: `calc(${insetRight}rem + 1rem)`, translate: '0 -50%' }
          : { translate: '0 -50%' }
      }
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
      }}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <motion.button
            key={item.key}
            type="button"
            onClick={(event) => item.onClick(event.currentTarget.getBoundingClientRect())}
            aria-pressed={item.active ? true : undefined}
            variants={{
              hidden: { opacity: 0, x: side === 'left' ? -28 : 28, filter: 'blur(8px)' },
              visible: {
                opacity: 1,
                x: 0,
                filter: 'blur(0px)',
                transition: { duration: 0.7, ease: EASE },
              },
            }}
            /* Nudged into the screen rather than scaled up — a control on an
               edge should feel like it slides out to meet you. */
            whileHover={{ x: side === 'left' ? 6 : -6 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            className={cn(
              'group/rail flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left outline-none',
              'sm:gap-3 sm:px-4 sm:py-3',
              /*
               * Frosted over a *dark scrim*, not clear glass. Clear glass is
               * only legible over bright artwork — it vanishes against dark
               * water or a night sky, and these backdrops are photographs with
               * both in the same frame. The scrim is what guarantees white text
               * reads anywhere the scene puts it.
               */
              'liquid-btn is-scrim',
              'focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal',
              item.active && 'border-signal/50 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-signal)_35%,transparent)]',
              item.danger && 'hover:border-signal/55',
            )}
          >
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-chalk ring-1 ring-inset ring-white/15 sm:size-9',
                'transition-colors duration-500',
                item.active && 'bg-signal/25 text-white ring-signal/40',
                item.danger && 'group-hover/rail:bg-signal/25 group-hover/rail:text-white',
              )}
            >
              <Icon aria-hidden className="size-[1.05rem]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {/* Wraps on a phone, truncates once there's width for one
                    line. "Create a room" over two lines still says what it
                    does; "Create …" does not. */}
                <span className="font-display text-[0.9rem] font-semibold leading-tight tracking-[-0.015em] text-chalk sm:truncate sm:text-[0.95rem]">
                  {item.label}
                </span>
                {item.live && (
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 animate-signal-pulse rounded-full bg-emerald-400"
                  />
                )}
              </span>
              {/* The hint is a nicety, and on a phone it only ever rendered as
                  a cut-off fragment — "Start your o…" tells you less than the
                  space it costs the label above it. */}
              {item.hint && (
                <span className="hidden truncate text-[0.72rem] text-mist sm:block">
                  {item.hint}
                </span>
              )}
            </span>
          </motion.button>
        )
      })}
    </motion.nav>
  )
}
