import { ChevronDown, ChevronUp, Play, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import * as watchApi from '@/features/watch/api'
import { SourcePicker, type Queued } from '@/features/watch/SourcePicker'
import { formatTime, type QueueItem } from '@/features/watch/types'
import { cn } from '@/lib/utils'

const SOURCE_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  file: 'Video file',
  external: 'Synced clock',
}

/**
 * The running order, and the way to add to it.
 *
 * Adding is delegated to the same `SourcePicker` the empty stage uses, so
 * there is exactly one answer to "how do I put something on" no matter where
 * you are — and only one place for that flow to go wrong.
 */
export function QueuePanel({
  roomId,
  items,
  nowPlayingId,
  canSearch,
  onQueueChange,
  onQueued,
  onPlayNow,
  onClose,
}: {
  roomId: string
  items: QueueItem[]
  nowPlayingId: string | null
  canSearch: boolean
  onQueueChange: (items: QueueItem[]) => void
  /**
   * Adding from in here has to reach the stage, or picking a video from the
   * panel puts nothing on — the queue grows and the screen stays empty.
   */
  onQueued: (queued: Queued, playNow: boolean) => void
  onPlayNow: (item: QueueItem) => void
  onClose: () => void
}) {
  async function move(index: number, delta: number) {
    const next = [...items]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    /* Optimistic, then reconciled with what the server actually stored — a
       reorder that visibly lags a click feels broken. */
    onQueueChange(next)
    onQueueChange(
      await watchApi.reorderQueue(
        roomId,
        next.map((item) => item.id),
      ),
    )
  }

  return (
    <aside className="pointer-events-auto flex h-full w-full flex-col border-l border-white/[0.08] bg-void/85 backdrop-blur-xl md:w-[24rem]">
      <header className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div>
          <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-chalk">
            Up next
          </h3>
          <p className="mt-0.5 text-[0.76rem] text-mist">
            {items.length === 0
              ? 'Nothing queued yet'
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={onClose} aria-label="Close queue" plain>
          <X aria-hidden />
        </Button>
      </header>

      <div className="border-b border-white/[0.07] px-5 py-4">
        <SourcePicker roomId={roomId} canSearch={canSearch} compact onQueued={onQueued} />
      </div>

      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-6 py-10 text-center text-[0.84rem] leading-relaxed text-mist">
            Nothing lined up yet. Whatever you add plays for the whole room at once.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 p-3">
            {items.map((item, index) => {
              const current = item.id === nowPlayingId
              return (
                <li
                  key={item.id}
                  className={cn(
                    'group/item flex gap-3 rounded-card p-2 transition-colors duration-200',
                    current
                      ? 'bg-signal/[0.1] ring-1 ring-inset ring-signal/30'
                      : 'hover:bg-white/[0.05]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPlayNow(item)}
                    className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-deep outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    aria-label={`Play ${item.title} now`}
                  >
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-[0.6rem] uppercase tracking-wider text-dusk">
                        {SOURCE_LABEL[item.source]?.split(' ')[0]}
                      </span>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-void/55 opacity-0 transition-opacity duration-200 group-hover/item:opacity-100">
                      <Play aria-hidden className="size-4 fill-chalk text-chalk" />
                    </span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[0.8rem] leading-snug text-chalk">
                      {item.title}
                    </p>
                    <p className="mt-0.5 truncate text-[0.7rem] text-dusk">
                      {current ? 'Playing now' : SOURCE_LABEL[item.source]} · {item.addedBy.name}
                      {item.duration ? ` · ${formatTime(item.duration)}` : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/item:opacity-100">
                    <button
                      type="button"
                      onClick={() => void move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="grid size-6 place-items-center rounded text-mist transition-colors hover:bg-white/10 hover:text-chalk disabled:opacity-25"
                    >
                      <ChevronUp aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void move(index, 1)}
                      disabled={index === items.length - 1}
                      aria-label="Move down"
                      className="grid size-6 place-items-center rounded text-mist transition-colors hover:bg-white/10 hover:text-chalk disabled:opacity-25"
                    >
                      <ChevronDown aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () =>
                        onQueueChange(await watchApi.removeFromQueue(roomId, item.id))
                      }
                      aria-label={`Remove ${item.title}`}
                      className="grid size-6 place-items-center rounded text-mist transition-colors hover:bg-signal/20 hover:text-signal-bright"
                    >
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
