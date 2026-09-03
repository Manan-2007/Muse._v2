import { useEffect, useState } from 'react'
import { ChevronDown, Heart, MessagesSquare, Mic, Quote } from 'lucide-react'

import { CoverHeading } from '@/features/music/CoverHeading'
import { LyricsPanel } from '@/features/music/LyricsPanel'
import { useLyrics } from '@/features/music/useLyrics'
import { useMusic } from '@/features/music/MusicContext'
import { MusicControls } from '@/features/music/MusicControls'
import type { CoverPalette } from '@/features/music/useCoverPalette'
import { useAudioAnalyser } from '@/features/music/useAudioAnalyser'
import { Vinyl } from '@/features/music/Vinyl'
import { cn } from '@/lib/utils'

/**
 * The record, full size.
 *
 * Its own view rather than the app's home screen. A music app is mostly
 * looking for things to play; this is the moment you stop looking, so it earns
 * a whole screen with nothing else on it — one object, its name, and the
 * transport.
 *
 * The composition is deliberately a single centred column with generous air
 * around it. Everything competing for that space (search, playlists, the
 * queue) lives one gesture away rather than in the corners of this.
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
  /** So the avatar strip can leave you out of it. */
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
    queue,
    send,
    handle,
    position,
    duration,
    needsGesture,
    acknowledgeGesture,
    error,
    volume,
    setVolume,
    analyserSource,
    singalong,
  } = useMusic()

  const track = snapshot?.track ?? null

  /*
   * Local, not shared. Whether the words are showing is a way of looking at
   * the song rather than a fact about it — the same as being fullscreen — and
   * pushing it through the room would put them on everybody's screen because
   * one person wanted to read along.
   */
  const [showLyrics, setShowLyrics] = useState(false)
  const { lyrics, loading: lyricsLoading, available } = useLyrics(snapshot?.roomId ?? null, track)

  /*
   * A track with no words puts the record back in the middle.
   *
   * Left open, the next song in the queue would land on an empty column with
   * the record shoved to one side for nothing — the layout would be paying
   * for a panel with nothing in it.
   */
  useEffect(() => {
    if (available === false) setShowLyrics(false)
  }, [available])

  const { read } = useAudioAnalyser({
    source: analyserSource,
    playing: snapshot?.playing ?? false,
  })

  if (!track || !snapshot) return null

  const others = snapshot.listeners.filter((one) => one.id !== selfId)
  const singers = snapshot.listeners.filter((one) => one.singing)
  const recorders = snapshot.listeners.filter((one) => one.recording)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Back to library"
          className="grid size-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-chalk outline-none backdrop-blur-md transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <ChevronDown aria-hidden className="size-4" />
        </button>

        <span className="flex items-center gap-3">
          <span className="text-[0.68rem] uppercase tracking-[0.22em] text-dusk">Now playing</span>

          {/*
            Everyone else in here, and only them.
            Your own face is not news to you, and including it would make a
            room of one look busy. An empty space when you are alone is the
            honest state.
          */}
          {others.length > 0 && (
            <span className="flex -space-x-2">
              {others.slice(0, 4).map((one) => (
                <span
                  key={one.id}
                  title={one.singing ? `${one.name} — singing along` : one.name}
                  className={cn(
                    'grid size-7 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.62rem] font-semibold text-white ring-2 ring-void',
                    one.singing && 'ring-signal/60',
                  )}
                >
                  {one.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {others.length > 4 && (
                <span className="grid size-7 place-items-center rounded-full bg-white/10 text-[0.6rem] font-semibold text-chalk ring-2 ring-void">
                  +{others.length - 4}
                </span>
              )}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={onToggleLike}
          aria-label={liked ? 'Remove from liked' : 'Like this song'}
          aria-pressed={liked}
          className={cn(
            'grid size-9 place-items-center rounded-full border outline-none backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            liked
              ? 'border-signal/40 bg-signal/15 text-signal-bright'
              : 'border-white/10 bg-white/[0.04] text-chalk hover:bg-white/[0.1]',
          )}
        >
          <Heart aria-hidden className={cn('size-4', liked && 'fill-current')} />
        </button>

        {/* Offered only once the lookup has found something. A button that
            leads to "no lyrics" half the time is worse than no button. */}
        {available && (
        <button
          type="button"
          onClick={() => setShowLyrics((open) => !open)}
          aria-pressed={showLyrics}
          aria-label={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors duration-300',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            showLyrics
              ? 'bg-chalk text-void'
              : 'bg-white/[0.06] text-mist ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-chalk',
          )}
        >
          <Quote aria-hidden className="size-4" />
        </button>
        )}

        {/* The record view draws its own header over the stage's, so the way
            back to the room has to be repeated here or it disappears for as
            long as somebody is looking at the record. */}
        {onTogglePanel && (
          <button
            type="button"
            onClick={onTogglePanel}
            aria-pressed={panelOpen}
            aria-label="Chat"
            className={cn(
              'relative grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors duration-300',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
              panelOpen
                ? 'bg-signal/15 text-chalk ring-1 ring-inset ring-signal/50'
                : 'bg-white/[0.06] text-mist ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-chalk',
            )}
          >
            <MessagesSquare aria-hidden className="size-4" />
            {unread > 0 && !panelOpen && (
              <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-signal px-1 text-[0.6rem] font-semibold leading-4 text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-8 lg:px-8">
        {/* The record. Narrows and moves left to make room for the words on a
            wide screen; on a narrow one the words take the whole column
            instead, because two of these side by side would leave neither
            readable. */}
        <div
          className={cn(
            'flex min-h-0 flex-col items-center justify-center gap-8 px-6',
            showLyrics
              ? 'hidden lg:flex lg:w-[44%] lg:shrink-0 lg:px-0'
              : 'flex-1',
          )}
        >
        {/* The record is the subject of this screen, so it takes as much of it
            as the shortest edge allows rather than a fixed size. */}
        <Vinyl
          artwork={track.artwork}
          playing={snapshot.playing}
          read={read}
          accent={palette?.base ?? 'var(--color-signal)'}
          className="w-[min(78vw,min(30rem,46vh))]"
        />

        <div className="w-full max-w-2xl text-center">
          {/* Clamped, because these titles are not written to be headlines —
              a YouTube upload carries its own parenthetical baggage, and three
              lines of it pushes the record off the screen it is the subject
              of. Two lines, then it yields. */}
          <CoverHeading
            artwork={track.artwork}
            palette={palette}
            className="line-clamp-2 text-[clamp(1.5rem,4vw,2.6rem)] leading-[1.06]"
          >
            {track.title}
          </CoverHeading>

          {(track.artist ?? track.album) && (
            <p className="mt-2.5 truncate text-[0.95rem] text-mist">
              {[track.artist, track.album].filter(Boolean).join(' · ')}
            </p>
          )}

          {(singers.length > 0 || recorders.length > 0) && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {singers.length > 0 && (
                <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 backdrop-blur-md">
                  <Mic aria-hidden className="size-3.5 text-chalk" />
                  <span className="text-[0.72rem] text-chalk">
                    {singers.map((one) => one.name).join(', ')} singing
                  </span>
                </span>
              )}

              {/* Everyone sees this, not just whoever pressed record. */}
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
        </div>

        {showLyrics && (
          <div className="flex min-h-0 flex-1 flex-col">
            <LyricsPanel
              lyrics={lyrics}
              loading={lyricsLoading}
              onSeek={(seconds) => send('music:control', { action: 'seek', position: seconds })}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-4 px-6 pb-6">
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

        <div className="w-full max-w-2xl">
          <MusicControls
            snapshot={snapshot}
            position={position}
            duration={duration}
            queueCount={queue.length}
            queueOpen={queueOpen}
            volume={volume}
            singing={singalong.singing}
            recording={singalong.recording}
            onPlayPause={() =>
              send('music:control', {
                action: snapshot.playing ? 'pause' : 'play',
                position: handle ? handle.getPosition() : undefined,
              })
            }
            onSeek={(seconds) => send('music:control', { action: 'seek', position: seconds })}
            onNext={() => send('music:next', { seq: snapshot.seq })}
            onPrevious={() => send('music:previous', { seq: snapshot.seq })}
            onVolume={setVolume}
            onToggleQueue={onOpenQueue}
            onToggleSinging={singalong.toggleSinging}
            onToggleRecording={singalong.toggleRecording}
            disabled={false}
          />
        </div>
      </div>
    </div>
  )
}
