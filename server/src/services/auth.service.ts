import bcrypt from 'bcryptjs'

import * as userModel from '../models/user.model.js'
import { HttpError } from '../utils/HttpError.js'

const BCRYPT_ROUNDS = 12

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}

export async function register(input: { email: string; name: string; password: string }) {
  const existing = await userModel.findByEmail(input.email)
  if (existing) throw HttpError.conflict('That email is already registered')

  const user = await userModel.createUser({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
  })

  return userModel.toPublicUser(user)
}

export async function login(input: { email: string; password: string }) {
  const user = await userModel.findByEmail(input.email)

  /*
   * Identical response whether the email exists or the password is wrong, so
   * this endpoint can't be used to work out which accounts are registered.
   */
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : false
  if (!user || !ok) throw HttpError.unauthorized('Email or password is incorrect')

  return userModel.toPublicUser(user)
}

export async function getUser(userId: string) {
  const user = await userModel.findById(userId)
  if (!user) throw HttpError.unauthorized()
  return userModel.toPublicUser(user)
}
