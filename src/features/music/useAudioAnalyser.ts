import { useCallback, useEffect, useRef } from 'react'

/**
 * Live frequency data for the visualiser.
 *
 * Reads the actual waveform through a Web Audio `AnalyserNode` wherever the
 * audio is ours to read — which means uploaded files and direct links, not
 * YouTube. YouTube's audio plays inside a cross-origin iframe that the Web
 * Audio API has no access to at all, by design.
 *
 * Rather than let the record sit still for a source whose waveform is
 * genuinely unreadable, the bars fall back to a synthesised pulse. It is
 * honest about what it is: the shape moves with tempo-ish motion so the page
 * stays alive, but nothing here pretends to be measuring a signal it cannot see.
 */

/** Bars around the record. Enough to read as a ring, few enough to draw cheaply. */
export const BAND_COUNT = 64

export function useAudioAnalyser({
  source,
  playing,
}: {
  /** The element node to tap, or null when there is nothing readable. */
  source: MediaElementAudioSourceNode | null
  playing: boolean
}) {
  const analyser = useRef<AnalyserNode | null>(null)
  /* Explicitly backed by an ArrayBuffer, not the union `Uint8Array` defaults
     to — `getByteFrequencyData` will not accept a possibly-shared buffer. */
  const bins = useRef<Uint8Array<ArrayBuffer> | null>(null)
  /** Smoothed output, so bars ease rather than strobe between frames. */
  const levels = useRef<Float32Array>(new Float32Array(BAND_COUNT))

  useEffect(() => {
    if (!source) {
      analyser.current = null
      bins.current = null
      return
    }

    const context = source.context
    const node = context.createAnalyser()
    /* 512 bins is plenty at 64 bands, and small enough to stay cheap on a
       phone. The built-in smoothing does the first pass of easing for us. */
    node.fftSize = 512
    node.smoothingTimeConstant = 0.75

    /*
     * Tapped, not spliced. The source keeps its own connection to the
     * destination — routing playback *through* the analyser would mean any
     * failure in this graph silences the music, which is a bad trade for a
     * decoration.
     */
    source.connect(node)

    analyser.current = node
    bins.current = new Uint8Array(new ArrayBuffer(node.frequencyBinCount))

    return () => {
      try {
        source.disconnect(node)
      } catch {
        /* Already torn down with its context. */
      }
      analyser.current = null
      bins.current = null
    }
  }, [source])

  /**
   * Current levels, 0–1 per band. Called from a render loop, so it allocates
   * nothing and mutates one array in place.
   */
  const read = useCallback(
    (time: number): Float32Array => {
      const out = levels.current
      const node = analyser.current
      const data = bins.current

      if (node && data) {
        node.getByteFrequencyData(data)

        /*
         * Logarithmic banding. Frequency bins are linear but hearing is not —
         * split evenly and three quarters of the bars would be treble nobody
         * can hear moving, while the whole bass end squeezed into two.
         */
        for (let band = 0; band < BAND_COUNT; band += 1) {
          const from = Math.floor((data.length * (Math.pow(2, band / BAND_COUNT) - 1)) / 1)
          const to = Math.floor((data.length * (Math.pow(2, (band + 1) / BAND_COUNT) - 1)) / 1)
          const start = Math.min(data.length - 1, from)
          const end = Math.min(data.length, Math.max(start + 1, to))

          let sum = 0
          for (let i = start; i < end; i += 1) sum += data[i]!
          const value = sum / (end - start) / 255

          /* Eased towards the target — the analyser's own smoothing handles
             the signal, this handles the paint. */
          out[band] = out[band]! + (value - out[band]!) * 0.35
        }

        return out
      }

      /*
       * No readable signal. A slow travelling wave, damped to nothing when
       * paused so a stopped track still visibly reads as stopped.
       */
      const amplitude = playing ? 1 : 0
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const phase = band / BAND_COUNT
        const wave =
          0.5 +
          0.3 * Math.sin(time / 620 + phase * Math.PI * 4) +
          0.2 * Math.sin(time / 310 + phase * Math.PI * 7)
        /* Shaped so the low end sits taller, the way real music does. */
        const tilt = 1 - phase * 0.55
        const target = wave * tilt * amplitude
        out[band] = out[band]! + (target - out[band]!) * 0.12
      }

      return out
    },
    [playing],
  )

  return { read, live: Boolean(source) }
}
