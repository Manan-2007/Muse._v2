import { useEffect } from 'react'

/**
 * Drives the iridescent sheen on every `.liquid-btn`.
 *
 * One delegated listener for the whole document rather than a handler per
 * button. Buttons come and go constantly here — rails swap contents when you
 * walk into a room, panels mount and unmount — and a global listener needs no
 * wiring on each new one, which is what lets the effect be a class name rather
 * than a component everything has to be rewritten into.
 *
 * Writes CSS variables directly. Nothing re-renders: this runs at pointer rate
 * and React has no business in that loop.
 */
export function useLiquidPointer() {
  useEffect(() => {
    let active: HTMLElement | null = null

    const clear = (el: HTMLElement | null) => {
      if (!el) return
      el.style.removeProperty('--lg-edge')
      el.style.removeProperty('--lg-angle')
      el.style.removeProperty('--lg-x')
      el.style.removeProperty('--lg-y')
    }

    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null
      const el = target?.closest?.('.liquid-btn') as HTMLElement | null

      if (el !== active) {
        clear(active)
        active = el
      }
      if (!el) return

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const halfW = rect.width / 2
      const halfH = rect.height / 2
      const dx = x - halfW
      const dy = y - halfH

      /* Angle from the centre, rotated so 0deg points up — the conic gradient
         starts at 12 o'clock, so this makes the bright arc land under the
         cursor rather than a quarter turn away from it. */
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
      if (angle < 0) angle += 360

      /*
       * How close to an edge, 0 at dead centre and 1 on the border.
       *
       * Measured as a fraction of the distance to the boundary *along the
       * cursor's own direction*, so it reaches 1 on the long sides as readily
       * as on the short ones. A plain radial distance would leave a wide
       * button's left and right edges permanently dim.
       */
      const reachX = dx === 0 ? Infinity : halfW / Math.abs(dx)
      const reachY = dy === 0 ? Infinity : halfH / Math.abs(dy)
      const edge = Math.min(Math.max(1 / Math.min(reachX, reachY), 0), 1)

      el.style.setProperty('--lg-angle', `${angle.toFixed(1)}deg`)
      el.style.setProperty('--lg-edge', edge.toFixed(3))
      el.style.setProperty('--lg-x', `${((x / rect.width) * 100).toFixed(1)}%`)
      el.style.setProperty('--lg-y', `${((y / rect.height) * 100).toFixed(1)}%`)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      clear(active)
    }
  }, [])
}
