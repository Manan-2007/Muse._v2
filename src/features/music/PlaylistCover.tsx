import { ListMusic } from 'lucide-react'

import type { Playlist } from '@/features/music/types'
import { cn } from '@/lib/utils'

/**
 * A playlist's face.
 *
 * A custom cover if the maker set one; otherwise a quilt of the first few
 * songs' artwork — four in a grid the way every music app draws an auto-cover,
 * one filled square if that's all there is, and a plain mark for an empty
 * playlist. So a playlist always looks like the music in it without anyone
 * having to design a cover.
 */
export function PlaylistCover({
  playlist,
  className,
  rounded = 'rounded-lg',
}: {
  playlist: Pick<Playlist, 'cover' | 'tracks'>
  className?: string
  rounded?: string
}) {
  if (playlist.cover) {
    return (
      <span className={cn('block overflow-hidden', rounded, className)}>
        <img src={playlist.cover} alt="" className="size-full object-cover" />
      </span>
    )
  }

  const arts = playlist.tracks.map((t) => t.artwork).filter((a): a is string => Boolean(a))

  if (arts.length === 0) {
    return (
      <span
        className={cn(
          'grid place-items-center bg-gradient-to-br from-signal/30 to-signal-deep/40 text-chalk/80',
          rounded,
          className,
        )}
      >
        <ListMusic aria-hidden className="size-1/3" />
      </span>
    )
  }

  if (arts.length < 4) {
    return (
      <span className={cn('block overflow-hidden', rounded, className)}>
        <img src={arts[0]} alt="" className="size-full object-cover" />
      </span>
    )
  }

  return (
    <span className={cn('grid grid-cols-2 grid-rows-2 overflow-hidden', rounded, className)}>
      {arts.slice(0, 4).map((art, i) => (
        <img key={i} src={art} alt="" className="size-full object-cover" />
      ))}
    </span>
  )
}
