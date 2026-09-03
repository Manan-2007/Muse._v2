import { useEffect, useRef, useState } from 'react'
import {
  Circle,
  ListMusic,
  Mic,
  MicOff,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { formatTime, type MusicSnapshot } from '@/features/music/types'
import { cn } from '@/lib/utils'

/**
 * The transport, under the record.
 *
 * Split down the middle by who a control belongs to. Play, seek and skip are
 * the room's — pressing them moves the song for everybody. Volume, the
 * microphone and the recorder are yours alone, and never leave this browser's
 * own playback. Grouping them by that rather than by shape is what stops
 * someone muting a room they meant to mute themselves out of.
 */
export function MusicControls({
  snapshot,
  position,
  duration,
  queueCount,
  queueOpen,
  volume,
  singing,
  recording,
  onPlayPause,
  onSeek,
  onNext,
  onPrevious,
  onVolume,
  onToggleQueue,
  onToggleSinging,
  onToggleRecording,
  disabled,
}: {
  snapshot: MusicSnapshot
  position: number
  duration: number
  queueCount: number
  queueOpen: boolean
  volume: number
  singing: boolean
  recording: boolean
  onPlayPause: () => void
  onSeek: (seconds: number) => void
  onNext: () => void
  onPrevious: () => void
  onVolume: (level: number) => void
  onToggleQueue: () => void
  onToggleSinging: () => void
  onToggleRecording: () => void
  disabled: boolean
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const volumeMenu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!volumeOpen) return
    const onAway = (event: MouseEvent) => {
      if (!volumeMenu.current?.contains(event.target as Node)) setVolumeOpen(false)
    }
    window.addEventListener('mousedown', onAway)
    return () => window.removeEventListener('mousedown', onAway)
  }, [volumeOpen])

  /* While a finger is down the bar follows the finger, not the room — letting
     the server's position win mid-drag would make the handle fight back. */
  const shown = scrubbing ?? position
  const percent = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  const roundButton =
    'grid size-10 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.06] text-chalk outline-none backdrop-blur-md transition-colors duration-300 hover:border-white/30 hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-35'

  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        <span className="w-11 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-mist">
          {formatTime(shown)}
        </span>

        <label className="relative flex h-8 min-w-0 flex-1 items-center">
          <span className="sr-only">Seek</span>
          <span aria-hidden className="absolute inset-x-0 h-1 rounded-full bg-white/12" />
          <span
            aria-hidden
            className="absolute h-1 rounded-full bg-chalk transition-[width] duration-150"
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
            /* Tabbing away mid-scrub would otherwise leave the bar following a
               drag that is no longer happening. */
            onBlur={() => setScrubbing(null)}
            className="absolute inset-x-0 h-8 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </label>

        <span className="w-11 shrink-0 font-mono text-[0.7rem] tabular-nums text-mist">
          {duration > 0 ? formatTime(duration) : '--:--'}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled || queueCount === 0}
          aria-label="Previous track"
          className={roundButton}
        >
          <SkipBack aria-hidden className="size-4" />
        </button>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={disabled}
          aria-label={snapshot.playing ? 'Pause' : 'Play'}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-chalk text-void outline-none transition-transform duration-300 hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal disabled:opacity-35"
        >
          {snapshot.playing ? (
            <Pause aria-hidden className="size-5 fill-current" />
          ) : (
            <Play aria-hidden className="size-5 translate-x-px fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={disabled || queueCount === 0}
          aria-label="Next track"
          className={roundButton}
        >
          <SkipForward aria-hidden className="size-4" />
        </button>

        <div className="min-w-0 flex-1" />

        {/* Everything from here right is personal, not the room's. */}
        <button
          type="button"
          onClick={onToggleSinging}
          aria-label={singing ? 'Stop singing along' : 'Sing along'}
          aria-pressed={singing}
          className={cn(
            roundButton,
            singing && 'border-signal/50 bg-signal/20 text-chalk hover:bg-signal/25',
          )}
        >
          {singing ? <Mic aria-hidden className="size-4" /> : <MicOff aria-hidden className="size-4" />}
        </button>

        {/* Only offered while a microphone is open — recording the music on its
            own is just keeping a copy of the file. */}
        {singing && (
          <button
            type="button"
            onClick={onToggleRecording}
            aria-label={recording ? 'Stop recording' : 'Record the singalong'}
            aria-pressed={recording}
            className={cn(
              roundButton,
              recording && 'border-signal/60 bg-signal/25 text-signal-bright',
            )}
          >
            {recording ? (
              <Square aria-hidden className="size-3.5 fill-current" />
            ) : (
              <Circle aria-hidden className="size-3.5 fill-current" />
            )}
          </button>
        )}

        <div ref={volumeMenu} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setVolumeOpen((open) => !open)}
            aria-label="Volume"
            className={roundButton}
          >
            <VolumeIcon aria-hidden className="size-4" />
          </button>

          {volumeOpen && (
            <div className="glass-pill-ink absolute bottom-12 right-0 flex h-32 w-11 flex-col items-center justify-center rounded-card p-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
                aria-label="Volume level"
                /* Rotated rather than `writing-mode`, which Safari still reads
                   inconsistently for range inputs. */
                className="h-24 w-24 -rotate-90 cursor-pointer accent-chalk"
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleQueue}
          aria-label="Queue"
          aria-pressed={queueOpen}
          className={cn(
            roundButton,
            'w-auto gap-2 px-3.5',
            queueOpen && 'border-signal/50 bg-signal/15',
          )}
        >
          <ListMusic aria-hidden className="size-4" />
          {queueCount > 0 && <span className="text-[0.72rem] tabular-nums">{queueCount}</span>}
        </button>
      </div>
    </div>
  )
}
