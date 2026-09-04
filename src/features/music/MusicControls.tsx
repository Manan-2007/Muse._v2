import { useState } from 'react'
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { formatTime, type MusicSnapshot } from '@/features/music/types'
import { cn } from '@/lib/utils'

/**
 * The transport, under the record — Muse._v1's layout: a thin scrubber with the
 * times on either side, the five-button row (shuffle, back, play, forward,
 * repeat) with the play control the clear centre of gravity, and a quiet volume
 * slider beneath.
 *
 * Play, seek and skip are the room's — pressing them moves the song for
 * everybody. Shuffle, repeat and volume are this listener's alone.
 */
export function MusicControls({
  snapshot,
  position,
  duration,
  shuffle,
  repeat,
  volume,
  onPlayPause,
  onSeek,
  onNext,
  onPrevious,
  onToggleShuffle,
  onToggleRepeat,
  onVolume,
  disabled,
}: {
  snapshot: MusicSnapshot
  position: number
  duration: number
  shuffle: boolean
  repeat: boolean
  volume: number
  onPlayPause: () => void
  onSeek: (seconds: number) => void
  onNext: () => void
  onPrevious: () => void
  onToggleShuffle: () => void
  onToggleRepeat: () => void
  onVolume: (level: number) => void
  disabled: boolean
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  /* While a finger is down the bar follows the finger, not the room — letting
     the server's position win mid-drag would make the handle fight back. */
  const shown = scrubbing ?? position
  const percent = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="w-full">
      {/* Scrubber, Apple-thin, with the clock on either side. */}
      <div className="flex items-center gap-3">
        <span className="w-11 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-mist">
          {formatTime(shown)}
        </span>

        <label className="relative flex h-6 min-w-0 flex-1 items-center">
          <span className="sr-only">Seek</span>
          <span aria-hidden className="absolute inset-x-0 h-[3px] rounded-full bg-white/15" />
          <span
            aria-hidden
            className="absolute h-[3px] rounded-full bg-chalk transition-[width] duration-150"
            style={{ width: `${percent}%` }}
          />
          <span
            aria-hidden
            className="absolute size-3 -translate-x-1/2 rounded-full bg-chalk shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
            style={{ left: `${percent}%` }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            value={shown}
            disabled={disabled || duration === 0}
            onChange={(event) => setScrubbing(Number(event.target.value))}
            onPointerUp={() => {
              if (scrubbing !== null) onSeek(scrubbing)
              setScrubbing(null)
            }}
            onKeyUp={() => {
              if (scrubbing !== null) onSeek(scrubbing)
              setScrubbing(null)
            }}
            onBlur={() => setScrubbing(null)}
            className="absolute inset-x-0 h-6 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </label>

        <span className="w-11 shrink-0 font-mono text-[0.7rem] tabular-nums text-mist">
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </div>

      {/* The five buttons. Shuffle and repeat sit at the ends in white-60, going
          signal-red when on; the transport proper is white and centred. */}
      <div className="mt-5 flex items-center justify-center gap-6 sm:gap-8">
        <button
          type="button"
          onClick={onToggleShuffle}
          aria-label="Shuffle"
          aria-pressed={shuffle}
          className={cn(
            'grid size-9 place-items-center rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            shuffle ? 'text-signal-bright' : 'text-mist hover:text-chalk',
          )}
        >
          <Shuffle aria-hidden className="size-[1.15rem]" />
        </button>

        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled}
          aria-label="Previous track"
          className="grid size-11 place-items-center rounded-full text-chalk outline-none transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35"
        >
          <SkipBack aria-hidden className="size-6 fill-current" />
        </button>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={disabled}
          aria-label={snapshot.playing ? 'Pause' : 'Play'}
          className="grid size-[4.25rem] shrink-0 place-items-center rounded-full text-chalk outline-none transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal disabled:opacity-35"
        >
          {snapshot.playing ? (
            <Pause aria-hidden className="size-[3.4rem] fill-current" />
          ) : (
            <Play aria-hidden className="size-[3.4rem] translate-x-0.5 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={disabled}
          aria-label="Next track"
          className="grid size-11 place-items-center rounded-full text-chalk outline-none transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35"
        >
          <SkipForward aria-hidden className="size-6 fill-current" />
        </button>

        <button
          type="button"
          onClick={onToggleRepeat}
          aria-label="Repeat"
          aria-pressed={repeat}
          className={cn(
            'grid size-9 place-items-center rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            repeat ? 'text-signal-bright' : 'text-mist hover:text-chalk',
          )}
        >
          {repeat ? (
            <Repeat1 aria-hidden className="size-[1.15rem]" />
          ) : (
            <Repeat aria-hidden className="size-[1.15rem]" />
          )}
        </button>
      </div>

      {/* Volume, quiet, beneath — a personal control, so it never carries the
          signal colour the transport's live state uses. */}
      <div className="mx-auto mt-5 flex w-[70%] max-w-xs items-center gap-3 opacity-80">
        <VolumeIcon aria-hidden className="size-4 shrink-0 text-mist" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          aria-label="Volume"
          className="h-1 w-full cursor-pointer accent-chalk"
        />
        <Volume2 aria-hidden className="size-4 shrink-0 text-mist" />
      </div>
    </div>
  )
}
