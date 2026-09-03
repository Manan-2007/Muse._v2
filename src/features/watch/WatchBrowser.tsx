import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clapperboard, FolderOpen, ListVideo, Loader2, Search, Upload } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import * as watchApi from '@/features/watch/api'
import { PosterCard, PosterGrid } from '@/features/watch/PosterCard'
import type { LibraryEntry, QueueItem, SearchResult } from '@/features/watch/types'
import type { Queued } from '@/features/watch/SourcePicker'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const

type View = 'search' | 'library' | 'queue'

const NAV: { id: View; label: string; icon: typeof Search }[] = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'On the server', icon: FolderOpen },
  { id: 'queue', label: 'Up next', icon: ListVideo },
]

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Choosing what the room watches.
 *
 * The same shape as the music library — a rail, a grid, one scrolling column —
 * because it is the same job: find a thing, then put it on. What differs is
 * what a video needs said about it. There is no artist and no album; there is
 * a channel, a running time, and occasionally the fact that a file on the
 * server is in a container no browser will open.
 *
 * Deliberately not a mirror of the music page. There is no "liked", because
 * nobody keeps a film the way they keep a song, and no suggestions, because
 * the honest basis for those — what this room has played before — is a
 * handful of rows rather than a taste.
 */
export function WatchBrowser({
  roomId,
  canSearch,
  queue,
  nowPlayingRef,
  playing,
  onQueued,
  onPlayQueued,
}: {
  roomId: string
  canSearch: boolean
  queue: QueueItem[]
  /** The `ref` of what is on, so the grid can mark it. */
  nowPlayingRef: string | null
  playing: boolean
  onQueued: (queued: Queued, playNow: boolean) => void
  onPlayQueued: (item: QueueItem) => void
}) {
  const [view, setView] = useState<View>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null)
  /** Which file is being asked about, so the confirm is inline rather than a window.confirm. */
  const [pendingDelete, setPendingDelete] = useState<LibraryEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const filePicker = useRef<HTMLInputElement>(null)
  const searchField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (view === 'search') searchField.current?.focus()
  }, [view])

  /* Read fresh each time it is opened — the folder is the source of truth, and
     something dropped in a moment ago should already be there. */
  useEffect(() => {
    if (view !== 'library') return
    setBusy(true)
    watchApi
      .fetchLibrary(roomId)
      .then(setLibrary)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not read the server folder'),
      )
      .finally(() => setBusy(false))
  }, [view, roomId])

  /*
   * Asking, not doing.
   *
   * This removes the file and everything published from it, and there is no
   * undo behind it — so the click opens a question rather than performing the
   * deletion. Inline rather than `window.confirm`, which cannot say which file
   * or that the streamed copy goes with it, and which some mobile browsers
   * suppress outright.
   */
  const removeFile = useCallback((entry: LibraryEntry) => {
    setError(null)
    setPendingDelete(entry)
  }, [])

  const confirmDelete = useCallback(async () => {
    const entry = pendingDelete
    if (!entry || deleting) return

    setDeleting(true)
    setError(null)
    try {
      await watchApi.deleteFromLibrary(roomId, entry.file)
      /* Dropped locally rather than refetched: the answer is already known,
         and a round trip here would blank the grid for a moment. */
      setLibrary((current) => current?.filter((item) => item.file !== entry.file) ?? null)
      setPendingDelete(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete that file')
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete, deleting, roomId])

  const add = useCallback(
    async (item: Parameters<typeof watchApi.addToQueue>[1], playNow: boolean) => {
      setError(null)
      try {
        onQueued(await watchApi.addToQueue(roomId, item), playNow)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not add that')
      }
    },
    [roomId, onQueued],
  )

  const runSearch = useCallback(async () => {
    const value = query.trim()
    if (!value) return

    setBusy(true)
    setError(null)
    setResults(null)

    try {
      const looksLikeLink = /^https?:\/\//i.test(value) || /^[\w-]{11}$/.test(value)

      /* A pasted link is an instruction rather than a question — resolve it
         and put it on. It is also the only way to reach the platforms that
         cannot be embedded, which resolve into the room's shared countdown. */
      if (looksLikeLink) {
        const resolved = await watchApi.resolveInput(roomId, value)
        await add(resolved, true)
        setQuery('')
        return
      }

      if (!canSearch) {
        setError('Search needs a YouTube API key on the server — paste a link instead.')
        return
      }

      setResults(await watchApi.searchVideos(roomId, value))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search')
    } finally {
      setBusy(false)
    }
  }, [query, roomId, canSearch, add])

  const upload = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)
      setProgress(0)
      try {
        await add(await watchApi.uploadVideo(roomId, file, setProgress), true)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Upload failed')
      } finally {
        setProgress(null)
      }
    },
    [roomId, add],
  )

  const heading = useMemo(() => NAV.find((entry) => entry.id === view)!, [view])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <input
        ref={filePicker}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime"
        className="hidden"
        onChange={(event) => {
          void upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 pt-1 md:w-52 md:flex-col md:overflow-visible md:px-4 md:pb-6 md:pt-2">
          {NAV.map((entry) => {
            const Icon = entry.icon
            const active = view === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setView(entry.id)}
                className={cn(
                  'relative flex min-h-11 shrink-0 items-center gap-2.5 rounded-full px-3.5 py-2 text-left outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-0 md:rounded-xl',
                  active ? 'text-chalk' : 'text-mist hover:text-chalk',
                )}
              >
                {/* One moving marker rather than a class that blinks between
                    items — the same treatment the music rail uses. */}
                {active && (
                  <motion.span
                    layoutId="watch-nav-active"
                    className="absolute inset-0 rounded-full bg-white/[0.09] ring-1 ring-inset ring-white/10 md:rounded-xl"
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
                <Icon aria-hidden className="relative size-4 shrink-0" />
                <span className="relative text-[0.85rem] font-medium">{entry.label}</span>
                {entry.id === 'queue' && queue.length > 0 && (
                  <span className="relative ml-auto text-[0.72rem] tabular-nums text-dusk">
                    {queue.length}
                  </span>
                )}
              </button>
            )
          })}

          <div className="hidden md:mt-auto md:block md:px-1">
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              disabled={progress !== null}
              className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/12 px-3.5 py-2.5 text-left text-[0.8rem] text-mist outline-none transition-colors hover:border-white/25 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-50"
            >
              {progress !== null ? (
                <>
                  <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                  <span>{Math.round(progress * 100)}%</span>
                </>
              ) : (
                <>
                  <Upload aria-hidden className="size-4 shrink-0" />
                  <span>Upload a video</span>
                </>
              )}
            </button>
          </div>
        </nav>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 md:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <h2 className="shrink-0 pb-3 font-display text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em] text-chalk">
                {heading.label}
              </h2>

              {view === 'search' && (
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
                          ? 'Search YouTube, or paste any link'
                          : 'Paste a YouTube link, or a direct video URL'
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
                  {view === 'search' ? (
                    results === null ? (
                      <Empty
                        title="Find something to watch"
                        body="Search YouTube, paste a link, or drop a file into the server folder and pick it from there."
                      />
                    ) : results.length === 0 ? (
                      <Empty title="Nothing found" body="Try a different set of words." />
                    ) : (
                      <PosterGrid>
                        {results.map((result) => (
                          <PosterCard
                            key={result.id}
                            item={{
                              source: 'youtube',
                              ref: result.id,
                              title: result.title,
                              subtitle: result.channel,
                              thumbnail: result.thumbnail,
                            }}
                            current={nowPlayingRef === result.id}
                            playing={playing}
                            onPlay={() =>
                              void add(
                                {
                                  source: 'youtube',
                                  ref: result.id,
                                  title: result.title,
                                  duration: null,
                                  thumbnail: result.thumbnail,
                                },
                                true,
                              )
                            }
                            onQueue={() =>
                              void add(
                                {
                                  source: 'youtube',
                                  ref: result.id,
                                  title: result.title,
                                  duration: null,
                                  thumbnail: result.thumbnail,
                                },
                                false,
                              )
                            }
                          />
                        ))}
                      </PosterGrid>
                    )
                  ) : view === 'library' ? (
                    busy && !library ? (
                      <div className="grid place-items-center py-14">
                        <Loader2 aria-hidden className="size-5 animate-spin text-mist" />
                      </div>
                    ) : !library || library.length === 0 ? (
                      <Empty
                        title="Nothing in the uploads folder"
                        body="Drop a video into server/uploads/ on the machine running the backend and it shows up here."
                      />
                    ) : (
                      <>
                        <PosterGrid>
                          {library.map((entry) => (
                            <PosterCard
                              key={entry.file}
                              item={{
                                source: 'file',
                                ref: entry.hls ?? entry.ref,
                                title: entry.title,
                                subtitle: entry.hls
                                  ? `${formatBytes(entry.bytes)} · streaming`
                                  : formatBytes(entry.bytes),
                                thumbnail: entry.thumbnail,
                                duration: entry.duration,
                                playable: entry.playable,
                                reason: !entry.playable
                                  ? "Browsers can't play this container"
                                  : !entry.fastStart && !entry.hls
                                    ? 'Slow to start — needs remuxing'
                                    : null,
                              }}
                              current={nowPlayingRef === (entry.hls ?? entry.ref)}
                              playing={playing}
                              onPlay={() =>
                                void add(
                                  {
                                    source: 'file',
                                    ref: entry.hls ?? entry.ref,
                                    title: entry.title,
                                    duration: entry.duration,
                                    thumbnail: entry.thumbnail,
                                  },
                                  true,
                                )
                              }
                              onQueue={() =>
                                void add(
                                  {
                                    source: 'file',
                                    ref: entry.hls ?? entry.ref,
                                    title: entry.title,
                                    duration: entry.duration,
                                    thumbnail: entry.thumbnail,
                                  },
                                  false,
                                )
                              }
                              onDelete={() => void removeFile(entry)}
                            />
                          ))}
                        </PosterGrid>

                        {library.some((entry) => !entry.playable) && (
                          <p className="mt-3 px-1 text-[0.7rem] leading-relaxed text-dusk">
                            Greyed-out files are containers no browser will play (.mkv, .avi).
                            Convert one with{' '}
                            <code className="font-mono text-[0.68rem] text-mist">
                              ffmpeg -i in.mkv -c:v copy -c:a aac out.mp4
                            </code>{' '}
                            and it appears here ready to go.
                          </p>
                        )}
                      </>
                    )
                  ) : queue.length === 0 ? (
                    <Empty
                      title="Nothing lined up"
                      body="Whatever you add plays for the whole room at once."
                    />
                  ) : (
                    <PosterGrid>
                      {queue.map((item) => (
                        <PosterCard
                          key={item.id}
                          item={{
                            source: item.source,
                            ref: item.ref,
                            title: item.title,
                            subtitle: item.addedBy.name,
                            thumbnail: item.thumbnail,
                            duration: item.duration,
                          }}
                          current={nowPlayingRef === item.ref}
                          playing={playing}
                          onPlay={() => onPlayQueued(item)}
                        />
                      ))}
                    </PosterGrid>
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-50 grid place-items-center bg-void/70 p-5 backdrop-blur-sm"
            onClick={() => !deleting && setPendingDelete(null)}
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-label={`Delete ${pendingDelete.title}`}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-white/12 bg-[rgb(16_16_20/0.97)] p-5 shadow-[0_30px_80px_-24px_rgb(0_0_0/0.9)]"
            >
              <h3 className="font-display text-[1.02rem] font-semibold tracking-[-0.015em] text-chalk">
                Delete this from the server?
              </h3>
              <p className="mt-2 break-words text-[0.85rem] leading-relaxed text-mist">
                <span className="text-chalk">{pendingDelete.title}</span> will be removed from the
                uploads folder
                {pendingDelete.hls ? ', along with the streamed copy on the CDN' : ''}. This cannot
                be undone.
              </p>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  flat
                  onClick={() => setPendingDelete(null)}
                  disabled={deleting}
                >
                  Keep it
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  flat
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="border-rose-400/40 text-rose-200 hover:border-rose-400/70 hover:text-rose-100"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-mist ring-1 ring-inset ring-white/10">
        <Clapperboard aria-hidden className="size-5" />
      </span>
      <p className="mt-4 font-display text-[1.05rem] font-semibold text-chalk">{title}</p>
      <p className="mt-1.5 max-w-sm text-[0.84rem] leading-relaxed text-mist">{body}</p>
    </div>
  )
}
