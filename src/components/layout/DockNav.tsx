import { useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion'

import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/** How far either side of an item the cursor starts lifting it, in px. */
const FALLOFF = 130
const MAX_LIFT = 0.24

type DockItemProps = {
  pointerX: MotionValue<number>
  enabled: boolean
  children: ReactNode
  className?: string
}

function DockItem({ pointerX, enabled, children, className }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null)

  /*
   * Distance is measured on every frame from the live pointer value rather
   * than from React state — the whole dock runs on the compositor, so moving
   * the cursor across it never triggers a render.
   */
  const distance = useTransform(pointerX, (x) => {
    const bounds = ref.current?.getBoundingClientRect()
    if (!bounds || x === Number.NEGATIVE_INFINITY) return FALLOFF
    return Math.abs(x - (bounds.left + bounds.width / 2))
  })

  const target = useTransform(distance, [0, FALLOFF], [1 + MAX_LIFT, 1], { clamp: true })
  const scale = useSpring(target, { stiffness: 320, damping: 26, mass: 0.4 })
  const lift = useTransform(scale, (value) => -(value - 1) * 18)

  return (
    <motion.div
      ref={ref}
      className={cn('origin-bottom', className)}
      style={enabled ? { scale, y: lift } : undefined}
    >
      {children}
    </motion.div>
  )
}

/**
 * macOS-dock behaviour on the nav pill: items swell as the cursor approaches
 * and settle as it leaves, with the nearest one lifting most.
 */
export function DockNav({ items }: { items: { key: string; node: ReactNode }[] }) {
  const reduced = usePrefersReducedMotion()
  const pointerX = useMotionValue(Number.NEGATIVE_INFINITY)

  return (
    <nav
      aria-label="Primary"
      className="mx-auto hidden items-end gap-7 md:flex"
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') pointerX.set(event.clientX)
      }}
      onPointerLeave={() => pointerX.set(Number.NEGATIVE_INFINITY)}
    >
      {items.map((item) => (
        <DockItem key={item.key} pointerX={pointerX} enabled={!reduced}>
          {item.node}
        </DockItem>
      ))}
    </nav>
  )
}
