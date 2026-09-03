export type RoomType = {
  id: string
  name: string
  description: string
  /** Card art, stepped across the navy → red spectrum so the set reads as one palette. */
  from: string
  to: string
  glow: string
}

export const ROOM_TYPES: RoomType[] = [
  {
    id: 'study-group',
    name: 'Study Group',
    description: 'Lecture sync and a shared code editor, kept focused.',
    from: '#04083a',
    to: '#101f8c',
    glow: '#4a63e8',
  },
  {
    id: 'team',
    name: 'Team',
    description: 'Discussion and code, kept simple and professional.',
    from: '#061033',
    to: '#1b3a9e',
    glow: '#3f7ae0',
  },
  {
    id: 'friends',
    name: 'Friends',
    description: "Games, music, watch parties. Whoever's got the remote, has the remote.",
    from: '#1a0640',
    to: '#52117a',
    glow: '#9a5be8',
  },
  {
    id: 'family',
    name: 'Family',
    description: 'Movies, music, and games the whole group can jump into.',
    from: '#2c0530',
    to: '#8a1466',
    glow: '#e05ab0',
  },
  {
    id: 'couple',
    name: 'Couple',
    description: 'Movie nights and shared playlists, built for two.',
    from: '#33040a',
    to: '#a01020',
    glow: '#ff4d5e',
  },
]
