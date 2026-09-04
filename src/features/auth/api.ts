import { api } from '@/lib/api'
import { setToken } from '@/lib/config'
import { resetSocket } from '@/lib/socket'

export type User = {
  id: string
  email: string
  name: string
  createdAt: string
  /** Null until the welcome flow is done — the onboarding gate reads this. */
  onboardedAt: string | null
}

/* `token` is only present cross-origin; same-origin the cookie carries it. */
type UserResponse = { user: User; token?: string }

/** Keep the stored token and the socket in step with who is signed in. */
function adopt(response: UserResponse) {
  setToken(response.token ?? null)
  resetSocket()
  return response.user
}

export function register(input: { name: string; email: string; password: string }) {
  return api.post<UserResponse>('/auth/register', input).then(adopt)
}

export function login(input: { email: string; password: string }) {
  return api.post<UserResponse>('/auth/login', input).then(adopt)
}

export function logout() {
  return api.post<{ ok: true }>('/auth/logout').finally(() => {
    setToken(null)
    resetSocket()
  })
}

export function fetchMe() {
  return api.get<UserResponse>('/auth/me').then((r) => r.user)
}

/**
 * Finish the welcome flow: send the taste picks, get back the now-onboarded
 * user plus the personal room the starter mix was built into.
 */
export function submitOnboarding(input: { genres: string[]; artists: string[] }) {
  return api.post<{ user: User; roomId: string; count: number }>('/auth/onboarding', input)
}

export type ChartCover = { title: string; artist: string; artwork: string }

/** Chart covers for the landing page's wall. Public — no sign-in needed. */
export function fetchCharts() {
  return api.get<{ covers: ChartCover[] }>('/charts').then((r) => r.covers)
}

export type ArtistCard = { name: string; photo: string | null }

/** Artists to pick from in onboarding — the curated grid, or a search. */
export function fetchArtists(query?: string) {
  const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  return api.get<{ artists: ArtistCard[] }>(`/artists${q}`).then((r) => r.artists)
}
