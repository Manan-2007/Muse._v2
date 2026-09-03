import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/features/auth/AuthContext'
import { AuthForm } from '@/features/auth/components/AuthForm'
import { StoneBackdrop } from '@/features/landing/components/StoneBackdrop'
import { useEntrance } from '@/features/transition/EntranceContext'

/**
 * The same room the landing page ends on.
 *
 * Signing up is the step immediately after that page's call to action, so it
 * inherits its material rather than handing the visitor to a differently-lit
 * product halfway through the one decision they came to make.
 */
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StoneBackdrop className="pointer-events-none fixed inset-0 z-0" />
      <main className="relative z-10 grid min-h-svh place-items-center px-6 py-32">{children}</main>
    </>
  )
}

export function SignInPage() {
  const { signIn } = useAuth()
  const { play } = useEntrance()
  const navigate = useNavigate()

  return (
    <AuthLayout>
      <AuthForm
        mode="signin"
        onSubmit={async ({ email, password }) => {
          await signIn({ email, password })
          // Corridor first, then the destination mounts underneath it.
          play()
          navigate('/dashboard', { replace: true })
        }}
      />
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { signUp } = useAuth()
  const { play } = useEntrance()
  const navigate = useNavigate()

  return (
    <AuthLayout>
      <AuthForm
        mode="signup"
        onSubmit={async (input) => {
          await signUp(input)
          play()
          navigate('/dashboard', { replace: true })
        }}
      />
    </AuthLayout>
  )
}
