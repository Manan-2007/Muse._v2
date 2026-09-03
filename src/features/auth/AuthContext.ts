import { createContext, useContext } from 'react'

import type { User } from '@/features/auth/api'

export type AuthState = {
  user: User | null
  /** True until the first `/auth/me` check settles, so routes don't flash. */
  loading: boolean
  signIn: (input: { email: string; password: string }) => Promise<void>
  signUp: (input: { name: string; email: string; password: string }) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
