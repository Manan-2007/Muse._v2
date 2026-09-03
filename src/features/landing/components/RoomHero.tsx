import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

import { HeroBallpit } from '@/features/landing/components/HeroBallpit'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'

/**
 * The hero is the product — or rather, the room is: no photograph standing in
 * for it any more.
 *
 * This used to open on the hub's own backdrop, a room lit at golden hour. The
 * pit of spheres behind the headline is the room now — the stone the rest of
 * the page is printed on shows straight through the hero as well, so there is
 * nothing behind the words but the surface and the motion. Nothing dims the
 * pit to make room for the type either: the spheres run at full brightness,
 * and the words get their contrast from a shadow the glyphs themselves cast,
 * not from darkening the thing behind them.
 */

/** The people standing in the room, as the hub labels them. */
const STANDING = [
  { name: 'Aditi', tint: 'var(--color-signal)' },
  { name: 'you', tint: '#7fb3e8', self: true },
  { name: 'Rohan', tint: '#e0a02f' },
]

export function RoomHero() {
  const section = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()

  const { scrollYProgress } = useScroll({
    target: section,
    offset: ['start start', 'end start'],
  })

  /* The copy leaves early and fades out before the section does, so it reads
     as sitting in front of the pit rather than pasted over it. */
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', '-38%'])
  const copyFade = useTransform(scrollYProgress, [0, 0.65], [1, 0])

  const still = { y: undefined, opacity: undefined }

  return (
    <section
      ref={section}
      id="top"
      /*
       * No background of its own, and centred rather than pinned to a corner.
       *
       * It used to paint solid `bg-void`, which is what drew the hard line
       * across the page where the hero stopped and the stone started — two
       * different blacks meeting at an edge read as a seam even when they are
       * close. Letting the stone show through from behind means there is
       * nothing to butt up against. Centring the copy is what a page whose
       * whole background is now motion actually wants: pinned to a corner it
       * would read as sitting *beside* the pit; centred, it sits *in* it.
       */
      className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden px-5 py-28 text-center sm:px-8 md:px-12"
    >
      {/*
        The pit, full-bleed and at full strength — nothing sits over it to
        dim it, on purpose. The words get their contrast from a shadow cast
        by the glyphs themselves further down, not from darkening the thing
        behind them.
      */}
      <HeroBallpit className="absolute inset-0 -z-10 size-full" />

      <motion.div
        className="relative mx-auto w-full max-w-3xl"
        style={reduced ? still : { y: copyY, opacity: copyFade }}
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 backdrop-blur-md">
          <span className="size-1.5 animate-signal-pulse rounded-full bg-emerald-400" />
          <span className="text-[0.7rem] tracking-[0.02em] text-chalk">
            3 in the room now
          </span>
        </span>

        {/*
          The pit sits directly behind this copy now, at full brightness, so
          the shadow below is load-bearing rather than decorative — it is
          what keeps white text readable over a bright sphere passing behind
          a letter, without dimming the sphere to get there.
        */}
        <h1
          className="mt-5 font-display text-[clamp(2.4rem,8vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-chalk [text-shadow:0_2px_28px_rgb(0_0_0/0.85),0_1px_3px_rgb(0_0_0/0.9)]"
        >
          Everyone on the
          <br />
          same second.
        </h1>

        <p className="mx-auto mt-5 max-w-lg text-[0.95rem] leading-relaxed text-mist [text-shadow:0_1px_16px_rgb(0_0_0/0.9)] sm:text-[1.02rem]">
          A room that stays open. Put a film on and it plays in step for all of you —
          one of you hits pause, it stops on every screen. Then put the music on, without
          anybody having to leave and come back.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/?signup"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-chalk px-6 text-[0.9rem] font-medium text-void outline-none transition-transform duration-300 hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Start a room
            <ArrowRight
              aria-hidden
              className="size-4 transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </Link>
          <Link
            to="/?signin"
            className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-6 text-[0.9rem] text-chalk outline-none backdrop-blur-md transition-colors duration-300 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            I have one
          </Link>
        </div>

        {/*
          The nameplates the hub puts under each person's feet, laid along the
          bottom of the scene. This is the app's own vocabulary for "somebody
          is here", so the hero ends on the thing the product is actually for.
        */}
        <ul className="mt-10 flex flex-wrap items-center justify-center gap-2 md:mt-14">
          {STANDING.map((person) => (
            <li
              key={person.name}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-void/55 px-3 py-1.5 backdrop-blur-md"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: person.tint }}
              />
              <span className="text-[0.75rem] text-chalk">{person.name}</span>
              {person.self && (
                <span className="text-[0.68rem] text-dusk">it&apos;s you</span>
              )}
            </li>
          ))}
        </ul>
      </motion.div>
    </section>
  )
}
