import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Film, FolderOpen, Link2, Loader2, MonitorPlay, Search, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import * as watchApi from '@/features/watch/api'
import { useExtensionInstalled } from '@/features/watch/useExtensionInstalled'
import type { LibraryEntry, QueueItem, ResolvedSource, SearchResult } from '@/features/watch/types'
import { cn } from '@/lib/utils'

/**
 * Choosing what to watch.
 *
 * Deliberately a *source* question first, not a search box. The three sources
 * behave so differently — one searchable, one uploaded, one not embeddable at
 * all — that a single input would have to guess which you meant and would be
 * wrong often enough to be irritating. Picking the source first also lets each
 * one explain its own constraints at the moment they matter.
 */

type Source = 'library' | 'youtube' | 'upload' | 'link' | 'external' | 'netflix'

/** Rough and readable — a movie listing wants "3.1 GB", not a byte count. */
function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const SOURCES: {
  id: Source
  label: string
  hint: string
  icon: typeof Film
}[] = [
  {
    id: 'library',
    label: 'On the server',
    hint: 'Already in the uploads folder',
    icon: FolderOpen,
  },
  { id: 'youtube', label: 'YouTube', hint: 'Search or paste a link', icon: Film },
  { id: 'upload', label: 'Upload a video', hint: 'From this device', icon: Upload },
  { id: 'link', label: 'Direct link', hint: 'A .mp4 or .webm URL', icon: Link2 },
  { id: 'netflix', label: 'Netflix', hint: 'Real sync, with the extension', icon: MonitorPlay },
  { id: 'external', label: 'Prime, Hotstar, others', hint: 'Synced countdown', icon: MonitorPlay },
]

/** What the picker hands back once the server has stored the addition. */
export type Queued = { item: QueueItem; items: QueueItem[] }

