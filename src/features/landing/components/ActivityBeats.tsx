import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { Clapperboard, Music4, type LucideIcon } from 'lucide-react'

import { RevealBlock, SweepHeading } from '@/features/landing/components/Reveal'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { cn } from '@/lib/utils'

/**
 * One beat per activity, each shown as the thing itself.
 *
 * Not feature cards. A card with an icon and two lines of copy is what a page
 * writes when it has nothing to show; this app has real chrome — a scrubber
 * mid-film, a queue with names against it — and a fragment of the actual
 * interface argues better than a description of it.
 *
 * Each beat parallaxes: the copy and the picture leave at slightly different
 * rates as the section passes, which is what gives the page depth without
 * anything actually moving on its own.
 */

function Beat({
  id,
  icon: Icon,
  eyebrow,
  title,
  copy,
  children,
  flip = false,
}: {
  id: string
  icon: LucideIcon
  eyebrow: string
  title: string
  copy: string
  children: React.ReactNode
  /** Alternates which side the picture falls on, on wide screens only. */
  flip?: boolean
}) {
  const section = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()

  /* Measured across the section's whole pass through the viewport, so the
     movement is tied to where it is on screen rather than to page position. */
  const { scrollYProgress } = useScroll({
    target: section,
    offset: ['start end', 'end start'],
  })

  /* Two depths. The picture hangs back, the words go on ahead — a small
     difference, because parallax that announces itself reads as a gimmick. */
  const copyY = useTransform(scrollYProgress, [0, 1], ['32px', '-32px'])
  const artY = useTransform(scrollYProgress, [0, 1], ['58px', '-58px'])
  const fade = useTransform(scrollYProgress, [0, 0.22, 0.8, 1], [0, 1, 1, 0.35])

  const still = { y: undefined, opacity: undefined }

  return (
    <section
      ref={section}
      id={id}
      className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28"
    >
      <div
        className={cn(
          'mx-auto flex max-w-6xl flex-col gap-9 md:gap-14 lg:items-center',
          flip ? 'lg:flex-row-reverse' : 'lg:flex-row',
        )}
      >
        <motion.div
          className="lg:w-[38%]"
          style={reduced ? still : { y: copyY, opacity: fade }}
        >
          <span className="inline-flex items-center gap-2.5 text-dusk">
            <Icon aria-hidden className="size-4" />
            <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em]">
              {eyebrow}
            </span>
          </span>
          <SweepHeading className="mt-3 font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            {title}
          </SweepHeading>
          <RevealBlock delay={120}>
            <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-mist">{copy}</p>
          </RevealBlock>
        </motion.div>

        <motion.div
          className="min-w-0 lg:w-[62%]"
          style={reduced ? still : { y: artY }}
        >
          <RevealBlock delay={60}>{children}</RevealBlock>
        </motion.div>
      </div>
    </section>
  )
}

/** The frame every fragment sits in — the app's glass, at rest. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="float-panel overflow-hidden rounded-2xl p-4 sm:p-5">
      {children}
    </div>
  )
}

/** Watch: a scrubber, with the whole room holding the same position on it. */
function WatchFragment() {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
          <span className="size-1.5 animate-signal-pulse rounded-full bg-emerald-400" />
          <span className="text-[0.68rem] text-chalk">3 watching</span>
        </span>
        <span className="truncate text-[0.8rem] text-mist">Spirited Away</span>
      </div>

      <div className="mt-5">
        <div className="relative h-1 rounded-full bg-white/12">
          <div className="absolute inset-y-0 left-0 w-[42%] rounded-full bg-signal" />
          {/* Three heads, one position. That coincidence is the product. */}
          {['var(--color-signal)', '#7fb3e8', '#e0a02f'].map((tint, index) => (
            <span
              key={tint}
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-void"
              style={{ left: `${42 + index * 0.35}%`, background: tint }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex justify-between font-mono text-[0.68rem] tabular-nums text-dusk">
          <span>52:18</span>
          <span>2:04:31</span>
        </div>
      </div>
    </Panel>
  )
}

/**
 * Listen: a screenshot goes here.
 *
 * Drop an image at `src/assets/landing/listen.png` (or .jpg / .webp) and it
 * takes this slot automatically — nothing to import and nothing to register,
 * the same convention the characters and scenes folders already use. Until
 * then the queue below stands in, so the section is never empty.
 */
const LISTEN_SHOT = Object.values(
  import.meta.glob('../../../assets/landing/listen.{png,jpg,jpeg,webp,avif}', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)[0]

function ListenFragment() {
  if (LISTEN_SHOT) {
    return (
      <div className="float-panel overflow-hidden rounded-2xl">
        <img
          src={LISTEN_SHOT}
          alt="The Listen page: a shared queue with a record playing."
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
      </div>
    )
  }

  const queue = [
    { title: 'Kesariya', by: 'Aditi', now: true },
    { title: 'Blinding Lights', by: 'you' },
    { title: 'Chaiyya Chaiyya', by: 'Rohan' },
  ]

  return (
    <Panel>
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-dusk">
        Up next
      </span>
      <ul className="mt-3 flex flex-col gap-1.5">
        {queue.map((track) => (
          <li
            key={track.title}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300',
              track.now ? 'bg-white/[0.07]' : 'bg-white/[0.02] hover:bg-white/[0.05]',
            )}
          >
            {/* Four bars standing in for the visualiser, only on the one
                that is actually playing. */}
            <span className="flex h-4 w-4 shrink-0 items-end gap-[2px]">
              {[0.5, 1, 0.7, 0.35].map((height, index) => (
                <span
                  key={index}
                  className={cn('w-[2px] rounded-full', track.now ? 'bg-signal' : 'bg-white/20')}
                  style={{ height: `${(track.now ? height : 0.35) * 100}%` }}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.85rem] text-chalk">
              {track.title}
            </span>
            <span className="shrink-0 text-[0.7rem] text-dusk">{track.by}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function ActivityBeats() {
  return (
    <>
      <Beat
        id="watch"
        icon={Clapperboard}
        eyebrow="Watch"
        title="Pause it here, it stops there."
        copy="One player, shared by the room. Play, pause, scrub or change speed and everyone moves with you — held to the same frame by a clock the server keeps, not by everyone pressing play at once."
      >
        <WatchFragment />
      </Beat>

      <Beat
        id="listen"
        icon={Music4}
        eyebrow="Listen"
        title="A queue with everyone's fingerprints on it."
        copy="Add to the same queue, see who put what on, and sing over the top of it if you like — the room hears your microphone alongside the track."
        flip
      >
        <ListenFragment />
      </Beat>
    </>
  )
}
