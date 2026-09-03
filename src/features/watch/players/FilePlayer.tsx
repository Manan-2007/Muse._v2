import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

import type { AudioTrackInfo, PlayerHandle, SubtitleTrack } from '@/features/watch/types'

/**
 * A direct media URL in a plain `<video>`.
 *
 * The best-behaved of the three sources: arbitrary playback rates mean drift is
 * absorbed by running imperceptibly fast or slow instead of seeking, so a
 * client that falls behind catches up without anyone seeing a jump.
 *
 * Handles both shapes a file can arrive in. A plain MP4 the element plays by
 * itself. An HLS playlist it cannot, except on Safari — everywhere else the
 * manifest has to be parsed in JavaScript and the segments fed in, which is
 * what `hls.js` is for. Both end up driving the same `<video>`, so everything
 * downstream — the sync engine, the drift loop, the handle below — is unaware
 * of which one it got.
 */

const isHls = (src: string) => /\.m3u8(\?|$)/i.test(src)

/*
 * `HTMLMediaElement.audioTracks` — Safari's own multi-audio API for native
 * HLS. It never made it into a finished standard, so TypeScript's DOM types
 * do not carry it even though the browser genuinely implements it. This is
 * the minimal shape used below, not a claim that it's standard.
 */
type NativeAudioTrack = { id: string; label: string; language: string; enabled: boolean }
type NativeAudioTrackList = EventTarget & { length: number; [index: number]: NativeAudioTrack }
type WithNativeAudioTracks = HTMLVideoElement & { audioTracks?: NativeAudioTrackList }

