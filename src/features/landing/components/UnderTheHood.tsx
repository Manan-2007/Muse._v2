import { RevealBlock, RevealGroup, SweepHeading } from '@/features/landing/components/Reveal'

/**
 * Why the sync actually holds.
 *
 * Every product in this category claims to be synchronised, so the claim on
 * its own is worth nothing — the specifics are the argument. These are the
 * real mechanisms out of the codebase, described in plain words: the server
 * clock, the drift correction, the reconnect. A reader who has been let down
 * by a watch-party before is looking for exactly this section.
 */

const MECHANISMS = [
  {
    label: 'The clock',
    title: 'Nobody trusts their own watch',
    copy: 'Browser clocks are routinely seconds out. Each client measures its offset from the server across several round trips and keeps the median, so "where the film is" means the same thing on every device in the room.',
  },
  {
    label: 'Drift',
    title: 'Corrected by speed, not by jumping',
    copy: 'A player that slips behind is run imperceptibly fast until it catches up, rather than yanked forward. You only ever see a jump when the gap is big enough that you would have noticed it anyway.',
  },
  {
    label: 'Buffering',
    title: 'A stall is not treated as drift',
    copy: 'While a player is buffering — and for a moment after — it is left alone. Correcting a stalled client is how other players end up in a loop of stall, jump, stall.',
  },
  {
    label: 'Reconnect',
    title: 'Walking back in mid-film',
    copy: 'Drop off the network and the room carries on. When you come back it asks the server where everyone is now, rather than resuming from a position that stopped being true minutes ago.',
  },
]

export function UnderTheHood() {
  return (
    <section id="sync" className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-dusk">
            Under the hood
          </span>
          <SweepHeading className="mt-3 font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            Everyone says synchronised. Here is what that means here.
          </SweepHeading>
          <RevealBlock delay={120}>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-mist">
              Four things have to be true at once, and most of the work is in the fourth —
              handling the moment it goes wrong without making it worse.
            </p>
          </RevealBlock>
        </div>

        <RevealGroup className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] sm:grid-cols-2" step={100} start={120}>
          {MECHANISMS.map((item) => (
            <div key={item.label} className="bg-void/55 p-6 backdrop-blur-xl backdrop-saturate-150 sm:p-7">
              <span className="font-mono text-[0.64rem] uppercase tracking-[0.16em] text-signal-bright">
                {item.label}
              </span>
              <h3 className="mt-2.5 font-display text-[1.05rem] font-semibold leading-snug tracking-[-0.01em] text-chalk">
                {item.title}
              </h3>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-mist">{item.copy}</p>
            </div>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}

/** What else is in the room, once something is playing in it. */
const IN_THE_ROOM = [
  { title: 'Voice', copy: 'Talk over whatever is on, without a second app in front of it.' },
  { title: 'Chat', copy: 'For the half of the room that would rather type than talk.' },
  { title: 'Presence', copy: 'See who is actually here, and what they are looking at.' },
  { title: 'A character', copy: 'Everyone stands in the room as somebody. Pick yours.' },
]

export function InTheRoom() {
  return (
    <section id="room" className="relative px-5 py-20 sm:px-8 md:px-12 md:py-28 lg:pl-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-dusk">
            The room itself
          </span>
          <SweepHeading className="mt-3 font-display text-[clamp(1.75rem,4.5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.02em]">
            A place, not a call.
          </SweepHeading>
          <RevealBlock delay={120}>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-mist">
              A call ends. A room is somewhere you leave things — a queue half played, a game
              mid-turn, whoever wandered off to make tea.
            </p>
          </RevealBlock>
        </div>

        <RevealGroup className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" step={90} start={120}>
          {IN_THE_ROOM.map((item) => (
            <div
              key={item.title}
              className="float-panel rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5"
            >
              <h3 className="font-display text-[1rem] font-semibold tracking-[-0.01em] text-chalk">
                {item.title}
              </h3>
              <p className="mt-2 text-[0.86rem] leading-relaxed text-mist">{item.copy}</p>
            </div>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
