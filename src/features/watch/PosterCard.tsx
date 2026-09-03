import { Clapperboard, ListPlus, Play, Trash2 } from 'lucide-react'

import { formatTime } from '@/features/watch/types'
import { cn } from '@/lib/utils'

/** Whatever can be put on: a search result, a file on the server, a queue row. */
export type Playable = {
  source: 'youtube' | 'file' | 'external'
  ref: string
  title: string
  /** Channel, or the size of the file — whatever identifies it beneath the name. */
  subtitle?: string | null
  thumbnail?: string | null
  duration?: number | null
  /** False for containers no browser will play; the card says why. */
  playable?: boolean
  reason?: string | null
}

/**
 * One thing to watch.
 *
 * Sixteen-by-nine, not square. A film is recognised by a frame from it, and a
 * frame is a landscape — cropping it to a tile the shape of an album cover
 * throws away the part that identifies it. It is the same reason the music
 * page uses squares: match the shape of the thing, not the shape of the grid.
 */
export function PosterCard({
  item,
  current,
  playing,
  onPlay,
  onQueue,
  onDelete,
}: {
  item: Playable
  current?: boolean
  playing?: boolean
  onPlay: () => void
  /** Absent where queueing without playing makes no sense. */
  onQueue?: () => void
  /** Only for things that live on this server — nothing else is ours to delete. */
  onDelete?: () => void
}) {
  const disabled = item.playable === false

  return (
    <div className="group/card relative flex flex-col">
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={disabled ? `${item.title} — ${item.reason ?? 'cannot be played'}` : `Play ${item.title}`}
        className={cn(
          'relative aspect-video w-full overflow-hidden rounded-xl bg-white/[0.05] outline-none ring-1 ring-inset transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal',
          current ? 'ring-signal/50' : 'ring-white/10 group-hover/card:ring-white/20',
          disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 ease-glass group-hover/card:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center text-dusk">
            <Clapperboard aria-hidden className="size-6" />
          </span>
        )}

        <span
          className={cn(
            'absolute inset-0 bg-gradient-to-t from-void/75 via-transparent to-transparent transition-opacity duration-300',
            current ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
          )}
        />

        {!disabled && (
          <span
            className={cn(
              'absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full bg-chalk text-void shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)] transition-all duration-300',
              current && playing
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0 group-hover/card:translate-y-0 group-hover/card:opacity-100',
            )}
          >
            <Play aria-hidden className="size-4 translate-x-px fill-current" />
          </span>
        )}

        {item.duration != null && item.duration > 0 && (
          <span className="absolute bottom-2 left-2 rounded bg-void/80 px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums text-chalk">
            {formatTime(item.duration)}
          </span>
        )}
      </button>

      <div className="flex items-start gap-1 px-0.5 pt-2.5">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'line-clamp-2 text-[0.84rem] leading-snug',
              current ? 'text-signal-bright' : 'text-chalk',
            )}
            title={item.title}
          >
            {item.title}
          </p>
          {(item.subtitle ?? item.reason) && (
            <p className="mt-0.5 truncate text-[0.74rem] text-dusk">
              {disabled ? item.reason : item.subtitle}
            </p>
          )}
        </div>

        {onQueue && !disabled && (
          <button
            type="button"
            onClick={onQueue}
            aria-label={`Add ${item.title} to the queue`}
            className="grid size-7 shrink-0 place-items-center rounded-full text-dusk opacity-0 outline-none transition-all duration-200 hover:text-chalk focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal group-hover/card:opacity-100"
          >
            <ListPlus aria-hidden className="size-3.5" />
          </button>
        )}

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${item.title} from the server`}
            /*
             * Visible on touch, revealed on hover with a pointer.
             * `group-hover` is a mouse idea — a phone has no hover state, so
             * a control that only appears on it is a control a phone can
             * never reach.
             */
            className="grid size-8 shrink-0 place-items-center rounded-full text-dusk outline-none transition-all duration-200 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:size-7 sm:opacity-0 sm:group-hover/card:opacity-100"
          >
            <Trash2 aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** The grid these sit in — wider cells than music, because the tiles are wider. */
export function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-6 pb-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  )
}
