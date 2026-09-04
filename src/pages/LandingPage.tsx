import { Link } from 'react-router-dom'
import { MessagesSquare, MonitorUp, Search, Sparkles } from 'lucide-react'

import { Logo } from '@/components/layout/Logo'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'

/**
 * The front door.
 *
 * One clean screen in Muse.'s own dark field — a streaming app's opener, not a
 * scrolling marketing site. It names what the app is (a player, a library, and
 * rooms to listen together) and gets out of the way with two buttons.
 */

const HIGHLIGHTS = [
  {
    icon: Sparkles,
    title: 'A record you can touch',
    body: 'A real turntable on screen — drop the needle to play, drag the vinyl to scrub, watch it spin.',
  },
  {
    icon: MessagesSquare,
    title: 'Rooms to listen together',
    body: 'Private rooms that stay in sync across every device. Chat, call, and hear the same second.',
  },
  {
    icon: MonitorUp,
    title: 'Share the moment',
    body: 'Turn on your camera, or share your screen, while a record plays for the whole room.',
  },
  {
    icon: Search,
    title: 'Yours from the first minute',
    body: 'Search anything, save what you love, build playlists — with a starter mix waiting on sign-up.',
  },
]

export function LandingPage() {
  return (
    <main className="relative min-h-svh overflow-hidden">
      <MuseBackdrop />

      <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-5xl flex-col px-5 sm:px-8">
        <header className="flex shrink-0 items-center justify-between gap-3 py-5">
          <span className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[1.1rem] font-semibold tracking-[-0.02em] text-chalk">
              Muse<span className="text-signal">.</span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Link
              to="/signin"
              className="rounded-full px-4 py-2 text-[0.85rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="rounded-full bg-signal px-4 py-2 text-[0.85rem] font-semibold text-white outline-none transition-colors hover:bg-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Get started
            </Link>
          </span>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <span className="font-mono text-[0.72rem] uppercase tracking-[0.28em] text-signal-bright">
            Music, together or on your own
          </span>
          <h1 className="mt-5 max-w-3xl text-balance font-display text-[clamp(2.6rem,8vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-chalk">
            Put a record on.
          </h1>
          <p className="mt-5 max-w-xl text-[clamp(1rem,2.4vw,1.2rem)] leading-relaxed text-mist">
            An immersive player, your whole library, and rooms to listen together — in sync, across
            every device.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="rounded-full bg-signal px-7 py-3.5 text-[0.95rem] font-semibold text-white shadow-[0_14px_40px_-12px_rgba(250,35,59,0.6)] outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
            >
              Start listening
            </Link>
            <Link
              to="/signin"
              className="rounded-full border border-white/15 px-7 py-3.5 text-[0.95rem] font-medium text-chalk outline-none transition-colors hover:border-white/35 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
            >
              I have an account
            </Link>
          </div>
        </section>

        <section className="grid shrink-0 gap-3 pb-16 sm:grid-cols-2 lg:grid-cols-4">
          {HIGHLIGHTS.map((item) => {
            const Icon = item.icon
            return (
              <div
                key={item.title}
                className="rounded-card border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm"
              >
                <Icon aria-hidden className="size-5 text-signal-bright" />
                <h2 className="mt-3 text-[0.95rem] font-semibold text-chalk">{item.title}</h2>
                <p className="mt-1.5 text-[0.83rem] leading-relaxed text-mist">{item.body}</p>
              </div>
            )
          })}
        </section>
      </div>
    </main>
  )
}
