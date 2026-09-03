import { useEffect, useRef, useState } from 'react'

import {
  loadYouTubeApi,
  youtubeError,
  type YTPlayer,
} from '@/features/watch/players/youtubeApi'
import type { AudioHandle } from '@/features/music/types'

/**
 * A YouTube video played for its sound.
 *
 * The iframe still exists — YouTube has no audio-only mode and hiding the
 * player is against nothing in its terms, but removing it from the document
 * would stop playback entirely. So it is mounted at one pixel, off-screen and
 * inert, while the record and the bars stand in for it visually.
 *
 * Its audio cannot be analysed. The stream lives inside a cross-origin iframe
 * that the Web Audio API has no route into, which is why `getAnalyserSource`
 * answers null and the visualiser falls back to its synthetic motion.
 */
export function YouTubeTrackPlayer({
  videoId,
  active,
  startAt,
  volume,
  onHandle,
  onEnded,
  onError,
  onDuration,
}: {
  videoId: string
  /**
   * Whether YouTube is what the room is currently playing.
   *
   * The player stays mounted even when it is not — unmounting it means
   * `destroy()`, and destroying it during its own ENDED event is what crashed
   * the SDK when a queue ran out. Inactive, it simply pauses and stops
   * publishing its handle, so the sync engine ignores it.
   */
  active: boolean
  startAt: number
  volume: number
  onHandle: (handle: AudioHandle | null) => void
  onEnded: () => void
  onError: (message: string) => void
  onDuration: (seconds: number) => void
}) {
  const mount = useRef<HTMLDivElement>(null)
  /** The node handed to the API — ours to create and remove, never React's. */
  const hostNode = useRef<HTMLDivElement | null>(null)
  const player = useRef<YTPlayer | null>(null)
  const buffering = useRef(false)
  const [ready, setReady] = useState(false)

  const videoRef = useRef(videoId)
  videoRef.current = videoId
  const activeRef = useRef(active)
  activeRef.current = active
  /** The video the player is actually pointed at, to spot real changes. */
  const loadedVideo = useRef<string | null>(null)
  const startRef = useRef(startAt)
  const endedRef = useRef(onEnded)
  const errorRef = useRef(onError)
  const handleRef = useRef(onHandle)
  const durationRef = useRef(onDuration)
  startRef.current = startAt
  endedRef.current = onEnded
  errorRef.current = onError
  handleRef.current = onHandle
  durationRef.current = onDuration

  /*
   * Built once, then re-pointed.
   *
   * Creating a player per video meant every track change was a `destroy()`
   * immediately followed by a `new Player()`, and catching the SDK between
   * those two is what threw from inside its own minified code. `loadVideoById`
   * is the API's own answer to "play something else" and keeps one player
   * alive for the life of the page.
   */
  useEffect(() => {
    let disposed = false

    void loadYouTubeApi()
      .then((YT) => {
        if (disposed || !mount.current) return

        /*
         * A fresh node for the API to consume, every time.
         *
         * `YT.Player` does not render *into* the element it is given — it
         * replaces it with an iframe. Handing it a React-owned ref means React
         * and the API both believe they own that node, and on the second mount
         * (StrictMode does one immediately) the API is handed a node it
         * already replaced. Its internals then dereference a player it has
         * torn down — the `this.g.src` throw — from inside a cross-origin
         * script where no stack survives.
         *
         * Creating and removing this child ourselves keeps the two apart:
         * React only ever owns the container, the API only ever owns the
         * child, and neither reaches into the other's node.
         */
        const host = document.createElement('div')
        host.style.width = '100%'
        host.style.height = '100%'
        mount.current.append(host)
        hostNode.current = host

        /*
         * Wrapped, because everything past this point is somebody else's
         * script running in our call stack. A throw from inside the iframe
         * API is not catchable anywhere else, is reported as a bare "Script
         * error." with no stack because it is cross-origin, and — without
         * this — unmounts the entire React tree to a blank page.
         */
        try {
          loadedVideo.current = videoRef.current
          player.current = new YT.Player(host, {
            videoId: videoRef.current,
            playerVars: {
              controls: 0,
              disablekb: 1,
              modestbranding: 1,
              rel: 0,
              playsinline: 1,
              iv_load_policy: 3,
              origin: window.location.origin,
            },
            /*
             * Each guarded, because these run *inside* the SDK's own call
             * stack. Anything that throws here — a stale ref, a setState on
             * an unmounting tree — unwinds through minified third-party code
             * that has no idea what to do with it, and surfaces as an
             * unattributable error far from its cause.
             */
            events: {
              onReady: ({ target }) => {
                if (disposed) return
                try {
                  if (startRef.current > 1) target.seekTo(startRef.current, true)
                  const duration = target.getDuration()
                  if (duration > 0) durationRef.current(duration)
                  setReady(true)
                } catch {
                  /* The player went away between the event and this handler. */
                }
              },
              onStateChange: ({ data }) => {
                if (disposed) return
                try {
                  buffering.current = data === YT.PlayerState.BUFFERING
                  /* Only when this player is the room's — a paused, inactive
                     player reaching its end must not advance the queue. */
                  if (data === YT.PlayerState.ENDED && activeRef.current) endedRef.current()
                } catch {
                  /* As above. */
                }
              },
              onError: ({ data }) => {
                if (disposed) return
                try {
                  errorRef.current(youtubeError(data))
                } catch {
                  /* As above. */
                }
              },
            },
          })
        } catch {
          if (!disposed) errorRef.current('The YouTube player could not start for that track.')
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          errorRef.current(
            cause instanceof Error ? cause.message : 'Could not load the YouTube player',
          )
        }
      })

    return () => {
      disposed = true
      setReady(false)
      handleRef.current(null)
      try {
        player.current?.destroy()
      } catch {
        /* Destroying a player whose iframe is already gone throws; the node is
           gone either way, which is all we wanted. */
      }
      player.current = null
      /* Remove whatever the API left behind — by now the child is an iframe,
         not the div we appended. */
      hostNode.current?.remove()
      hostNode.current = null
    }
    /* Deliberately empty: the player outlives any one video. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || !player.current) return
    /* YouTube takes 0–100, everything else here is 0–1. */
    player.current.setVolume(Math.round(Math.min(1, Math.max(0, volume)) * 100))
  }, [volume, ready])

  /* A different song on the same player, rather than a different player. */
  useEffect(() => {
    if (!ready || !player.current || !active) return
    if (loadedVideo.current === videoId) return

    loadedVideo.current = videoId
    try {
      player.current.loadVideoById({
        videoId,
        startSeconds: startRef.current > 1 ? startRef.current : undefined,
      })
    } catch {
      errorRef.current('Could not switch to that track.')
    }
  }, [videoId, ready, active])

  useEffect(() => {
    if (!ready || !player.current) return
    if (!active) {
      /* Not ours to drive any more — stop making noise and stand down. */
      try {
        player.current.pauseVideo()
      } catch {
        /* Already gone. */
      }
      return
    }

    const instance = player.current
    const handle: AudioHandle = {
      play: () => instance.playVideo(),
      pause: () => instance.pauseVideo(),
      seek: (seconds) => instance.seekTo(Math.max(0, seconds), true),
      /* Nothing to do. YouTube honours only its own list — 0.25, 0.5, 0.75,
         1, 1.25 and up — so there is no such thing as a 2% nudge here, and
         snapping to the nearest allowed rate would be a tempo change nobody
         asked for. `supportsFineRate: false` routes this source to seeking. */
      setRate: () => undefined,
      getPosition: () => instance.getCurrentTime() || 0,
      getDuration: () => instance.getDuration() || 0,
      isBuffering: () => buffering.current,
      isPaused: () => instance.getPlayerState?.() === 2,
      supportsFineRate: false,
      setVolume: (level) => instance.setVolume(Math.round(level * 100)),
      /* See the note at the top — there is nothing here to tap. */
      getAnalyserSource: () => null,
    }

    onHandle(handle)
    return () => onHandle(null)
  }, [ready, onHandle, active])

  return (
    <div
      aria-hidden
      /*
       * Off-screen at a real size, rather than collapsed to a pixel.
       *
       * The player has to stay in the layout — `display: none` and
       * `visibility: hidden` suspend playback in some browsers — but it also
       * has to have somewhere to build: given a 1px box, the iframe API is
       * being asked to lay out a video player inside nothing, and it throws
       * from inside its own cross-origin script where no stack survives.
       *
       * 320×180 is a normal small embed. Nobody sees it; it simply exists.
       */
      className="pointer-events-none fixed -left-[9999px] top-0 h-[180px] w-[320px] overflow-hidden opacity-0"
    >
      <div ref={mount} className="size-full" />
    </div>
  )
}
