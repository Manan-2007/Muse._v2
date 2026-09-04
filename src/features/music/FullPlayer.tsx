import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { CoverAmbience } from '@/features/music/CoverAmbience'
import { useMusic } from '@/features/music/MusicContext'
import { MusicQueuePanel } from '@/features/music/MusicQueuePanel'
import { NowPlaying } from '@/features/music/NowPlaying'
import type { LibraryTrack } from '@/features/music/types'
import type { useLibrary } from '@/features/music/useLibrary'
import { useCoverPalette } from '@/features/music/useCoverPalette'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * The record, full-screen.
 *
 * Apple Music's now-playing sheet: it rises over the whole app — sidebar and
 * all — because looking at the record is a mode, not a page. The library and
 * search stay where they were, behind it, and pulling this down returns you to
 * exactly the spot you left. The immersive cover background is the point, so it
 * paints edge to edge rather than insetting for the sidebar.
 *
 * Everything it needs — the session, the queue, the transport — comes from the
 * one MusicProvider above, so this is the same session seen close up rather
 * than a second one.
 */
export function FullPlayer({
  open,
  onClose,
  selfId,
  library,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  insetRight = 0,
}: {
  open: boolean
  onClose: () => void
  selfId?: string
  library: ReturnType<typeof useLibrary>
  /** Chat lives here only inside a shared room — solo has nobody to talk to. */
  panelOpen?: boolean
  onTogglePanel?: () => void
  unread?: number
  insetRight?: number
}) {
  const { snapshot, queue, setQueue, send } = useMusic()
  const track = snapshot?.track ?? null
  const palette = useCoverPalette(track?.artwork)

  const [queueOpen, setQueueOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (queueOpen) setQueueOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, queueOpen])

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

  return createPortal(
    <AnimatePresence>
      {open && track && (
        <motion.div
          className="fixed left-0 top-0 z-[140] flex flex-col overflow-hidden"
          style={{ width: '100vw', height: '100dvh', paddingRight: `${insetRight}rem` }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <CoverAmbience palette={palette} artwork={track.artwork} />

          <div className="relative flex min-h-0 flex-1 flex-col">
            <NowPlaying
              palette={palette}
              selfId={selfId}
              liked={currentAsTrack ? library.isLiked(currentAsTrack) : false}
              onToggleLike={toggleLikeCurrent}
              onCollapse={onClose}
              onOpenQueue={() => setQueueOpen((v) => !v)}
              queueOpen={queueOpen}
              panelOpen={panelOpen}
              onTogglePanel={onTogglePanel}
              unread={unread}
            />
          </div>

          <AnimatePresence>
            {queueOpen && snapshot && (
              <motion.div
                className="absolute inset-y-0 right-0 z-20 w-full md:w-[24rem]"
                style={{ marginRight: `${insetRight}rem` }}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <MusicQueuePanel
                  roomId={snapshot.roomId}
                  items={queue}
                  nowPlayingId={track.id}
                  onQueueChange={setQueue}
                  onPlayNow={(next) => send('music:load', { trackId: next.id })}
                  onClose={() => setQueueOpen(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