export function SourcePicker({
  roomId,
  canSearch,
  compact = false,
  onQueued,
}: {
  roomId: string
  canSearch: boolean
  /** Inside the side panel the tiles stack; on the empty stage they spread. */
  compact?: boolean
  /**
   * The item that was created, not just the fact that one was. The caller
   * usually wants to put it on, and it can only do that by id — see the note
   * on the pending load in `WatchStage`.
   */
  onQueued: (queued: Queued, playNow: boolean) => void
}) {
  const [source, setSource] = useState<Source | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [pending, setPending] = useState<ResolvedSource | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null)

  const field = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery('')
    setResults(null)
    setPending(null)
    setError(null)
    setLibrary(null)
    if (source && source !== 'upload' && source !== 'library') field.current?.focus()
    if (source === 'upload') filePicker.current?.click()

    /* Read fresh every time it's opened — the folder is the source of truth,
       and a file dropped in a moment ago should already be here. */
    if (source === 'library') {
      setBusy(true)
      watchApi
        .fetchLibrary(roomId)
        .then(setLibrary)
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Could not read the server folder'),
        )
        .finally(() => setBusy(false))
    }
  }, [source, roomId])

  async function queue(resolved: Omit<ResolvedSource, 'note'>, playNow: boolean) {
    setBusy(true)
    setError(null)
    try {
      const queued = await watchApi.addToQueue(roomId, resolved)
      setQuery('')
      setResults(null)
      setPending(null)
      onQueued(queued, playNow)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || busy) return

    setBusy(true)
    setError(null)
    setResults(null)

    try {
      const looksLikeLink = /^https?:\/\//i.test(value) || /^[\w-]{11}$/.test(value)

      if (source === 'youtube' && !looksLikeLink) {
        if (!canSearch) {
          setError('Search needs a YouTube API key on the server — paste a link instead.')
          return
        }
        setResults(await watchApi.searchVideos(roomId, value))
        return
      }

      const resolved = await watchApi.resolveInput(roomId, value)
      /* An unembeddable platform switches the room into clock mode, which is a
         big enough change to confirm rather than spring on everyone. */
      if (resolved.note) setPending(resolved)
      else await queue(resolved, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add that')
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      const resolved = await watchApi.uploadVideo(roomId, file, setProgress)
      await queue(resolved, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const placeholder =
    source === 'youtube'
      ? canSearch
        ? 'Search YouTube, or paste a link'
        : 'Paste a YouTube link'
      : source === 'link'
        ? 'https://example.com/video.mp4'
        : 'What are you all putting on?'

  return (
    <div className="w-full">
      <input
        ref={filePicker}
        type="file"
        accept="video/mp4,video/webm,video/ogg,video/quicktime"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {!source ? (
        <div className={cn('grid gap-2.5', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
          {SOURCES.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSource(entry.id)}
                className="liquid-btn is-scrim flex items-center gap-3 rounded-card px-4 py-3.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-chalk ring-1 ring-inset ring-white/15">
                  <Icon aria-hidden className="size-[1.05rem]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[0.92rem] font-semibold text-chalk">
                    {entry.label}
                  </span>
                  <span className="block truncate text-[0.72rem] text-mist">{entry.hint}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSource(null)}
              className="rounded-full px-2.5 py-1 text-[0.75rem] text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              ← All sources
            </button>
            <span className="text-[0.75rem] text-dusk">
              {SOURCES.find((entry) => entry.id === source)?.label}
            </span>
          </div>

          {source === 'library' ? (
            <div>
              {busy && !library && (
                <p className="px-1 py-6 text-center text-[0.82rem] text-mist">
                  Reading the server folder…
                </p>
              )}

              {library && library.length === 0 && (
                <div className="rounded-card border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-center">
                  <p className="text-[0.85rem] leading-relaxed text-mist">
                    Nothing in the uploads folder yet. Drop a video into{' '}
                    <code className="font-mono text-[0.78rem] text-chalk">server/uploads/</code> on
                    the machine running the backend and it shows up here.
                  </p>
                </div>
              )}

              {library && library.length > 0 && (
                <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-lenis-prevent>
                  {library.map((entry) => (
                    <li key={entry.file}>
                      <button
                        type="button"
                        disabled={busy || !entry.playable}
                        onClick={() =>
                          void queue(
                            {
                              source: 'file',
                              /* The CDN version whenever there is one. Same
                                 film either way, but the published one starts
                                 in a second and does not come out of the
                                 server's uplink. */
                              ref: entry.hls ?? entry.ref,
                              title: entry.title,
                              duration: entry.duration,
                              thumbnail: null,
                            },
                            true,
                          )
                        }
                        className={cn(
                          'flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left outline-none transition-colors duration-200',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                          entry.playable
                            ? 'hover:bg-white/[0.06]'
                            : 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-mist ring-1 ring-inset ring-white/10">
                          <Film aria-hidden className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.85rem] text-chalk">
                            {entry.title}
                          </span>
                          <span className="block truncate text-[0.7rem] text-dusk">
                            {formatBytes(entry.bytes)}
                            {!entry.playable && " · browsers can't play this container"}
                            {/* Published files are streamed, so the local
                                file's own shortcomings stop mattering. */}
                            {entry.hls
                              ? ' · streaming'
                              : entry.playable &&
                                !entry.fastStart &&
                                ' · slow to start — needs remuxing'}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {library?.some((entry) => !entry.playable) && (
                <p className="mt-3 px-1 text-[0.7rem] leading-relaxed text-dusk">
                  Greyed-out files are containers no browser will play (.mkv, .avi). Convert one
                  with{' '}
                  <code className="font-mono text-[0.68rem] text-mist">
                    ffmpeg -i in.mkv -c:v copy -c:a aac out.mp4
                  </code>{' '}
                  and it appears here ready to go.
                </p>
              )}

              {library?.some((entry) => entry.playable && !entry.fastStart && !entry.hls) && (
                <p className="mt-3 px-1 text-[0.7rem] leading-relaxed text-dusk">
                  Files marked “slow to start” keep their index at the end, so the player waits on
                  the whole download before the first frame. Move it to the front — no re-encode,
                  so it is a copy rather than a conversion —{' '}
                  <code className="font-mono text-[0.68rem] text-mist">
                    ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4
                  </code>
                </p>
              )}
            </div>
          ) : source === 'netflix' ? (
            <NetflixPanel />
          ) : source === 'upload' ? (
            <div className="rounded-card border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-center">
              {progress !== null ? (
                <>
                  <p className="text-[0.85rem] text-chalk">
                    Uploading… {Math.round(progress * 100)}%
                  </p>
                  <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-signal transition-[width] duration-200"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </span>
                </>
              ) : (
                <>
                  <p className="text-[0.85rem] leading-relaxed text-mist">
                    Pick a video and it uploads to the room, so everyone can play it — not just
                    you.
                  </p>
                  <Button
                    size="sm"
                    className="mt-4"
                    disabled={busy}
                    onClick={() => filePicker.current?.click()}
                  >
                    Choose a file
                  </Button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="flex gap-2">
                <span className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden
                    className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-dusk"
                  />
                  <input
                    ref={field}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={placeholder}
                    spellCheck={false}
                    className="w-full rounded-full border border-white/[0.1] bg-white/[0.04] py-2.5 pl-10 pr-4 text-[0.85rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/50"
                  />
                </span>
                <Button type="submit" size="sm" disabled={busy || query.trim().length === 0}>
                  {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : 'Go'}
                </Button>
              </div>
            </form>
          )}

          {pending && (
            <div className="mt-3 rounded-card border border-signal/30 bg-signal/[0.06] p-4">
              <p className="font-display text-[0.9rem] font-semibold text-chalk">{pending.title}</p>
              <p className="mt-1.5 text-[0.78rem] leading-relaxed text-mist">{pending.note}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void queue(pending, true)}>
                  Start the countdown
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {results && (
            <ul className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto" data-lenis-prevent>
              {results.length === 0 && (
                <li className="px-2 py-3 text-[0.8rem] text-mist">Nothing found.</li>
              )}
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void queue(
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
                    className="flex w-full gap-3 rounded-card p-2 text-left outline-none transition-colors duration-200 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    <img
                      src={result.thumbnail}
                      alt=""
                      className="h-12 w-20 shrink-0 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[0.8rem] leading-snug text-chalk">
                        {result.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.7rem] text-dusk">
                        {result.channel}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[0.78rem] leading-relaxed text-signal-bright">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The Netflix source, which is not a source so much as a handover.
 *
 * Nothing gets added to the queue here, and that is the point. Netflix will
 * not embed and exposes no playback API, so the room cannot drive it from
 * this page no matter what is typed in. What *can* drive it is a content
 * script standing inside the Netflix tab — so the useful thing this screen
 * can do is tell you honestly whether that piece is present, and get out of
 * the way if it is.
 *
 * Prime and Hotstar stay under the old entry next to this one, because for
 * them the honest answer is still a synced countdown. Naming Netflix
 * separately is the difference between "this platform is a compromise" and
 * "this platform actually works", which is worth not blurring.
 */
function NetflixPanel() {
  const installed = useExtensionInstalled()

  return (
    <div className="rounded-card border border-white/12 bg-white/[0.03] px-5 py-5">
      <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-chalk">
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            installed ? 'bg-emerald-400' : 'bg-white/30',
          )}
        />
        {installed ? 'Extension installed' : 'Extension not detected in this browser'}
      </p>

      {installed ? (
        <>
          <p className="mt-3 text-[0.85rem] leading-relaxed text-mist">
            You are set up — there is nothing to add here. Open the title on{' '}
            <a
              href="https://www.netflix.com"
              target="_blank"
              rel="noreferrer noopener"
              className="text-chalk underline decoration-white/30 underline-offset-2 hover:decoration-white"
            >
              netflix.com
            </a>{' '}
            and press <strong className="font-semibold text-chalk">Start the room on this</strong>{' '}
            in the panel that appears over the player. Everyone else in the room opens the same
            title on their own account, and their tab falls in step on its own.
          </p>
          <p className="mt-3 text-[0.72rem] leading-relaxed text-dusk">
            Play, pause and seek travel both ways. Nobody shares a stream or a login — the room
            only ever agrees on a timestamp.
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 text-[0.85rem] leading-relaxed text-mist">
            Netflix refuses to be embedded and offers no playback API, so this page cannot drive
            it. A small browser extension can, because it runs inside the Netflix tab itself —
            reading its clock and nudging play, pause and seek, exactly as your own keyboard
            would.
          </p>
          <p className="mt-3 text-[0.85rem] leading-relaxed text-mist">
            Install it from the{' '}
            <code className="font-mono text-[0.78rem] text-chalk">extension/</code> folder of this
            project — <code className="font-mono text-[0.78rem] text-chalk">chrome://extensions</code>{' '}
            → Developer mode → Load unpacked. Then come back to this tab; it configures itself
            from here, with nothing to type.
          </p>
          <p className="mt-3 text-[0.72rem] leading-relaxed text-dusk">
            Everyone who wants to watch along needs it. Without it, use the{' '}
            <strong className="font-semibold text-mist">Prime, Hotstar, others</strong> entry
            instead — a shared countdown rather than real sync.
          </p>
        </>
      )}
    </div>
  )
}
