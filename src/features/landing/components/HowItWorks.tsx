import { RevealBlock, RevealGroup, SweepHeading } from '@/features/landing/components/Reveal'

/**
 * Three steps, because there are genuinely only three.
 *
 * Numbered markers earn their place here in a way they do not on most pages:
 * this is a real sequence, and the order carries information the reader needs
 * — you cannot send the link before there is a room to link to.
 */

const STEPS = [
  {
    n: '01',
    title: 'Open a room',
    copy: 'Pick who it is for and it exists. No scheduling, no meeting id, no start time — a room is a place, not an appointment.',
  },
  {
    n: '02',
    title: 'Send the link',
    copy: 'One link, no install, no account needed to look. Whoever opens it walks in at whatever the room is already doing.',
  },
  {
    n: '03',
    title: 'Put something on',
    copy: 'A film, a queue, a game. Everyone gets it at the same moment, and it keeps running whether you are all looking at it or not.',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28">
      <div className="mx-auto max-w-6xl">
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-dusk">
          How it works
        </span>
        <SweepHeading className="mt-3 max-w-2xl font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
          Three steps, and you are already in it.
        </SweepHeading>

        <RevealGroup
          className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
          step={110}
          start={80}
        >
          {STEPS.map((step) => (
            <div key={step.n} className="relative border-t border-white/10 pt-5">
              <span className="font-mono text-[0.72rem] tabular-nums text-signal-bright">
                {step.n}
              </span>
              <h3 className="mt-2 font-display text-[1.15rem] font-semibold tracking-[-0.01em] text-chalk">
                {step.title}
              </h3>
              <p className="mt-2 text-[0.9rem] leading-relaxed text-mist">{step.copy}</p>
            </div>
          ))}
        </RevealGroup>

        <RevealBlock delay={420}>
          <p className="mt-10 max-w-xl text-[0.86rem] leading-relaxed text-dusk">
            The room does not close when you do. Come back tomorrow and the queue is where you
            left it, with whatever anybody added while you were gone.
          </p>
        </RevealBlock>
      </div>
    </section>
  )
}
