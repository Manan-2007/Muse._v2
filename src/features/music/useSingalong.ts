import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'

/**
 * Singing along, and capturing it.
 *
 * A peer-to-peer mesh: every singer connects directly to every other singer,
 * with the server only carrying the handshake. That is what keeps voices as
 * close to live as the network allows — but "as close as the network allows"
 * is still roughly a tenth of a second on a good connection and more on a bad
 * one. There is no arrangement of this code that reaches zero, and anything
 * claiming otherwise is measuring something else.
 *
 * The mesh costs a connection per pair, so it is right for a room of friends
 * and wrong for a hall. Past a handful of singers the fan-out is what breaks
 * first, not the audio.
 *
 * Recording is deliberately local. With no server in the media path there is
 * no vantage point that hears the whole room, so what each person can capture
 * is what reaches *them*: their own microphone, everyone else's voice, and the
 * music, mixed in the browser. Every recording is one seat in the room.
 */

type IceConfig = { iceServers: RTCIceServer[] }

type Peer = {
  connection: RTCPeerConnection
  stream: MediaStream | null
}

export type SingalongState = {
  singing: boolean
  recording: boolean
  /** Set when the microphone or the recorder could not be started. */
  error: string | null
  /** How many other microphones are currently connected. */
  peerCount: number
}

