import { prisma } from './prisma.js'

export type UserRecord = {
  id: string
  email: string
  name: string
  passwordHash: string
  createdAt: Date
}

/** A user as the client is allowed to see them — never includes the hash. */
export type PublicUser = Omit<UserRecord, 'passwordHash'>

export function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user
  return safe
}

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } })
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export function createUser(data: { email: string; name: string; passwordHash: string }) {
  return prisma.user.create({ data })
}
