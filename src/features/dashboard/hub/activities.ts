import { Clapperboard, Music4, type LucideIcon } from 'lucide-react'

export type ActivityId = 'watch' | 'music'

export type Activity = {
  id: ActivityId
  label: string
  hint: string
  icon: LucideIcon
  /** What lands in this slot when the feature is built. */
  blurb: string
}

/**
 * The two things a room can be doing. Muse. is music-first: listening together
 * is the point, and co-watching is the one other thing a room reaches for on
 * the same night. Everyone in the room gets the same set — no per-room-type
 * lists and no host-only controls, which keeps the hub one screen with one
 * meaning.
 */
export const ACTIVITIES: Activity[] = [
  {
    id: 'music',
    label: 'Listen',
    hint: 'Shared queue',
    icon: Music4,
    blurb:
      "The room's playlist and its live queue — add, reorder, skip, and vote, with playback synchronised the same way the player is.",
  },
  {
    id: 'watch',
    label: 'Watch',
    hint: 'Together, in sync',
    icon: Clapperboard,
    blurb:
      'A shared player: search, queue, and synchronised play, pause, seek and speed, with drift correction holding everyone to the same frame.',
  },
]

export function findActivity(id: ActivityId) {
  return ACTIVITIES.find((activity) => activity.id === id)!
}
