import { useCallback, useEffect, useRef } from 'react'

/**
 * The turntable scratch — the "zig-zig" you feel when you drag the record.
 *
 * There is no real audio to scrub (YouTube's is sealed away), so the sound is
 * synthesised: a loop of filtered noise whose loudness and pitch track how fast
 * the disc is being turned. Still it is silent; nudge it and it rasps; whip it
 * and it squeals — the same feedback a hand gets from vinyl, which is what makes
 * scrubbing feel physical and makes rough DJ-style cueing possible by ear.
 *
 * Off is honoured: the setting lives in localStorage so Settings can flip it,
 * and this reads it fresh each grab.
 */

const SETTING_KEY = 'muse:scratch'

export function scratchEnabled() {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setScratchEnabled(on: boolean) {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off')
  } catch {
    /* Not fatal — the preference just won't persist. */
  }
}

export function useScratchSound() {
  const ctx = useRef<AudioContext | null>(null)
  const gain = useRef<GainNode | null>(null)
  const filter = useRef<BiquadFilterNode | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)

  const lastValue = useRef<number | null>(null)
  const lastTime = useRef(0)
  const idle = useRef<number | null>(null)
  const active = useRef(false)

  const ensure = useCallback(() => {
    if (ctx.current) return ctx.current
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return null

    const context = new AudioCtx()

    /* A short loop of white noise — the raw material a needle drags across. */
    const seconds = 1
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1

    const noise = context.createBufferSource()
    noise.buffer = buffer
    noise.loop = true

    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 800
    band.Q.value = 0.8

    const out = context.createGain()
    out.gain.value = 0

    noise.connect(band)
    band.connect(out)
    out.connect(context.destination)
    noise.start()

    ctx.current = context
    source.current = noise
    filter.current = band
    gain.current = out
    return context
  }, [])

  const start = useCallback(() => {
    if (!scratchEnabled()) return
    const context = ensure()
    if (!context) return
    void context.resume()
    active.current = true
    lastValue.current = null
    lastTime.current = performance.now()
  }, [ensure])

  /**
   * Feed the current scrub position (cumulative seconds since the grab).
   *
   * Speed is the change since the last frame; the sound is shaped from it so a
   * fast flick is louder and brighter than a slow nudge, and stillness fades to
   * silence even while the finger is still down.
   */
  const move = useCallback((value: number) => {
    if (!active.current || !ctx.current || !gain.current || !filter.current) return
    const now = performance.now()
    const dt = Math.max(16, now - lastTime.current)
    lastTime.current = now

    const previous = lastValue.current
    lastValue.current = value
    if (previous === null) return

    /* Seconds of track per second of wall-clock — how hard the disc is spun. */
    const speed = Math.min(6, (Math.abs(value - previous) / dt) * 1000)
    const context = ctx.current
    const level = Math.min(0.22, speed * 0.05)
    gain.current.gain.setTargetAtTime(level, context.currentTime, 0.02)
    filter.current.frequency.setTargetAtTime(300 + speed * 550, context.currentTime, 0.02)

    /* Hold nothing: if no move lands soon, the rasp dies even mid-grab. */
    if (idle.current) window.clearTimeout(idle.current)
    idle.current = window.setTimeout(() => {
      if (ctx.current && gain.current) {
        gain.current.gain.setTargetAtTime(0, ctx.current.currentTime, 0.05)
      }
    }, 90)
  }, [])

  const end = useCallback(() => {
    active.current = false
    lastValue.current = null
    if (idle.current) window.clearTimeout(idle.current)
    if (ctx.current && gain.current) {
      gain.current.gain.setTargetAtTime(0, ctx.current.currentTime, 0.05)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (idle.current) window.clearTimeout(idle.current)
      try {
        source.current?.stop()
        void ctx.current?.close()
      } catch {
        /* Already gone. */
      }
    }
  }, [])

  return { start, move, end }
}
