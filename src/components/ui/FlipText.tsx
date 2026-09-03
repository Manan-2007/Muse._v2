import type { CSSVars } from '@/lib/utils'

/**
 * Splits a label into per-character flip cards.
 *
 * The whole string stays available to assistive tech via `aria-label`; the
 * characters themselves are hidden from it, because a screen reader announcing
 * "C, r, e, a, t, e" one letter at a time is exactly the failure mode that
 * makes decorative text splitting a bad idea.
 */
export function FlipText({ text }: { text: string }) {
  return (
    <span aria-label={text} className="inline-flex">
      {[...text].map((character, index) => {
        if (character === ' ') {
          return (
            <span key={index} aria-hidden className="inline-block">
              &nbsp;
            </span>
          )
        }

        return (
          <span
            key={index}
            aria-hidden
            className="flip-char"
            style={{ '--i': index } as CSSVars}
          >
            <span className="flip-char__inner">
              <span className="flip-char__face">{character}</span>
              <span className="flip-char__face flip-char__face--incoming">{character}</span>
            </span>
          </span>
        )
      })}
    </span>
  )
}