export function useSingalong({
  roomId,
  enabled,
  /** The audio graph node carrying the music, so it lands in the recording. */
  musicSource,
}: {
  roomId: string | null
  /** False while the page is closed — everything is torn down. */
  enabled: boolean
  musicSource: MediaElementAudioSourceNode | null
}) {
  const [state, setState] = useState<SingalongState>({
    singing: false,
    recording: false,
    error: null,
    peerCount: 0,
  })

  const microphone = useRef<MediaStream | null>(null)
  const peers = useRef(new Map<string, Peer>())
  const ice = useRef<RTCIceServer[]>([])

  /* The graph the recorder listens to. Built once and reused, because a
     recording started mid-song must not rebuild the routing underneath it. */
  const context = useRef<AudioContext | null>(null)
  const mixer = useRef<MediaStreamAudioDestinationNode | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const singingRef = useRef(false)
  /** Peers we currently have an offer out to — see the collision note below. */
  const makingOffer = useRef(new Set<string>())

  const announce = useCallback(
    (event: string, payload: Record<string, unknown>) => {
      if (!roomId) return
      getSocket().emit(event, { roomId, ...payload })
    },
    [roomId],
  )

  /** The mixing bus every recorded source feeds into. */
  const ensureMixer = useCallback(() => {
    if (!context.current) context.current = new AudioContext()
    if (!mixer.current) mixer.current = context.current.createMediaStreamDestination()
    return { context: context.current, mixer: mixer.current }
  }, [])

  /* The music is one input to the mix. Tapped, never rerouted — the same rule
     as the visualiser, so a recording can never silence playback. */
  useEffect(() => {
    if (!musicSource || !state.recording) return
    const { mixer: destination } = ensureMixer()
    try {
      musicSource.connect(destination)
    } catch {
      /* Already connected, or a context that has gone away. */
    }
    return () => {
      try {
        musicSource.disconnect(destination)
      } catch {
        /* Torn down with its context. */
      }
    }
  }, [musicSource, state.recording, ensureMixer])

  const addToMix = useCallback(
    (stream: MediaStream) => {
      const { context: ctx, mixer: destination } = ensureMixer()
      try {
        ctx.createMediaStreamSource(stream).connect(destination)
      } catch {
        /* A stream with no audio track — nothing to mix. */
      }
    },
    [ensureMixer],
  )

  const closePeer = useCallback((socketId: string) => {
    const peer = peers.current.get(socketId)
    if (!peer) return
    peer.connection.onicecandidate = null
    peer.connection.ontrack = null
    peer.connection.close()
    peers.current.delete(socketId)
    setState((current) => ({ ...current, peerCount: peers.current.size }))
  }, [])

  const createPeer = useCallback(
    (socketId: string) => {
      const existing = peers.current.get(socketId)
      if (existing) return existing.connection

      const connection = new RTCPeerConnection({ iceServers: ice.current })
      const peer: Peer = { connection, stream: null }
      peers.current.set(socketId, peer)

      for (const track of microphone.current?.getTracks() ?? []) {
        connection.addTrack(track, microphone.current!)
      }

      connection.onicecandidate = (event) => {
        if (event.candidate) {
          announce('music:candidate', { to: socketId, candidate: event.candidate.toJSON() })
        }
      }

      connection.ontrack = (event) => {
        const [stream] = event.streams
        if (!stream) return
        peer.stream = stream

        /*
         * Played through a detached element rather than the audio graph.
         * Chrome will not deliver a remote track's audio unless it is attached
         * to a media element somewhere — routing it only into Web Audio yields
         * silence, which is a long-standing quirk rather than a bug here.
         */
        const element = new Audio()
        element.srcObject = stream
        element.autoplay = true
        void element.play().catch(() => undefined)

        addToMix(stream)
        setState((current) => ({ ...current, peerCount: peers.current.size }))
      }

      return connection
    },
    [announce, addToMix],
  )

  /* Signalling. Mounted whenever the page is open, not only while singing —
     an offer can arrive from someone who started before this client did. */
  useEffect(() => {
    if (!roomId || !enabled) return

    const socket = getSocket()

    const onJoined = async ({ socketId }: { socketId: string }) => {
      if (!singingRef.current) return
      const peer = peers.current.get(socketId) ?? { connection: createPeer(socketId), stream: null }
      const connection = peer.connection ?? createPeer(socketId)

      /* Flagged for the duration, so an offer arriving from the other side
         mid-negotiation can be recognised as a collision rather than treated
         as an ordinary request. */
      makingOffer.current.add(socketId)
      try {
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        announce('music:offer', { to: socketId, sdp: offer })
      } catch {
        /* The connection went away mid-negotiation. */
      } finally {
        makingOffer.current.delete(socketId)
      }
    }

    /*
     * Perfect negotiation, for the case where both sides offer at once.
     *
     * Two people enabling their microphone in the same moment each see the
     * other's arrival and each send an offer. Both connections are then in
     * `have-local-offer`, and applying the incoming one throws — a pair that
     * never connects, for no reason either person can see.
     *
     * The standard resolution: one side is designated polite and gives way.
     * Socket ids are the tie-break because both ends already agree on them,
     * so each independently reaches the same conclusion with nothing to
     * negotiate about who negotiates.
     */
    const onOffer = async ({
      from,
      sdp,
    }: {
      from: string
      sdp: RTCSessionDescriptionInit
    }) => {
      const connection = createPeer(from)
      const polite = (socket.id ?? '') > from

      const collision =
        makingOffer.current.has(from) || connection.signalingState !== 'stable'

      /* The impolite side ignores the collision and expects the other to
         yield; two peers both yielding would drop the connection entirely. */
      if (collision && !polite) return

      try {
        if (collision) {
          /* Withdraw our own offer, then take theirs. */
          await connection.setLocalDescription({ type: 'rollback' })
        }
        await connection.setRemoteDescription(new RTCSessionDescription(sdp))
        const answer = await connection.createAnswer()
        await connection.setLocalDescription(answer)
        announce('music:answer', { to: from, sdp: answer })
      } catch {
        /* A connection torn down between the offer and this handler. */
      }
    }

    const onAnswer = async ({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const peer = peers.current.get(from)
      if (!peer) return
      try {
        /* An answer only applies to an outstanding offer. After a rollback
           there may be none, and applying it would throw. */
        if (peer.connection.signalingState !== 'have-local-offer') return
        await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp))
      } catch {
        /* As above. */
      }
    }

    const onCandidate = async ({
      from,
      candidate,
    }: {
      from: string
      candidate: RTCIceCandidateInit
    }) => {
      const peer = peers.current.get(from)
      if (!peer) return
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {
        /* A candidate that arrived before the description it belongs to. */
      }
    }

    const onLeft = ({ socketId }: { socketId: string }) => closePeer(socketId)

    socket.on('music:singalong-joined', (raw) => void onJoined(raw))
    socket.on('music:offer', (raw) => void onOffer(raw))
    socket.on('music:answer', (raw) => void onAnswer(raw))
    socket.on('music:candidate', (raw) => void onCandidate(raw))
    socket.on('music:singalong-left', onLeft)

    return () => {
      socket.off('music:singalong-joined')
      socket.off('music:offer')
      socket.off('music:answer')
      socket.off('music:candidate')
      socket.off('music:singalong-left', onLeft)
    }
  }, [roomId, enabled, createPeer, closePeer, announce])

  const stopSinging = useCallback(() => {
    singingRef.current = false
    for (const socketId of [...peers.current.keys()]) closePeer(socketId)
    for (const track of microphone.current?.getTracks() ?? []) track.stop()
    microphone.current = null
    announce('music:singalong', { singing: false })
    setState((current) => ({ ...current, singing: false, peerCount: 0 }))
  }, [announce, closePeer])

  const startSinging = useCallback(async () => {
    try {
      if (ice.current.length === 0) {
        const config = await api.get<IceConfig>('/ice').catch(() => null)
        ice.current = config?.iceServers ?? []
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          /* Echo cancellation is essential here — without it every singer's
             speakers feed straight back into their own microphone and the mesh
             turns into howl. The other two keep a laptop mic usable. */
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      microphone.current = stream
      singingRef.current = true
      addToMix(stream)
      announce('music:singalong', { singing: true })
      setState((current) => ({ ...current, singing: true, error: null }))
    } catch (cause) {
      setState((current) => ({
        ...current,
        singing: false,
        error:
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Microphone access was blocked — allow it in your browser to sing along.'
            : 'Could not start your microphone.',
      }))
    }
  }, [addToMix, announce])

  const toggleSinging = useCallback(() => {
    if (singingRef.current) stopSinging()
    else void startSinging()
  }, [startSinging, stopSinging])

  const stopRecording = useCallback(() => {
    recorder.current?.stop()
    recorder.current = null
    announce('music:recording', { recording: false })
    setState((current) => ({ ...current, recording: false }))
  }, [announce])

  const startRecording = useCallback(() => {
    try {
      const { mixer: destination } = ensureMixer()

      /* Opus in WebM is the one combination every browser that supports
         MediaRecorder can write; the rest is left to the implementation. */
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined

      const instance = new MediaRecorder(destination.stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []

      instance.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data)
      }

      instance.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime ?? 'audio/webm' })
        chunks.current = []

        /* Handed straight to the browser's download. Nothing is uploaded —
           this is the singer's own copy of their own room. */
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `singalong-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }

      instance.start()
      recorder.current = instance
      announce('music:recording', { recording: true })
      setState((current) => ({ ...current, recording: true, error: null }))
    } catch {
      setState((current) => ({
        ...current,
        recording: false,
        error: "This browser can't record audio.",
      }))
    }
  }, [announce, ensureMixer])

  const toggleRecording = useCallback(() => {
    if (recorder.current) stopRecording()
    else startRecording()
  }, [startRecording, stopRecording])

  /* Leaving the page hangs up and stops the tape. */
  useEffect(() => {
    if (enabled) return
    if (recorder.current) stopRecording()
    if (singingRef.current) stopSinging()
  }, [enabled, stopRecording, stopSinging])

  useEffect(
    () => () => {
      recorder.current?.stop()
      for (const peer of peers.current.values()) peer.connection.close()
      peers.current.clear()
      for (const track of microphone.current?.getTracks() ?? []) track.stop()
      void context.current?.close().catch(() => undefined)
    },
    [],
  )

  return { ...state, toggleSinging, toggleRecording }
}
