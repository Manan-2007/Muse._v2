import { useEffect, useState } from 'react'
import { Disc3, Play } from 'lucide-react'

import { fetchRecommendations, type RecShelf } from '@/features/music/api'
import { fromCatalog, useEnqueue } from '@/features/music/useEnqueue'
import { fetchPersonalRoom } from '@/features/rooms/api'

/**
 * The "made for you" shelves, wherever they're shown.
 *
 * Fetches the listener's recommendations for their own room and lays them out
 * as Spotify-style rows of playable covers — a tap plays the song. Used both as
 * a band on Home and as the whole of the For You page, so the two can never
 * drift apart. Renders nothing until there is something to recommend.
 */
export function RecShelves({ heading }: { heading?: string }) {
  const { play } = useEnqueue()
  const [shelves, setShelves] = useState<RecShelf[]>([])

  useEffect(() => {
    let cancelled = false
    void fetchPersonalRoom()
      .then((room) => fetchRecommendations(room.id))
      .then((s) => !cancelled && setShelves(s))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  if (shelves.length === 0) return null

  return (
    <div className="space-y-7">
      {heading && (
        <h2 className="font-display text-[1.3rem] font-semibold tracking-[-0.015em] text-chalk">
          {heading}
        </h2>
      )}
      {shelves.map((shelf) => (
        <div key={shelf.id}>
          <div className="mb-3">
            <h3 className="font-display text-[1.05rem] font-semibold text-chalk">{shelf.title}</h3>
            {shelf.subtitle && <p className="mt-0.5 text-[0.76rem] text-dusk">{shelf.subtitle}</p>}
          </div>
          <div className="scrollbar-none -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {shelf.tracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => void play(fromCatalog(track))}
                className="group flex w-36 shrink-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/10">
                  {track.artwork ? (
                    <img
                      src={track.artwork}
                      alt=""
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="grid size-full place-items-center text-dusk">
                      <Disc3 aria-hidden className="size-6" />
                    </span>
                  )}
                  <span className="absolute bottom-2 right-2 grid size-9 translate-y-1 place-items-center rounded-full bg-signal text-white opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                    <Play aria-hidden className="size-4 translate-x-px fill-current" />
                  </span>
                </span>
                <span className="truncate text-[0.82rem] font-medium text-chalk">{track.title}</span>
                <span className="-mt-1.5 truncate text-[0.72rem] text-dusk">{track.artist}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
