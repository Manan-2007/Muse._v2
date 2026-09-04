import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Heart, ListMusic, MessagesSquare, Mic, MicOff, Quote } from 'lucide-react'

import { CircularVisualizer } from '@/features/music/CircularVisualizer'
import { LyricsPanel } from '@/features/music/LyricsPanel'
import { useLyrics } from '@/features/music/useLyrics'
import { useMusic } from '@/features/music/MusicContext'
import { MusicControls } from '@/features/music/MusicControls'
import type { CoverPalette } from '@/features/music/useCoverPalette'
import { Vinyl } from '@/features/music/Vinyl'
import { cn } from '@/lib/utils'

/**
 * The record, full size — Muse._v1's player, given a real turntable and the
 * things V1 never had (a like, the words, the queue, and a room to share it).
 *
 * One centred column: the record, its name, its artist, and the transport. The
 * extras live as a quiet cluster in the top corner rather than crowding the
 * middle, so the page reads as "one song playing" first and a control surface
 * second.
 */
export function NowPlaying({
  palette,
  selfId,
  liked,
  onToggleLike,
  onCollapse,
  onOpenQueue,
  queueOpen,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
}: {
  palette: CoverPalette | null
  /** So the singalong strip can leave you out of it. */
  selfId: string | undefined
  liked: boolean
  onToggleLike: () => void
  onCollapse: () => void
  onOpenQueue: () => void
  queueOpen: boolean
  panelOpen?: boolean
  onTogglePanel?: () => void
  unread?: number
}) {
  const {
    snapshot,
    send,
    handle,
    position,
    duration,
    needsGesture,
    acknowledgeGesture,
    error,
    volume,
    setVolume,
    singalong,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    next,
    previous,
    analyserSource,
  } = useMusic()

  const track = snapshot?.track ?? null

  /*
   * Turning the record to scrub. The base is where the playhead was when the
   * grab began; the disc reports how far it has turned, and the target is the
   * two added. Seeks are thrown at the room while turning — throttled — with a
   * final one on release so the room lands where the finger left it.
   */
  const positionRef = useRef(position)
  positionRef.current = position
  const durationRef = useRef(duration)
  durationRef.current = duration
  const scrubBase = useRef(0)
  const lastScrubSeek = useRef(0)

  const seekTo = (seconds: number) => send('music:control', { action: 'seek', position: seconds })

  const scrubTarget = (deltaSeconds: number) => {
    const max = durationRef.current > 0 ? durationRef.current : Number.MAX_SAFE_INTEGER
    return Math.min(Math.max(scrubBase.current + deltaSeconds, 0), max)
  }

  /* Local, not shared — whether the words are showing is a way of looking at
     the song, like being fullscreen, not a fact about it. */
  const [showLyrics, setShowLyrics] = useState(false)
  const { lyrics, loading: lyricsLoading, available } = useLyrics(snapshot?.roomId ?? null, track)

  useEffect(() => {
    if (available === false) setShowLyrics(false)
  }, [available])

  if (!track || !snapshot) return null

  const others = snapshot.listeners.filter((one) => one.id !== selfId)
  const shared = others.length > 0
  const singers = snapshot.listeners.filter((one) => one.singing)
  const recorders = snapshot.listeners.filter((one) => one.recording)

  const iconButton =
    'relative grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal'
  const iconIdle = 'text-mist hover:bg-chalk/10 hover:text-chalk'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Minimal top bar: the way back, a quiet label, and the extras. The
          label is centred on the page, not wedged between the two button
          clusters — so it reads as a caption for the record, dead centre. */}
      <header className="relative flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Back to library"
          className={cn(iconButton, iconIdle)}
        >
          <ChevronDown aria-hidden className="size-5" />
        </button>

        <span className="pointer-events-none absolute left-1/2 top-1/2 max-w-[45%] -translate-x-1/2 -translate-y-1/2 truncate text-center text-[0.66rem] uppercase tracking-[0.28em] text-dusk">
          {shared ? `Playing · ${others.length + 1} listening` : 'Playing from your queue'}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleLike}
            aria-label={liked ? 'Remove from liked' : 'Like this song'}
            aria-pressed={liked}
            className={cn(iconButton, liked ? 'text-signal-bright' : iconIdle)}
          >
            <Heart aria-hidden className={cn('size-[1.15rem]', liked && 'fill-current')} />
          </button>

          {available && (
            <button
              type="button"
              onClick={() => setShowLyrics((open) => !open)}
              aria-pressed={showLyrics}
              aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
              className={cn(iconButton, showLyrics ? 'bg-chalk text-void' : iconIdle)}
            >
              <Quote aria-hidden className="size-[1.05rem]" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenQueue}
            aria-pressed={queueOpen}
            aria-label="Queue"
            className={cn(iconButton, queueOpen ? 'text-signal-bright' : iconIdle)}
          >
            <ListMusic aria-hidden className="size-[1.15rem]" />
          </button>

          {/* Singing along is a room thing — only offered when someone else is
              actually here to hear it. */}
          {shared && (
            <button
              type="button"
              onClick={singalong.toggleSinging}
              aria-pressed={singalong.singing}
              aria-label={singalong.singing ? 'Stop singing along' : 'Sing along'}
              className={cn(iconButton, singalong.singing ? 'text-signal-bright' : iconIdle)}
            >
              {singalong.singing ? (
                <Mic aria-hidden className="size-[1.05rem]" />
              ) : (
                <MicOff aria-hidden className="size-[1.05rem]" />
              )}
            </button>
          )}

          {onTogglePanel && (
            <button
              type="button"
              onClick={onTogglePanel}
              aria-pressed={panelOpen}
              aria-label="Chat"
              className={cn(iconButton, panelOpen ? 'text-signal-bright' : iconIdle)}
            >
              <MessagesSquare aria-hidden className="size-[1.1rem]" />
              {unread > 0 && !panelOpen && (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-signal px-1 text-[0.6rem] font-semibold leading-4 text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          )}
        </span>
      </header>

      {/* When the words come up, this whole left column — record, title AND
          transport — glides left and the lyrics rise beside it, the way Apple
          Music's player splits. No box around the words; they sit on the page. */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row lg:items-stretch lg:gap-6 lg:px-6">
        <motion.div
          layout
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'flex min-h-0 flex-col items-center justify-center gap-6 px-6 pb-6',
            showLyrics ? 'hidden lg:flex lg:w-[46%] lg:shrink-0 lg:px-2' : 'flex-1',
          )}
        >
          {/* The record, ringed by the beat meter. The meter's canvas is drawn
              larger than the disc and overflows around it, so the bars stand in
              the open space just outside the rim rather than on top of it. */}
          <div className="relative aspect-square w-[min(70vw,min(24rem,38vh))]">
            <CircularVisualizer
              source={analyserSource}
              playing={snapshot.playing}
              accent={palette?.accent ?? palette?.base ?? 'var(--color-signal)'}
              className="absolute inset-[-28%]"
            />
            <Vinyl
              artwork={track.artwork}
              playing={snapshot.playing}
              accent={palette?.base ?? 'var(--color-signal)'}
              scrubbable={duration > 0}
              onScrubStart={() => {
                scrubBase.current = positionRef.current
              }}
              onScrub={(deltaSeconds) => {
                const now = performance.now()
                if (now - lastScrubSeek.current < 120) return
                lastScrubSeek.current = now
                seekTo(scrubTarget(deltaSeconds))
              }}
              onScrubEnd={(deltaSeconds) => {
                lastScrubSeek.current = 0
                seekTo(scrubTarget(deltaSeconds))
              }}
            />
          </div>

          <div className="w-full max-w-xl text-center">
            <h1 className="text-balance font-display text-[clamp(1.5rem,4vw,2.4rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-chalk [text-shadow:0_2px_16px_rgba(0,0,0,0.5)] line-clamp-2">
              {track.title}
            </h1>
            {(track.artist ?? track.album) && (
              <p className="mt-2 truncate text-[1.02rem] font-medium text-signal-bright [text-shadow:0_1px_10px_rgba(0,0,0,0.3)]">
                {[track.artist, track.album].filter(Boolean).join(' · ')}
              </p>
            )}

            {(singers.length > 0 || recorders.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {singers.length > 0 && (
                  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 backdrop-blur-md">
                    <Mic aria-hidden className="size-3.5 text-chalk" />
                    <span className="text-[0.72rem] text-chalk">
                      {singers.map((one) => one.name).join(', ')} singing
                    </span>
                  </span>
                )}
                {recorders.length > 0 && (
                  <span className="flex items-center gap-2 rounded-full border border-signal/40 bg-signal/15 px-3 py-1.5">
                    <span className="size-2 animate-signal-pulse rounded-full bg-signal-bright" />
                    <span className="text-[0.72rem] text-chalk">
                      {recorders.length === 1
                        ? `${recorders[0]!.name} is recording`
                        : `${recorders.length} recording`}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Transport — inside the left column, so it travels left with the
              record when the lyrics open instead of staying stranded centre. */}
          <div className="flex w-full max-w-md flex-col items-center gap-3">
            {(error ?? singalong.error) && (
              <p
                role="alert"
                className="max-w-lg rounded-xl border border-signal/25 bg-signal/[0.08] px-4 py-3 text-center text-[0.82rem] leading-relaxed text-signal-bright"
              >
                {error ?? singalong.error}
              </p>
            )}

            {needsGesture && (
              <button
                type="button"
                onClick={acknowledgeGesture}
                className="rounded-full bg-chalk px-5 py-2.5 text-[0.85rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
              >
                Tap to join playback
              </button>
            )}

            <MusicControls
              snapshot={snapshot}
              position={position}
              duration={duration}
              shuffle={shuffle}
              repeat={repeat}
              volume={volume}
              onPlayPause={() =>
                send('music:control', {
                  action: snapshot.playing ? 'pause' : 'play',
                  position: handle ? handle.getPosition() : undefined,
                })
              }
              onSeek={(seconds) => seekTo(seconds)}
              onNext={next}
              onPrevious={previous}
              onToggleShuffle={() => setShuffle(!shuffle)}
              onToggleRepeat={() => setRepeat(!repeat)}
              onVolume={setVolume}
              disabled={false}
            />
          </div>
        </motion.div>

        {/* The words, on the right — plain text on the page, no card. */}
        <AnimatePresence>
          {showLyrics && (
            <motion.div
              key="lyrics"
              className="flex min-h-0 flex-1 flex-col pb-6"
              initial={{ opacity: 0, x: 36 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 36 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <LyricsPanel
                lyrics={lyrics}
                loading={lyricsLoading}
                onSeek={(seconds) => seekTo(seconds)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
