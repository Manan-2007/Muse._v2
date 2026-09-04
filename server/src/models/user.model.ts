import { prisma } from './prisma.js'

export type UserRecord = {
  id: string
  email: string
  name: string
  passwordHash: string
  avatar: string | null
  createdAt: Date
  onboardedAt: Date | null
  favGenres: string
  favArtists: string
}

/**
 * A user as the client is allowed to see them.
 *
 * Never the hash, and not the raw taste JSON either — the client only needs to
 * know *whether* onboarding is done, not to read back the picks it already
 * sent. Fields are listed rather than omitted so a new column on the record
 * cannot leak by simply existing.
 */
export type PublicUser = {
  id: string
  email: string
  name: string
  avatar: string | null
  createdAt: Date
  onboardedAt: Date | null
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    createdAt: user.createdAt,
    onboardedAt: user.onboardedAt,
  }
}

/** Update the parts of a profile a person can change themselves. */
export function updateProfile(userId: string, data: { name?: string; avatar?: string | null }) {
  return prisma.user.update({ where: { id: userId }, data })
}

/** Record the taste picks and stamp the account as onboarded. */
export function markOnboarded(userId: string, genres: string[], artists: string[]) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      onboardedAt: new Date(),
      favGenres: JSON.stringify(genres),
      favArtists: JSON.stringify(artists),
    },
  })
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
