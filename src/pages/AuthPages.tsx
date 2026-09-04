import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { Logo } from '@/components/layout/Logo'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'

/**
 * Sign in / sign up.
 *
 * One clean card on Muse.'s own dark field — the look a streaming app opens
 * with, not the stone-and-glass world the marketing page used to hand you into.
 * Both modes share this screen; only the copy and the extra name field differ.
 */
function AuthScreen({ mode }: { mode: 'signin' | 'signup' }) {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signup = mode === 'signup'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (signup) await signUp({ name, email, password })
      else await signIn({ email, password })
      /* Onboarding gate (RequireAuth) sends new accounts to /welcome. */
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong')
      setBusy(false)
    }
  }

  const field =
    'h-12 w-full rounded-xl border border-white/12 bg-white/[0.04] px-4 text-[0.95rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/60'

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-5 py-12">
      <MuseBackdrop />

      <div className="relative w-full max-w-sm">
        <Link
          to="/"
          className="mb-8 flex items-center justify-center gap-2.5 outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80"
        >
          <Logo className="size-8" />
          <span className="font-display text-[1.4rem] font-semibold tracking-[-0.02em] text-chalk">
            Muse<span className="text-signal">.</span>
          </span>
        </Link>

        <div className="rounded-panel border border-white/10 bg-white/[0.04] p-7 backdrop-blur-2xl sm:p-8">
          <h1 className="font-display text-[1.5rem] font-semibold tracking-[-0.02em] text-chalk">
            {signup ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1.5 text-[0.9rem] text-mist">
            {signup ? 'A minute to set up, then the music.' : 'Sign in to pick up where you left off.'}
          </p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            {signup && (
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
                className={field}
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className={field}
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={signup ? 'At least 8 characters' : 'Password'}
              autoComplete={signup ? 'new-password' : 'current-password'}
              required
              className={field}
            />

            {error && (
              <p role="alert" className="text-[0.82rem] leading-relaxed text-signal-bright">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-signal text-[0.95rem] font-semibold text-white outline-none transition-[transform,background-color] hover:bg-signal-bright hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-60"
            >
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[0.88rem] text-mist">
          {signup ? 'Already have an account?' : 'New to Muse.?'}{' '}
          <Link
            to={signup ? '/signin' : '/signup'}
            className="font-medium text-chalk underline-offset-2 outline-none hover:underline focus-visible:underline"
          >
            {signup ? 'Sign in' : 'Create one'}
          </Link>
        </p>
      </div>
    </main>
  )
}

export function SignInPage() {
  return <AuthScreen mode="signin" />
}

export function SignUpPage() {
  return <AuthScreen mode="signup" />
}
