import { useState } from 'react'
import { Plus } from 'lucide-react'

import { RevealBlock, SweepHeading } from '@/features/landing/components/Reveal'
import { cn } from '@/lib/utils'

/**
 * The questions somebody actually has before they open a room.
 *
 * Written as real answers rather than reassurance. The two that matter most
 * are the awkward ones — what it costs and what it cannot play — so they are
 * answered plainly and early rather than buried under the easy ones.
 *
 * Built on `<details>`/`<summary>`, which is keyboard operable, announced
 * correctly, and open-able before any JavaScript has run. A div with an
 * `onClick` is none of those things.
 */

const QUESTIONS = [
  {
    q: 'Does everyone need an account?',
    a: 'To open a room, yes. To join one, no — the link is enough to get in and watch. You only sign up when you want a room of your own that stays put.',
  },
  {
    q: 'What can it actually play?',
    a: 'YouTube, a direct video link, or a file you upload to the room. It cannot play Netflix, Prime or Disney+ for you — those are encrypted in the browser, and anyone claiming otherwise is running a countdown timer next to your own subscription.',
  },
  {
    q: 'How far out of step can it get?',
    a: 'Under normal conditions, a fraction of a second — small drift is absorbed by running fractionally fast rather than by jumping. A bad network shows up as buffering on that person’s screen, not as everyone else being dragged around.',
  },
  {
    q: 'Does it work on a phone?',
    a: 'Yes, including the room, the queue and voice. Some browsers refuse to start video without a tap, so a late joiner may be asked to press play once — that is the browser’s rule, not ours.',
  },
  {
    q: 'What happens to a room I stop using?',
    a: 'It stays. The queue, the history and whoever you invited are all still there when you come back, which is the entire difference between a room and a call.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing today. It is a student project rather than a business, and there is no plan to put a meter on the part that makes it worth using.',
  },
]

export function Questions() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="questions" className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28">
      <div className="mx-auto max-w-3xl">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-dusk">
          Before you ask
        </span>
        <SweepHeading className="mt-3 font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
          The awkward questions first.
        </SweepHeading>

        <RevealBlock delay={140}>
          <ul className="mt-10 flex flex-col">
            {QUESTIONS.map((item, index) => {
              const isOpen = open === index
              return (
                <li key={item.q} className="border-b border-white/10 first:border-t">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : index)}
                    className="flex w-full items-start gap-4 py-5 text-left outline-none transition-colors duration-300 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    <span
                      className={cn(
                        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-all duration-300',
                        isOpen
                          ? 'rotate-45 border-signal-bright text-signal-bright'
                          : 'border-white/25 text-mist',
                      )}
                    >
                      <Plus aria-hidden className="size-3" />
                    </span>
                    <span className="flex-1 font-display text-[1.02rem] font-medium leading-snug tracking-[-0.01em] text-chalk">
                      {item.q}
                    </span>
                  </button>

                  {/*
                    Height is animated through a grid row rather than max-height.
                    A guessed max-height either clips a long answer or leaves a
                    gap under a short one; `1fr` measures the real thing.
                  */}
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-500 ease-glass',
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                    )}
                  >
                    <div className="overflow-hidden">
                      <p className="pb-6 pl-9 pr-2 text-[0.9rem] leading-relaxed text-mist">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </RevealBlock>
      </div>
    </section>
  )
}
