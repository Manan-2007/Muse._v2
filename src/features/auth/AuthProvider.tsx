import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { AuthContext, type AuthState } from '@/features/auth/AuthContext'
import * as authApi from '@/features/auth/api'
import type { User } from '@/features/auth/api'

/**
 * Holds the signed-in user for the app.
 *
 * The session itself lives in an httpOnly cookie, so this is only a cache of
 * who that cookie belongs to — the server is always the authority. On mount it
 * asks `/auth/me` once; a 401 there just means "signed out", not an error.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    authApi
      .fetchMe()
      .then((me) => {
        if (!cancelled) setUser(me)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (input: { email: string; password: string }) => {
    setUser(await authApi.login(input))
  }, [])

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      setUser(await authApi.register(input))
    },
    [],
  )

  const signOut = useCallback(async () => {
    await authApi.logout()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
