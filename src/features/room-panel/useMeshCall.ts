import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'

/**
 * A full-mesh WebRTC call.
 *
 * Every participant holds a peer connection to every other one, and media goes
 * browser to browser — the server only introduces people and relays SDP/ICE.
 * That keeps the infrastructure at zero, at the cost of scaling: n participants
 * means n−1 uploads each, which is fine for the handful of people a room is for
 * and would not be for forty.
 *
 * Negotiation follows the "perfect negotiation" pattern. Both sides add their
 * tracks as soon as they know about each other, so both try to offer at once;
 * rather than trying to elect an initiator, one side is designated polite and
 * rolls back when it collides. Comparing socket ids gives both ends the same
 * answer without another round trip.
 */

/**
 * Fallback when the server can't be reached for its ICE config.
 *
 * STUN-only, and therefore only good for peers that can reach each other
 * directly — which in practice means the same network.
 */
const STUN_ONLY: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ],
  },
]

type IceConfig = { iceServers: RTCIceServer[]; relay: boolean }

let icePromise: Promise<IceConfig> | null = null

/**
 * ICE servers, from the server.
 *
 * Deliberately not hardcoded here. Relay credentials are billable secrets and
 * anything in this file ships to every visitor; the server holds them and
 * hands out what the browser needs. Cached for the tab, because the answer
 * doesn't change between calls.
 */
function loadIce(): Promise<IceConfig> {
  if (!icePromise) {
    icePromise = api
      .get<IceConfig>('/ice')
      .then((config) => ({
        iceServers: config.iceServers?.length ? config.iceServers : STUN_ONLY,
        relay: Boolean(config.relay),
      }))
      .catch(() => {
        /*
         * The failure is not cached, only the success.
         *
         * A transient blip — the tunnel restarting, a slow first request —
         * would otherwise fall back to STUN-only and stay there for the rest
         * of the tab's life, since the module-level cache never expires. The
         * next call to `loadIce` (the next time someone presses Start) gets a
         * fresh attempt instead of repeating a stale failure.
         */
        icePromise = null
        return { iceServers: STUN_ONLY, relay: false }
      })
  }
  return icePromise
}

export type CallPeer = {
  socketId: string
  userId: string
  name: string
  muted: boolean
  cameraOff: boolean
}

export type RemotePeer = CallPeer & {
  stream: MediaStream | null
  /** Connection lost or never established — usually a NAT needing TURN. */
  failed: boolean
}

export type CallStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'full'

type Connection = {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  /**
   * ICE candidates that arrived before the remote description did.
   *
   * `addIceCandidate` throws if there is no remote description yet, and the
   * candidate is then gone for good. Since candidates routinely overtake the
   * offer they belong to, dropping them is a reliable way to produce a call
   * that negotiates fine and then never connects.
   */
  pending: RTCIceCandidateInit[]
  /** Guards the one automatic ICE restart, so it cannot loop. */
  restarted: boolean
}

