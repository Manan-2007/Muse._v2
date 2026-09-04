import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessagesSquare, MonitorUp, Search, Sparkles } from 'lucide-react'

import { Logo } from '@/components/layout/Logo'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'
import { fetchCharts, type ChartCover } from '@/features/auth/api'

/**
 * The front door.
 *
 * Apple Music's website opener: a wall of real, current album art drifting
 * behind the name, so the first thing you see is music. The wall is live chart
 * covers; if they can't be fetched the app's own dark field carries the page
 * instead, and the words never depend on the pictures loading.
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

const COLUMN_COUNT = 6

export function LandingPage() {
  const [covers, setCovers] = useState<ChartCover[]>([])

  useEffect(() => {
    let cancelled = false
    void fetchCharts()
      .then((list) => !cancelled && setCovers(list))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="relative min-h-svh overflow-hidden bg-void">
      <MuseBackdrop />
      {covers.length > 0 && <CoverWall covers={covers} />}

      {/* Scrim — keeps the wall visible but the words readable over it. */}
      <div className="absolute inset-0 bg-gradient-to-b from-void/60 via-void/80 to-void" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_35%,transparent_20%,rgba(0,0,0,0.82))]" />

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
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-signal-bright backdrop-blur-md">
            Music, together or on your own
          </span>
          <h1 className="mt-6 max-w-3xl text-balance font-display text-[clamp(2.6rem,8vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-chalk [text-shadow:0_4px_30px_rgba(0,0,0,0.6)]">
            Put a record on.
          </h1>
          <p className="mt-5 max-w-xl text-[clamp(1rem,2.4vw,1.2rem)] leading-relaxed text-mist [text-shadow:0_2px_16px_rgba(0,0,0,0.7)]">
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
              className="rounded-full border border-white/15 bg-white/[0.03] px-7 py-3.5 text-[0.95rem] font-medium text-chalk backdrop-blur-md outline-none transition-colors hover:border-white/35 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal"
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
                className="rounded-card border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md"
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

/**
 * The drifting wall of album art.
 *
 * Covers dealt round-robin into columns, each column scrolling on its own — up
 * or down, at its own pace — so the whole field breathes. The wall is tilted and
 * oversized so its edges never show, and it is decorative, so it is inert to the
 * pointer and hidden from a screen reader.
 */
function CoverWall({ covers }: { covers: ChartCover[] }) {
  const columns: ChartCover[][] = Array.from({ length: COLUMN_COUNT }, () => [])
  covers.forEach((cover, i) => columns[i % COLUMN_COUNT]!.push(cover))

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 flex h-[140%] w-[130%] -translate-x-1/2 -translate-y-1/2 rotate-[-12deg] gap-3 sm:gap-4">
        {columns.map((column, index) => {
          const doubled = [...column, ...column]
          const up = index % 2 === 0
          const duration = 44 + (index % 3) * 12
          return (
            <div key={index} className="flex-1">
              <div
                className="flex flex-col gap-3 sm:gap-4"
                style={{
                  animation: `${up ? 'marquee-y-up' : 'marquee-y-down'} ${duration}s linear infinite`,
                }}
              >
                {doubled.map((cover, i) => (
                  <span
                    key={`${cover.artwork}-${i}`}
                    className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/10"
                  >
                    <img
                      src={cover.artwork}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
