import { api } from '@/lib/api'
import { setToken } from '@/lib/config'
import { resetSocket } from '@/lib/socket'

export type User = {
  id: string
  email: string
  name: string
  createdAt: string
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
