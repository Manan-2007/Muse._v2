import { useEffect, useState } from 'react'
import { Clock, Music2, Sparkles, TrendingUp } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { fetchStats, type TasteStats } from '@/features/music/api'
import { fetchPersonalRoom } from '@/features/rooms/api'

/**
 * Your taste — a living Wrapped.
 *
 * Everything here grows the more you listen: how much you've played, the
 * artists and songs you return to, and a genre radar that takes the shape of
 * your listening. All from real play history — nothing here is guessed.
 */
export function ProfilePage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<TasteStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchPersonalRoom()
      .then((room) => fetchStats(room.id))
      .then((s) => {
        if (cancelled) return
        setStats(s)
        setLoading(false)
      })
      .catch(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const firstName = user?.name.split(' ')[0]
  const topArtist = stats?.topArtists[0]
  const topGenre = stats?.genres[0]

  return (
    <div className="space-y-8 py-2">
      {/* Who, and the headline. */}
      <div className="flex items-center gap-4">
        <span className="relative size-20 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-signal to-signal-deep ring-1 ring-inset ring-white/15">
          {user?.avatar ? (
            <img src={user.avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-[1.8rem] font-semibold text-white">
              {user?.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[0.72rem] uppercase tracking-[0.24em] text-dusk">Your taste</p>
          <h1 className="mt-1 font-display text-[clamp(1.7rem,5vw,2.4rem)] font-semibold tracking-[-0.02em] text-chalk">
            {firstName ? `${firstName}'s Muse.` : 'Your Muse.'}
          </h1>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-card bg-white/[0.04]" />
          ))}
        </div>
      ) : !stats || stats.totalPlays === 0 ? (
        <div className="rounded-panel border border-white/10 bg-white/[0.03] p-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white/[0.05] text-mist ring-1 ring-inset ring-white/10">
            <Sparkles aria-hidden className="size-5" />
          </span>
          <p className="mt-4 font-display text-[1.1rem] font-semibold text-chalk">
            Your taste will appear here
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[0.85rem] leading-relaxed text-mist">
            Play some music and this fills in — top artists, most-played songs, and a picture of
            the genres you lean on.
          </p>
        </div>
      ) : (
        <>
          {/* Headline numbers. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Music2} label="Songs played" value={String(stats.totalPlays)} />
            <StatTile icon={Clock} label="Minutes" value={stats.totalMinutes.toLocaleString()} />
            <StatTile icon={TrendingUp} label="Top artist" value={topArtist?.name ?? '—'} />
            <StatTile icon={Sparkles} label="Top genre" value={topGenre?.genre ?? '—'} />
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {/* The genre radar. */}
            <section>
              <h2 className="mb-4 font-display text-[1.1rem] font-semibold text-chalk">
                Your genres
              </h2>
              {stats.genres.length >= 3 ? (
                <div className="rounded-panel border border-white/10 bg-white/[0.03] p-4">
                  <GenreRadar genres={stats.genres} />
                </div>
              ) : (
                <BarList
                  items={stats.genres.map((g) => ({ label: g.genre, value: g.count }))}
                  empty="Not enough listening yet to map your genres."
                />
              )}
            </section>

            {/* Top artists as bars. */}
            <section>
              <h2 className="mb-4 font-display text-[1.1rem] font-semibold text-chalk">
                Top artists
              </h2>
              <BarList
                items={stats.topArtists.map((a) => ({ label: a.name, value: a.count }))}
                empty="Play a few songs to see your artists."
              />
            </section>
          </div>

          {/* Most-played songs. */}
          <section>
            <h2 className="mb-4 font-display text-[1.1rem] font-semibold text-chalk">
              On heavy rotation
            </h2>
            <div className="flex flex-col gap-0.5">
              {stats.topSongs.map((song, i) => (
                <div
                  key={`${song.title}-${i}`}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.04]"
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[0.75rem] tabular-nums text-dusk">
                    {i + 1}
                  </span>
                  <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/10">
                    {song.artwork && (
                      <img src={song.artwork} alt="" className="size-full object-cover" loading="lazy" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] text-chalk">{song.title}</span>
                    <span className="block truncate text-[0.74rem] text-dusk">{song.artist}</span>
                  </span>
                  <span className="shrink-0 text-[0.74rem] text-dusk">
                    {song.count} play{song.count === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Music2
  label: string
  value: string
}) {
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.03] p-4">
      <Icon aria-hidden className="size-5 text-signal-bright" />
      <p className="mt-3 truncate font-display text-[1.15rem] font-semibold text-chalk">{value}</p>
      <p className="text-[0.72rem] text-dusk">{label}</p>
    </div>
  )
}

function BarList({
  items,
  empty,
}: {
  items: { label: string; value: number }[]
  empty: string
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-card border border-white/10 bg-white/[0.03] p-6 text-center text-[0.84rem] text-dusk">
        {empty}
      </div>
    )
  }
  const max = Math.max(...items.map((i) => i.value))
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[0.85rem] text-chalk">{item.label}</span>
            <span className="shrink-0 font-mono text-[0.72rem] tabular-nums text-dusk">
              {item.value}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-signal to-signal-bright"
              style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The genre radar — the "circle where the lines go here and there".
 *
 * One spoke per genre, each reaching out as far as that genre is played. Drawn
 * as plain SVG so it needs no charting library and themes with the app.
 */
function GenreRadar({ genres }: { genres: { genre: string; count: number }[] }) {
  const size = 280
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 46
  const max = Math.max(...genres.map((g) => g.count))
  const n = genres.length

  const angleFor = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2
  const point = (i: number, r: number) => ({
    x: cx + Math.cos(angleFor(i)) * r,
    y: cy + Math.sin(angleFor(i)) * r,
  })

  const shape = genres
    .map((g, i) => {
      const p = point(i, radius * (g.count / max))
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[280px]" role="img" aria-label="Genre radar">
      {/* Rings. */}
      {[0.33, 0.66, 1].map((ring) => (
        <polygon
          key={ring}
          points={genres
            .map((_, i) => {
              const p = point(i, radius * ring)
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
            })
            .join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}
      {/* Spokes. */}
      {genres.map((_, i) => {
        const p = point(i, radius)
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      })}
      {/* The taste shape. */}
      <polygon points={shape} fill="rgba(250,35,59,0.28)" stroke="var(--color-signal)" strokeWidth="2" />
      {genres.map((g, i) => {
        const p = point(i, radius * (g.count / max))
        return <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-signal-bright)" />
      })}
      {/* Labels. */}
      {genres.map((g, i) => {
        const p = point(i, radius + 20)
        const anchor = Math.abs(p.x - cx) < 8 ? 'middle' : p.x > cx ? 'start' : 'end'
        return (
          <text
            key={g.genre}
            x={p.x}
            y={p.y}
            fill="var(--color-mist)"
            fontSize="11"
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            {g.genre}
          </text>
        )
      })}
    </svg>
  )
}
