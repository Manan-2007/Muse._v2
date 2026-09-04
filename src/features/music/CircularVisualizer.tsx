import { useEffect, useRef } from 'react'

import { BAND_COUNT, useAudioAnalyser } from '@/features/music/useAudioAnalyser'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * The beat ring around the record.
 *
 * A recording-studio meter bent into a circle: 64 bars stood on end around the
 * disc, rising and falling with the music. The waveform is read straight from
 * the audio when it is ours to read (uploads, direct links); for YouTube, whose
 * audio is sealed inside a cross-origin iframe, the bars ride a synthesised
 * pulse instead — see `useAudioAnalyser`, which is honest about the difference.
 *
 * Canvas rather than 64 DOM nodes redrawn 60 times a second — this is a
 * decoration, and it should cost like one. The disc is drawn on top of it by
 * the parent, so the bars appear to grow out from behind the rim.
 */
export function CircularVisualizer({
  source,
  playing,
  accent = 'var(--color-signal)',
  className,
}: {
  source: MediaElementAudioSourceNode | null
  playing: boolean
  /** Bar colour, sampled from the cover. Any CSS colour; resolved on mount. */
  accent?: string
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const canvas = useRef<HTMLCanvasElement>(null)
  const { read } = useAudioAnalyser({ source, playing })

  const readRef = useRef(read)
  readRef.current = read
  const playingRef = useRef(playing)
  playingRef.current = playing
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const ctx = element.getContext('2d')
    if (!ctx) return

    /* Resolve the accent to a concrete rgb once — canvas cannot read a CSS
       custom property, and doing it per frame would thrash getComputedStyle. */
    let color = '#fa233b'
    const probe = document.createElement('span')
    probe.style.color = accent
    document.body.appendChild(probe)
    color = getComputedStyle(probe).color || color
    probe.remove()
    const rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(color)
    const raw = rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [250, 35, 59]
    /* Lift the sampled colour towards white — a cover's accent can be dark, and
       a dark ring on a dark page is no ring at all. */
    const [r, g, b] = raw.map((c) => Math.round(c + (255 - c) * 0.3))

    let frame = 0
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)

      /*
       * Size from the PARENT, never from the canvas's own box. A <canvas> is a
       * replaced element, so `absolute inset-[-28%]` does not constrain its
       * layout size — that comes from its width/height attributes. Reading the
       * canvas's own rect and writing it back as the bitmap size is a feedback
       * loop: each frame measures itself a little larger and inflates again,
       * doubling until it hits the browser's max canvas dimension and renders
       * as a solid white sheet over the player. The disc container is a stable
       * square; the ring overflows it by 28% on every side (see inset-[-28%]),
       * so the canvas is 1.56× the disc. We also pin an explicit CSS size, so
       * the replaced element can never fall back to its intrinsic dimensions.
       */
      const host = element.parentElement ?? element
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = Math.round(host.getBoundingClientRect().width * 1.56)
      if (size === 0 || !Number.isFinite(size)) return
      if (element.width !== size * dpr) {
        element.width = size * dpr
        element.height = size * dpr
        element.style.width = `${size}px`
        element.style.height = `${size}px`
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)

      const cx = size / 2
      const cy = size / 2
      /* The disc (drawn on top by the parent) fills the middle ~75% of this
         canvas; the bars stand in the open ring just beyond its rim. */
      const inner = size * 0.36
      const maxLen = size * 0.115
      const barWidth = Math.max(2, size * 0.008)

      const levels = readRef.current(time)
      const gain = reducedRef.current ? 0.25 : 1

      ctx.lineCap = 'round'
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.6)`
      for (let i = 0; i < BAND_COUNT; i += 1) {
        /* Mirror the spectrum across the circle so the two halves match — a
           ring that is loud on one side and dead on the other reads as broken
           rather than as a meter. */
        const band = i < BAND_COUNT / 2 ? i * 2 : (BAND_COUNT - i) * 2 - 1
        const level = Math.min(1, (levels[band] ?? 0) * gain)
        const angle = (i / BAND_COUNT) * Math.PI * 2 - Math.PI / 2

        const len = maxLen * (0.22 + level * 0.78)
        const x1 = cx + Math.cos(angle) * inner
        const y1 = cy + Math.sin(angle) * inner
        const x2 = cx + Math.cos(angle) * (inner + len)
        const y2 = cy + Math.sin(angle) * (inner + len)

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.45 + level * 0.55})`
        ctx.lineWidth = barWidth
        ctx.shadowBlur = 6 + level * 10
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }
      ctx.shadowBlur = 0
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [accent])

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn('pointer-events-none', className)}
    />
  )
}
