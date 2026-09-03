import { useCallback, useEffect, useRef, useState } from 'react'

import { getSocket } from '@/lib/socket'

/**
 * The hub's quick voice, relayed through the app's own server instead of
 * peer-to-peer.
 *
 * A WebRTC mesh call needs the two browsers to actually reach each other,
 * which across different networks means a TURN relay — a paid, metered
 * resource meant for the deliberate "Chat & call" panel, not an ambient
 * always-on button. Routing raw audio through the socket every client already
 * holds open sidesteps NAT traversal completely: nothing to negotiate, no
 * relay to pay for. The trade is bandwidth (uncompressed PCM, not Opus) and
 * a server hop even between two people on the same wifi — a fair price for a
 * feature meant to be simple and free rather than maximally efficient.
 *
 * `ScriptProcessorNode`, not `AudioWorkletNode`. It is formally deprecated,
 * but it needs no separate module file to load and runs identically on every
 * browser this app targets, Safari included — for a feature this small, that
 * simplicity is worth more than the (real, but here negligible) main-thread
 * cost.
 */

/** What actually goes over the wire — kept small on purpose. */
const SEND_SAMPLE_RATE = 16000
/** Samples per captured frame at the browser's native rate, before decimation. */
const BUFFER_SIZE = 4096

export type VoiceState = 'off' | 'requesting' | 'live' | 'denied' | 'unsupported'

type PeerAudio = {
  context: AudioContext
  /** Where the next scheduled chunk starts, so playback stays gapless. */
  nextStart: number
}

export function useVoiceRelay(roomId: string | null) {
  const [state, setState] = useState<VoiceState>('off')
  const [error, setError] = useState<string | null>(null)

  /** 0 → 1, read by the button's ring every animation frame — not state. */
  const level = useRef(0)

  const stream = useRef<MediaStream | null>(null)
  const captureContext = useRef<AudioContext | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const active = useRef(false)

  /** One playback pipeline per sender, so simultaneous speakers don't collide. */
  const playback = useRef(new Map<string, PeerAudio>())

  const stopCapture = useCallback(() => {
    processor.current?.disconnect()
    processor.current = null
    void captureContext.current?.close()
    captureContext.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    level.current = 0
  }, [])

  const stopPlayback = useCallback(() => {
    for (const peer of playback.current.values()) void peer.context.close()
    playback.current.clear()
  }, [])

  const leave = useCallback(() => {
    if (!active.current) return
    active.current = false
    if (roomId) getSocket().emit('voice:leave', { roomId })
    stopCapture()
    stopPlayback()
    setState('off')
  }, [roomId, stopCapture, stopPlayback])

  /*
   * Playing a peer's frame.
   *
   * Each incoming chunk is 16-bit PCM at `SEND_SAMPLE_RATE`, scheduled right
   * after whatever that same sender's last chunk ended — that ordering is
   * what turns a stream of small buffers back into continuous speech instead
   * of a series of clicks.
   */
  const playChunk = useCallback((from: string, chunk: ArrayBuffer) => {
    let peer = playback.current.get(from)
    if (!peer) {
      const context = new AudioContext()
      peer = { context, nextStart: context.currentTime }
      playback.current.set(from, peer)
    }

    const samples = new Int16Array(chunk)
    const buffer = peer.context.createBuffer(1, samples.length, SEND_SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768

    const source = peer.context.createBufferSource()
    source.buffer = buffer
    source.connect(peer.context.destination)

    /* A sender who paused and resumed would otherwise have their backlog
       scheduled to play back-to-back in a burst — catch the clock up to now
       first, so a gap in speech is silence, not a rush to catch up. */
    const startAt = Math.max(peer.nextStart, peer.context.currentTime)
    source.start(startAt)
    peer.nextStart = startAt + buffer.duration
  }, [])

  const join = useCallback(async () => {
    if (!roomId || active.current) return

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setState('unsupported')
      setError('Voice needs a browser with microphone support.')
      return
    }

    setState('requesting')
    setError(null)

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
    } catch {
      setState('denied')
      setError('Microphone is blocked. Allow it and try again.')
      return
    }

    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream.current)
    /* Deprecated, and the deliberate choice — see the file header. */
    const node = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    const socket = getSocket()
    /* Decimation factor from the device's native rate down to what actually
       gets sent — e.g. 3 at a typical 48kHz device, meaning every third
       sample survives. No anti-aliasing filter: for speech, at this ratio,
       the aliasing is inaudible and a filter would be one more thing that can
       go wrong for no perceptible gain. */
    const ratio = Math.max(1, Math.round(context.sampleRate / SEND_SAMPLE_RATE))

    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)

      /* RMS over the raw frame — what the ring reflects. */
      let sum = 0
      for (const sample of input) sum += sample * sample
      level.current = Math.min(1, Math.sqrt(sum / input.length) * 3.2)

      const outLength = Math.floor(input.length / ratio)
      const out = new Int16Array(outLength)
      for (let i = 0; i < outLength; i++) {
        const sample = Math.max(-1, Math.min(1, input[i * ratio]!))
        out[i] = sample < 0 ? sample * 32768 : sample * 32767
      }

      socket.emit('voice:chunk', { roomId, chunk: out.buffer })
    }

    source.connect(node)
    /* A `ScriptProcessorNode` only fires while it's part of a live graph —
       silently routed to a muted gain rather than to the speakers, so it
       keeps running without anyone hearing their own voice echoed back. */
    const sink = context.createGain()
    sink.gain.value = 0
    node.connect(sink)
    sink.connect(context.destination)

    captureContext.current = context
    processor.current = node
    active.current = true
    setState('live')

    socket.emit('voice:join', { roomId })
  }, [roomId])

  const toggle = useCallback(() => {
    if (state === 'live') leave()
    else if (state !== 'requesting') void join()
  }, [state, join, leave])

  /* Incoming audio, wired for the lifetime of the room — independent of
     whether *this* client has joined, so a chunk arriving right after join
     is never dropped for having no listener yet. */
  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()

    const onChunk = ({
      roomId: id,
      from,
      chunk,
    }: {
      roomId: string
      from: string
      chunk: ArrayBuffer
    }) => {
      if (id === roomId && active.current) playChunk(from, chunk)
    }

    socket.on('voice:chunk', onChunk)
    return () => {
      socket.off('voice:chunk', onChunk)
    }
  }, [roomId, playChunk])

  /* Leaving the room, or the room changing under you, ends the call rather
     than leaving a mic hot with nowhere for the audio to go. */
  useEffect(() => {
    return () => {
      if (active.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  return { state, error, level, toggle }
}
