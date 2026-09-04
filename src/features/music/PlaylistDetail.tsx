import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ImagePlus,
  ListMusic,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'

import { PlaylistCover } from '@/features/music/PlaylistCover'
import { TrackRow } from '@/features/music/TrackRow'
import { formatTime, type LibraryTrack, type Playlist } from '@/features/music/types'
import type { useLibrary } from '@/features/music/useLibrary'
import { downscaleImage } from '@/features/settings/downscaleImage'
import { cn } from '@/lib/utils'

type RowProps = (track: LibraryTrack) => React.ComponentProps<typeof TrackRow>

/**
 * A playlist, opened.
 *
 * A cover built from its songs (or one the maker uploaded), a name and a byline,
 * then the running order. An Edit mode turns the list into something you can
 * rearrange — move songs up and down, drop ones you're done with — and lets the
 * name, byline and cover be changed. Everything saves as it happens.
 */
export function PlaylistDetail({
  playlist,
  library,
  rowProps,
  onBack,
}: {
  playlist: Playlist
  library: ReturnType<typeof useLibrary>
  rowProps: RowProps
  onBack: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(playlist.name)
  const [description, setDescription] = useState(playlist.description ?? '')
  const coverPicker = useRef<HTMLInputElement>(null)

  /* Keep the drafts in step if the playlist changes underneath (a song added
     from elsewhere, say) while not editing. */
  useEffect(() => {
    if (!editing) {
      setName(playlist.name)
      setDescription(playlist.description ?? '')
    }
  }, [playlist.name, playlist.description, editing])

  const tracks = playlist.tracks
  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration ?? 0), 0)

  const saveMeta = () => {
    const trimmed = name.trim()
    void library.updatePlaylist(playlist.id, {
      name: trimmed || playlist.name,
      description: description.trim() || null,
    })
  }

  const move = (index: number, delta: number) => {
    const next = index + delta
    if (next < 0 || next >= tracks.length) return
    const ids = tracks.map((t) => t.id)
    ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
    void library.reorderPlaylist(playlist.id, ids)
  }

  const chooseCover = async (file: File | undefined) => {
    if (!file) return
    try {
      const dataUrl = await downscaleImage(file, 512)
      void library.updatePlaylist(playlist.id, { cover: dataUrl })
    } catch {
      /* A bad file just does nothing; the song-quilt cover stays. */
    }
  }

  const playFirst = () => {
    if (tracks[0]) rowProps(tracks[0]).onPlay()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header — cover, name, byline, and the count. */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="relative shrink-0">
          <PlaylistCover
            playlist={playlist}
            rounded="rounded-2xl"
            className="size-40 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-white/10 sm:size-44"
          />
          {editing && (
            <>
              <input
                ref={coverPicker}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void chooseCover(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => coverPicker.current?.click()}
                className="absolute inset-0 grid place-items-center rounded-2xl bg-black/55 text-white outline-none transition-opacity hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="flex flex-col items-center gap-1.5 text-[0.78rem]">
                  <ImagePlus aria-hidden className="size-5" />
                  Change cover
                </span>
              </button>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] uppercase tracking-[0.2em] text-dusk">Playlist</p>
          {editing ? (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveMeta}
              maxLength={120}
              placeholder="Playlist name"
              className="mt-1.5 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 font-display text-[clamp(1.4rem,3vw,2rem)] font-semibold tracking-[-0.02em] text-chalk outline-none focus:border-white/25"
            />
          ) : (
            <h2 className="mt-1 font-display text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-[-0.03em] text-chalk">
              {playlist.name}
            </h2>
          )}

          {editing ? (
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={saveMeta}
              maxLength={300}
              placeholder="Add a byline (optional)"
              className="mt-2 w-full rounded-lg border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[0.85rem] text-mist outline-none placeholder:text-dusk focus:border-white/25"
            />
          ) : (
            playlist.description && (
              <p className="mt-2 max-w-xl text-[0.88rem] leading-relaxed text-mist">
                {playlist.description}
              </p>
            )
          )}

          <p className="mt-3 text-[0.76rem] text-dusk">
            {playlist.createdBy.name} · {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
            {totalSeconds > 0 && ` · ${formatDuration(totalSeconds)}`}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={playFirst}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 rounded-full bg-signal px-5 py-2.5 text-[0.85rem] font-semibold text-white outline-none transition-colors hover:bg-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
            >
              <Play aria-hidden className="size-4 translate-x-px fill-current" />
              Play
            </button>
            <button
              type="button"
              onClick={() => {
                if (editing) saveMeta()
                setEditing((e) => !e)
              }}
              className={cn(
                'flex items-center gap-2 rounded-full border px-4 py-2.5 text-[0.85rem] font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                editing
                  ? 'border-signal/50 bg-signal/10 text-chalk'
                  : 'border-white/12 text-chalk hover:border-white/25 hover:bg-white/[0.06]',
              )}
            >
              {editing ? <Check aria-hidden className="size-4" /> : <Pencil aria-hidden className="size-4" />}
              {editing ? 'Done' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-full px-3 py-2.5 text-[0.85rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Back
            </button>
          </div>
        </div>
      </div>

      {/* The running order. */}
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-mist ring-1 ring-inset ring-white/10">
            <ListMusic aria-hidden className="size-5" />
          </span>
          <p className="mt-4 font-display text-[1.05rem] font-semibold text-chalk">This playlist is empty</p>
          <p className="mt-1.5 max-w-sm text-[0.84rem] leading-relaxed text-mist">
            Add songs to it from the menu on any row in Search or Liked.
          </p>
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-0.5">
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04]"
            >
              <span className="w-5 shrink-0 text-center font-mono text-[0.72rem] tabular-nums text-dusk">
                {index + 1}
              </span>
              <span className="size-10 shrink-0 overflow-hidden rounded-md bg-white/[0.05] ring-1 ring-inset ring-white/10">
                {track.artwork && <img src={track.artwork} alt="" className="size-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.86rem] text-chalk">{track.title}</span>
                {track.artist && (
                  <span className="block truncate text-[0.74rem] text-dusk">{track.artist}</span>
                )}
              </span>
              {track.duration != null && (
                <span className="hidden shrink-0 font-mono text-[0.7rem] tabular-nums text-dusk sm:block">
                  {formatTime(track.duration)}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                <IconBtn label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp aria-hidden className="size-4" />
                </IconBtn>
                <IconBtn
                  label="Move down"
                  disabled={index === tracks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </IconBtn>
                <IconBtn
                  label={`Remove ${track.title}`}
                  onClick={() => void library.removeFromPlaylist(playlist.id, track.id)}
                  danger
                >
                  <Trash2 aria-hidden className="size-4" />
                </IconBtn>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              index={index}
              {...rowProps(track)}
              onRemove={() => void library.removeFromPlaylist(playlist.id, track.id)}
              removeLabel="Remove from this playlist"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled = false,
  danger = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'grid size-8 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-25',
        danger && 'hover:text-signal-bright',
      )}
    >
      {children}
    </button>
  )
}

/** "3 min", "1 hr 24 min" — a running time people read at a glance. */
function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rest = mins % 60
  return rest ? `${hrs} hr ${rest} min` : `${hrs} hr`
}
