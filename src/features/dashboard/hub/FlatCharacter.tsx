import { motion, useTransform } from 'framer-motion'

import type { PointerTilt } from '@/hooks/usePointerTilt'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * A character as a flat cutout.
 *
 * What a PNG can honestly do is breathe, sway, and lean toward you — small,
 * slow, and low-amplitude. It cannot shift weight or turn, because the shading
 * is baked for one pose; pushing the motion further is exactly where a cutout
 * starts reading as cardboard, so the numbers here are deliberately small.
 */
export function FlatCharacter({
  src,
  alt,
  tilt,
  delay = 0,
}: {
  src: string
  alt: string
  tilt: PointerTilt
  /** Staggers the breath so a party doesn't inhale in unison. */
  delay?: number
}) {
  const reduced = usePrefersReducedMotion()

  /* Leans *with* the cursor, unlike the backdrop planes — the world recedes,
     the person turns toward you. */
  const rotate = useTransform(tilt.x, (value) => value * 2.4)
  const x = useTransform(tilt.x, (value) => value * 9)

  return (
    <motion.div
      className="relative flex h-full w-full items-end justify-center"
      style={reduced ? undefined : { rotate, x }}
      /* Rotate about the feet: a cutout pivoting at its centre floats, one
         pivoting at the floor is standing on it. */
      transformTemplate={({ rotate: r, x: tx }) => `translateX(${tx ?? '0px'}) rotate(${r ?? '0deg'})`}
    >
      <div
        aria-hidden
        className="absolute bottom-[2%] h-5 w-[58%] rounded-[50%] bg-[radial-gradient(ellipse,rgb(0_0_0/0.6),transparent_72%)] blur-[6px]"
      />
      <motion.img
        src={src}
        alt={alt}
        draggable={false}
        className="relative max-h-full w-auto select-none object-contain drop-shadow-[0_24px_40px_rgb(0_0_0/0.55)]"
        animate={
          reduced
            ? undefined
            : {
                /* Breath and a slow weight sway, on two different periods so
                   the loop never lands on an obvious beat. */
                y: [0, -5, 0],
                scaleY: [1, 1.012, 1],
              }
        }
        transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay }}
        style={{ transformOrigin: 'bottom center' }}
      />
    </motion.div>
  )
}
