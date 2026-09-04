import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Loader2, Music2, Search, Sparkles } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { fetchArtists, submitOnboarding, type ArtistCard } from '@/features/auth/api'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'
import { Wordmark } from '@/components/layout/Logo'
import { cn } from '@/lib/utils'

/**
 * The welcome flow — Synora's shape, for music.
 *
 * A short wizard rather than one long form: pick a few genres, then a few
 * artists from a wall of faces (you know a face before you read a name), then a
 * quick look at what you chose before it becomes a starter mix. One question per
 * step so it reads as setup, not paperwork, and every answer is optional — the
 * whole thing can be skipped straight to the music.
 */

const EASE = [0.16, 1, 0.3, 1] as const

const GENRES = [
  'Pop',
  'Hip-Hop',
  'R&B',
  'Rock',
  'Indie',
  'Electronic',
  'K-Pop',
  'Bollywood',
  'Punjabi',
  'Afrobeats',
  'Jazz',
  'Classical',
  'Country',
  'Metal',
  'Lo-fi',
  'Latin',
]

/** A stable hue per genre, so the chips read as a lively spectrum. */
function genreHue(genre: string) {
  let hash = 0
  for (let i = 0; i < genre.length; i += 1) hash = genre.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash) % 360
}

type StepId = 'genres' | 'artists' | 'review'
const STEPS: { id: StepId; label: string }[] = [
  { id: 'genres', label: 'Sound' },
  { id: 'artists', label: 'Artists' },
  { id: 'review', label: 'Finish' },
]

