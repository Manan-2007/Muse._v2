import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { AuthForm } from '@/features/auth/components/AuthForm'
import { useEntrance } from '@/features/transition/EntranceContext'

/**
 * Signing in without leaving the page.
 *
 * The landing page spends its whole length making an argument, and sending
 * somebody to a separate route to type an email throws that away — they come
 * back, if they come back, to a page scrolled to the top. This floats the form
 * over the same moving surface instead, so the room is still visible behind
 * the thing they are joining.
 *
 * Dismissed by clicking anywhere off it, or by Escape. Both matter: the click
 * is what most people try first, and Escape is what the keyboard expects.
 */
export function AuthModal({
  mode,
  onClose,
}: {
  mode: 'signin' | 'signup'
  onClose: () => void
}) {
  const { signIn, signUp } = useAuth()
  const { play } = useEntrance()
  const navigate = useNavigate()
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    /* Whatever had focus when this opened gets it back when it closes —
       otherwise a keyboard user is returned to the top of the document. */
    returnTo.current = document.activeElement as HTMLElement | null

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)

    /* The page behind must not scroll while this is over it — on a phone that
       reads as the form sliding off the screen under your thumb. */
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    /* Focus moves into the dialog, so the next Tab lands in the form rather
       than somewhere behind it. */
    const focusable = panel.current?.querySelector<HTMLElement>('input, button')
    focusable?.focus()

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      returnTo.current?.focus?.()
    }
  }, [onClose])

  const finish = () => {
    onClose()
    play()
    navigate('/dashboard', { replace: true })
  }

  return (
    <div
      className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto p-5 py-16"
      /*
       * Anything outside the panel dismisses.
       *
       * Asked as "was this inside the panel?" rather than "did this land on
       * the container itself?" — the scrim is a child of this element, so it
       * becomes the event target and the narrower test silently never fired.
       *
       * On mousedown rather than click, so a drag that starts inside the form
       * and releases outside it does not count as clicking away.
       */
      onMouseDown={(event) => {
        if (!panel.current?.contains(event.target as Node)) onClose()
      }}
    >
      {/* Darkened, but not opaque: the surface keeps moving behind it, which
          is the whole reason for doing this here rather than on its own page. */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-void/72 backdrop-blur-sm" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'signin' ? 'Sign in' : 'Create your account'}
        className="relative w-full max-w-md"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 right-0 z-10 grid size-9 -translate-y-full place-items-center rounded-full border border-white/12 bg-void/70 text-mist outline-none backdrop-blur-md transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <X aria-hidden className="size-4" />
        </button>

        <AuthForm
          mode={mode}
          onSubmit={async (input) => {
            if (mode === 'signin') await signIn({ email: input.email, password: input.password })
            else await signUp(input)
            finish()
          }}
        />
      </div>
    </div>
  )
}
