import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, X } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { submitOnboarding } from '@/features/auth/api'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'
import { cn } from '@/lib/utils'

/**
 * The welcome flow.
 *
 * The one screen between signing up and the app. It asks the two questions a
 * new account can actually answer — a few genres, a few artists — and hands
 * them straight to the server, which turns them into a starter mix waiting in
 * the player. Kept to one screen on purpose: anything longer is a form standing
 * between someone and the music they came for.
 */

const GENRES = [
  'Pop',
  'Hip-Hop',
  'R&B',
  'Rock',
  'Indie',
  'Electronic',
  'K-Pop',
  'Bollywood',
  'Afrobeats',
  'Jazz',
  'Classical',
  'Country',
  'Metal',
  'Lo-fi',
]

export function OnboardingPage() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const [genres, setGenres] = useState<Set<string>>(new Set())
  const [artists, setArtists] = useState<string[]>([])
  const [artistDraft, setArtistDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const firstName = user?.name.split(' ')[0]

  const toggleGenre = (genre: string) => {
    setGenres((current) => {
      const next = new Set(current)
      if (next.has(genre)) next.delete(genre)
      else next.add(genre)
      return next
    })
  }

  const addArtist = () => {
    const value = artistDraft.trim()
    if (!value) return
    /* Case-insensitive dedupe, and a soft cap — six names is plenty to seed a
       mix, and more only makes the search slower without making it better. */
    const exists = artists.some((one) => one.toLowerCase() === value.toLowerCase())
    if (!exists && artists.length < 8) setArtists((current) => [...current, value])
    setArtistDraft('')
  }

  const onArtistKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addArtist()
    }
  }

  const finish = async (picks: { genres: string[]; artists: string[] }) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await submitOnboarding(picks)
      setUser(result.user)
      /* Straight into the solo player, where the mix is already queued — the
         payoff for answering, rather than a dashboard to go looking from. */
      const destination =
        result.count > 0 ? `/dashboard?room=${result.roomId}&activity=music` : '/dashboard'
      navigate(destination, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish setting up')
      setBusy(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void finish({ genres: [...genres], artists })
  }

  const hasPicks = genres.size > 0 || artists.length > 0

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-5 py-16">
      <MuseBackdrop />

      <div className="float-panel relative w-full max-w-lg rounded-panel p-8 md:p-10">
        <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-signal-bright">
          Welcome to Muse.
        </p>
        <h1 className="mt-3 text-balance font-display text-[clamp(1.8rem,5vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-chalk">
          {firstName ? `What do you listen to, ${firstName}?` : 'What do you listen to?'}
        </h1>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-mist">
          Pick a few, and we&apos;ll cue up a starter mix. You can change everything later.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-7">
          <fieldset>
            <legend className="text-[0.72rem] uppercase tracking-[0.2em] text-dusk">Genres</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {GENRES.map((genre) => {
                const on = genres.has(genre)
                return (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => toggleGenre(genre)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-[0.82rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                      on
                        ? 'border-signal/50 bg-signal/20 text-chalk'
                        : 'border-white/12 bg-white/[0.04] text-mist hover:border-white/25 hover:text-chalk',
                    )}
                  >
                    {genre}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[0.72rem] uppercase tracking-[0.2em] text-dusk">
              Artists you love
            </legend>
            <div className="mt-3 flex gap-2">
              <input
                value={artistDraft}
                onChange={(event) => setArtistDraft(event.target.value)}
                onKeyDown={onArtistKey}
                placeholder="Type a name, press Enter"
                className="h-11 min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[0.9rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-white/25"
              />
              <button
                type="button"
                onClick={addArtist}
                aria-label="Add artist"
                className="grid size-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-chalk outline-none transition-colors hover:border-white/25 hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </div>

            {artists.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {artists.map((artist) => (
                  <span
                    key={artist}
                    className="flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/15 py-1 pl-3 pr-1.5 text-[0.82rem] text-chalk"
                  >
                    {artist}
                    <button
                      type="button"
                      onClick={() => setArtists((current) => current.filter((one) => one !== artist))}
                      aria-label={`Remove ${artist}`}
                      className="grid size-5 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-[0.82rem] leading-relaxed text-signal-bright">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => void finish({ genres: [], artists: [] })}
              disabled={busy}
              className="text-[0.85rem] text-dusk underline-offset-2 outline-none transition-colors hover:text-mist focus-visible:underline disabled:opacity-40"
            >
              Skip for now
            </button>

            <button
              type="submit"
              disabled={busy || !hasPicks}
              className="flex items-center gap-2 rounded-full bg-chalk px-5 py-3 text-[0.9rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            >
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {busy ? 'Building your mix…' : 'Build my starter mix'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
