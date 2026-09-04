import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type NavItem = {
  key: string
  label: string
  icon: LucideIcon
  active?: boolean
  /** A live/attention dot on the icon, e.g. unread chat or a room in session. */
  live?: boolean
  onClick: () => void
}

/**
 * The app's navigation — a floating glass tab bar, Muse._v1's shape.
 *
 * Bottom-centre rather than a top strip because this is a music app you
 * operate one-handed: the destinations sit where a thumb reaches. Glass, like
 * everything that floats over the record. The active tab wears the signal red;
 * the rest stay quiet until pointed at.
 */
export function BottomNav({ items, insetRight = 0 }: { items: NavItem[]; insetRight?: number }) {
  return (
    <nav
      className="pointer-events-none fixed bottom-4 left-0 z-[120] flex justify-center px-4 transition-[right] duration-500 ease-glass md:bottom-6"
      style={{ right: `${insetRight}rem` }}
      aria-label="Primary"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-abyss p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.85)]">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-2 rounded-full px-3.5 py-2 outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:px-4',
                item.active
                  ? 'bg-white/[0.1] text-chalk'
                  : 'text-mist hover:bg-white/[0.06] hover:text-chalk',
              )}
            >
              <span className="relative">
                <Icon aria-hidden className={cn('size-[1.15rem]', item.active && 'text-signal-bright')} />
                {item.live && (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-signal-pulse rounded-full bg-signal ring-2 ring-[#141319]" />
                )}
              </span>
              {/* The label rides alongside on the active tab and on wider
                  screens, and collapses to just the icon when space is tight. */}
              <span className={cn('text-[0.8rem] font-medium', item.active ? 'inline' : 'hidden sm:inline')}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
