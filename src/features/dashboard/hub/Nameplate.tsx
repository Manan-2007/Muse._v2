import { Crown } from 'lucide-react'

import { cn } from '@/lib/utils'

export type PlateStatus = 'here' | 'away'

/**
 * The label under a character. Deliberately the only place a member's name
 * appears in the scene — floating text over artwork reads as a watermark.
 */
export function Nameplate({
  name,
  status,
  owner = false,
  you = false,
  className,
}: {
  name: string
  status: PlateStatus
  owner?: boolean
  you?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'glass-pill-ink pointer-events-auto flex min-w-0 flex-col items-center gap-0.5 rounded-card px-4 py-2 text-center',
        status === 'away' && 'opacity-55',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {owner && <Crown aria-label="Room owner" className="size-3.5 shrink-0 text-signal" />}
        <span className="truncate font-display text-[0.92rem] font-semibold tracking-[-0.01em] text-chalk">
          {name}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            status === 'here' ? 'animate-signal-pulse bg-emerald-400' : 'bg-white/25',
          )}
        />
        <span className="text-[0.68rem] lowercase tracking-wide text-mist">
          {you ? 'you' : status === 'here' ? 'in the room' : 'away'}
        </span>
      </span>
    </div>
  )
}
