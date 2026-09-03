import { useEffect, useState } from 'react'
import { ExternalLink, MonitorPlay } from 'lucide-react'

import { formatTime, type WatchItem } from '@/features/watch/types'

/**
 * Co-watching something we are not allowed to embed.
 *
 * Netflix, Prime, Disney+ and the rest expose no playback API and their players
 * are DRM-sandboxed, so there is no honest way to observe or drive them from
 * here. Rather than ship a player that silently desynchronises, the room syncs
 * the one thing it legitimately can: a clock. Everyone opens the title in their
 * own tab, the room counts down, and the shared timer is the reference to jump
 * back to when someone falls behind.
 */
export function ExternalBeacon({
  item,
  position,
  playing,
}: {
  item: WatchItem
  /** The room's shared clock, in seconds. */
  position: number
  playing: boolean
}) {
  const [now, setNow] = useState(position)

  /* Ticks locally between snapshots so the clock reads smoothly; the value it
     starts from is always the server's, so it can't drift on its own. */
  useEffect(() => {
    setNow(position)
    if (!playing) return

    const started = performance.now()
    const frame = setInterval(() => {
      setNow(position + (performance.now() - started) / 1000)
    }, 250)

    return () => clearInterval(frame)
  }, [position, playing])

  const link = /^https?:\/\//i.test(item.ref) ? item.ref : null
  const counting = playing && now < 3

  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_100%_at_50%_0%,var(--color-grade-violet),var(--color-void)_70%)] p-8">
      <div className="flex max-w-lg flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-full bg-signal/15 text-signal-bright ring-1 ring-inset ring-signal/30">
          <MonitorPlay aria-hidden className="size-6" />
        </span>

        <p className="mt-5 text-[0.7rem] uppercase tracking-[0.2em] text-dusk">
          Synced clock · plays in your own tab
        </p>
        <h3 className="mt-2 font-display text-[clamp(1.3rem,3vw,2rem)] font-semibold leading-tight tracking-[-0.03em] text-chalk">
          {item.title}
        </h3>

        {counting ? (
          <p
            key={Math.ceil(3 - now)}
            className="mt-8 animate-[fade-up_0.4s_ease-out] font-display text-[5rem] font-semibold leading-none text-signal-bright"
          >
            {Math.max(1, Math.ceil(3 - now))}
          </p>
        ) : (
          <p className="mt-8 font-mono text-[3rem] font-semibold leading-none tabular-nums text-chalk">
            {formatTime(Math.max(0, now))}
          </p>
        )}

        <p className="mt-6 max-w-md text-[0.9rem] leading-relaxed text-mist">
          {playing
            ? 'The room is counting together. Match this timestamp in your player and you are all on the same frame.'
            : 'Everyone open it in their own tab, then press play here to start the count together.'}
        </p>

        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2.5 text-[0.85rem] text-chalk transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.09]"
          >
            Open {item.title}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}
