import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Heart,
  ListMusic,
  Loader2,
  Music4,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as musicApi from '@/features/music/api'
import { useMusic } from '@/features/music/MusicContext'
import { TrackCard, TrackGrid } from '@/features/music/TrackCard'
import { TrackRow } from '@/features/music/TrackRow'
import type {
  LibraryTrack,
  Playlist,
  TrackSearchResult,
} from '@/features/music/types'
import type { useLibrary } from '@/features/music/useLibrary'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const

type View = 'search' | 'liked' | 'playlists' | 'suggested'

const NAV: { id: View; label: string; icon: typeof Search }[] = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'liked', label: 'Liked', icon: Heart },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'suggested', label: 'Suggested', icon: Sparkles },
]

/** A YouTube result, in the shape the rest of the app stores songs in. */
const fromSearch = (result: TrackSearchResult): LibraryTrack => ({
  source: 'youtube',
  ref: result.id,
  title: result.title,
  artist: result.channel,
  album: null,
  artwork: result.thumbnail,
  duration: null,
})

/**
 * The library half of the music app.
 *
 * Everything that is not the record itself: finding songs, keeping them, and
 * choosing what plays next.
 *
 * Browsing is a grid of covers, because a cover is recognised long before a
 * title is read. A playlist stays a numbered list — there the running order is
 * the information, and a grid says nothing about what follows what.
 */
