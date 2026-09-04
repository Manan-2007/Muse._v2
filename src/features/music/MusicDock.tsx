import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, Music4, Pause, Play, SkipForward, X } from 'lucide-react'

import { useMusic } from '@/features/music/MusicContext'
import { useCoverPalette } from '@/features/music/useCoverPalette'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The now-playing bar — Apple Music's, kept above the tab bar.
 *
 * Whatever is on stays here while you browse: cover, title, a play/pause and a
 * skip, over a thin progress line, and the whole strip taps back into the full
 * player. Square art rather than a spinning disc — the record lives on the
 * player page; this is the app's chrome.
 *
 * Hidden — not stopped — while the record view is open (that view is this same
 * session at full size) and during a film (the watch stage pauses the music, so
 * a transport here would be for something that isn't playing).
 */
export function MusicDock({
  visible,
  onOpen,
  onLeave,
  insetRight = 0,
  insetLeft = 0,
}: {
  visible: boolean
  /** Given the dock's own box, so the page opens out of it too. */
  onOpen: (from?: DOMRect) => void
  /** Step out of the listening session — for you, not for the room. */
  onLeave: () => void
  /** Rem the room panel occupies, so the bar never hides behind it. */
  insetRight?: number
  /** Rem the left sidebar occupies, so the bar centres over the content. */
  insetLeft?: number
}) {
  const { snapshot, queue, send, handle, position, duration, singalong } = useMusic()
  const track = snapshot?.track ?? null
  const palette = useCoverPalette(track?.artwork)

  const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0

  return createPortal(
    <AnimatePresence>
      {visible && track && (
        <motion.div
          /* Above the activity stages (135) so the bar for the music playing
             underneath one is visible; below the room panel and floating call,
             which are deliberately opened. Sits just above the tab bar. */
          className="pointer-events-none fixed bottom-[4.75rem] left-0 z-[137] flex justify-center px-3 sm:px-5 lg:bottom-[1.5rem]"
          style={{ right: `${insetRight}rem`, left: `${insetLeft}rem` }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <div
            className="pointer-events-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-white/12 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.55)]"
            style={{
              /* Themed base so the bar is a light card in light mode (the song
                 name was black-on-black before), tinted by the cover either way. */
              background: palette
                ? `color-mix(in oklab, ${palette.base} 26%, var(--dock-base, #101014))`
                : 'var(--dock-base, #101014)',
            }}
          >
            {/* The playhead, along the top edge. */}
            <div className="h-[3px] w-full bg-white/10">
              <div
                className="h-full bg-chalk transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="flex min-w-0 items-center gap-3 p-2.5">
              <button
                type="button"
                onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
                aria-label="Open the player"
                className="relative size-11 shrink-0 overflow-hidden rounded-lg outline-none ring-1 ring-inset ring-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                {track.artwork ? (
                  <img src={track.artwork} alt="" className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center bg-white/10 text-chalk">
                    <Music4 aria-hidden className="size-4" />
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
                className="flex min-w-0 flex-1 flex-col items-start text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="w-full truncate text-[0.85rem] font-medium text-chalk">
                  {track.title}
                </span>
                <span className="flex w-full items-center gap-1.5 truncate text-[0.72rem] text-mist">
                  {singalong.singing && <Mic aria-hidden className="size-3 shrink-0 text-signal-bright" />}
                  {singalong.singing ? 'Singing along' : (track.artist ?? 'In the room')}
                </span>
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
                className="grid size-9 shrink-0 place-items-center rounded-full text-chalk outline-none transition-transform duration-300 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                {snapshot?.playing ? (
                  <Pause aria-hidden className="size-5 fill-current" />
                ) : (
                  <Play aria-hidden className="size-5 translate-x-px fill-current" />
                )}
              </button>

              <button
                type="button"
                onClick={() => snapshot && send('music:next', { seq: snapshot.seq })}
                disabled={queue.length === 0}
                aria-label="Next track"
                className="grid size-9 shrink-0 place-items-center rounded-full text-chalk outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-30"
              >
                <SkipForward aria-hidden className="size-4 fill-current" />
              </button>

              {/* Leaves the session — yours only, not a room-wide pause. */}
              <button
                type="button"
                onClick={onLeave}
                aria-label="Leave the music"
                className="grid size-9 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
