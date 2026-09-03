import { PrismaClient } from '@prisma/client'

/**
 * The single Prisma client for the process.
 *
 * Only the model layer imports this — services go through the models, and
 * controllers go through the services. That keeps query details in one place
 * and lets the business logic be read without knowing the schema.
 */
export const prisma = new PrismaClient()