export function useMeshCall(roomId: string | null) {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peers, setPeers] = useState<Record<string, RemotePeer>>({})
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** People on the call you have not joined, for the panel's badge. */
  const [othersOnCall, setOthersOnCall] = useState(0)
  /** Somebody just started one — prompts the rest of the room to come in. */
  const [invite, setInvite] = useState<{ name: string } | null>(null)

  const connections = useRef(new Map<string, Connection>())
  const stream = useRef<MediaStream | null>(null)
  const active = useRef(false)
  const ice = useRef<RTCIceServer[]>(STUN_ONLY)
  /** False when the server has no relay — cross-network calls cannot work. */
  const [relayAvailable, setRelayAvailable] = useState(true)

  /* Fetched up front so the first peer connection already has the relay,
     rather than gathering candidates without it and failing. */
  useEffect(() => {
    let cancelled = false
    void loadIce().then((config) => {
      if (cancelled) return
      ice.current = config.iceServers
      setRelayAvailable(config.relay)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signal = useCallback(
    (to: string, data: unknown) => {
      if (!roomId) return
      getSocket().emit('call:signal', { roomId, to, data })
    },
    [roomId],
  )

  /** Build (or fetch) the connection to one peer and wire its events. */
  const connectionFor = useCallback(
    (peerId: string) => {
      const existing = connections.current.get(peerId)
      if (existing) return existing

      const socket = getSocket()
      /* Gathering a few candidates up front shaves a noticeable pause off the
         first connection, especially when a relay is involved. */
      const pc = new RTCPeerConnection({ iceServers: ice.current, iceCandidatePoolSize: 4 })
      /* Deterministic and symmetric: whoever has the smaller socket id is the
         polite one, and both ends compute the same answer independently. */
      const polite = (socket.id ?? '') < peerId

      const entry: Connection = {
        pc,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        pending: [],
        restarted: false,
      }
      connections.current.set(peerId, entry)

      const local = stream.current
      if (local) {
        for (const track of local.getTracks()) pc.addTrack(track, local)
      }

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true
          await pc.setLocalDescription()
          signal(peerId, { description: pc.localDescription })
        } catch {
          /* A negotiation that fails here is retried by the next event. */
        } finally {
          entry.makingOffer = false
        }
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) signal(peerId, { candidate })
      }

      pc.ontrack = ({ streams }) => {
        const [remote] = streams
        if (!remote) return
        /*
         * Create the entry if it isn't there yet rather than dropping the
         * stream. `ontrack` fires once; if it lands before the roster event
         * that introduces this peer, discarding it means a permanently black
         * tile for someone who is actually connected.
         */
        setPeers((current) => ({
          ...current,
          [peerId]: {
            socketId: peerId,
            userId: current[peerId]?.userId ?? '',
            name: current[peerId]?.name ?? 'Someone',
            muted: current[peerId]?.muted ?? false,
            cameraOff: current[peerId]?.cameraOff ?? false,
            stream: remote,
            failed: false,
          },
        }))
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        const dead = state === 'failed'

        setPeers((current) => {
          const peer = current[peerId]
          if (!peer) return current
          /* Recovered — clear the warning rather than leaving it stuck on. */
          return { ...current, [peerId]: { ...peer, failed: dead } }
        })

        /*
         * One automatic retry on failure.
         *
         * `failed` often means the candidates that were gathered went stale —
         * a network switched from wifi to cellular, or a relay expired. An ICE
         * restart re-gathers and re-offers, which recovers the call without
         * anyone having to hang up. Only the impolite side restarts, so the
         * two ends don't both do it and collide.
         */
        if (dead && !entry.polite && !entry.restarted) {
          entry.restarted = true
          try {
            pc.restartIce()
          } catch {
            /* Older browsers lack restartIce; the tile already says failed. */
          }
        }
      }

      return entry
    },
    [signal],
  )

  const teardownPeer = useCallback((peerId: string) => {
    const entry = connections.current.get(peerId)
    entry?.pc.close()
    connections.current.delete(peerId)
    setPeers((current) => {
      const next = { ...current }
      delete next[peerId]
      return next
    })
  }, [])

  const leave = useCallback(() => {
    active.current = false
    if (roomId) getSocket().emit('call:leave', { roomId })

    for (const [peerId] of connections.current) {
      connections.current.get(peerId)?.pc.close()
    }
    connections.current.clear()

    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null

    setPeers({})
    setLocalStream(null)
    setStatus('idle')
    setMuted(false)
    setCameraOff(false)
  }, [roomId])

  /**
   * @param audioOnly Skip the camera entirely rather than requesting it and
   *   discarding it. The hub's quick Voice button uses this — pressing "Voice"
   *   shouldn't pop a camera permission prompt for someone who only wants to
   *   talk. It is not a different call, just a different way in: audio-only
   *   and full joins land in exactly the same room call, same peers.
   */
  const join = useCallback(
    async (audioOnly = false) => {
      if (!roomId || active.current) return

      /*
       * Camera and microphone need a secure context.
       *
       * Browsers only expose `mediaDevices` on HTTPS or on localhost — so the
       * moment a second person opens the app over the LAN at
       * `http://192.168.x.x:5173`, it is simply not there. That is a browser rule
       * with no way around it in code, and reporting it as "this browser cannot
       * make calls" sends people off debugging the wrong thing entirely.
       */
      if (!window.isSecureContext) {
        setStatus('unsupported')
        setError(
          'Camera and mic are blocked on an insecure connection. Browsers only allow them on HTTPS or localhost — open the app over HTTPS (a tunnel works) to call from another machine.',
        )
        return
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        setStatus('unsupported')
        setError('This browser cannot make calls.')
        return
      }

      setStatus('requesting')
      setError(null)

      let media: MediaStream
      const AUDIO = { echoCancellation: true, noiseSuppression: true }

      if (audioOnly) {
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
          setCameraOff(true)
        } catch {
          setStatus('denied')
          setError('Microphone is blocked. Allow it and try again.')
          return
        }
      } else {
        try {
          media = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: AUDIO,
          })
        } catch {
          /* No camera, or camera in use elsewhere — audio alone is still a call. */
          try {
            media = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
            setCameraOff(true)
          } catch {
            setStatus('denied')
            setError('Camera and microphone are blocked. Allow them and try again.')
            return
          }
        }
      }

      /*
       * Awaited here, not just left to the background effect.
       *
       * `iceServers` is a constructor-only option — a peer connection built
       * before this resolves is stuck on STUN alone forever, even after the
       * real config arrives. The background effect only *primes* the cache;
       * this is what guarantees the value is actually ready before
       * `call:join` can trigger the first `connectionFor()`. The fetch runs
       * in parallel with `getUserMedia` above rather than after it, so it
       * costs nothing extra.
       */
      ice.current = (await loadIce()).iceServers

      stream.current = media
      active.current = true
      setInvite(null)
      setLocalStream(media)
      setStatus('live')
      getSocket().emit('call:join', { roomId })
    },
    [roomId],
  )

  /* Socket wiring. Kept separate from `join` so a peer arriving before we
     finished getting media is still handled. */
  useEffect(() => {
    if (!roomId) return
    const socket = getSocket()

    const addPeer = (peer: CallPeer) =>
      setPeers((current) => ({
        ...current,
        [peer.socketId]: { ...peer, stream: current[peer.socketId]?.stream ?? null, failed: false },
      }))

    const onPeers = ({ peers: list }: { peers: CallPeer[] }) => {
      for (const peer of list) {
        addPeer(peer)
        connectionFor(peer.socketId)
      }
    }

    const onPeerJoined = ({ peer }: { peer: CallPeer }) => {
      if (!active.current || peer.socketId === socket.id) return
      addPeer(peer)
      connectionFor(peer.socketId)
    }

    const onPeerLeft = ({ socketId }: { socketId: string }) => teardownPeer(socketId)

    const onRoster = ({ peers: list }: { peers: CallPeer[] }) => {
      setPeers((current) => {
        const next: Record<string, RemotePeer> = {}
        for (const peer of list) {
          if (peer.socketId === socket.id) continue
          next[peer.socketId] = {
            ...peer,
            stream: current[peer.socketId]?.stream ?? null,
            failed: current[peer.socketId]?.failed ?? false,
          }
        }
        return next
      })
    }

    const onCount = ({ count }: { count: number }) => {
      setOthersOnCall(count)
      /* Nobody left on the call means the prompt is stale — drop it rather
         than invite someone into an empty room. */
      if (count === 0) setInvite(null)
    }

    const onStarted = ({ by }: { by: { name: string } }) => {
      if (!active.current) setInvite({ name: by.name })
    }

    const onFull = () => {
      setStatus('full')
      setError('This call is full.')
      leave()
    }

    const onSignal = async ({ from, data }: { from: string; data: unknown }) => {
      if (!active.current) return
      const entry = connectionFor(from)
      const { pc } = entry
      const payload = data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }

      try {
        if (payload.description) {
          /* Glare: both sides offered at once. The impolite peer ignores the
             incoming offer and keeps its own; the polite one rolls back. */
          const collision =
            payload.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable')

          entry.ignoreOffer = !entry.polite && collision
          if (entry.ignoreOffer) return

          await pc.setRemoteDescription(payload.description)

          /* Anything that overtook the description can be applied now. */
          for (const candidate of entry.pending.splice(0)) {
            await pc.addIceCandidate(candidate).catch(() => undefined)
          }

          if (payload.description.type === 'offer') {
            await pc.setLocalDescription()
            signal(from, { description: pc.localDescription })
          }
        } else if (payload.candidate) {
          if (!pc.remoteDescription) {
            entry.pending.push(payload.candidate)
            return
          }
          await pc.addIceCandidate(payload.candidate).catch(() => undefined)
        }
      } catch {
        /* A failed exchange shows up as a failed connection state, which the
           tile already reports — nothing useful to do here. */
      }
    }

    socket.on('call:peers', onPeers)
    socket.on('call:peer-joined', onPeerJoined)
    socket.on('call:peer-left', onPeerLeft)
    socket.on('call:roster', onRoster)
    socket.on('call:count', onCount)
    socket.on('call:started', onStarted)
    socket.on('call:full', onFull)
    socket.on('call:signal', onSignal)

    return () => {
      socket.off('call:peers', onPeers)
      socket.off('call:peer-joined', onPeerJoined)
      socket.off('call:peer-left', onPeerLeft)
      socket.off('call:roster', onRoster)
      socket.off('call:count', onCount)
      socket.off('call:started', onStarted)
      socket.off('call:full', onFull)
      socket.off('call:signal', onSignal)
    }
  }, [roomId, connectionFor, teardownPeer, signal, leave])

  /* Leaving the room ends the call — a call outliving the room it belongs to
     would keep the camera light on with nothing on screen to explain it. */
  useEffect(() => {
    return () => {
      if (active.current) leave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const publishState = useCallback(
    (nextMuted: boolean, nextCameraOff: boolean) => {
      if (roomId) getSocket().emit('call:state', { roomId, muted: nextMuted, cameraOff: nextCameraOff })
    },
    [roomId],
  )

  /* Tracks are disabled rather than removed: renegotiating the connection every
     time somebody taps mute would be slow and drop audio for a beat. */
  const toggleMute = useCallback(() => {
    const next = !muted
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    setMuted(next)
    publishState(next, cameraOff)
  }, [muted, cameraOff, publishState])

  const toggleCamera = useCallback(() => {
    const next = !cameraOff
    stream.current?.getVideoTracks().forEach((track) => {
      track.enabled = !next
    })
    setCameraOff(next)
    publishState(muted, next)
  }, [muted, cameraOff, publishState])

  const hasCamera = (localStream?.getVideoTracks().length ?? 0) > 0

  /*
   * Your own level, read off the stream actually being sent.
   *
   * This used to be a second, separate `getUserMedia` capture just for a meter
   * — which meant the hub's quick Voice button was proving a *different*
   * microphone stream than the one the call transmitted, not the real one.
   * Analysing `localStream` itself means the ring can only ever show what
   * peers are actually hearing.
   *
   * A ref, not state: this updates every animation frame, and pushing that
   * through React would re-render everything downstream at 60fps for a value
   * only one small ring reads.
   */
  const micLevel = useRef(0)

  useEffect(() => {
    if (!localStream || localStream.getAudioTracks().length === 0) {
      micLevel.current = 0
      return
    }

    const audio = new AudioContext()
    const source = audio.createMediaStreamSource(localStream)
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    const samples = new Uint8Array(analyser.frequencyBinCount)
    let frame = 0

    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      /* RMS around the 128 midpoint — peak alone flickers too hard to read
         as a voice level. */
      let sum = 0
      for (const sample of samples) {
        const centred = (sample - 128) / 128
        sum += centred * centred
      }
      micLevel.current = Math.min(1, Math.sqrt(sum / samples.length) * 3.2)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      micLevel.current = 0
      void audio.close()
    }
  }, [localStream])

  return {
    status,
    error,
    localStream,
    peers: Object.values(peers),
    othersOnCall,
    relayAvailable,
    invite,
    dismissInvite: () => setInvite(null),
    muted,
    cameraOff,
    hasCamera,
    micLevel,
    join,
    leave,
    toggleMute,
    toggleCamera,
  }
}
