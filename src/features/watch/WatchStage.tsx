import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Loader2, MessagesSquare, Play, WifiOff, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import * as watchApi from '@/features/watch/api'
import { ExternalBeacon } from '@/features/watch/players/ExternalBeacon'
import { FilePlayer } from '@/features/watch/players/FilePlayer'
import { YouTubePlayer } from '@/features/watch/players/YouTubePlayer'
import { QueuePanel } from '@/features/watch/QueuePanel'
import { type Queued } from '@/features/watch/SourcePicker'
import { WatchBrowser } from '@/features/watch/WatchBrowser'
import { CoverAmbience } from '@/features/music/CoverAmbience'
import type { AudioTrackInfo, PlayerHandle, QueueItem } from '@/features/watch/types'
import { useDriftCorrection } from '@/features/sync/useDriftCorrection'
import { useWatchSession } from '@/features/watch/useWatchSession'
import { WatchControls } from '@/features/watch/WatchControls'
import { WatchToasts } from '@/features/watch/WatchToasts'
import { apiUrl } from '@/lib/config'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as const

/** Last language someone on this device picked, so the next film opens in it. */
const AUDIO_LANGUAGE_KEY = 'syncroom.audioLanguage'

/**
 * The watch stage.
 *
 * Takes the whole screen rather than sitting in a card: this is the flagship
 * activity, and a synced player in a modal reads as a preview of one.
 *
 * Portalled to the body for the same reason the hub's drawer is — the hub's
 * fade leaves a `will-change` that would trap this under the fixed header.
 */
