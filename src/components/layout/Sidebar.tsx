import { useState, type ComponentType } from 'react'
import {
  ChevronDown,
  Clock,
  Heart,
  Home,
  Library,
  ListMusic,
  LogOut,
  Music2,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-react'

import { Wordmark } from '@/components/layout/Logo'
import type { Playlist } from '@/features/music/types'
import type { Room } from '@/features/rooms/api'
import { cn } from '@/lib/utils'

export type ShellView = 'home' | 'search' | 'library' | 'rooms'
export type LibrarySection = 'recent' | 'playlists' | 'artists' | 'songs' | 'liked'

/**
 * The app's spine — Apple Music's left column, always on.
 *
 * Every destination lives here and stays put, so wherever you are the way
 * anywhere else is one click in a place that never moves. Home and Search sit
 * at the top; Library opens into the four ways of holding music; the room's
 * own list and the rooms you belong to fill the rest. Dark glass, so it reads
 * as chrome floating over the coloured page rather than part of it.
 *
 * On phones this is hidden and slides in as a drawer — see the shell.
 */
export function Sidebar({
  user,
  view,
  librarySection,
  playlists,
  rooms,
  activeRoomId,
  roomsLive = false,
  onHome,
  onSearch,
  onLibrary,
  onLiked,
  onOpenPlaylist,
  onNewPlaylist,
  onOpenRooms,
  onSelectRoom,
  onCreateRoom,
  onOpenSettings,
  onSignOut,
  className,
}: {
  user: { name: string } | null
  view: ShellView
  librarySection: LibrarySection
  playlists: Playlist[]
  rooms: Room[]
  activeRoomId: string | null
  roomsLive?: boolean
  onHome: () => void
  onSearch: () => void
  onLibrary: (section: LibrarySection) => void
  onLiked: () => void
  onOpenPlaylist: (playlist: Playlist) => void
  onNewPlaylist: () => void
  onOpenRooms: () => void
  onSelectRoom: (roomId: string) => void
  onCreateRoom: () => void
  onOpenSettings: () => void
  onSignOut: () => void
  className?: string
}) {
  const [libraryOpen, setLibraryOpen] = useState(true)

  const librarySub: { id: LibrarySection; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { id: 'recent', label: 'Recently Added', icon: Clock },
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'artists', label: 'Artists', icon: Users },
    { id: 'songs', label: 'Songs', icon: Music2 },
  ]

  return (
    <aside
      className={cn(
        'flex h-full w-64 shrink-0 flex-col border-r border-white/[0.07] bg-[#0a0a0d]/85 backdrop-blur-2xl',
        className,
      )}
    >
      <div className="shrink-0 px-5 pb-2 pt-5">
        <Wordmark />
      </div>

      <nav className="scrollbar-none min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        <NavRow icon={Home} label="Home" active={view === 'home'} onClick={onHome} />
        <NavRow icon={Search} label="Search" active={view === 'search'} onClick={onSearch} />

        {/* Library — the four ways of holding music, folded away until wanted. */}
        <button
          type="button"
          onClick={() => {
            setLibraryOpen((o) => !o)
            onLibrary(librarySection === 'liked' ? 'recent' : librarySection)
          }}
          className={cn(
            'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            view === 'library' ? 'text-chalk' : 'text-mist hover:text-chalk',
          )}
        >
          <Library aria-hidden className="size-[1.15rem] shrink-0" />
          <span className="flex-1 text-[0.9rem] font-medium">Your Library</span>
          <ChevronDown
            aria-hidden
            className={cn('size-4 shrink-0 text-dusk transition-transform', libraryOpen ? '' : '-rotate-90')}
          />
        </button>

        {libraryOpen && (
          <div className="space-y-0.5 pb-1 pl-3">
            {librarySub.map((sub) => (
              <NavRow
                key={sub.id}
                icon={sub.icon}
                label={sub.label}
                small
                active={view === 'library' && librarySection === sub.id}
                onClick={() => onLibrary(sub.id)}
              />
            ))}
          </div>
        )}

        <NavRow
          icon={Heart}
          label="Liked Songs"
          active={view === 'library' && librarySection === 'liked'}
          onClick={onLiked}
        />

        <div className="my-3 border-t border-white/[0.06]" />

        {/* Playlists — as many rows as the person has made. */}
        <div className="flex items-center justify-between px-3 pb-1">
          <span className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-dusk">
            Playlists
          </span>
          <button
            type="button"
            onClick={onNewPlaylist}
            aria-label="New playlist"
            className="grid size-6 place-items-center rounded-full text-dusk outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </div>
        {playlists.length === 0 ? (
          <p className="px-3 pb-1 text-[0.75rem] leading-relaxed text-dusk">
            Playlists you make show up here.
          </p>
        ) : (
          playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onOpenPlaylist(playlist)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-white/[0.06] text-dusk ring-1 ring-inset ring-white/10">
                {playlist.tracks[0]?.artwork ? (
                  <img src={playlist.tracks[0].artwork} alt="" className="size-full object-cover" />
                ) : (
                  <ListMusic aria-hidden className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.82rem] text-chalk">{playlist.name}</span>
                <span className="block truncate text-[0.7rem] text-dusk">
                  {playlist.tracks.length} {playlist.tracks.length === 1 ? 'song' : 'songs'}
                </span>
              </span>
            </button>
          ))
        )}

        <div className="my-3 border-t border-white/[0.06]" />

        {/* Rooms — Discord's servers, in the spine. */}
        <button
          type="button"
          onClick={onOpenRooms}
          className={cn(
            'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
            view === 'rooms' ? 'text-chalk' : 'text-mist hover:text-chalk',
          )}
        >
          <Users aria-hidden className="size-[1.15rem] shrink-0" />
          <span className="flex-1 text-[0.9rem] font-medium">Rooms</span>
          {roomsLive && <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />}
        </button>

        <div className="space-y-0.5 pl-3">
          {rooms.map((room) => {
            const active = view === 'rooms' && room.id === activeRoomId
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onSelectRoom(room.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                  active ? 'bg-white/[0.07] text-chalk' : 'text-mist hover:bg-white/[0.05] hover:text-chalk',
                )}
              >
                <span
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-lg text-[0.75rem] font-semibold',
                    active
                      ? 'bg-gradient-to-br from-signal to-signal-deep text-white'
                      : 'bg-white/[0.06] text-chalk',
                  )}
                >
                  {room.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.82rem]">{room.name}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={onCreateRoom}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-mist outline-none transition-colors hover:bg-white/[0.05] hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-signal-bright">
              <Plus aria-hidden className="size-4" />
            </span>
            <span className="text-[0.82rem]">New room</span>
          </button>
        </div>
      </nav>

      {/* Who you are, and the way to settings. */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-white/[0.07] px-3 py-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.8rem] font-semibold text-white"
        >
          {user?.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-medium text-chalk">
          {user?.name ?? 'You'}
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="grid size-8 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <Settings aria-hidden className="size-[1.05rem]" />
        </button>
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          className="grid size-8 shrink-0 place-items-center rounded-full text-mist outline-none transition-colors hover:bg-white/10 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <LogOut aria-hidden className="size-[1.05rem]" />
        </button>
      </div>
    </aside>
  )
}

function NavRow({
  icon: Icon,
  label,
  active = false,
  small = false,
  live = false,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  active?: boolean
  small?: boolean
  live?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        small ? 'py-1.5' : 'py-2',
        active ? 'bg-white/[0.07] text-chalk' : 'text-mist hover:bg-white/[0.04] hover:text-chalk',
      )}
    >
      <Icon
        aria-hidden
        className={cn(small ? 'size-4' : 'size-[1.15rem]', 'shrink-0', active && 'text-signal-bright')}
      />
      <span className={cn('flex-1', small ? 'text-[0.82rem]' : 'text-[0.9rem] font-medium')}>{label}</span>
      {live && <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />}
    </button>
  )
}
