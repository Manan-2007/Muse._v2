import { useEffect, useRef } from 'react'

import { BAND_COUNT } from '@/features/music/useAudioAnalyser'
import { cn } from '@/lib/utils'

/**
 * The record, and the sound coming off it.
 *
 * One canvas for the bars and a DOM element for the disc, rather than drawing
 * everything into the canvas. The artwork is an image with a border radius and
 * a shadow — things the browser already composites on the GPU — and painting
 * it per frame would cost far more than letting CSS hold it still while only
 * the reactive part redraws.
 *
 * The rotation is CSS too, driven by an animation that is paused rather than
 * removed. A record that stops when the music stops and picks up from the same
 * groove is the entire charm of the thing; restarting at zero every time would
 * read as a glitch.
 */
export function Vinyl({
  artwork,
  playing,
  read,
  accent,
  className,
}: {
  artwork: string | null
  playing: boolean
  /** Frequency levels for this frame, 0–1 per band. */
  read: (time: number) => Float32Array
  /** Colour the bars take, sampled from the cover when there is one. */
  accent: string
  className?: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const readRef = useRef(read)
  readRef.current = read

  /*
   * Canvas cannot read CSS custom properties.
   *
   * Assigning `var(--color-signal)` to `strokeStyle` is not an error — the
   * value is simply rejected and the context keeps whatever it had, which is
   * black. On a black page that means bars that are drawn perfectly and are
   * completely invisible, so the variable is resolved here first.
   */
  const accentRef = useRef(accent)
  accentRef.current = accent.startsWith('var(')
    ? getComputedStyle(document.documentElement)
        .getPropertyValue(accent.slice(4, -1).trim())
        .trim() || '#ffffff'
    : accent

  useEffect(() => {
    const element = canvas.current
    if (!element) return

    const context = element.getContext('2d')
    if (!context) return

    let frame = 0
    let width = 0
    let height = 0

    /*
     * Measured every frame rather than cached against a ResizeObserver.
     *
     * The page arrives mid-animation — the whole stage is growing out of a
     * button — so the first measurement is of an element that is still the
     * wrong size, and a cached one taken then is wrong for as long as it
     * lives. Reading the rect each frame is a single layout query against one
     * element, which is far cheaper than being wrong.
     *
     * Backing store matched to the device, capped at 2: past that the
     * sharpness is invisible and the fill rate is not.
     */
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width === width && rect.height === height) return

      width = rect.width
      height = rect.height
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      element.width = Math.max(1, Math.round(width * ratio))
      element.height = Math.max(1, Math.round(height * ratio))
      /* Resizing the backing store resets the context, so the scale has to be
         reapplied here rather than once at setup. */
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)

      measure()
      if (width === 0 || height === 0) return
      context.clearRect(0, 0, width, height)

      const levels = readRef.current(time)
      const centreX = width / 2
      const centreY = height / 2
      /* The ring starts outside the disc — the disc is 72% of the box, so the
         bars begin just past its edge and grow outward into the margin. */
      const inner = Math.min(width, height) * 0.38
      const reach = Math.min(width, height) * 0.11

      context.save()
      context.translate(centreX, centreY)
      context.strokeStyle = accentRef.current
      context.lineCap = 'round'
      context.lineWidth = Math.max(1.5, (Math.min(width, height) / BAND_COUNT) * 0.5)

      for (let band = 0; band < BAND_COUNT; band += 1) {
        const level = levels[band] ?? 0
        /* Mirrored around the vertical axis so the ring is symmetrical —
           reading the same spectrum up both sides looks composed, where
           wrapping it once around the circle looks like a scatter. */
        const half = BAND_COUNT / 2
        const index = band < half ? band : BAND_COUNT - 1 - band
        const angle = (index / half) * Math.PI - Math.PI / 2
        const mirrored = band < half ? angle : -angle + Math.PI

        const length = reach * Math.max(0.04, level)
        const cos = Math.cos(mirrored)
        const sin = Math.sin(mirrored)

        context.globalAlpha = 0.35 + level * 0.65
        context.beginPath()
        context.moveTo(cos * inner, sin * inner)
        context.lineTo(cos * (inner + length), sin * (inner + length))
        context.stroke()
      }

      context.restore()
    }

    frame = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className={cn('relative aspect-square w-full', className)}>
      <canvas ref={canvas} className="absolute inset-0 size-full" />

      <div
        className="absolute inset-[14%] rounded-full shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{
          /* The disc itself: black vinyl with a sheen across it, and grooves
             drawn as a repeating gradient rather than a texture file. */
          background:
            'repeating-radial-gradient(circle at 50% 50%, #0b0b0d 0px, #141417 2px, #0b0b0d 4px)',
          animation: 'music-spin 7s linear infinite',
          animationPlayState: playing ? 'running' : 'paused',
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[linear-gradient(115deg,transparent_38%,rgba(255,255,255,0.09)_47%,transparent_56%)]"
        />

        {/* A real record's label is about a third of its face — smaller reads
            as a sticker, larger stops looking like vinyl at all. */}
        <span className="absolute inset-[32%] overflow-hidden rounded-full ring-1 ring-inset ring-white/15">
          {artwork ? (
            <img src={artwork} alt="" className="size-full object-cover" />
          ) : (
            /* No cover: the label stays, in the app's own colours, rather than
               leaving a hole in the middle of the record. */
            <span className="grid size-full place-items-center bg-gradient-to-br from-signal/70 to-signal-deep" />
          )}
        </span>

        {/* The spindle hole, punched through whatever is behind it. */}
        <span className="absolute left-1/2 top-1/2 size-[4.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-void ring-1 ring-white/20" />
      </div>
    </div>
  )
}
