import { prisma } from './prisma.js'

const messageSelect = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const

/**
 * The tail of the conversation.
 *
 * Fetched newest-first so the limit takes the *recent* messages rather than the
 * oldest ones, then flipped back into reading order.
 */
export async function recentMessages(roomId: string, limit = 60) {
  const rows = await prisma.message.findMany({
    where: { roomId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: messageSelect,
  })
  return rows.reverse()
}

export function createMessage(input: { roomId: string; authorId: string; body: string }) {
  return prisma.message.create({ data: input, select: messageSelect })
}
