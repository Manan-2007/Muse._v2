import { useEffect, useRef, useState } from 'react'

import {
  loadYouTubeApi,
  youtubeError,
  type YTPlayer,
} from '@/features/watch/players/youtubeApi'
import type { PlayerHandle } from '@/features/watch/types'

/**
 * YouTube, driven by us rather than by its own chrome.
 *
 * Native controls are off: two sets of controls that disagree about who is in
 * charge is exactly how a synced player ends up fighting itself. Everything the
 * viewer can press goes through the room.
 */
export function YouTubePlayer({
  videoId,
  active,
  startAt,
  onHandle,
  onEnded,
  onError,
}: {
  videoId: string
  /**
   * Whether YouTube is what the room is currently showing.
   *
   * The player stays mounted even when it is not — unmounting it means
   * `destroy()`, and destroying it while it is mid-event (its own ENDED, or
   * a queue advance racing a video switch) is what crashed the SDK. Inactive,
   * it simply pauses and stops publishing its handle.
   */
  active: boolean
  /** Where to begin — a late joiner starts mid-video, not at zero. */
  startAt: number
  onHandle: (handle: PlayerHandle | null) => void
  onEnded: () => void
  onError: (message: string) => void
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
  startRef.current = startAt
  endedRef.current = onEnded
  errorRef.current = onError
  handleRef.current = onHandle

  /*
   * Built once, then re-pointed.
   *
   * Creating a player per video meant every video change was a `destroy()`
   * immediately followed by a `new Player()`, and catching the SDK between
   * those two is what threw from inside its own minified code. `loadVideoById`
   * is the API's own answer to "play something else" and keeps one player
   * alive for the life of the room.
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
         * and the API both believe they own that node, and on a second mount
         * the API is handed a node it already replaced, then dereferences a
         * player it has torn down — the `this.g.src` throw — from inside a
         * cross-origin script where no stack survives.
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
              /* Origin is required for the API to talk to the iframe reliably. */
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

                  /*
                   * An inactive player that reports itself playing is put back
                   * down, every time it says so.
                   *
                   * Switching to a server video pauses this one exactly once,
                   * on the transition. But a pause that lands while the SDK is
                   * still buffering is dropped — YouTube finishes the load it
                   * already had in flight and starts playing anyway, and since
                   * `active` does not change again, nothing ever pauses it a
                   * second time. The result is a hidden iframe playing audio
                   * underneath the video that replaced it, for the rest of the
                   * session. It needs a slow connection to happen, which is
                   * why it survived: on a fast one the buffer is over before
                   * anyone can pick the next thing.
                   *
                   * Muting as well as pausing is the belt to that braces —
                   * mute takes effect immediately and is not refused mid-load,
                   * so even a pause that loses the race is silent.
                   */
                  if (
                    !activeRef.current &&
                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.BUFFERING)
                  ) {
                    player.current?.mute()
                    player.current?.pauseVideo()
                  }
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
          if (!disposed) errorRef.current('The YouTube player could not start for that video.')
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

  /* A different video on the same player, rather than a different player. */
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
      errorRef.current('Could not switch to that video.')
    }
  }, [videoId, ready, active])

  /* Published only once the player is genuinely ready and it is the room's
     current source — a handle whose methods reach a paused, backgrounded
     player would have the sync engine driving nothing. */
  useEffect(() => {
    if (!ready || !player.current) return
    if (!active) {
      try {
        /* Muted before it is paused, and deliberately in that order: mute
           takes effect on a player that is still loading, where pause does
           not. See the note in `onStateChange`. */
        player.current.mute()
        player.current.pauseVideo()
      } catch {
        /* Already gone. */
      }
      return
    }

    const instance = player.current
    /* Back on screen, so undo the mute the inactive branch applied. Safe to
       do unconditionally: nothing in the room's controls can mute YouTube —
       the handle below exposes no volume — so the only mute it can ever be
       clearing is that one. */
    try {
      instance.unMute()
    } catch {
      /* Already gone. */
    }
    const handle: PlayerHandle = {
      play: () => instance.playVideo(),
      pause: () => instance.pauseVideo(),
      seek: (seconds) => instance.seekTo(Math.max(0, seconds), true),
      setRate: (rate) => instance.setPlaybackRate(rate),
      getPosition: () => instance.getCurrentTime() || 0,
      getDuration: () => instance.getDuration() || 0,
      isBuffering: () => buffering.current,
      /* 2 is PAUSED in the iframe API's state enum. Read live rather than
         tracked, so a pause from YouTube's own controls counts too. */
      isPaused: () => instance.getPlayerState?.() === 2,
      /* YouTube only accepts its own rate list, so drift is corrected by
         seeking rather than by nudging the speed. */
      supportsFineRate: false,
      /* The iframe API has no alternate-audio concept to expose, and YouTube
         draws its own captions inside the iframe where we can't reach them. */
      getAudioTracks: () => [],
      getAudioTrack: () => 0,
      setAudioTrack: () => undefined,
      getSubtitleTrack: () => -1,
      setSubtitleTrack: () => undefined,
    }

    onHandle(handle)
    return () => onHandle(null)
  }, [ready, onHandle, active])

  return (
    <div
      /* Stays mounted while inactive (see the note on `active` above) but
         must not sit visibly over whatever *is* the current source. */
      className={active ? 'absolute inset-0' : 'absolute inset-0 hidden'}
    >
      <div ref={mount} className="size-full [&>iframe]:size-full" />
    </div>
  )
}