export function WatchStage({
  roomId,
  selfId,
  onClose,
  insetRight = 0,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  origin,
}: {
  roomId: string
  selfId: string | undefined
  onClose: () => void
  /** Rem the room panel occupies, so the player is never hidden behind it. */
  insetRight?: number
  panelOpen?: boolean
  /** The stage covers the hub's rails, so chat needs a door in from here. */
  onTogglePanel?: () => void
  unread?: number
  /** The control this opened from, so the reveal starts there. */
  origin?: DOMRect | null
}) {
  const { snapshot, queue, setQueue, connected, clockReady, targetPosition, send } = useWatchSession(
    roomId,
    true,
  )

  const [handle, setHandle] = useState<PlayerHandle | null>(null)

  /* Read through refs by the player-intent callback below, so it can stay a
     stable function while still seeing the current room and player. */
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const handleRef = useRef(handle)
  handleRef.current = handle
  const [queueOpen, setQueueOpen] = useState(false)
  const [canSearch, setCanSearch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when the browser refuses to autoplay — the viewer has to ask for it. */
  const [needsGesture, setNeedsGesture] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  /** Id of a just-added item waiting to be put on. See `onQueued` below. */
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  /*
   * Audio language.
   *
   * Deliberately local, never sent through `send()`. Playback position, rate,
   * and what's on are decisions the room makes together — which language you
   * personally hear it in is not, the same way volume isn't. Two people in one
   * room can watch the same film in different languages at once.
   */
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([])
  const [audioTrack, setAudioTrackState] = useState(0)
  /** Index into the item's subtitle list, or -1 for off. Also personal. */
  const [subtitleTrack, setSubtitleTrackState] = useState(-1)
  /** True while the player is stalled, so a freeze reads as loading. */
  const [buffering, setBuffering] = useState(false)

  const item = snapshot?.item ?? null
  const embeddable = item?.source === 'youtube' || item?.source === 'file'

  /*
   * The last YouTube video this room played.
   *
   * Kept so the player below can outlive the item that introduced it — a
   * fresh instance per video meant `destroy()` immediately followed by
   * `new Player()`, which is what crashed the SDK on every switch, including
   * a switch to a non-YouTube source. Cleared only on a room change, the one
   * moment the whole session is genuinely being torn down.
   */
  const [stickyYouTubeRef, setStickyYouTubeRef] = useState<string | null>(null)
  useEffect(() => {
    if (item?.source === 'youtube') setStickyYouTubeRef(item.ref)
  }, [item?.source, item?.ref])
  useEffect(() => {
    setStickyYouTubeRef(null)
  }, [roomId])

  /*
   * Auto-hide chrome.
   *
   * The header and controls fade out after 5 s of no mouse/touch activity,
   * then reappear on any movement. Scrubbing, hovering the controls, or
   * pausing keeps them visible.
   */
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const resetHideTimer = useCallback(() => {
    setChromeVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChromeVisible(false), 5000)
  }, [])

  /* Start the timer when a video is playing; clear when paused or empty. */
  useEffect(() => {
    if (!item || !snapshot?.playing) {
      setChromeVisible(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      return
    }
    resetHideTimer()
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [item, snapshot?.playing, resetHideTimer])

  /* Track fullscreen state changes (user might press Escape). */
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /*
   * iOS Safari never fires `fullscreenchange` for the video-native path
   * below — it has its own events for its own fullscreen mode.
   */
  useEffect(() => {
    const video = handle?.getVideoElement?.()
    if (!video) return
    const onBegin = () => setIsFullscreen(true)
    const onEnd = () => setIsFullscreen(false)
    video.addEventListener('webkitbeginfullscreen', onBegin)
    video.addEventListener('webkitendfullscreen', onEnd)
    return () => {
      video.removeEventListener('webkitbeginfullscreen', onBegin)
      video.removeEventListener('webkitendfullscreen', onEnd)
    }
  }, [handle])

  const toggleFullscreen = useCallback(() => {
    if (!stageRef.current) return

    const video = handle?.getVideoElement?.() as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void
          webkitExitFullscreen?: () => void
          webkitDisplayingFullscreen?: boolean
          webkitSupportsFullscreen?: boolean
        })
      | null
      | undefined

    if (video?.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen?.()
      return
    }

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined)
      return
    }

    /*
     * iOS Safari blacks out a `<video>` when a non-video ancestor goes
     * fullscreen through the standard API — the video composites beneath
     * the fullscreened layer rather than into it. Its own video-fullscreen
     * API is the one path Safari actually renders correctly, at the cost of
     * swapping in the OS player chrome for our custom controls while it's
     * open — a real tradeoff, but better than a black rectangle.
     */
    if (video?.webkitSupportsFullscreen) {
      video.webkitEnterFullscreen?.()
      return
    }

    stageRef.current.requestFullscreen().catch(() => undefined)
  }, [handle])


  useEffect(() => {
    watchApi
      .fetchCapabilities(roomId)
      .then((caps) => setCanSearch(caps.search))
      .catch(() => setCanSearch(false))
  }, [roomId])

  useEffect(() => {
    watchApi.fetchQueue(roomId).then(setQueue).catch(() => undefined)
  }, [roomId, setQueue])

  /* A new item clears the last item's failure, so one unembeddable video does
     not leave an error sitting over the next one. */
  useEffect(() => {
    setError(null)
    setNeedsGesture(false)
  }, [item?.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * Reconcile play/pause with the room.
   *
   * Keyed on the room's intent, not on player events — the player is a
   * follower here. `needsGesture` covers the case browsers force on us: a late
   * joiner has not interacted with the page yet, so `play()` is refused and the
   * only honest response is to ask.
   */
  useEffect(() => {
    if (!handle || !snapshot || !embeddable) return

    if (!snapshot.playing) {
      handle.pause()
      setNeedsGesture(false)
      return
    }

    /*
     * Nothing is placed until the clock has been measured.
     *
     * `targetPosition` is only as good as the offset behind it, and before the
     * first pong that offset is zero — not "no skew" but "not asked yet". A
     * snapshot arrives in milliseconds and the first pong does not, so this
     * used to seek to wherever this device's own clock happened to think the
     * room was, which is a different wrong place on every machine. It settled
     * eventually, through the drift correction, which is why it looked like a
     * few seconds of disagreement at the start and fine thereafter.
     *
     * Pausing is exempt: stopping needs no clock, and the room having stopped
     * is not something worth delaying.
     */
    if (!clockReady) return

    handle.seek(targetPosition())
    handle.setRate(snapshot.rate)
    handle.play()

    const before = handle.getPosition()

    /*
     * Checked twice, early and late.
     *
     * A phone refuses to start a video with sound until the person has touched
     * something — that is browser policy, not something this app can talk its
     * way out of. The refusal is silent: YouTube's API returns nothing to
     * catch, so the only way to know is that the position has not moved and
     * the player is not merely loading.
     *
     * Waiting the full second and a half to find that out is most of why
     * opening Watch on a phone showed a still frame with a YouTube logo on it
     * and no explanation — the invitation to tap arrived long after the person
     * had already started wondering what was broken. The early look catches a
     * refusal, which is instant; the later one is still needed for a slow
     * connection, where six hundred milliseconds of no progress means the
     * network rather than a policy.
     */
    const stalled = () => handle.getPosition() <= before + 0.05 && !handle.isBuffering()
    const early = setTimeout(() => {
      if (stalled()) setNeedsGesture(true)
    }, 600)
    const check = setTimeout(() => {
      if (stalled()) setNeedsGesture(true)
    }, 1400)

    return () => {
      clearTimeout(early)
      clearTimeout(check)
    }
    /* Keyed on `seq`, not on the snapshot object. A viewer joining rebuilds the
       snapshot without changing playback, and re-running this would re-seek and
       re-play the video every time somebody walked in. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, embeddable, clockReady, snapshot?.seq, snapshot?.playing, snapshot?.rate])

  useDriftCorrection({
    handle,
    playing: snapshot?.playing ?? false,
    rate: snapshot?.rate ?? 1,
    seq: snapshot?.seq ?? -1,
    targetPosition,
    enabled: embeddable && !needsGesture,
  })

  /* Local read-out for the scrubber. Deliberately not the drift loop's clock —
     this only paints, and it runs faster so the bar moves smoothly. */
  useEffect(() => {
    const tick = () => {
      if (handle && embeddable) {
        setPosition(handle.getPosition())
        setDuration(handle.getDuration() || item?.duration || 0)
        /* Only while the room believes it's playing. A paused video is not
           buffering, and saying so would put a spinner over every pause. */
        setBuffering(handle.isBuffering() && (snapshot?.playing ?? false))
      } else if (snapshot) {
        setPosition(targetPosition())
        setDuration(item?.duration ?? 0)
        setBuffering(false)
      }
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [handle, embeddable, snapshot, targetPosition, item?.duration])

  /*
   * Read the source's audio-track list into state.
   *
   * Called on every handle change and again whenever the player says its list
   * might have moved — HLS discovers alternate audio asynchronously, so the
   * list at the moment playback starts is not reliably the final one.
   */
  const syncAudioTracks = useCallback(() => {
    if (!handle) {
      setAudioTracks([])
      setAudioTrackState(0)
      return
    }
    setAudioTracks(handle.getAudioTracks())
    setAudioTrackState(handle.getAudioTrack())
  }, [handle])

  useEffect(() => {
    syncAudioTracks()
  }, [syncAudioTracks])

  /* A saved language applies itself once, the moment a video's tracks first
     become known — not on every re-sync, or manually switching languages
     mid-film would get silently reverted the next time hls.js re-announces
     its track list. */
  const appliedPreference = useRef<string | null>(null)
  useEffect(() => {
    if (!handle || audioTracks.length < 2) return
    if (appliedPreference.current === item?.id) return
    appliedPreference.current = item?.id ?? null

    let preferred: string | null = null
    try {
      preferred = localStorage.getItem(AUDIO_LANGUAGE_KEY)
    } catch {
      /* Private browsing can refuse storage access entirely. */
    }
    if (!preferred) return

    const match = audioTracks.find((track) => track.language === preferred)
    if (match && match.id !== handle.getAudioTrack()) {
      handle.setAudioTrack(match.id)
      setAudioTrackState(match.id)
    }
  }, [handle, audioTracks, item?.id])

  const onAudioTrackChange = useCallback(
    (id: number) => {
      if (!handle) return
      handle.setAudioTrack(id)
      setAudioTrackState(id)
      const track = audioTracks.find((entry) => entry.id === id)
      if (track) {
        try {
          localStorage.setItem(AUDIO_LANGUAGE_KEY, track.language)
        } catch {
          /* Not being able to remember the choice is not worth surfacing. */
        }
      }
    },
    [handle, audioTracks],
  )

  /* Subtitles start off on every new item, matching the `<track>` elements,
     which are rendered without `default` for the same reason. */
  useEffect(() => {
    setSubtitleTrackState(-1)
  }, [item?.id])

  const onSubtitleTrackChange = useCallback(
    (index: number) => {
      if (!handle) return
      handle.setSubtitleTrack(index)
      setSubtitleTrackState(index)
    },
    [handle],
  )

  const playNow = useCallback((next: QueueItem) => send('watch:load', { itemId: next.id }), [send])

  /*
   * The player was played or paused by something outside this app.
   *
   * Fullscreen on a phone hands the video to the OS player, whose pause button
   * — like the lock screen's, and a headphone click — reaches the element
   * directly. Treated as a control the room issued, so pausing there pauses it
   * for everybody, exactly as the app's own button does.
   *
   * Ignored when it merely agrees with the room, which is the common case: the
   * element fires `pause` when *we* pause it, and echoing that back would send
   * a second command for every one the room already made.
   */
  const onPlayerIntent = useCallback(
    (playing: boolean) => {
      const room = snapshotRef.current
      if (!room || room.playing === playing) return
      /* An ended film pauses itself. That is `watch:ended`'s business, and
         reporting it here as a pause would fight the advance to the next
         thing in the queue. */
      if (handleRef.current?.getDuration() && !playing) {
        const handle = handleRef.current
        const duration = handle.getDuration()
        if (duration > 0 && handle.getPosition() >= duration - 0.5) return
      }

      send('watch:control', {
        action: playing ? 'play' : 'pause',
        position: handleRef.current?.getPosition(),
      })
    },
    [send],
  )

  /*
   * Choosing something should play it.
   *
   * Identified by id, never by position. The add is REST and the room's queue
   * arrives over the socket, so at the moment of choosing the list in hand can
   * still be the one from before — and "the last row" was then whatever was
   * already there, which is how picking a video used to start the *previous*
   * one. Holding the id and waiting for that exact row is the whole fix.
   */
  const onQueued = useCallback(
    ({ item: added, items }: Queued, playImmediately: boolean) => {
      /* The REST reply is already the new queue, so seed it rather than wait
         on the socket — otherwise a dropped `watch:queue` means the pending
         load never resolves and the pick silently does nothing. */
      setQueue(items)
      if (playImmediately) setPendingPlayId(added.id)
    },
    [setQueue],
  )

  useEffect(() => {
    if (!pendingPlayId) return
    const target = queue.find((entry) => entry.id === pendingPlayId)
    if (!target) return
    playNow(target)
    setPendingPlayId(null)
  }, [pendingPlayId, queue, playNow])

  const skip = useCallback(() => {
    if (!snapshot) return
    send('watch:ended', { seq: snapshot.seq })
  }, [send, snapshot])

  const onEnded = useCallback(() => {
    if (!snapshot) return
    /* The seq stamps which item ended, so five clients firing at once still
       only advance the queue by one. */
    send('watch:ended', { seq: snapshot.seq })
  }, [send, snapshot])

  const first = queue[0]

  const revealX = origin ? `${Math.round(origin.left + origin.width / 2)}px` : '50%'
  const revealY = origin ? `${Math.round(origin.top + origin.height / 2)}px` : '50%'

  return createPortal(
    <motion.div
      /*
       * Sized explicitly rather than by `inset-0`: several ancestors on this
       * page can establish a containing block, and when one does a fixed
       * element's insets resolve against something that is not the screen.
       *
       * The opening is a CSS keyframe for the same reason `MusicStage` uses
       * one — animating `clip-path` through Motion on a portalled, fixed
       * element inside an `AnimatePresence` left it parked on its first
       * frame: a working page clipped to a zero-radius circle, which is to
       * say invisible.
       */
      ref={stageRef}
      className={cn(
        'fixed left-0 top-0 z-[135] flex flex-col overflow-hidden transition-[padding] duration-500 ease-glass',
        /* Solid the moment there is a picture to protect; see-through while
           the shelf is up, so the room stays visible underneath it. */
        item ? 'bg-void' : 'bg-transparent',
      )}
      style={{
        width: '100vw',
        height: '100dvh',
        paddingRight: `${insetRight}rem`,
        cursor: chromeVisible ? undefined : 'none',
        ['--reveal-x' as string]: revealX,
        ['--reveal-y' as string]: revealY,
        animation: 'stage-reveal 0.62s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
    >
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className={cn('absolute inset-0', item ? 'bg-black' : 'bg-transparent')}>
            {/*
              One persistent player for the room's whole life, kept mounted
              past the video that introduced it. A fresh instance per video
              meant `destroy()` immediately followed by `new Player()` —
              which is what crashed the SDK, on *any* switch away from
              YouTube too, since that unmounted it mid glue-code. Idle, it is
              a paused iframe under the current source, driving nothing.
            */}
            {stickyYouTubeRef && (
              <YouTubePlayer
                key="youtube"
                videoId={stickyYouTubeRef}
                active={item?.source === 'youtube'}
                startAt={targetPosition()}
                onHandle={setHandle}
                onEnded={onEnded}
                onError={setError}
              />
            )}

            {item && embeddable && item.source === 'file' && (
              <FilePlayer
                key={item.id}
                /* Uploads are stored as a server-relative path, which resolves
                   against the *frontend* once the two are on different origins.
                   `apiUrl` puts it back on the API. The service worker in
                   `public/ngrok-sw.js` adds the `ngrok-skip-browser-warning`
                   header so ngrok doesn't serve its interstitial to the
                   `<video>` element. */
                src={apiUrl(item.ref)}
                startAt={targetPosition()}
                subtitles={item.subtitles}
                onHandle={setHandle}
                onEnded={onEnded}
                onError={setError}
                onAudioTracksChanged={syncAudioTracks}
                onIntentChanged={onPlayerIntent}
              />
            )}

            {item && item.source === 'external' && (
              <ExternalBeacon
                item={item}
                position={snapshot?.position ?? 0}
                playing={snapshot?.playing ?? false}
              />
            )}

            {!item && (
              /*
                The browser, not a dialog full of source buttons.
                Choosing what to watch is most of the time spent here when
                nothing is on, so it gets the whole screen and the same rail
                the music library uses — with a thumbnail grid, because a
                still frame identifies a video faster than its title does.
              */
              <div className="absolute inset-0 flex flex-col">
                <CoverAmbience palette={null} translucent />
                <div className="relative flex min-h-0 flex-1 flex-col pt-16">
                  {first && (
                    <div className="shrink-0 px-4 pb-1 md:px-6">
                      <button
                        type="button"
                        onClick={() => playNow(first)}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left outline-none backdrop-blur-md transition-colors hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-chalk text-void">
                          <Play aria-hidden className="size-4 translate-x-px fill-current" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[0.7rem] uppercase tracking-[0.16em] text-dusk">
                            Pick up where the room left off
                          </span>
                          <span className="block truncate text-[0.88rem] text-chalk">
                            {first.title}
                          </span>
                        </span>
                      </button>
                    </div>
                  )}

                  <WatchBrowser
                    roomId={roomId}
                    canSearch={canSearch}
                    queue={queue}
                    nowPlayingRef={null}
                    playing={false}
                    onQueued={onQueued}
                    onPlayQueued={playNow}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sits under `needsGesture`, which is a different problem with its
              own overlay — showing both at once would be two explanations for
              one stopped video. */}
          {buffering && !needsGesture && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <span className="glass-pill-ink flex items-center gap-2.5 rounded-full px-4 py-2.5">
                <Loader2 aria-hidden className="size-4 animate-spin text-signal-bright" />
                <span className="text-[0.78rem] text-chalk">Buffering…</span>
              </span>
            </div>
          )}

          {needsGesture && (
            <button
              type="button"
              onClick={() => {
                handle?.seek(targetPosition())
                handle?.play()
                setNeedsGesture(false)
              }}
              className="absolute inset-0 z-10 grid place-items-center bg-void/70 backdrop-blur-sm"
            >
              <span className="flex flex-col items-center gap-3">
                <span className="grid size-16 place-items-center rounded-full bg-chalk text-void">
                  <Play aria-hidden className="size-7 translate-x-0.5 fill-current" />
                </span>
                <span className="font-display text-[1.05rem] font-semibold text-chalk">
                  Tap to join playback
                </span>
                <span className="max-w-xs text-center text-[0.8rem] leading-relaxed text-mist">
                  Your browser blocks video that starts on its own. This drops you straight in at
                  the room's timestamp.
                </span>
              </span>
            </button>
          )}

          {error && (
            <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-4">
              <p
                role="alert"
                className="glass-pill-ink max-w-lg rounded-card px-4 py-3 text-center text-[0.82rem] leading-relaxed text-signal-bright"
              >
                {error}
              </p>
            </div>
          )}

          <header
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-void/90 to-transparent p-4 transition-opacity duration-500 ease-glass md:p-5',
              chromeVisible ? 'opacity-100' : 'opacity-0',
            )}
          >
            <span className="pointer-events-auto flex items-center gap-2.5">
              {snapshot && snapshot.viewers.length > 0 && (
                <span className="glass-pill-ink flex items-center gap-2 rounded-full px-3 py-1.5">
                  <span className="size-1.5 animate-signal-pulse rounded-full bg-emerald-400" />
                  <span className="text-[0.72rem] text-chalk">
                    {snapshot.viewers.length} watching
                  </span>
                </span>
              )}
              {!connected && (
                <span className="glass-pill-ink flex items-center gap-2 rounded-full px-3 py-1.5 text-signal-bright">
                  <WifiOff aria-hidden className="size-3.5" />
                  <span className="text-[0.72rem]">Reconnecting…</span>
                </span>
              )}
              {!snapshot && (
                <span className="glass-pill-ink flex items-center gap-2 rounded-full px-3 py-1.5">
                  <Loader2 aria-hidden className="size-3.5 animate-spin text-mist" />
                  <span className="text-[0.72rem] text-mist">Syncing…</span>
                </span>
              )}
            </span>

            <span className="pointer-events-auto flex items-center gap-2">
              {onTogglePanel && (
                <button
                  type="button"
                  onClick={onTogglePanel}
                  aria-label="Chat and call"
                  aria-pressed={panelOpen}
                  className={cn(
                    'relative flex h-11 items-center gap-2 rounded-full border px-3.5 outline-none transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:h-10',
                    panelOpen
                      ? 'border-signal/50 bg-signal/15 text-chalk'
                      : 'border-white/15 bg-white/[0.05] text-chalk backdrop-blur-md hover:border-white/30 hover:bg-white/[0.1]',
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
              <Button variant="outline" size="icon" onClick={onClose} aria-label="Leave the stage" plain>
                <X aria-hidden />
              </Button>
            </span>
          </header>

          <WatchToasts snapshot={snapshot} selfId={selfId} />

          <div
            className={cn(
              'absolute inset-x-0 bottom-0 transition-opacity duration-500 ease-glass',
              chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
          >
            {snapshot && (
              <WatchControls
                snapshot={snapshot}
                position={position}
                duration={duration}
                queueCount={queue.length}
                queueOpen={queueOpen}
                isFullscreen={isFullscreen}
                audioTracks={audioTracks}
                audioTrack={audioTrack}
                onAudioTrackChange={onAudioTrackChange}
                subtitles={item?.subtitles ?? []}
                subtitleTrack={subtitleTrack}
                onSubtitleTrackChange={onSubtitleTrackChange}
                onToggleQueue={() => setQueueOpen((open) => !open)}
                onPlayPause={() =>
                  send('watch:control', {
                    action: snapshot.playing ? 'pause' : 'play',
                    position: embeddable && handle ? handle.getPosition() : undefined,
                  })
                }
                onSeek={(seconds) => send('watch:control', { action: 'seek', position: seconds })}
                onRate={(rate) => send('watch:control', { action: 'rate', rate })}
                onSkip={skip}
                onToggleFullscreen={toggleFullscreen}
                disabled={!item}
              />
            )}
          </div>
        </div>

        {queueOpen && (
          <QueuePanel
            roomId={roomId}
            items={queue}
            nowPlayingId={item?.id ?? null}
            canSearch={canSearch}
            onQueueChange={setQueue}
            onQueued={onQueued}
            onPlayNow={(next) => playNow(next)}
            onClose={() => setQueueOpen(false)}
          />
        )}
      </div>
    </motion.div>,
    document.body,
  )
}
