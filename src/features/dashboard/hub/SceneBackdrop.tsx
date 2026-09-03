import { motion, useTransform } from 'framer-motion'

import type { PointerTilt } from '@/hooks/usePointerTilt'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import type { Scene } from '@/lib/scenes'

/** Pixels of travel for a depth-1 plane. Nearer planes multiply this. */
const TRAVEL = 14

function Plane({
  url,
  depth,
  scale,
  tilt,
}: {
  url: string
  depth: number
  scale: number
  tilt: PointerTilt
}) {
  /*
   * Opposed to the cursor — the scene leans *away* as you move into it, which
   * is what a camera pushing through real depth does. Matching the cursor
   * direction instead reads as a sticker being dragged around.
   */
  const x = useTransform(tilt.x, (value) => value * -TRAVEL * depth)
  const y = useTransform(tilt.y, (value) => value * -TRAVEL * depth * 0.55)

  return (
    <motion.div
      aria-hidden
      className="absolute inset-0 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${url})`, x, y, scale }}
    />
  )
}

/**
 * The hub's world.
 *
 * A scene's planes are stacked back to front and shifted at different rates, so
 * the still image gains depth without anything being 3D. A scene that ships a
 * video uses that instead — real motion beats faked motion, and the layered
 * fallback is there for the reduced-motion case anyway.
 *
 * With no scene at all this still renders: a graded, drifting gradient so the
 * hub is a finished screen on a clean checkout rather than a white void.
 */
export function SceneBackdrop({ scene, tilt }: { scene?: Scene; tilt: PointerTilt }) {
  const reduced = usePrefersReducedMotion()

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-void">
      {scene?.video && !reduced ? (
        <video
          className="absolute inset-0 size-full object-cover"
          src={scene.video}
          autoPlay
          muted
          loop
          playsInline
          /* Decoding a full-screen loop on the main thread is what makes the
             rest of the hub stutter; this keeps it on the compositor. */
          disablePictureInPicture
        />
      ) : (
        scene?.layers.map((layer) => (
          <Plane
            key={layer.name}
            url={layer.url}
            depth={layer.depth}
            scale={layer.scale}
            tilt={tilt}
          />
        ))
      )}

      {/*
        No artwork yet: a dusk sky with a warm horizon rather than a near-black
        wash. This is what the hub looks like on a clean checkout, so it has to
        be a finished screen in its own right — and it has to be bright enough
        that frosted controls over it are still legible.
      */}
      {!scene && (
        <>
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#0a1236_0%,#1b1440_42%,#43203a_68%,#7c3a24_86%,#2a1512_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(55%_38%_at_50%_84%,rgb(255_186_106/0.55),transparent_70%)]" />
          <div className="absolute inset-0 animate-float-slow bg-[radial-gradient(65%_45%_at_18%_20%,color-mix(in_oklab,var(--color-neon-violet)_26%,transparent),transparent_66%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(50%_40%_at_84%_16%,color-mix(in_oklab,var(--color-neon-blue)_22%,transparent),transparent_62%)]" />
          {/* A horizon line, so the character has something to stand against. */}
          <div className="absolute inset-x-0 top-[68%] h-px bg-[linear-gradient(to_right,transparent,rgb(255_205_150/0.35),transparent)]" />
        </>
      )}

      {/* Grade: darkened edges and a lifted floor, so white UI stays readable
          over whatever artwork lands here. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_45%,transparent_35%,rgb(0_0_0/0.5)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-void/70 via-void/20 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-void/60 to-transparent" />
      <div className="grain absolute inset-0 opacity-[0.08] mix-blend-overlay" />
    </div>
  )
}
