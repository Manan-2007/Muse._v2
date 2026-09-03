import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronUp,
  ListMusic,
  Loader2,
  MessagesSquare,
  Music4,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react'

import { CoverAmbience } from '@/features/music/CoverAmbience'
import { useMusic } from '@/features/music/MusicContext'
import { MusicBrowser } from '@/features/music/MusicBrowser'
import { MusicQueuePanel } from '@/features/music/MusicQueuePanel'
import { NowPlaying } from '@/features/music/NowPlaying'
import type { LibraryTrack } from '@/features/music/types'
import { useCoverPalette } from '@/features/music/useCoverPalette'
import { useLibrary } from '@/features/music/useLibrary'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The music app.
 *
 * Two screens sharing one background and one session: a library you browse,
 * and the record you are listening to. They are not a page and a modal — the
 * record slides up over the library and back down, because it is the same
 * place seen close up.
 *
 * The background belongs to the whole app rather than to the record, so
 * walking from a playlist to the now-playing view is a continuous colour
 * rather than two differently-lit rooms.
 */
export function MusicStage({
  onClose,
  insetRight = 0,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  origin,
  selfId,
}: {
  onClose: () => void
  /** Excluded from the listener avatars — you already know you are here. */
  selfId?: string
  insetRight?: number
  panelOpen?: boolean
  onTogglePanel?: () => void
  unread?: number
  /** The control this opened from, so the reveal starts there. */
  origin?: DOMRect | null
}) {
  const {
    roomId,
    snapshot,
    connected,
    send,
    handle,
    queue,
    setQueue,
    position,
    duration,
    volume,
    setVolume,
  } = useMusic()
  const library = useLibrary(roomId)

  const [expanded, setExpanded] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  const track = snapshot?.track ?? null
  const palette = useCoverPalette(track?.artwork)

  /* The record opens itself the first time something starts, then stays where
     the listener last put it — arriving on a library while music begins behind
     it reads as the app ignoring you. */
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false)
  useEffect(() => {
    if (track && !hasAutoExpanded) {
      setExpanded(true)
      setHasAutoExpanded(true)
    }
  }, [track, hasAutoExpanded])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      /* Escape steps back one level rather than leaving outright — the record
         first, the room only once there is nothing left to close. */
      if (queueOpen) setQueueOpen(false)
      else if (expanded) setExpanded(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, expanded, queueOpen])

  /* Memoised on the track's identity rather than rebuilt each render — the
     like button below depends on it, and a fresh object every frame would
     rebuild that callback continuously. */
  const currentAsTrack = useMemo<LibraryTrack | null>(
    () =>
      track
        ? {
            source: track.source,
            ref: track.ref,
            title: track.title,
            artist: track.artist,
            album: track.album,
            artwork: track.artwork,
            duration: track.duration,
          }
        : null,
    [track],
  )

  const toggleLikeCurrent = useCallback(() => {
    if (currentAsTrack) void library.toggleLike(currentAsTrack)
  }, [currentAsTrack, library])

  if (!roomId) return null

  const revealX = origin ? `${Math.round(origin.left + origin.width / 2)}px` : '50%'
  const revealY = origin ? `${Math.round(origin.top + origin.height / 2)}px` : '50%'
  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0

  return createPortal(
    <motion.div
      /*
       * Sized explicitly rather than by `inset-0`: several ancestors on this
       * page can establish a containing block, and when one does a fixed
       * element's insets resolve against something that is not the screen.
       *
       * The opening is a CSS keyframe for a related reason — animating
       * `clip-path` through Motion here left the element parked on its first
       * frame, which is a working page nobody can see.
       */
      className="fixed left-0 top-0 z-[135] flex flex-col overflow-hidden transition-[padding] duration-500 ease-glass"
      style={{
        width: '100vw',
        height: '100dvh',
        paddingRight: `${insetRight}rem`,
        ['--reveal-x' as string]: revealX,
        ['--reveal-y' as string]: revealY,
        animation: 'stage-reveal 0.62s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {/* Translucent while browsing; the record view above draws its own solid
          one, so opening a track closes the room off behind it. */}
      <CoverAmbience palette={palette} translucent={!expanded} />

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* One header for the whole app — the record view draws its own on
              top when it is up, so this never has to change identity. */}
          <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
            <span className="flex min-w-0 items-center gap-2">
              {snapshot && snapshot.listeners.length > 0 && (
                <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 backdrop-blur-md">
                  <span className="size-1.5 animate-signal-pulse rounded-full bg-emerald-400" />
                  <span className="text-[0.72rem] text-chalk">
                    {snapshot.listeners.length} listening
                  </span>
                </span>
              )}
              {!connected && (
                <span className="flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1.5 text-signal-bright">
                  <WifiOff aria-hidden className="size-3.5" />
                  <span className="text-[0.72rem]">Reconnecting…</span>
                </span>
              )}
              {!snapshot && (
                <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
                  <Loader2 aria-hidden className="size-3.5 animate-spin text-mist" />
                  <span className="text-[0.72rem] text-mist">Syncing…</span>
                </span>
              )}
            </span>

            <span className="flex shrink-0 items-center gap-2">
              {onTogglePanel && (
                <button
                  type="button"
                  onClick={onTogglePanel}
                  aria-label="Chat"
                  aria-pressed={panelOpen}
                  className={cn(
                    'relative flex h-11 items-center gap-2 rounded-full border px-3.5 outline-none backdrop-blur-md sm:h-9 transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                    panelOpen
                      ? 'border-signal/50 bg-signal/15 text-chalk'
                      : 'border-white/10 bg-white/[0.04] text-chalk hover:bg-white/[0.1]',
                  )}
                >
                  <MessagesSquare aria-hidden className="size-4" />
                  {unread > 0 && !panelOpen && (
                    <span className="min-w-4 rounded-full bg-signal px-1 text-[0.62rem] font-semibold leading-4 text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Leave the music"
                className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-chalk outline-none backdrop-blur-md sm:size-9 transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <X aria-hidden className="size-4" />
              </button>
            </span>
          </header>

          <MusicBrowser library={library} />

          {/*
            The bar between the two screens.
            Always the same object: it shows what is on, and pressing it lifts
            the record into view. Its progress line is the only chrome that
            survives into the expanded view, so the transition has something
            continuous to hold on to.
          */}
          <AnimatePresence>
            {track && !expanded && (
              <motion.div
                className="shrink-0 px-4 pb-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-2xl">
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-px bg-white/10"
                  />
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-px bg-chalk transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />

                  <div className="flex items-center gap-3 p-2.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10">
                        {track.artwork ? (
                          <img src={track.artwork} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="grid size-full place-items-center text-dusk">
                            <Music4 aria-hidden className="size-4" />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.85rem] text-chalk">
                          {track.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[0.72rem] text-dusk">
                          {track.artist ?? 'Playing in the room'}
                        </span>
                      </span>
                    </button>

                    {/* A transport, not a single button. Skipping and volume
                        are what people reach for without opening anything. */}
                    <button
                      type="button"
                      onClick={() => snapshot && send('music:previous', { seq: snapshot.seq })}
                      disabled={queue.length === 0}
                      aria-label="Previous track"
                      className="hidden size-9 shrink-0 place-items-center rounded-full text-chalk outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-30 sm:grid"
                    >
                      <SkipBack aria-hidden className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        snapshot &&
                        send('music:control', {
                          action: snapshot.playing ? 'pause' : 'play',
                          position: handle ? handle.getPosition() : undefined,
                        })
                      }
                      aria-label={snapshot?.playing ? 'Pause' : 'Play'}
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-chalk text-void outline-none transition-transform duration-300 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      {snapshot?.playing ? (
                        <Pause aria-hidden className="size-4 fill-current" />
                      ) : (
                        <Play aria-hidden className="size-4 translate-x-px fill-current" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => snapshot && send('music:next', { seq: snapshot.seq })}
                      disabled={queue.length === 0}
                      aria-label="Next track"
                      className="grid size-11 shrink-0 place-items-center rounded-full text-chalk outline-none transition-colors hover:bg-white/10 sm:size-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-30"
                    >
                      <SkipForward aria-hidden className="size-4" />
                    </button>

                    {/* Personal, so it never touches the room's playback. */}
                    <label className="hidden items-center gap-2 pl-1 pr-1 lg:flex">
                      <span className="sr-only">Volume</span>
                      <Volume2 aria-hidden className="size-4 shrink-0 text-mist" />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onChange={(event) => setVolume(Number(event.target.value))}
                        className="w-24 cursor-pointer accent-chalk"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => setQueueOpen((open) => !open)}
                      aria-label="Queue"
                      aria-pressed={queueOpen}
                      className="hidden size-9 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:grid"
                    >
                      <ListMusic aria-hidden className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      aria-label="Open the record"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      <ChevronUp aria-hidden className="size-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* The record, over everything. Slides rather than fades: it is the same
          session moving closer, not a different screen replacing this one. */}
      <AnimatePresence>
        {expanded && track && (
          <motion.div
            className="absolute inset-0 z-10 flex flex-col overflow-hidden"
            style={{ paddingRight: `${insetRight}rem` }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            <CoverAmbience palette={palette} />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <NowPlaying
                palette={palette}
                selfId={selfId}
                liked={currentAsTrack ? library.isLiked(currentAsTrack) : false}
                onToggleLike={toggleLikeCurrent}
                onCollapse={() => setExpanded(false)}
                onOpenQueue={() => setQueueOpen((open) => !open)}
                queueOpen={queueOpen}
                panelOpen={panelOpen}
                onTogglePanel={onTogglePanel}
                unread={unread}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/*
        Above both screens, deliberately.
        It used to live inside the library column, which meant opening it from
        the record put it *behind* the record — a panel that was mounted,
        correct, and invisible.
      */}
      <AnimatePresence>
        {queueOpen && (
          <motion.div
            className="absolute inset-y-0 right-0 z-20 w-full md:w-[24rem]"
            style={{ marginRight: `${insetRight}rem` }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <MusicQueuePanel
              roomId={roomId}
              items={queue}
              nowPlayingId={track?.id ?? null}
              onQueueChange={setQueue}
              onPlayNow={(next) => send('music:load', { trackId: next.id })}
              onClose={() => setQueueOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  )
}