export function OnboardingPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [genres, setGenres] = useState<Set<string>>(new Set())
  /** name → photo, so the review can show the faces you picked. */
  const [picked, setPicked] = useState<Map<string, string | null>>(new Map())

  const [curated, setCurated] = useState<ArtistCard[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ArtistCard[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const firstName = user?.name.split(' ')[0]

  useEffect(() => {
    let cancelled = false
    void fetchArtists()
      .then((list) => !cancelled && setCurated(list))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  /* Debounced artist search — a face wall that answers as you type. */
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const id = window.setTimeout(() => {
      void fetchArtists(q)
        .then((list) => setResults(list))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => window.clearTimeout(id)
  }, [query])

  const toggleGenre = (genre: string) => {
    setGenres((current) => {
      const next = new Set(current)
      if (next.has(genre)) next.delete(genre)
      else next.add(genre)
      return next
    })
  }

  const toggleArtist = (card: ArtistCard) => {
    setPicked((current) => {
      const next = new Map(current)
      if (next.has(card.name)) next.delete(card.name)
      else next.set(card.name, card.photo)
      return next
    })
  }

  const finish = useCallback(
    async (picks: { genres: string[]; artists: string[] }) => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        const result = await submitOnboarding(picks)
        setUser(result.user)
        const destination =
          result.count > 0 ? `/dashboard?room=${result.roomId}&activity=music` : '/dashboard'
        navigate(destination, { replace: true })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not finish setting up')
        setBusy(false)
      }
    },
    [busy, navigate, setUser],
  )

  const build = () =>
    void finish({ genres: [...genres], artists: [...picked.keys()] })

  const canContinue = step === 0 ? genres.size > 0 : step === 1 ? picked.size > 0 : true
  const last = step === STEPS.length - 1

  const next = () => {
    if (last) build()
    else setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }
  const back = () => setStep((s) => Math.max(0, s - 1))

  const gridArtists = query.trim() ? (results ?? []) : curated

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden">
      <MuseBackdrop />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <button
          type="button"
          onClick={() => void finish({ genres: [], artists: [] })}
          disabled={busy}
          className="text-[0.82rem] text-dusk outline-none transition-colors hover:text-mist focus-visible:underline disabled:opacity-40"
        >
          Skip for now
        </button>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-6 sm:px-8">
        {/* Step dots — where you are, and how far is left. */}
        <ol className="flex items-center gap-2 pb-6" aria-label="Setup progress">
          {STEPS.map((entry, i) => {
            const done = i < step
            const current = i === step
            return (
              <li key={entry.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full text-[0.7rem] font-semibold transition-colors',
                    done
                      ? 'bg-signal text-white'
                      : current
                        ? 'bg-chalk text-void'
                        : 'bg-white/10 text-dusk',
                  )}
                >
                  {done ? <Check aria-hidden className="size-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[0.8rem] font-medium',
                    current ? 'text-chalk' : 'text-dusk',
                  )}
                >
                  {entry.label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/10 sm:w-10" />}
              </li>
            )
          })}
        </ol>

        <div className="min-h-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={STEPS[step]!.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="flex h-full flex-col"
            >
              {step === 0 && (
                <StepGenres
                  firstName={firstName}
                  genres={genres}
                  onToggle={toggleGenre}
                />
              )}

              {step === 1 && (
                <StepArtists
                  query={query}
                  onQuery={setQuery}
                  searching={searching}
                  artists={gridArtists}
                  picked={picked}
                  onToggle={toggleArtist}
                />
              )}

              {step === 2 && (
                <StepReview genres={[...genres]} picked={picked} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {error && (
          <p role="alert" className="pt-3 text-[0.82rem] text-signal-bright">
            {error}
          </p>
        )}

        {/* Nav. */}
        <div className="flex items-center justify-between gap-4 pt-5">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.85rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-0"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </button>

          <button
            type="button"
            onClick={next}
            disabled={busy || !canContinue}
            className="flex items-center gap-2 rounded-full bg-chalk px-5 py-3 text-[0.9rem] font-semibold text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {last ? (busy ? 'Building your mix…' : 'Build my starter mix') : 'Continue'}
            {!last && <ArrowRight aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
    </main>
  )
}

function StepGenres({
  firstName,
  genres,
  onToggle,
}: {
  firstName: string | undefined
  genres: Set<string>
  onToggle: (genre: string) => void
}) {
  return (
    <div>
      <h1 className="text-balance font-display text-[clamp(1.7rem,5vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-chalk">
        {firstName ? `What are you into, ${firstName}?` : 'What are you into?'}
      </h1>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-mist">
        Pick the sounds you reach for. We&apos;ll use them to cue up a starter mix.
      </p>

      <div className="mt-7 flex flex-wrap gap-2.5">
        {GENRES.map((genre) => {
          const on = genres.has(genre)
          const hue = genreHue(genre)
          return (
            <button
              key={genre}
              type="button"
              onClick={() => onToggle(genre)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-4 py-2.5 text-[0.9rem] font-medium outline-none transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                on
                  ? 'scale-105 border-transparent text-white shadow-lg'
                  : 'border-white/12 bg-white/[0.04] text-mist hover:border-white/25 hover:text-chalk',
              )}
              style={
                on
                  ? {
                      background: `linear-gradient(135deg, hsl(${hue} 75% 45%), hsl(${(hue + 40) % 360} 75% 38%))`,
                    }
                  : undefined
              }
            >
              {genre}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepArtists({
  query,
  onQuery,
  searching,
  artists,
  picked,
  onToggle,
}: {
  query: string
  onQuery: (value: string) => void
  searching: boolean
  artists: ArtistCard[]
  picked: Map<string, string | null>
  onToggle: (card: ArtistCard) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <h1 className="text-balance font-display text-[clamp(1.7rem,5vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-chalk">
        Who do you love?
      </h1>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-mist">
        Tap a few. Search for anyone who isn&apos;t here — {picked.size > 0 ? `${picked.size} picked` : 'the more the better'}.
      </p>

      <div className="relative mt-5">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-dusk"
        />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search for an artist"
          spellCheck={false}
          className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-4 text-[0.9rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-white/25 focus:bg-white/[0.06]"
        />
        {searching && (
          <Loader2
            aria-hidden
            className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-mist"
          />
        )}
      </div>

      <div className="scrollbar-none mt-5 min-h-0 flex-1 overflow-y-auto pb-2">
        {artists.length === 0 ? (
          <p className="py-10 text-center text-[0.85rem] text-dusk">
            {query.trim() ? 'No artists found — try another spelling.' : 'Loading artists…'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
            {artists.map((card) => (
              <ArtistTile
                key={card.name}
                card={card}
                selected={picked.has(card.name)}
                onToggle={() => onToggle(card)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ArtistTile({
  card,
  selected,
  onToggle,
}: {
  card: ArtistCard
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className="group flex flex-col items-center gap-2 outline-none"
    >
      <span
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-full ring-2 transition-all duration-200 group-hover:scale-105 group-focus-visible:ring-signal',
          selected ? 'ring-signal' : 'ring-white/10',
        )}
      >
        {card.photo ? (
          <img src={card.photo} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center bg-gradient-to-br from-signal/40 to-signal-deep/50 text-chalk">
            <Music2 aria-hidden className="size-6" />
          </span>
        )}
        <span
          className={cn(
            'absolute inset-0 grid place-items-center bg-signal/45 backdrop-blur-[1px] transition-opacity duration-200',
            selected ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span className="grid size-8 place-items-center rounded-full bg-white text-signal">
            <Check aria-hidden className="size-5" />
          </span>
        </span>
      </span>
      <span
        className={cn(
          'line-clamp-1 text-center text-[0.78rem] font-medium',
          selected ? 'text-chalk' : 'text-mist',
        )}
      >
        {card.name}
      </span>
    </button>
  )
}

function StepReview({
  genres,
  picked,
}: {
  genres: string[]
  picked: Map<string, string | null>
}) {
  const artists = [...picked.entries()]
  return (
    <div>
      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[0.72rem] uppercase tracking-[0.18em] text-signal-bright">
        <Sparkles aria-hidden className="size-3.5" />
        Ready when you are
      </span>
      <h1 className="mt-4 text-balance font-display text-[clamp(1.7rem,5vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-chalk">
        Here&apos;s your Muse.
      </h1>
      <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-mist">
        We&apos;ll build a starter mix from these and cue it up. Everything is changeable later.
      </p>

      <div className="mt-7 space-y-6">
        <div>
          <p className="pb-3 text-[0.72rem] uppercase tracking-[0.18em] text-dusk">
            Sounds ({genres.length})
          </p>
          {genres.length === 0 ? (
            <p className="text-[0.85rem] text-dusk">None picked — that&apos;s fine.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[0.82rem] text-chalk"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="pb-3 text-[0.72rem] uppercase tracking-[0.18em] text-dusk">
            Artists ({artists.length})
          </p>
          {artists.length === 0 ? (
            <p className="text-[0.85rem] text-dusk">None picked — that&apos;s fine.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {artists.map(([name, photo]) => (
                <span key={name} className="flex w-16 flex-col items-center gap-1.5">
                  <span className="aspect-square w-14 overflow-hidden rounded-full ring-2 ring-signal/60">
                    {photo ? (
                      <img src={photo} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center bg-gradient-to-br from-signal/40 to-signal-deep/50 text-chalk">
                        <Music2 aria-hidden className="size-5" />
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-center text-[0.72rem] text-mist">{name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
