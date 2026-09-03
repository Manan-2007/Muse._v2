import { useEffect, useState } from 'react'

/**
 * The colours of the current cover, for the page to dress itself in.
 *
 * Sampled from the artwork rather than stored with the track, because the
 * artwork is the only thing that reliably exists — a YouTube thumbnail, an
 * uploaded file's embedded art, a URL someone pasted. Anything the server
 * could have precomputed would be missing for exactly the sources people
 * actually use.
 *
 * Returns null until a cover has been read, and null forever for a track that
 * has none. The page falls back to its own palette in that case rather than
 * inventing a colour, which is the difference between "this album is red" and
 * "the app is randomly red today".
 */

export type CoverPalette = {
  /** The cover's dominant colour, already lifted to something legible on black. */
  base: string
  /** A second colour for the gradient to travel to. */
  accent: string
  /** True when the artwork is dark enough that text needs its own ground. */
  dark: boolean
}

/** Bucketed to 32 levels per channel — exact colours cluster into one anyway. */
const BUCKET = 32

function toHsl(r: number, g: number, b: number) {
  const rd = r / 255
  const gd = g / 255
  const bd = b / 255
  const max = Math.max(rd, gd, bd)
  const min = Math.min(rd, gd, bd)
  const lightness = (max + min) / 2

  if (max === min) return { h: 0, s: 0, l: lightness }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let hue: number
  if (max === rd) hue = ((gd - bd) / delta + (gd < bd ? 6 : 0)) / 6
  else if (max === gd) hue = ((bd - rd) / delta + 2) / 6
  else hue = ((rd - gd) / delta + 4) / 6

  return { h: hue * 360, s: saturation, l: lightness }
}

export function useCoverPalette(artwork: string | null | undefined): CoverPalette | null {
  const [palette, setPalette] = useState<CoverPalette | null>(null)

  useEffect(() => {
    if (!artwork) {
      setPalette(null)
      return
    }

    let cancelled = false
    const image = new Image()
    /*
     * Required, and the reason this can fail quietly. Reading pixels out of a
     * canvas that has drawn a cross-origin image without CORS permission
     * throws a security error — so covers from a host that doesn't allow it
     * simply produce no palette, and the page keeps its own colours.
     */
    image.crossOrigin = 'anonymous'

    image.onload = () => {
      if (cancelled) return

      try {
        /* Tiny on purpose. The browser's own downscale is a cheap, decent
           average, and 32×32 is more than enough to find a dominant hue. */
        const size = 32
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size

        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return

        context.drawImage(image, 0, 0, size, size)
        const { data } = context.getImageData(0, 0, size, size)

        const counts = new Map<string, { count: number; r: number; g: number; b: number }>()

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]!
          const g = data[i + 1]!
          const b = data[i + 2]!
          const alpha = data[i + 3]!
          if (alpha < 128) continue

          const { s, l } = toHsl(r, g, b)
          /* Skip the near-black and near-white that dominate most covers —
             letterboxing, borders, and blown-out sky are the majority of the
             pixels and none of them are what anyone would call the colour. */
          if (l < 0.12 || l > 0.93 || s < 0.12) continue

          const key = `${Math.round(r / BUCKET)}-${Math.round(g / BUCKET)}-${Math.round(b / BUCKET)}`
          const existing = counts.get(key)
          if (existing) {
            existing.count += 1
            existing.r += r
            existing.g += g
            existing.b += b
          } else {
            counts.set(key, { count: 1, r, g, b })
          }
        }

        const ranked = [...counts.values()].sort((a, b) => b.count - a.count)
        if (ranked.length === 0) {
          setPalette(null)
          return
        }

        const dominant = ranked[0]!
        const average = {
          r: dominant.r / dominant.count,
          g: dominant.g / dominant.count,
          b: dominant.b / dominant.count,
        }
        const { h, s, l } = toHsl(average.r, average.g, average.b)

        /*
         * Pushed towards something that works as a *background*. The literal
         * dominant colour of a cover is often either muddy or fluorescent, and
         * either one behind an entire page is unreadable — so saturation is
         * floored and capped, and lightness is pinned into a narrow dark band.
         */
        const saturation = Math.min(0.72, Math.max(0.38, s))
        const second = (h + 42) % 360

        setPalette({
          base: `hsl(${h.toFixed(0)} ${(saturation * 100).toFixed(0)}% 24%)`,
          accent: `hsl(${second.toFixed(0)} ${(saturation * 100).toFixed(0)}% 16%)`,
          dark: l < 0.45,
        })
      } catch {
        /* A tainted canvas — see the note on `crossOrigin` above. */
        setPalette(null)
      }
    }

    image.onerror = () => {
      if (!cancelled) setPalette(null)
    }

    image.src = artwork

    return () => {
      cancelled = true
    }
  }, [artwork])

  return palette
}
