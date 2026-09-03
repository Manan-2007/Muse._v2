import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '@/features/auth/AuthContext'

/**
 * Gate for signed-in pages.
 *
 * Renders nothing while the first `/auth/me` check is in flight — redirecting
 * during that window would bounce a signed-in user to the sign-in screen on
 * every refresh.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="min-h-svh" aria-busy="true" />
  }

  if (!user) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
