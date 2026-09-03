import { Heart, ListPlus, Music4, Pause, Play } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTime, type LibraryTrack, type Playlist } from '@/features/music/types'
import { cn } from '@/lib/utils'

/**
 * One song, in a list.
 *
 * The single row component behind every view — search results, a playlist, the
 * liked list, suggestions. They differ only in what sits at the left edge, so
 * making four of these would be four places for the hover state, the heart,
 * and the now-playing treatment to drift apart.
 *
 * Restrained on purpose. A list of songs is read, not admired: one line of
 * title, one of artist, and the controls stay invisible until the row is
 * actually pointed at, so a full page of them is calm rather than busy.
 */
export function TrackRow({
  track,
  index,
  playing,
  current,
  liked,
  playlists,
  onPlay,
  onLike,
  onAddToPlaylist,
  onRemove,
  removeLabel,
}: {
  track: LibraryTrack
  /** Shown in place of artwork when the list is numbered. */
  index?: number
  playing?: boolean
  current?: boolean
  liked?: boolean
  playlists?: Playlist[]
  onPlay: () => void
  onLike?: () => void
  onAddToPlaylist?: (playlistId: string) => void
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors duration-200',
        current ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-white/[0.05] outline-none ring-1 ring-inset ring-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        aria-label={`Play ${track.title}`}
      >
        {track.artwork ? (
          <img src={track.artwork} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <span className="grid size-full place-items-center text-dusk">
            {index !== undefined ? (
              <span className="font-mono text-[0.7rem] tabular-nums">{index + 1}</span>
            ) : (
              <Music4 aria-hidden className="size-4" />
            )}
          </span>
        )}

        <span
          className={cn(
            'absolute inset-0 grid place-items-center bg-void/60 transition-opacity duration-200',
            current ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
          )}
        >
          {current && playing ? (
            <Pause aria-hidden className="size-4 fill-chalk text-chalk" />
          ) : (
            <Play aria-hidden className="size-4 translate-x-px fill-chalk text-chalk" />
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onPlay}
        className="min-w-0 flex-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <span
          className={cn(
            'block truncate text-[0.88rem] leading-snug',
            current ? 'text-signal-bright' : 'text-chalk',
          )}
        >
          {track.title}
        </span>
        {(track.artist ?? track.album) && (
          <span className="mt-0.5 block truncate text-[0.74rem] text-dusk">
            {[track.artist, track.album].filter(Boolean).join(' · ')}
          </span>
        )}
      </button>

      {track.duration != null && (
        <span className="hidden shrink-0 font-mono text-[0.7rem] tabular-nums text-dusk sm:block">
          {formatTime(track.duration)}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {onLike && (
          <button
            type="button"
            onClick={onLike}
            aria-label={liked ? `Remove ${track.title} from liked` : `Like ${track.title}`}
            aria-pressed={liked}
            className={cn(
              'grid size-8 place-items-center rounded-full outline-none transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
              /* A filled heart is the row's own state and always shows; an
                 empty one is an offer, and only appears on approach. */
              liked
                ? 'text-signal-bright'
                : 'text-dusk opacity-0 hover:text-chalk focus-visible:opacity-100 group-hover/row:opacity-100',
            )}
          >
            <Heart aria-hidden className={cn('size-4', liked && 'fill-current')} />
          </button>
        )}

        {(playlists?.length ?? 0) > 0 && onAddToPlaylist && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Add ${track.title} to a playlist`}
                className="grid size-8 place-items-center rounded-full text-dusk opacity-0 outline-none transition-all duration-200 hover:text-chalk focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal group-hover/row:opacity-100 data-[state=open]:opacity-100"
              >
                <ListPlus aria-hidden className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {playlists!.map((playlist) => (
                <DropdownMenuItem
                  key={playlist.id}
                  onSelect={() => onAddToPlaylist(playlist.id)}
                  className="cursor-pointer"
                >
                  <span className="truncate">{playlist.name}</span>
                </DropdownMenuItem>
              ))}
              {onRemove && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onRemove} className="cursor-pointer" variant="destructive">
                    {removeLabel ?? 'Remove'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
