import { useEffect, useRef, useState } from 'react'
import {
  Captions,
  Languages,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react'

import {
  formatTime,
  RATES,
  type AudioTrackInfo,
  type SubtitleTrack,
  type WatchSnapshot,
} from '@/features/watch/types'
import { cn } from '@/lib/utils'

/**
 * The control bar.
 *
 * Everyone in the room gets the same controls — there is no host — so every
 * press here is a request to the server, never a local state change. The bar
 * reflects what the room decided, not what this person clicked.
 */
export function WatchControls({
  snapshot,
  position,
  duration,
  queueCount,
  queueOpen,
  isFullscreen,
  audioTracks,
  audioTrack,
  onAudioTrackChange,
  subtitles,
  subtitleTrack,
  onSubtitleTrackChange,
  onToggleQueue,
  onPlayPause,
  onSeek,
  onRate,
  onSkip,
  onToggleFullscreen,
  disabled,
}: {
  snapshot: WatchSnapshot
  position: number
  duration: number
  queueCount: number
  queueOpen: boolean
  isFullscreen: boolean
  /** Empty when the source has nothing to choose between. */
  audioTracks: AudioTrackInfo[]
  audioTrack: number
  /** Personal, not sent to the room — see the note in `WatchStage`. */
  onAudioTrackChange: (id: number) => void
  /** Empty when nothing was published with this video. */
  subtitles: SubtitleTrack[]
  /** Index into `subtitles`, or -1 for off. */
  subtitleTrack: number
  onSubtitleTrackChange: (index: number) => void
  onToggleQueue: () => void
  onPlayPause: () => void
  onSeek: (seconds: number) => void
  onRate: (rate: number) => void
  onSkip: () => void
  onToggleFullscreen: () => void
  disabled: boolean
}) {
  /* While a scrub is in progress the bar shows the finger, not the room —
     otherwise incoming snapshots would drag the thumb out from under it. */
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [rateOpen, setRateOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [captionsOpen, setCaptionsOpen] = useState(false)
  const rateMenu = useRef<HTMLDivElement>(null)
  const languageMenu = useRef<HTMLDivElement>(null)
  const captionsMenu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rateOpen && !languageOpen && !captionsOpen) return
    const onAway = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rateMenu.current?.contains(target)) setRateOpen(false)
      if (!languageMenu.current?.contains(target)) setLanguageOpen(false)
      if (!captionsMenu.current?.contains(target)) setCaptionsOpen(false)
    }
    window.addEventListener('mousedown', onAway)
    return () => window.removeEventListener('mousedown', onAway)
  }, [rateOpen, languageOpen, captionsOpen])

  const shown = scrubbing ?? position
  const known = duration > 0
  const progress = known ? Math.min(100, (shown / duration) * 100) : 0

  return (
    <div className="pointer-events-auto flex flex-col gap-2 bg-gradient-to-t from-void via-void/85 to-transparent px-4 pb-4 pt-10 md:px-6 md:pb-5">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-right font-mono text-[0.72rem] tabular-nums text-mist">
          {formatTime(shown)}
        </span>

        <div className="relative flex h-11 flex-1 items-center sm:h-6">
          <div className="absolute inset-x-0 h-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-signal transition-[width] duration-200 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={known ? duration : 100}
            step={0.1}
            value={shown}
            disabled={disabled || !known}
            aria-label="Seek"
            onChange={(event) => setScrubbing(Number(event.target.value))}
            onPointerUp={() => {
              if (scrubbing !== null) onSeek(scrubbing)
              setScrubbing(null)
            }}
            /*
              Any key that moved the thumb commits the seek — not just the
              arrows. A range input also answers Home, End, PageUp and PageDown,
              and listing only the arrows meant those four moved the handle and
              then silently threw the seek away, which is a keyboard user
              scrubbing to no effect.
            */
            onKeyUp={() => {
              if (scrubbing === null) return
              onSeek(scrubbing)
              setScrubbing(null)
            }}
            /* Tabbing away mid-scrub would otherwise leave the bar following a
               drag that is no longer happening. */
            onBlur={() => setScrubbing(null)}
            className="absolute inset-x-0 h-11 w-full cursor-pointer sm:h-6 appearance-none bg-transparent outline-none disabled:cursor-default [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-chalk [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-signal)_40%,transparent)]"
          />
        </div>

        <span className="w-14 shrink-0 font-mono text-[0.72rem] tabular-nums text-dusk">
          {known ? formatTime(duration) : '--:--'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPlayPause}
          disabled={disabled}
          aria-label={snapshot.playing ? 'Pause for everyone' : 'Play for everyone'}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-chalk text-void outline-none transition-transform duration-300 ease-glass hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-95 disabled:opacity-40"
        >
          {snapshot.playing ? (
            <Pause aria-hidden className="size-5 fill-current" />
          ) : (
            <Play aria-hidden className="size-5 translate-x-px fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={onSkip}
          disabled={disabled || queueCount === 0}
          aria-label="Skip to next"
          className="grid size-11 shrink-0 place-items-center sm:size-10 rounded-full border border-white/12 bg-white/[0.05] text-chalk outline-none transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35"
        >
          <SkipForward aria-hidden className="size-4" />
        </button>

        {/* The title yields first. With captions and audio-language buttons
            present there are six controls competing for a phone's width, and
            a title squeezed to three characters is worth less than the room
            the buttons need. */}
        <div className="hidden min-w-0 flex-1 px-2 sm:block">
          <p className="truncate text-[0.85rem] font-medium text-chalk">
            {snapshot.item?.title ?? 'Nothing playing'}
          </p>
        </div>
        <div className="flex-1 sm:hidden" />

        {subtitles.length > 0 && (
          <div ref={captionsMenu} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setCaptionsOpen((open) => !open)}
              disabled={disabled}
              aria-label="Subtitles"
              aria-pressed={subtitleTrack >= 0}
              className={cn(
                'grid size-11 shrink-0 place-items-center sm:size-10 rounded-full border outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35',
                subtitleTrack >= 0
                  ? 'border-signal/50 bg-signal/15 text-chalk'
                  : 'border-white/12 bg-white/[0.05] text-chalk hover:border-white/30 hover:bg-white/[0.1]',
              )}
            >
              <Captions aria-hidden className="size-4" />
            </button>

            {captionsOpen && (
              <div className="glass-pill-ink absolute bottom-12 right-0 flex flex-col gap-0.5 rounded-card p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onSubtitleTrackChange(-1)
                    setCaptionsOpen(false)
                  }}
                  className={cn(
                    'whitespace-nowrap rounded-full px-4 py-1.5 text-left text-[0.78rem] transition-colors duration-200',
                    subtitleTrack < 0
                      ? 'bg-signal/20 text-chalk'
                      : 'text-mist hover:bg-white/[0.08] hover:text-chalk',
                  )}
                >
                  Off
                </button>
                {subtitles.map((track, index) => (
                  <button
                    key={track.url}
                    type="button"
                    onClick={() => {
                      onSubtitleTrackChange(index)
                      setCaptionsOpen(false)
                    }}
                    className={cn(
                      'whitespace-nowrap rounded-full px-4 py-1.5 text-left text-[0.78rem] transition-colors duration-200',
                      index === subtitleTrack
                        ? 'bg-signal/20 text-chalk'
                        : 'text-mist hover:bg-white/[0.08] hover:text-chalk',
                    )}
                  >
                    {track.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {audioTracks.length > 1 && (
          <div ref={languageMenu} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setLanguageOpen((open) => !open)}
              disabled={disabled}
              aria-label="Audio language"
              className="grid size-11 shrink-0 place-items-center sm:size-10 rounded-full border border-white/12 bg-white/[0.05] text-chalk outline-none transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35"
            >
              <Languages aria-hidden className="size-4" />
            </button>

            {languageOpen && (
              <div className="glass-pill-ink absolute bottom-12 right-0 flex flex-col gap-0.5 rounded-card p-1.5">
                {audioTracks.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => {
                      onAudioTrackChange(track.id)
                      setLanguageOpen(false)
                    }}
                    className={cn(
                      'whitespace-nowrap rounded-full px-4 py-1.5 text-left text-[0.78rem] transition-colors duration-200',
                      track.id === audioTrack
                        ? 'bg-signal/20 text-chalk'
                        : 'text-mist hover:bg-white/[0.08] hover:text-chalk',
                    )}
                  >
                    {track.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={rateMenu} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setRateOpen((open) => !open)}
            disabled={disabled}
            aria-label="Playback speed"
            className="h-11 rounded-full border sm:h-10 border-white/12 bg-white/[0.05] px-3.5 font-mono text-[0.78rem] text-chalk outline-none transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35"
          >
            {snapshot.rate}×
          </button>

          {rateOpen && (
            <div className="glass-pill-ink absolute bottom-12 right-0 flex flex-col gap-0.5 rounded-card p-1.5">
              {RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => {
                    onRate(rate)
                    setRateOpen(false)
                  }}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-left font-mono text-[0.78rem] transition-colors duration-200',
                    rate === snapshot.rate
                      ? 'bg-signal/20 text-chalk'
                      : 'text-mist hover:bg-white/[0.08] hover:text-chalk',
                  )}
                >
                  {rate}×
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleQueue}
          aria-label="Queue"
          aria-pressed={queueOpen}
          className={cn(
            'flex h-11 shrink-0 items-center gap-2 rounded-full border sm:h-10 px-3.5 outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            queueOpen
              ? 'border-signal/50 bg-signal/15 text-chalk'
              : 'border-white/12 bg-white/[0.05] text-chalk hover:border-white/30 hover:bg-white/[0.1]',
          )}
        >
          <ListVideo aria-hidden className="size-4" />
          <span className="text-[0.78rem] tabular-nums">{queueCount}</span>
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="grid size-11 shrink-0 place-items-center sm:size-10 rounded-full border border-white/12 bg-white/[0.05] text-chalk outline-none transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          {isFullscreen ? (
            <Minimize aria-hidden className="size-4" />
          ) : (
            <Maximize aria-hidden className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}