export function MusicBrowser({
  library,
  onSectionChange,
}: {
  library: ReturnType<typeof useLibrary>
  /** Lets the shell colour its header for whichever view is showing. */
  onSectionChange?: (view: View) => void
}) {
  const { roomId, snapshot, canSearch, onQueued, queue } = useMusic()

  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TrackSearchResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null)
  const [suggestions, setSuggestions] = useState<{
    history: LibraryTrack[]
    more: TrackSearchResult[]
  } | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  /* The song waiting on a playlist that does not exist yet. */
  const [newListFor, setNewListFor] = useState<LibraryTrack | null>(null)
  const [newListName, setNewListName] = useState('')

  const filePicker = useRef<HTMLInputElement>(null)
  const searchField = useRef<HTMLInputElement>(null)

  const current = snapshot?.track ?? null
  const playing = snapshot?.playing ?? false

  useEffect(() => {
    onSectionChange?.(view)
  }, [view, onSectionChange])

  useEffect(() => {
    if (view === 'search') searchField.current?.focus()
  }, [view])

  /* Suggestions follow whatever is on — the seed is the current artist, so the
     list is a continuation of this song rather than a fixed shelf. */
  useEffect(() => {
    if (view !== 'suggested' || !roomId) return
    setBusy(true)
    musicApi
      .fetchSuggestions(roomId, current?.artist)
      .then(setSuggestions)
      .catch(() => setSuggestions({ history: [], more: [] }))
      .finally(() => setBusy(false))
  }, [view, roomId, current?.artist])

  /**
   * Put a song on now.
   *
   * Everything reachable from here is a `LibraryTrack`, not a queue row — so
   * playing means adding it to the room's queue first and letting the normal
   * pending-id path start it, exactly as the picker does.
   */
  /**
   * Put a song in the room's queue, and optionally on right now.
   *
   * Everything reachable from here is a `LibraryTrack`, not a queue row, so
   * both actions go through the same add — the only difference is whether the
   * room is asked to load it immediately or leave it for later.
   */
  const enqueue = useCallback(
    async (track: LibraryTrack, playNow: boolean) => {
      if (!roomId) return
      setError(null)
      try {
        const queued = await musicApi.addToQueue(roomId, {
          source: track.source,
          ref: track.ref,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork: track.artwork,
          duration: track.duration,
        })
        onQueued(queued, playNow)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add that')
      }
    },
    [roomId, onQueued],
  )

  const play = useCallback(
    (track: LibraryTrack) => void enqueue(track, true),
    [enqueue],
  )

  const runSearch = useCallback(async () => {
    const value = query.trim()
    if (!value || !roomId) return

    setBusy(true)
    setError(null)
    setResults(null)

    try {
      const looksLikeLink = /^https?:\/\//i.test(value) || /^[\w-]{11}$/.test(value)

      /* A pasted link is an instruction, not a query — resolving it names the
         song properly and puts it straight on. */
      if (looksLikeLink) {
        const resolved = await musicApi.resolveInput(roomId, value)
        await enqueue(resolved, true)
        setQuery('')
        return
      }

      if (!canSearch) {
        setError('Search needs a YouTube API key on the server — paste a link instead.')
        return
      }

      setResults(await musicApi.searchTracks(roomId, value))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search')
    } finally {
      setBusy(false)
    }
  }, [query, roomId, canSearch, enqueue])

  const upload = useCallback(
    async (file: File | undefined) => {
      if (!file || !roomId) return
      setError(null)
      setUploadProgress(0)
      try {
        const resolved = await musicApi.uploadTrack(roomId, file, setUploadProgress)
        await enqueue(resolved, true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Upload failed')
      } finally {
        setUploadProgress(null)
      }
    },
    [roomId, enqueue],
  )

  const rowProps = useCallback(
    (track: LibraryTrack) => ({
      track,
      playing,
      current: current?.source === track.source && current.ref === track.ref,
      liked: library.isLiked(track),
      playlists: library.playlists,
      onPlay: () => play(track),
      onQueue: () => void enqueue(track, false),
      onLike: () => void library.toggleLike(track),
      onAddToPlaylist: (playlistId: string) => void library.addToPlaylist(playlistId, track),
      onNewPlaylist: () => {
        setNewListName('')
        setNewListFor(track)
      },
    }),
    [playing, current, library, play, enqueue],
  )

  const heading = useMemo(() => NAV.find((entry) => entry.id === view)!, [view])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={filePicker}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/opus,audio/wav,audio/flac"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {/*
        Naming a new playlist without losing the song that prompted it.
        The track is held while the name is typed, then both happen together —
        so "add this to a new playlist" is one action rather than three.
      */}
      <Dialog open={newListFor !== null} onOpenChange={(open) => !open && setNewListFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New playlist</DialogTitle>
            <DialogDescription>
              {newListFor
                ? `“${newListFor.title}” goes in first. Everyone in the room can see it.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const name = newListName.trim()
              const track = newListFor
              if (!name || !track) return
              setNewListFor(null)
              void library.createPlaylist(name).then((created) => {
                if (created) void library.addToPlaylist(created.id, track)
              })
            }}
          >
            <input
              autoFocus
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder="Name this playlist"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-[0.88rem] text-chalk outline-none placeholder:text-dusk focus:border-white/25"
            />
            <button
              type="submit"
              disabled={newListName.trim().length === 0}
              className="shrink-0 rounded-full bg-chalk px-4 text-[0.82rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
            >
              Create
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/*
        The rail. Horizontal on a phone and vertical from `md` up — the same
        four destinations either way, so the app does not change shape, only
        orientation.
      */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 pt-1 md:w-52 md:flex-col md:overflow-visible md:px-4 md:pb-6 md:pt-2">
          {NAV.map((entry) => {
            const Icon = entry.icon
            const active = view === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setView(entry.id)
                  setOpenPlaylist(null)
                }}
                className={cn(
                  'relative flex min-h-11 shrink-0 items-center gap-2.5 rounded-full px-3.5 py-2 text-left outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-0 md:rounded-xl',
                  active ? 'text-chalk' : 'text-mist hover:text-chalk',
                )}
              >
                {/* The selection is a moving object, not a class that blinks
                    between items — Motion carries it between destinations. */}
                {active && (
                  <motion.span
                    layoutId="music-nav-active"
                    className="absolute inset-0 rounded-full bg-white/[0.09] ring-1 ring-inset ring-white/10 md:rounded-xl"
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
                <Icon aria-hidden className="relative size-4 shrink-0" />
                <span className="relative text-[0.85rem] font-medium">{entry.label}</span>
              </button>
            )
          })}

          <div className="hidden md:mt-auto md:block md:px-1">
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              disabled={uploadProgress !== null}
              className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/12 px-3.5 py-2.5 text-left text-[0.8rem] text-mist outline-none transition-colors hover:border-white/25 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
            >
              {uploadProgress !== null ? (
                <>
                  <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                  <span>{Math.round(uploadProgress * 100)}%</span>
                </>
              ) : (
                <>
                  <Upload aria-hidden className="size-4 shrink-0" />
                  <span>Upload a track</span>
                </>
              )}
            </button>
          </div>
        </nav>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 md:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={openPlaylist ? `playlist-${openPlaylist.id}` : view}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <div className="shrink-0 pb-3">
                <h2 className="font-display text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em] text-chalk">
                  {openPlaylist ? openPlaylist.name : heading.label}
                </h2>
                {openPlaylist && (
                  <p className="mt-1 text-[0.78rem] text-dusk">
                    {openPlaylist.tracks.length}{' '}
                    {openPlaylist.tracks.length === 1 ? 'song' : 'songs'} · made by{' '}
                    {openPlaylist.createdBy.name}
                  </p>
                )}
              </div>

              {view === 'search' && !openPlaylist && (
                <form
                  className="shrink-0 pb-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void runSearch()
                  }}
                >
                  <div className="relative">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-dusk"
                    />
                    <input
                      ref={searchField}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={
                        canSearch
                          ? 'Search for a song, or paste a link'
                          : 'Paste a YouTube link, or a direct audio URL'
                      }
                      spellCheck={false}
                      className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-4 text-[0.9rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-white/25 focus:bg-white/[0.06]"
                    />
                    {busy && (
                      <Loader2
                        aria-hidden
                        className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-mist"
                      />
                    )}
                  </div>
                </form>
              )}

              {error && (
                <p
                  role="alert"
                  className="mb-3 shrink-0 rounded-xl border border-signal/25 bg-signal/[0.08] px-4 py-2.5 text-[0.8rem] text-signal-bright"
                >
                  {error}
                </p>
              )}

              <ScrollArea className="min-h-0 flex-1" data-lenis-prevent>
                <div className="pb-6 pr-3">
                  {openPlaylist ? (
                    <PlaylistDetail
                      playlist={openPlaylist}
                      rowProps={rowProps}
                      onRemove={(trackId) =>
                        void library.removeFromPlaylist(openPlaylist.id, trackId)
                      }
                    />
                  ) : view === 'search' ? (
                    <SearchView results={results} rowProps={rowProps} queued={queue.length} />
                  ) : view === 'liked' ? (
                    <LikedView tracks={library.liked} rowProps={rowProps} />
                  ) : view === 'playlists' ? (
                    <PlaylistsView
                      library={library}
                      onOpen={setOpenPlaylist}
                    />
                  ) : (
                    <SuggestedView
                      suggestions={suggestions}
                      busy={busy}
                      seed={current?.artist ?? null}
                      rowProps={rowProps}
                    />
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

/* ── Views ─────────────────────────────────────────────────────────────── */

function Empty({ icon: Icon, title, body }: { icon: typeof Music4; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-mist ring-1 ring-inset ring-white/10">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="mt-4 font-display text-[1.05rem] font-semibold text-chalk">{title}</p>
      <p className="mt-1.5 max-w-sm text-[0.84rem] leading-relaxed text-mist">{body}</p>
    </div>
  )
}

type RowProps = (track: LibraryTrack) => React.ComponentProps<typeof TrackRow>

function SearchView({
  results,
  rowProps,
  queued,
}: {
  results: TrackSearchResult[] | null
  rowProps: RowProps
  queued: number
}) {
  if (!results) {
    return (
      <Empty
        icon={Search}
        title="Find something to play"
        body={
          queued > 0
            ? 'Search for a song, paste a link, or open the queue to carry on where the room left off.'
            : 'Search for a song, or paste a YouTube link or a direct audio URL.'
        }
      />
    )
  }

  if (results.length === 0) {
    return <Empty icon={Search} title="Nothing found" body="Try a different set of words." />
  }

  return (
    <TrackGrid>
      {results.map((result) => (
        <TrackCard key={result.id} {...rowProps(fromSearch(result))} />
      ))}
    </TrackGrid>
  )
}

function LikedView({ tracks, rowProps }: { tracks: LibraryTrack[]; rowProps: RowProps }) {
  if (tracks.length === 0) {
    return (
      <Empty
        icon={Heart}
        title="Nothing saved yet"
        body="Hearts you press anywhere in here land in this list. It is yours — nobody else in the room sees it."
      />
    )
  }

  return (
    <TrackGrid>
      {tracks.map((track) => (
        <TrackCard key={`${track.source}:${track.ref}`} {...rowProps(track)} />
      ))}
    </TrackGrid>
  )
}

function PlaylistsView({
  library,
  onOpen,
}: {
  library: ReturnType<typeof useLibrary>
  onOpen: (playlist: Playlist) => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  return (
    <div className="flex flex-col gap-0.5">
      <div className="pb-2">
        {naming ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const value = name.trim()
              if (!value) return
              void library.createPlaylist(value)
              setName('')
              setNaming(false)
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this playlist"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-[0.88rem] text-chalk outline-none placeholder:text-dusk focus:border-white/25"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-chalk px-4 text-[0.82rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              aria-label="Cancel"
              className="grid size-11 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk"
            >
              <X aria-hidden className="size-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/12 px-4 py-3 text-left text-[0.85rem] text-mist outline-none transition-colors hover:border-white/25 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <Plus aria-hidden className="size-4" />
            New playlist
          </button>
        )}
      </div>

      {library.playlists.length === 0 ? (
        <Empty
          icon={ListMusic}
          title="No playlists yet"
          body="Playlists belong to the room, so anyone here can open one — and everyone can see who made it."
        />
      ) : (
        library.playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="group/list flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.05]"
          >
            <button
              type="button"
              onClick={() => onOpen(playlist)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.05] text-dusk ring-1 ring-inset ring-white/10">
                {playlist.tracks[0]?.artwork ? (
                  <img src={playlist.tracks[0].artwork} alt="" className="size-full object-cover" />
                ) : (
                  <ListMusic aria-hidden className="size-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.88rem] text-chalk">{playlist.name}</span>
                <span className="mt-0.5 block truncate text-[0.74rem] text-dusk">
                  {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'} ·{' '}
                  {playlist.createdBy.name}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => void library.removePlaylist(playlist.id)}
              aria-label={`Delete ${playlist.name}`}
              className="grid size-8 shrink-0 place-items-center rounded-full text-dusk opacity-0 outline-none transition-all hover:text-signal-bright focus-visible:opacity-100 group-hover/list:opacity-100"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function PlaylistDetail({
  playlist,
  rowProps,
  onRemove,
}: {
  playlist: Playlist
  rowProps: RowProps
  onRemove: (trackId: string) => void
}) {
  if (playlist.tracks.length === 0) {
    return (
      <Empty
        icon={ListMusic}
        title="This playlist is empty"
        body="Add songs to it from the menu on any row in search, liked, or suggested."
      />
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {playlist.tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          index={index}
          {...rowProps(track)}
          onRemove={() => onRemove(track.id)}
          removeLabel="Remove from this playlist"
        />
      ))}
    </div>
  )
}

function SuggestedView({
  suggestions,
  busy,
  seed,
  rowProps,
}: {
  suggestions: { history: LibraryTrack[]; more: TrackSearchResult[] } | null
  busy: boolean
  seed: string | null
  rowProps: RowProps
}) {
  if (busy && !suggestions) {
    return (
      <div className="grid place-items-center py-14">
        <Loader2 aria-hidden className="size-5 animate-spin text-mist" />
      </div>
    )
  }

  const history = suggestions?.history ?? []
  const more = suggestions?.more ?? []

  if (history.length === 0 && more.length === 0) {
    return (
      <Empty
        icon={Sparkles}
        title="Nothing to suggest yet"
        body="This list is built from what the room has actually played. Put a few songs on and it fills up."
      />
    )
  }

  return (
    <>
      {more.length > 0 && (
        <>
          {/*
            Labelled for what it is. This is a search for more from the current
            artist, not a model of anyone's taste — calling it "more like this"
            would be claiming an understanding the app does not have.
          */}
          <p className="px-0.5 pb-2.5 pt-1 text-[0.7rem] uppercase tracking-[0.18em] text-dusk">
            More from {seed}
          </p>
          <TrackGrid>
            {more.map((result) => (
              <TrackCard key={result.id} {...rowProps(fromSearch(result))} />
            ))}
          </TrackGrid>
        </>
      )}

      {history.length > 0 && (
        <>
          <p className="px-0.5 pb-2.5 pt-4 text-[0.7rem] uppercase tracking-[0.18em] text-dusk">
            Played in this room
          </p>
          <TrackGrid>
            {history.map((track) => (
              <TrackCard key={`${track.source}:${track.ref}`} {...rowProps(track)} />
            ))}
          </TrackGrid>
        </>
      )}
    </>
  )
}
