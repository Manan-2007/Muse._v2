import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

type Mode = 'signin' | 'signup'

type AuthFormProps = {
  mode: Mode
  onSubmit: (input: { name: string; email: string; password: string }) => Promise<void>
}

const COPY = {
  signin: {
    title: 'Walk back in.',
    lead: 'Your rooms are exactly where you left them.',
    action: 'Sign in',
    busy: 'Signing in…',
    altText: 'No account yet?',
    altLabel: 'Create one',
    altHref: '/signup',
  },
  signup: {
    title: 'Open your first room.',
    lead: 'Free, and ready in seconds.',
    action: 'Create account',
    busy: 'Creating…',
    altText: 'Already have an account?',
    altLabel: 'Sign in',
    altHref: '/signin',
  },
} as const

const field =
  'w-full rounded-2xl border border-white/[0.1] bg-white/[0.04] px-5 py-3.5 text-[0.95rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/50'

export function AuthForm({ mode, onSubmit }: AuthFormProps) {
  const copy = COPY[mode]
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name, email, password })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    /* Floats on the moving glass rather than sitting in a hole cut out of it
       — see `float-panel`. */
    <div className="float-panel w-full max-w-md rounded-panel p-8 md:p-10">
      <h1 className="font-display text-[clamp(2rem,5vw,2.9rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-chalk">
        {copy.title}
      </h1>
      <p className="mt-3 text-base text-mist">{copy.lead}</p>

      <form onSubmit={handleSubmit} className="mt-9 flex flex-col gap-3">
        {mode === 'signup' && (
          <label>
            <span className="sr-only">Your name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
              required
              maxLength={40}
              className={field}
            />
          </label>
        )}

        <label>
          <span className="sr-only">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            className={field}
          />
        </label>

        <label>
          <span className="sr-only">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={8}
            className={field}
          />
        </label>

        {error && (
          <p role="alert" className="text-[0.85rem] text-signal-bright">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="mt-3 w-full" disabled={busy}>
          {busy ? copy.busy : copy.action}
        </Button>
      </form>

      <p className="mt-7 text-[0.88rem] text-mist">
        {copy.altText}{' '}
        <Link to={copy.altHref} className="text-chalk underline underline-offset-4 hover:text-signal-bright">
          {copy.altLabel}
        </Link>
      </p>
    </div>
  )
}