export function FilePlayer({
  src,
  startAt,
  subtitles,
  onHandle,
  onEnded,
  onError,
  onAudioTracksChanged,
  onIntentChanged,
}: {
  src: string
  startAt: number
  /** Published WebVTT tracks. Rendered as `<track>` children below. */
  subtitles?: SubtitleTrack[]
  onHandle: (handle: PlayerHandle | null) => void
  onEnded: () => void
  onError: (message: string) => void
  /**
   * Fired whenever the alternate-audio list might have changed — a new video
   * loaded, or the source finished discovering its tracks after playback
   * already started. The handle's `getAudioTracks` is the source of truth;
   * this is only the doorbell telling the caller to go read it again.
   */
  onAudioTracksChanged?: () => void
  /**
   * The player was played or paused by something that is not us.
   *
   * On a phone, fullscreen hands the video to the operating system's own
   * player, and its pause button talks straight to the element — as do the
   * lock screen, the headphone button, and CarPlay. None of that goes through
   * this app's controls, so without this the room never hears about it: it
   * goes on believing the film is running, its clock keeps advancing, and the
   * drift correction starts seeking a stopped video to catch it up. Each seek
   * paints one new frame, which is what a paused film creeping forward every
   * few seconds actually is.
   */
  onIntentChanged?: (playing: boolean) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const buffering = useRef(false)
  const [ready, setReady] = useState(false)

  /* The hls.js instance backing the current source, or null off of it — the
     handle reads audio tracks through this rather than through closure state,
     since hls.js's own arrays are already the source of truth. */
  const hlsRef = useRef<Hls | null>(null)

  const startRef = useRef(startAt)
  startRef.current = startAt

  /* Callbacks land in an effect that must not re-run when the parent
     re-renders — attaching HLS twice tears down playback mid-frame. */
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  /* Through a ref so the element's handlers never need re-binding. */
  const onIntentRef = useRef(onIntentChanged)
  onIntentRef.current = onIntentChanged
  const onTracksRef = useRef(onAudioTracksChanged)
  onTracksRef.current = onAudioTracksChanged

  useEffect(() => {
    setReady(false)
  }, [src])

  /*
   * Attach the media source.
   *
   * Safari plays HLS natively and must be left to do it: running hls.js on top
   * of a player that already understands the format costs a JavaScript
   * transmux for no benefit, and on iOS fullscreen only works properly for the
   * native path.
   */
  useEffect(() => {
    const element = video.current
    if (!element) return

    if (!isHls(src)) {
      element.src = src
      return () => {
        element.removeAttribute('src')
        element.load()
      }
    }

    if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = src

      /* Safari discovers alternate audio asynchronously, same as hls.js does
         — the list is empty for a moment after `src` is set. */
      const nativeElement = element as WithNativeAudioTracks
      const onChange = () => onTracksRef.current?.()
      nativeElement.audioTracks?.addEventListener('addtrack', onChange)
      nativeElement.audioTracks?.addEventListener('change', onChange)

      return () => {
        nativeElement.audioTracks?.removeEventListener('addtrack', onChange)
        nativeElement.audioTracks?.removeEventListener('change', onChange)
        element.removeAttribute('src')
        element.load()
      }
    }

    if (!Hls.isSupported()) {
      onErrorRef.current("This browser can't play HLS video.")
      return
    }

    const hls = new Hls({
      /*
       * Buffer as far ahead as the browser will allow, and start before play.
       *
       * The defaults are tuned for live streams that must not run ahead of the
       * broadcast. This is a fixed file on object storage, and the room is
       * frequently paused mid-film — every second spent paused is a second
       * that could have been spent fetching, and on a slow line that is the
       * difference between watching and stalling.
       *
       * `startFragPrefetch` is the one that matters most: it defaults to
       * false, which means nothing at all is fetched until somebody presses
       * play. The first press then pays for the whole startup.
       *
       * How far ahead it actually reaches is
       *   min(max(8 · maxBufferSize / bitrate, maxBufferLength), maxMaxBufferLength)
       * so `maxBufferSize` is the real lever and the seconds are its bounds.
       * 400MB is deliberately past what any browser will grant: MSE enforces
       * its own quota (Chrome allows on the order of 150MB of video) and
       * hls.js backs off when it is refused, so this reads as "take whatever
       * you can get" rather than as a literal allocation.
       */
      startFragPrefetch: true,
      maxBufferLength: 60,
      maxBufferSize: 400 * 1000 * 1000,
      maxMaxBufferLength: 1800,
      /* Behind the playhead, though, a long buffer only costs memory — the
         room decides where playback is, and nobody scrubs backwards far. */
      backBufferLength: 30,
      enableWorker: true,
    })
    hlsRef.current = hls

    hls.on(Hls.Events.ERROR, (_event, data) => {
      /* Most errors are recoverable and hls.js expects to be told to try:
         a dropped segment or a stalled network is normal on a long film and
         should not end playback. Only a genuinely fatal one surfaces. */
      if (!data.fatal) return

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad()
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        return
      }

      onErrorRef.current("That video couldn't be played — the stream may still be publishing.")
      hls.destroy()
    })

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => onTracksRef.current?.())
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => onTracksRef.current?.())

    hls.loadSource(src)
    hls.attachMedia(element)

    return () => {
      hlsRef.current = null
      hls.destroy()
    }
  }, [src])

  useEffect(() => {
    if (!ready || !video.current) return

    const element = video.current
    const nativeElement = element as WithNativeAudioTracks

    /* Distinguishing the two audio APIs is the one thing every method here
       has to do: hls.js is authoritative whenever it's attached, and the
       browser's own `audioTracks` only applies to native Safari HLS (or is
       simply absent on a browser that never implements it). */
    const getAudioTracks = (): AudioTrackInfo[] => {
      if (hlsRef.current) {
        return hlsRef.current.audioTracks.map((track, index) => ({
          id: index,
          language: track.lang || 'und',
          label: track.name || track.lang || `Track ${index + 1}`,
        }))
      }
      const list = nativeElement.audioTracks
      if (!list) return []
      return Array.from({ length: list.length }, (_, index) => {
        const track = list[index]!
        return {
          id: index,
          language: track.language || 'und',
          label: track.label || track.language || `Track ${index + 1}`,
        }
      })
    }

    const getAudioTrack = (): number => {
      if (hlsRef.current) return hlsRef.current.audioTrack
      const list = nativeElement.audioTracks
      if (!list) return 0
      for (let index = 0; index < list.length; index += 1) {
        if (list[index]!.enabled) return index
      }
      return 0
    }

    const setAudioTrack = (id: number) => {
      if (hlsRef.current) {
        hlsRef.current.audioTrack = id
        return
      }
      const list = nativeElement.audioTracks
      if (!list) return
      /* The spec says setting one `enabled` track in an exclusive group turns
         the others off automatically, but that behaviour is inconsistent
         enough across engines that it isn't worth trusting — set it
         explicitly rather than debug a "two tracks at once" report later. */
      for (let index = 0; index < list.length; index += 1) {
        list[index]!.enabled = index === id
      }
    }

    /*
     * Subtitle visibility runs through `textTracks`, not the `<track>` DOM
     * nodes. React owns those elements, so setting `.mode` on the live
     * TextTrack list is the only way to change what's showing without
     * fighting the renderer over attributes.
     */
    const getSubtitleTrack = () => {
      const tracks = element.textTracks
      for (let index = 0; index < tracks.length; index += 1) {
        if (tracks[index]!.mode === 'showing') return index
      }
      return -1
    }

    const setSubtitleTrack = (index: number) => {
      const tracks = element.textTracks
      for (let position = 0; position < tracks.length; position += 1) {
        /* `hidden` rather than `disabled` for the ones being turned off: it
           keeps the cues parsed, so switching languages back is instant
           instead of re-fetching the file. */
        tracks[position]!.mode = position === index ? 'showing' : 'hidden'
      }
    }

    const handle: PlayerHandle = {
      play: () => void element.play().catch(() => undefined),
      pause: () => element.pause(),
      seek: (seconds) => {
        element.currentTime = Math.max(0, seconds)
      },
      setRate: (rate) => {
        element.playbackRate = rate
      },
      getPosition: () => element.currentTime || 0,
      getDuration: () => (Number.isFinite(element.duration) ? element.duration : 0),
      isBuffering: () => buffering.current,
      isPaused: () => element.paused,
      supportsFineRate: true,
      getAudioTracks,
      getAudioTrack,
      setAudioTrack,
      getSubtitleTrack,
      setSubtitleTrack,
      getVideoElement: () => video.current,
    }

    onHandle(handle)
    return () => onHandle(null)
  }, [ready, onHandle])

  /* Stop playback hard on unmount — removing the element from the DOM is not
     enough; the browser can keep the media session (and its audio) alive on a
     detached node until GC collects it. */
  useEffect(() => {
    const el = video.current
    return () => {
      if (!el) return
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }, [])

  return (
    <video
      ref={video}
      className="absolute inset-0 size-full bg-black object-contain"
      playsInline
      /* Ours are the only controls — see the note in YouTubePlayer. */
      controls={false}
      preload="auto"
      onLoadedMetadata={() => {
        if (video.current && startRef.current > 1) video.current.currentTime = startRef.current
        setReady(true)
      }}
      /*
       * Reported for any pause, ours included — the room is keyed on intent
       * and re-broadcasting a pause it already knows about is a no-op, where
       * missing one is the bug above.
       */
      onPause={() => onIntentRef.current?.(false)}
      onPlay={() => onIntentRef.current?.(true)}
      onWaiting={() => {
        buffering.current = true
      }}
      onPlaying={() => {
        buffering.current = false
      }}
      onEnded={onEnded}
      onError={() => {
        /* With HLS the element's own error is a symptom — hls.js reports the
           real cause through its ERROR event, and reporting both would race
           two different messages onto the screen. */
        if (isHls(src) && !video.current?.canPlayType('application/vnd.apple.mpegurl')) return
        onErrorRef.current(
          "That file couldn't be played. It needs to be a direct video URL the browser can fetch — and the host has to allow it.",
        )
      }}
    >
      {/* Off until asked for. `default` would burn one in as showing, and a
          film that starts with subtitles nobody chose is worse than one that
          starts without. */}
      {subtitles?.map((track) => (
        <track
          key={track.url}
          kind="subtitles"
          src={track.url}
          srcLang={track.language}
          label={track.label}
        />
      ))}
    </video>
  )
}
