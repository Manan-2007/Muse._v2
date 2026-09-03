import { ROOM_TYPES } from '@/data/rooms'

const FALLBACK = { from: '#1a0640', to: '#52117a', glow: '#9a5be8', name: 'Room' }

/** Card art for a room type, reusing the landing page's navy → red spectrum. */
export function roomStyle(type: string) {
  const match = ROOM_TYPES.find((room) => room.id.replace('-group', '') === type)
  if (!match) return FALLBACK
  return { from: match.from, to: match.to, glow: match.glow, name: match.name }
}

/** The five types the API accepts, paired with their art. */
export const ROOM_TYPE_OPTIONS = [
  { value: 'friends', label: 'Friends' },
  { value: 'couple', label: 'Couple' },
  { value: 'study', label: 'Study Group' },
  { value: 'family', label: 'Family' },
  { value: 'team', label: 'Team' },
] as const
