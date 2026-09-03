import { Heart, ListEnd, ListPlus, Music4, Pause, Play, Plus } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { LibraryTrack, Playlist } from '@/features/music/types'
import { cn } from '@/lib/utils'

/**
 * One song, as a card.
 *
 * The artwork does the identifying — people recognise a cover long before they
 * finish reading a title, which is the whole argument for a grid over a list
 * once songs have art. Everything else is subordinate to it: two lines of text
 * beneath, and controls that only surface on approach so a wall of these stays
 * quiet.
 *
 * The play affordance sits *on* the cover rather than beside it, so the target
 * is the thing you were already looking at.
 */
export function TrackCard({
  track,
  playing,
  current,
  liked,
  playlists,
  onPlay,
  onQueue,
  onLike,
  onAddToPlaylist,
  onNewPlaylist,
  onRemove,
  removeLabel,
}: {
  track: LibraryTrack
  playing?: boolean
  current?: boolean
  liked?: boolean
  playlists?: Playlist[]
  onPlay: () => void
  /** Line it up without interrupting what the room is already hearing. */
  onQueue?: () => void
  onLike?: () => void
  onAddToPlaylist?: (playlistId: string) => void
  /** Make one and put this song in it, without leaving the song. */
  onNewPlaylist?: () => void
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <div className="group/card relative flex flex-col">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${track.title}`}
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-xl bg-white/[0.05] outline-none ring-1 ring-inset transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal',
          current ? 'ring-signal/50' : 'ring-white/10 group-hover/card:ring-white/20',
        )}
      >
        {track.artwork ? (
          <img
            src={track.artwork}
            alt=""
            loading="lazy"
            /* Nudged in on hover — the cover is the button, so it should feel
               like one without the card itself moving and reflowing the grid. */
            className="size-full object-cover transition-transform duration-500 ease-glass group-hover/card:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center text-dusk">
            <Music4 aria-hidden className="size-7" />
          </span>
        )}

        <span
          className={cn(
            'absolute inset-0 bg-gradient-to-t from-void/70 via-transparent to-transparent transition-opacity duration-300',
            current ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
          )}
        />

        <span
          className={cn(
            'absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full bg-chalk text-void shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)] transition-all duration-300',
            current
              ? 'translate-y-0 opacity-100'
              : 'translate-y-2 opacity-0 group-hover/card:translate-y-0 group-hover/card:opacity-100',
          )}
        >
          {current && playing ? (
            <Pause aria-hidden className="size-4 fill-current" />
          ) : (
            <Play aria-hidden className="size-4 translate-x-px fill-current" />
          )}
        </span>
      </button>

      <div className="flex items-start gap-1 px-0.5 pt-2.5">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-[0.84rem] leading-snug',
              current ? 'text-signal-bright' : 'text-chalk',
            )}
            title={track.title}
          >
            {track.title}
          </p>
          {track.artist && (
            <p className="mt-0.5 truncate text-[0.75rem] text-dusk" title={track.artist}>
              {track.artist}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          {onQueue && (
            <button
              type="button"
              onClick={onQueue}
              aria-label={`Add ${track.title} to the queue`}
              className="grid size-7 place-items-center rounded-full text-dusk opacity-0 outline-none transition-all duration-200 hover:text-chalk focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal group-hover/card:opacity-100"
            >
              <ListEnd aria-hidden className="size-3.5" />
            </button>
          )}

          {onLike && (
            <button
              type="button"
              onClick={onLike}
              aria-label={liked ? `Remove ${track.title} from liked` : `Like ${track.title}`}
              aria-pressed={liked}
              className={cn(
                'grid size-7 place-items-center rounded-full outline-none transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                /* A filled heart is state and always shows; an empty one is an
                   offer, and only appears on approach. */
                liked
                  ? 'text-signal-bright'
                  : 'text-dusk opacity-0 hover:text-chalk focus-visible:opacity-100 group-hover/card:opacity-100',
              )}
            >
              <Heart aria-hidden className={cn('size-3.5', liked && 'fill-current')} />
            </button>
          )}

          {/*
            Always offered, even with no playlists yet.
            Hiding it until one existed meant the first playlist could only be
            made from the Playlists tab — so the answer to "save this song"
            was to leave the song, create a list, and come back and find it
            again.
          */}
          {onAddToPlaylist && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Add ${track.title} to a playlist`}
                  className="grid size-7 place-items-center rounded-full text-dusk opacity-0 outline-none transition-all duration-200 hover:text-chalk focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal group-hover/card:opacity-100 data-[state=open]:opacity-100"
                >
                  <ListPlus aria-hidden className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
                <DropdownMenuSeparator />

                {onNewPlaylist && (
                  <DropdownMenuItem onSelect={onNewPlaylist} className="cursor-pointer">
                    <Plus aria-hidden className="size-3.5" />
                    <span>New playlist…</span>
                  </DropdownMenuItem>
                )}

                {(playlists?.length ?? 0) > 0 && onNewPlaylist && <DropdownMenuSeparator />}

                {(playlists ?? []).map((playlist) => (
                  <DropdownMenuItem
                    key={playlist.id}
                    onSelect={() => onAddToPlaylist(playlist.id)}
                    className="cursor-pointer"
                  >
                    <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                    {/* Whose list it is — these are shared with the room, so
                        the name alone does not say enough. */}
                    <span className="ml-2 shrink-0 text-[0.7rem] text-dusk">
                      {playlist.createdBy.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                {onRemove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={onRemove}
                      className="cursor-pointer"
                      variant="destructive"
                    >
                      {removeLabel ?? 'Remove'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}

/** The shared grid every collection of cards sits in. */
export function TrackGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 pb-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  )
}
