import type { CoverPalette } from '@/features/music/useCoverPalette'
import { cn } from '@/lib/utils'

/**
 * A heading cut out of the album art.
 *
 * The artwork really is the fill — but scaled far past the letterforms and
 * washed with a bright overlay first. Both parts are load-bearing. At its
 * natural size a cover shows recognisable *content* inside the strokes:
 * faces, borders, and often the band's own name, which is how "Sweater
 * Weather" ended up with someone else's typography inside it. Blown up several
 * times over, the same image is a slow drift of its own colours, and the
 * overlay guarantees those stay light enough to read on black.
 *
 * Falls back to the sampled palette when there is no cover, and to plain chalk
 * when there is neither — clipped text with no background is invisible text,
 * so there is always something real underneath.
 */
export function CoverHeading({
  children,
  artwork,
  palette,
  className,
}: {
  children: React.ReactNode
  artwork: string | null
  palette: CoverPalette | null
  className?: string
}) {
  const shared = cn(
    'bg-clip-text font-display font-semibold tracking-[-0.03em] text-transparent',
    className,
  )

  if (artwork) {
    return (
      <h1
        className={shared}
        style={{
          /*
           * Two layers, both clipped to the glyphs: a lifting wash over the
           * artwork itself. `background-size` scales them independently, which
           * is what lets the image be enormous while the wash stays put.
           */
          backgroundImage: `linear-gradient(105deg, rgb(255 255 255 / 0.62), rgb(255 255 255 / 0.34)), url(${artwork})`,
          backgroundSize: '100% 100%, 420% auto',
          backgroundPosition: 'center, center',
          backgroundBlendMode: 'overlay, normal',
        }}
      >
        {children}
      </h1>
    )
  }

  const from = palette ? `color-mix(in oklab, ${palette.base} 40%, white)` : 'var(--color-chalk)'
  const to = palette ? `color-mix(in oklab, ${palette.accent} 55%, white)` : 'var(--color-mist)'

  return (
    <h1 className={shared} style={{ backgroundImage: `linear-gradient(102deg, ${from}, ${to})` }}>
      {children}
    </h1>
  )
}
