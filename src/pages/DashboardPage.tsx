import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Clapperboard,
  Copy,
  Disc3,
  Home as HomeIcon,
  ListMusic,
  LogOut,
  Menu,
  MessagesSquare,
  Play,
  Search as SearchIcon,
  Users,
} from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { BottomNav, type NavItem } from '@/components/layout/BottomNav'
import { Wordmark } from '@/components/layout/Logo'
import {
  Sidebar,
  type LibrarySection,
  type ShellView,
} from '@/components/layout/Sidebar'
import { HubDrawer } from '@/features/dashboard/hub/HubDrawer'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'
import { VoiceButton } from '@/features/dashboard/hub/VoiceButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { StageFailed } from '@/features/dashboard/hub/StageFailed'
import { MusicBrowser, type BrowserView } from '@/features/music/MusicBrowser'
import { MusicDock } from '@/features/music/MusicDock'
import { FullPlayer } from '@/features/music/FullPlayer'
import { MusicProvider } from '@/features/music/MusicProvider'
import { useLibrary } from '@/features/music/useLibrary'
import { CallInvite } from '@/features/room-panel/CallInvite'
import { RoomPanel, PANEL_WIDTH_REM } from '@/features/room-panel/RoomPanel'
import { useChat } from '@/features/room-panel/useChat'
import { FloatingCall } from '@/features/room-panel/FloatingCall'
import { ExtensionBridge } from '@/features/watch/ExtensionBridge'
import { useMeshCall } from '@/features/room-panel/useMeshCall'
import { useWatchPulse } from '@/features/watch/useWatchPulse'
import { WatchInvite } from '@/features/watch/WatchInvite'
import { WatchStage } from '@/features/watch/WatchStage'
import { CreateRoomForm } from '@/features/dashboard/components/CreateRoomForm'
import { fetchPlaylists, fetchSuggestions } from '@/features/music/api'
import type { LibraryTrack, Playlist } from '@/features/music/types'
import { fetchPersonalRoom, fetchRoom, type Room } from '@/features/rooms/api'
import { usePresence, type Present } from '@/features/rooms/usePresence'
import { usePresenceWatch } from '@/features/rooms/usePresenceWatch'
import { useRooms } from '@/features/rooms/useRooms'
import { useEntrance } from '@/features/transition/EntranceContext'

const EASE = [0.16, 1, 0.3, 1] as const

type Panel = 'create' | 'settings'

/** Which browser section backs a given shell view + library sub-section. */
function browserViewFor(view: ShellView, section: LibrarySection): BrowserView {
  if (view === 'search') return 'search'
  switch (section) {
    case 'liked':
      return 'liked'
    case 'playlists':
      return 'playlists'
    case 'recent':
    case 'artists':
      return 'suggested'
    case 'songs':
      return 'search'
  }
}

/**
 * The app.
 *
 * Apple Music's shape: a left column that never moves — Home, Search, Library,
 * your playlists and your rooms — beside a main area that scrolls, with the
 * record you are listening to riding a bar along the bottom and rising to full
 * screen when you ask. Search and Library are pages in the main column now, not
 * glass thrown over Home.
 *
 * Two listening contexts share one player: your own solo room, resolved
 * quietly on load, and whichever shared room you have walked into. The URL only
 * ever names a shared room; solo needs no address.
 */
export function DashboardPage() {
  const { user, signOut } = useAuth()
  const { phase } = useEntrance()
  const { rooms, loading, error, create, join, setOnline } = useRooms()

  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [sideOpen, setSideOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  /** Where in the app you are. Solo and social both live in one shell. */
  const [view, setView] = useState<ShellView>('home')
  const [librarySection, setLibrarySection] = useState<LibrarySection>('recent')
  /** Whether the immersive record view is raised over everything. */
  const [playerOpen, setPlayerOpen] = useState(false)

  const activeRoomId = params.get('room')
  const activity = params.get('activity') === 'watch' ? 'watch' : null

  /*
   * Whether you have stepped out of your own listening session. Personal: it
   * pauses this client without touching a shared room.
   */
  const [leftMusic, setLeftMusic] = useState(false)

  /* Your solo room, resolved once. It never appears in the URL or the room
     list — it is simply where music plays when you are not in a shared one. */
  const [personalRoom, setPersonalRoom] = useState<Room | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchPersonalRoom()
      .then((room) => !cancelled && setPersonalRoom(room))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const personalRoomId = personalRoom?.id ?? null

  /* A shared room held outside the list — deep-linked or freshly joined. */
  const [detachedRoom, setDetachedRoom] = useState<Room | null>(null)

  const activeRoom = activeRoomId
    ? (rooms.find((room) => room.id === activeRoomId) ??
      (detachedRoom?.id === activeRoomId ? detachedRoom : undefined) ??
      (personalRoom?.id === activeRoomId ? personalRoom : undefined))
    : undefined

  /* The social half: only a genuine shared room drives chat, the call and
     presence. Your solo room is nobody else's business. */
  const sharedRoomId = activeRoom && !activeRoom.personal ? activeRoom.id : null
  /* The music half: the shared room if you are in one, else your solo room. */
  const musicRoomId = sharedRoomId ?? personalRoomId

  const library = useLibrary(musicRoomId)

  /*
   * Resolve a shared room that is not in the list yet, and drop one that has
   * gone. The personal room is resolved separately, so it is exempt.
   */
  useEffect(() => {
    if (!activeRoomId || loading || activeRoom) return
    let cancelled = false
    fetchRoom(activeRoomId)
      .then((room) => !cancelled && setDetachedRoom(room))
      .catch(() => !cancelled && setActiveRoomId(null))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, activeRoom, loading])

  const setActiveRoomId = useCallback(
    (id: string | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (id) next.set('room', id)
          else next.delete('room')
          next.delete('activity')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  const setActivity = useCallback(
    (id: 'watch' | null) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (id) next.set('activity', id)
          else next.delete('activity')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  /* Onboarding used to land on `?activity=music`; honour it by raising the
     record, then clean the URL so a refresh doesn't keep doing it. */
  useEffect(() => {
    if (params.get('activity') === 'music') {
      setPlayerOpen(true)
      setLeftMusic(false)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete('activity')
          return next
        },
        { replace: true },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chat = useChat(sharedRoomId)
  const call = useMeshCall(sharedRoomId)

  const [poppedOut, setPoppedOut] = useState<string | null>(null)

  const floating = useMemo(() => {
    if (!poppedOut) return null
    if (poppedOut === 'self') {
      return {
        stream: call.localStream,
        name: user?.name ?? 'You',
        muted: call.muted,
        cameraOff: call.cameraOff || !call.hasCamera,
        failed: false,
        isSelf: true,
      }
    }
    const peer = call.peers.find((entry) => entry.socketId === poppedOut)
    if (!peer) return null
    return {
      stream: peer.stream,
      name: peer.name,
      muted: peer.muted,
      cameraOff: peer.cameraOff,
      failed: peer.failed,
      isSelf: false,
    }
  }, [poppedOut, call.localStream, call.peers, call.muted, call.cameraOff, call.hasCamera, user?.name])

  useEffect(() => {
    if (poppedOut && (call.status !== 'live' || !floating)) setPoppedOut(null)
  }, [poppedOut, call.status, floating])

  useEffect(() => {
    if (!sharedRoomId) setSideOpen(false)
  }, [sharedRoomId])

  const sideBySide = useMediaQuery('(min-width: 60rem)')
  const wide = useMediaQuery('(min-width: 64rem)')
  const inset = sideOpen && sideBySide ? PANEL_WIDTH_REM : 0
  const sidebarInset = wide ? 16 : 0

  const presenceRooms = useMemo(() => (sharedRoomId ? [sharedRoomId] : []), [sharedRoomId])

  const [roster, setRoster] = useState<Record<string, Present[]>>({})

  const handlePresence = useCallback(
    (roomId: string, present: Present[]) => {
      setRoster((current) => ({ ...current, [roomId]: present }))
      setOnline(
        roomId,
        present.map((person) => person.userId),
      )
    },
    [setOnline],
  )

  usePresence(presenceRooms, handlePresence, undefined)

  const watchedRooms = useMemo(() => rooms.map((room) => room.id).sort(), [rooms])
  usePresenceWatch(watchedRooms, handlePresence)

  const lastPresenced = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastPresenced.current
    if (previous && previous !== sharedRoomId) {
      setOnline(previous, [])
      setRoster((current) => ({ ...current, [previous]: [] }))
    }
    lastPresenced.current = sharedRoomId
  }, [sharedRoomId, setOnline])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const present = useMemo(() => {
    if (!user || !sharedRoomId) return []
    const here = roster[sharedRoomId] ?? []
    const others = here.filter((person) => person.userId !== user.id)
    return [
      { id: user.id, name: user.name, you: true },
      ...others.map((person) => ({ id: person.userId, name: person.name, you: false })),
    ]
  }, [user, sharedRoomId, roster])

  const watch = useWatchPulse(sharedRoomId)

  /* Enter a shared room from anywhere — the sidebar, a card, a code. */
  const enterRoom = useCallback(
    (roomId: string) => {
      setActiveRoomId(roomId)
      setView('rooms')
      setDrawerOpen(false)
    },
    [setActiveRoomId],
  )

  /* ── Navigation from the sidebar ─────────────────────────────────────── */
  const goHome = useCallback(() => {
    setView('home')
    setDrawerOpen(false)
  }, [])
  const goSearch = useCallback(() => {
    setView('search')
    setLeftMusic(false)
    setDrawerOpen(false)
  }, [])
  const goLibrary = useCallback((section: LibrarySection) => {
    setView('library')
    setLibrarySection(section)
    setDrawerOpen(false)
  }, [])
  const goLiked = useCallback(() => {
    setView('library')
    setLibrarySection('liked')
    setDrawerOpen(false)
  }, [])
  const goRooms = useCallback(() => {
    setView('rooms')
    setDrawerOpen(false)
  }, [])
  const openPlaylistsSection = useCallback(() => {
    setView('library')
    setLibrarySection('playlists')
    setDrawerOpen(false)
  }, [])

  const openPlayer = useCallback(() => {
    setPlayerOpen(true)
    setLeftMusic(false)
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name.split(' ')[0]

  const revealed = phase !== 'tunnel'

  const roomsLive =
    Boolean(sharedRoomId && (chat.unread > 0 || call.othersOnCall > 0)) || watch.viewers.length > 0

  const browserView = browserViewFor(view, librarySection)

  /* The mobile bottom bar — the same four destinations as the sidebar's top. */
  const navItems: NavItem[] = [
    { key: 'home', label: 'Home', icon: HomeIcon, active: view === 'home', onClick: goHome },
    { key: 'search', label: 'Search', icon: SearchIcon, active: view === 'search', onClick: goSearch },
    {
      key: 'library',
      label: 'Library',
      icon: Disc3,
      active: view === 'library',
      onClick: () => goLibrary('recent'),
    },
    {
      key: 'rooms',
      label: 'Rooms',
      icon: Users,
      active: view === 'rooms',
      live: roomsLive,
      onClick: goRooms,
    },
  ]

  const sidebar = (
    <Sidebar
      user={user}
      view={view}
      librarySection={librarySection}
      playlists={library.playlists}
      rooms={rooms}
      activeRoomId={sharedRoomId}
      roomsLive={roomsLive}
      onHome={goHome}
      onSearch={goSearch}
      onLibrary={goLibrary}
      onLiked={goLiked}
      onOpenPlaylist={openPlaylistsSection}
      onNewPlaylist={openPlaylistsSection}
      onOpenRooms={goRooms}
      onSelectRoom={enterRoom}
      onCreateRoom={() => setPanel('create')}
      onOpenSettings={() => setPanel('settings')}
      onSignOut={() => void signOut()}
    />
  )

  return (
    <MusicProvider roomId={musicRoomId} enabled={activity !== 'watch' && !leftMusic}>
      <ExtensionBridge roomId={sharedRoomId} roomName={activeRoom?.name ?? null} />

      <motion.main
        className="fixed inset-0 flex overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <MuseBackdrop />

        {revealed && (
          <>
            {/* The spine, on desktop. */}
            <div className="relative z-10 hidden lg:flex">{sidebar}</div>

            {/* The main column. */}
            <div className="relative z-10 flex min-w-0 flex-1 flex-col">
              {/* Slim bar on phones — the drawer handle and who you are. */}
              <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open menu"
                  className="grid size-9 place-items-center rounded-full border border-white/10 text-chalk outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  <Menu aria-hidden className="size-5" />
                </button>
                <Wordmark />
                <span
                  aria-hidden
                  className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.75rem] font-semibold text-white"
                >
                  {user?.name.slice(0, 1).toUpperCase()}
                </span>
              </header>

              <div
                data-lenis-prevent
                className="scrollbar-none relative min-h-0 flex-1 overflow-y-auto"
              >
                {view === 'home' && (
                  <div className="px-5 pb-40 pt-4 sm:px-8">
                    <div className="mx-auto w-full max-w-5xl">
                      <HomeContent
                        greeting={greeting}
                        firstName={firstName}
                        rooms={rooms}
                        activeRoom={sharedRoomId ? activeRoom : undefined}
                        onListen={goSearch}
                        onLibrary={() => goLibrary('recent')}
                        onPlaylists={openPlaylistsSection}
                        onOpenRooms={goRooms}
                        onEnterRoom={enterRoom}
                      />
                    </div>
                  </div>
                )}

                {(view === 'search' || view === 'library') && (
                  <ErrorBoundary
                    resetKey={`${view}:${librarySection}:${musicRoomId}`}
                    fallback={(_error, reset) => (
                      <StageFailed
                        title="The music library hit a problem"
                        onRetry={reset}
                        onClose={goHome}
                      />
                    )}
                  >
                    <div className="flex h-full flex-col pb-36 pt-2">
                      <MusicBrowser
                        library={library}
                        view={browserView}
                        hideChrome
                      />
                    </div>
                  </ErrorBoundary>
                )}

                {view === 'rooms' && (
                  <div className="px-5 pb-40 pt-4 sm:px-8">
                    <div className="mx-auto w-full max-w-5xl">
                      <RoomsContent
                        rooms={rooms}
                        loading={loading}
                        activeRoom={sharedRoomId ? activeRoom : undefined}
                        activeRoomId={sharedRoomId}
                        present={present}
                        roster={roster}
                        watchViewers={watch.viewers.length}
                        onSelectRoom={enterRoom}
                        onListen={goSearch}
                        onWatch={() => setActivity('watch')}
                        onChat={() => setSideOpen(true)}
                        onLeave={() => setActiveRoomId(null)}
                        onCreate={() => setPanel('create')}
                        onJoin={async (code) => {
                          const room = await join(code)
                          enterRoom(room.id)
                          return room
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile bottom bar — the sidebar's top four, thumb-height. */}
              <div className="lg:hidden">
                <BottomNav items={navItems} insetRight={inset} />
              </div>
            </div>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="pointer-events-none absolute inset-x-0 top-16 z-20 mx-auto max-w-sm px-6 text-center text-[0.8rem] text-signal-bright"
          >
            {error}
          </p>
        )}

        {/* The now-playing bar — rides the bottom, taps up to the record. */}
        {musicRoomId && (
          <MusicDock
            visible={!playerOpen && activity !== 'watch' && !leftMusic}
            onOpen={openPlayer}
            onLeave={() => setLeftMusic(true)}
            insetRight={inset}
            insetLeft={sidebarInset}
          />
        )}

        {/* The record, full screen. */}
        <FullPlayer
          open={playerOpen && activity !== 'watch'}
          onClose={() => setPlayerOpen(false)}
          selfId={user?.id}
          library={library}
          panelOpen={sharedRoomId ? sideOpen : false}
          onTogglePanel={sharedRoomId ? () => setSideOpen((open) => !open) : undefined}
          unread={chat.unread}
          insetRight={inset}
        />

        {/* Mobile drawer — the whole sidebar, slid in. */}
        <AnimatePresence>
          {drawerOpen && (
            <motion.div
              className="fixed inset-0 z-[150] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div
                className="absolute inset-y-0 left-0"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {sidebar}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {revealed && call.invite && !sideOpen && (
            <CallInvite
              key="call-invite"
              name={call.invite.name}
              onJoin={() => {
                setSideOpen(true)
                call.dismissInvite()
                void call.join()
              }}
              onDismiss={call.dismissInvite}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {revealed && watch.invite && activity !== 'watch' && (
            <WatchInvite
              key="watch-invite"
              name={watch.invite.name}
              onJoin={() => {
                setActivity('watch')
                watch.dismiss()
              }}
              onDismiss={watch.dismiss}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activity === 'watch' && activeRoom && sharedRoomId && (
            <WatchStage
              key="watch"
              origin={null}
              roomId={activeRoom.id}
              selfId={user?.id}
              onClose={() => setActivity(null)}
              insetRight={inset}
              panelOpen={sideOpen}
              unread={chat.unread}
              onTogglePanel={() => setSideOpen((open) => !open)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sideOpen && sharedRoomId && (
            <RoomPanel
              key="room-panel"
              chat={chat}
              call={call}
              roomName={activeRoom?.name ?? 'Room'}
              here={present.length}
              poppedOut={poppedOut}
              onPopOut={(who) => setPoppedOut((current) => (current === who ? null : who))}
              selfId={user?.id}
              selfName={user?.name ?? 'You'}
              onClose={() => setSideOpen(false)}
            />
          )}
        </AnimatePresence>

        {call.status === 'live' && floating && (
          <FloatingCall
            stream={floating.stream}
            name={floating.name}
            muted={floating.muted}
            cameraOff={floating.cameraOff}
            failed={floating.failed}
            isSelf={floating.isSelf}
            onClose={() => setPoppedOut(null)}
          />
        )}

        <AnimatePresence>
          {panel === 'create' && (
            <HubDrawer
              key="create"
              title="Start something new"
              subtitle="It stays open after you close the tab."
              onClose={() => setPanel(null)}
            >
              <CreateRoomForm
                onCreate={async (input) => {
                  const room = await create(input)
                  enterRoom(room.id)
                  setPanel(null)
                  return room
                }}
              />
            </HubDrawer>
          )}

          {panel === 'settings' && (
            <HubDrawer
              key="settings"
              title="Settings"
              subtitle="Appearance, sound and your profile."
              onClose={() => setPanel(null)}
            >
              <p className="text-[0.9rem] leading-relaxed text-mist">
                Light mode, the turntable&apos;s scratch sound, your photo and your name are
                landing here shortly.
              </p>
            </HubDrawer>
          )}
        </AnimatePresence>
      </motion.main>
    </MusicProvider>
  )
}

/**
 * Home — a streaming-app front page.
 *
 * A greeting, one big invitation to start listening, the quick links, and a
 * glance at recent tracks, your playlists and your rooms.
 */
function HomeContent({
  greeting,
  firstName,
  rooms,
  activeRoom,
  onListen,
  onLibrary,
  onPlaylists,
  onOpenRooms,
  onEnterRoom,
}: {
  greeting: string
  firstName: string | undefined
  rooms: Room[]
  activeRoom: Room | undefined
  onListen: () => void
  onLibrary: () => void
  onPlaylists: () => void
  onOpenRooms: () => void
  onEnterRoom: (roomId: string) => void
}) {
  const quickLinks = [
    { key: 'library', label: 'Library', hint: 'Liked & uploads', icon: Disc3, onClick: onLibrary },
    { key: 'playlists', label: 'Playlists', hint: 'Your mixes', icon: ListMusic, onClick: onPlaylists },
    { key: 'rooms', label: 'Rooms', hint: 'Listen together', icon: Users, onClick: onOpenRooms },
  ]

  const [recent, setRecent] = useState<LibraryTrack[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  useEffect(() => {
    let cancelled = false
    void fetchPersonalRoom()
      .then((room) => {
        void fetchSuggestions(room.id)
          .then((s) => !cancelled && setRecent(s.history))
          .catch(() => undefined)
        void fetchPlaylists(room.id)
          .then((p) => !cancelled && setPlaylists(p))
          .catch(() => undefined)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-8 py-2">
      <div>
        <p className="text-[0.72rem] uppercase tracking-[0.24em] text-dusk">{greeting}</p>
        <h1 className="mt-1.5 font-display text-[clamp(1.8rem,5vw,2.6rem)] font-semibold tracking-[-0.02em] text-chalk">
          {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </h1>
      </div>

      <button
        type="button"
        onClick={onListen}
        className="group relative flex w-full items-center gap-5 overflow-hidden rounded-panel border border-white/10 bg-gradient-to-br from-signal/25 via-white/[0.05] to-transparent p-6 text-left outline-none backdrop-blur-xl transition-transform duration-300 hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-chalk text-void shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:scale-105">
          <Play aria-hidden className="size-7 translate-x-0.5 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[1.3rem] font-semibold tracking-[-0.01em] text-chalk">
            Put a record on
          </span>
          <span className="mt-1 block text-[0.9rem] text-mist">
            Search, queue and listen — just you.
          </span>
        </span>
      </button>

      {activeRoom && (
        <button
          type="button"
          onClick={() => onEnterRoom(activeRoom.id)}
          className="flex w-full items-center gap-3 rounded-card border border-white/10 bg-white/[0.04] p-4 text-left outline-none transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9rem] font-medium text-chalk">
              Back to {activeRoom.name}
            </span>
            <span className="text-[0.75rem] text-mist">Pick up where the room is</span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-3 gap-3">
        {quickLinks.map((link) => {
          const Icon = link.icon
          return (
            <button
              key={link.key}
              type="button"
              onClick={link.onClick}
              className="flex flex-col gap-2 rounded-card border border-white/10 bg-white/[0.03] p-4 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <Icon aria-hidden className="size-5 text-signal-bright" />
              <span className="text-[0.9rem] font-medium text-chalk">{link.label}</span>
              <span className="text-[0.72rem] text-dusk">{link.hint}</span>
            </button>
          )
        })}
      </div>

      {recent.length > 0 && (
        <Shelf title="Recently played" onMore={onListen}>
          {recent.slice(0, 12).map((track, index) => (
            <button
              key={`${track.ref}-${index}`}
              type="button"
              onClick={onListen}
              className="group flex w-36 shrink-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <span className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.05] ring-1 ring-inset ring-white/10">
                {track.artwork ? (
                  <img
                    src={track.artwork}
                    alt=""
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-dusk">
                    <Disc3 aria-hidden className="size-6" />
                  </span>
                )}
              </span>
              <span className="truncate text-[0.82rem] font-medium text-chalk">{track.title}</span>
              {track.artist && (
                <span className="-mt-1.5 truncate text-[0.72rem] text-dusk">{track.artist}</span>
              )}
            </button>
          ))}
        </Shelf>
      )}

      {playlists.length > 0 && (
        <Shelf title="Your playlists" onMore={onPlaylists}>
          {playlists.map((playlist) => {
            const cover = playlist.tracks.find((t) => t.artwork)?.artwork ?? null
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={onPlaylists}
                className="group flex w-36 shrink-0 flex-col gap-2 rounded-lg text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br from-signal/30 to-signal-deep/40 ring-1 ring-inset ring-white/10">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="grid size-full place-items-center text-chalk/80">
                      <ListMusic aria-hidden className="size-6" />
                    </span>
                  )}
                </span>
                <span className="truncate text-[0.82rem] font-medium text-chalk">{playlist.name}</span>
                <span className="-mt-1.5 truncate text-[0.72rem] text-dusk">
                  {playlist.tracks.length} track{playlist.tracks.length === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </Shelf>
      )}

      {rooms.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[1.05rem] font-semibold text-chalk">Your rooms</h2>
            <button
              type="button"
              onClick={onOpenRooms}
              className="rounded-full text-[0.8rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:underline"
            >
              See all
            </button>
          </div>
          <div className="scrollbar-none flex gap-3 overflow-x-auto pb-2">
            {rooms.slice(0, 8).map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => onEnterRoom(room.id)}
                className="flex w-40 shrink-0 flex-col gap-2 rounded-card border border-white/10 bg-white/[0.03] p-3 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="grid h-20 place-items-center rounded-lg bg-gradient-to-br from-signal/30 to-signal-deep/40">
                  <Users aria-hidden className="size-6 text-chalk/80" />
                </span>
                <span className="truncate text-[0.85rem] font-medium text-chalk">{room.name}</span>
                <span className="truncate text-[0.72rem] capitalize text-dusk">
                  {room.type} · {room.members.length} member{room.members.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Rooms — Discord's shape, in the main column.
 *
 * The rail lives in the sidebar now, so here it is the selected room's channels
 * (Listen, Watch, Chat, Voice) beside who is here — or, with no room picked, a
 * plain account of what a room is and the two ways in.
 */
function RoomsContent({
  rooms,
  loading,
  activeRoom,
  activeRoomId,
  present,
  roster,
  watchViewers,
  onSelectRoom,
  onListen,
  onWatch,
  onChat,
  onLeave,
  onCreate,
  onJoin,
}: {
  rooms: Room[]
  loading: boolean
  activeRoom: Room | undefined
  activeRoomId: string | null
  present: { id: string; name: string; you: boolean }[]
  roster: Record<string, Present[]>
  watchViewers: number
  onSelectRoom: (roomId: string) => void
  onListen: () => void
  onWatch: () => void
  onChat: () => void
  onLeave: () => void
  onCreate: () => void
  onJoin: (code: string) => Promise<Room>
}) {
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [copied, setCopied] = useState(false)

  const shared = activeRoom && !activeRoom.personal

  const submitJoin = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim() || joining) return
    setJoining(true)
    try {
      await onJoin(code.trim())
      setCode('')
    } catch {
      /* The field stays, the person tries again. */
    } finally {
      setJoining(false)
    }
  }

  const copyCode = () => {
    if (!activeRoom) return
    void navigator.clipboard?.writeText(activeRoom.slug).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (!activeRoom) {
    return (
      <div className="py-2">
        <div className="mx-auto max-w-xl rounded-panel border border-white/10 bg-white/[0.03] p-8 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-signal/30 to-signal-deep/40 text-chalk">
            <Users aria-hidden className="size-6" />
          </span>
          <h1 className="mt-5 font-display text-[clamp(1.5rem,4vw,2rem)] font-semibold tracking-[-0.02em] text-chalk">
            Rooms are for listening together
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[0.92rem] leading-relaxed text-mist">
            A room is like a Discord server: everyone in it hears the same song at the same moment.
            Watch videos in sync, share your screen, chat, and hop into voice — across every device.
          </p>

          <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
            <button
              type="button"
              onClick={onCreate}
              className="w-full rounded-full bg-signal py-3 text-[0.9rem] font-semibold text-white outline-none transition-colors hover:bg-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Create a room
            </button>
            <form onSubmit={submitJoin} className="flex gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Have a code? Join a room"
                className="h-11 min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[0.88rem] text-chalk outline-none transition-colors placeholder:text-dusk focus:border-signal/60"
              />
              <button
                type="submit"
                disabled={joining || !code.trim()}
                className="shrink-0 rounded-full bg-white/10 px-5 text-[0.85rem] font-medium text-chalk outline-none transition-colors hover:bg-white/[0.16] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
              >
                Join
              </button>
            </form>
          </div>
        </div>

        {rooms.length > 0 && (
          <div className="mx-auto mt-8 max-w-xl">
            <h2 className="mb-3 font-display text-[1.05rem] font-semibold text-chalk">Your rooms</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {rooms.map((room) => {
                const online = roster[room.id]?.length ?? 0
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => onSelectRoom(room.id)}
                    className="flex items-center gap-3 rounded-card border border-white/10 bg-white/[0.03] p-3 text-left outline-none transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-signal to-signal-deep text-[0.85rem] font-semibold text-white">
                      {room.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.88rem] font-medium text-chalk">
                        {room.name}
                      </span>
                      <span className="block truncate text-[0.72rem] text-dusk">
                        {online > 0 ? `${online} online now` : `${room.members.length} members`}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {loading && rooms.length === 0 && (
          <div className="mx-auto mt-8 h-40 max-w-xl animate-pulse rounded-panel bg-white/[0.04]" />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-2 sm:h-[calc(100svh-10rem)] sm:min-h-[26rem] sm:flex-row">
      <div className="flex min-h-[24rem] min-w-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[1.1rem] font-semibold tracking-[-0.015em] text-chalk">
              {activeRoom.name}
            </h2>
            {shared ? (
              <button
                type="button"
                onClick={copyCode}
                className="mt-0.5 flex items-center gap-1.5 rounded text-[0.72rem] text-dusk outline-none transition-colors hover:text-mist focus-visible:text-mist"
              >
                <span className="font-mono">{activeRoom.slug}</span>
                {copied ? (
                  <Check aria-hidden className="size-3 text-emerald-400" />
                ) : (
                  <Copy aria-hidden className="size-3" />
                )}
              </button>
            ) : (
              <p className="mt-0.5 text-[0.72rem] text-dusk">Your private space</p>
            )}
          </div>
          {shared && (
            <button
              type="button"
              onClick={onLeave}
              aria-label="Leave room"
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/12 text-mist outline-none transition-colors hover:border-signal/40 hover:text-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-2 pb-1 pt-1 text-[0.66rem] uppercase tracking-[0.18em] text-dusk">
            Channels
          </p>
          <ChannelRow icon={Disc3} name="Listen" hint="Shared queue" onClick={onListen} />
          <ChannelRow
            icon={Clapperboard}
            name="Watch"
            hint={watchViewers > 0 ? `${watchViewers} watching` : 'Together, in sync'}
            live={watchViewers > 0}
            onClick={onWatch}
          />
          <ChannelRow icon={MessagesSquare} name="Chat" hint="Talk to the room" onClick={onChat} />

          <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-mist">
                <Users aria-hidden className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.9rem] font-medium text-chalk">Voice</span>
                <span className="block truncate text-[0.72rem] text-dusk">Hop in to talk</span>
              </span>
            </span>
            <VoiceButton roomId={activeRoomId} />
          </div>
        </div>
      </div>

      {shared && (
        <aside className="hidden w-56 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] lg:flex">
          <p className="border-b border-white/[0.07] px-4 py-3.5 text-[0.66rem] uppercase tracking-[0.18em] text-dusk">
            Here — {present.length}
          </p>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {present.map((member) => (
              <div key={member.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <span className="relative shrink-0">
                  <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.7rem] font-semibold text-white">
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0d0d0f]" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.85rem] text-chalk">
                  {member.name}
                  {member.you && <span className="text-dusk"> · you</span>}
                </span>
                {activeRoom.ownerId === member.id && (
                  <span className="shrink-0 text-[0.6rem] uppercase tracking-wide text-dusk">Host</span>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

/** One "channel" row in a room — an activity you tap into. */
function ChannelRow({
  icon: Icon,
  name,
  hint,
  live = false,
  onClick,
}: {
  icon: typeof Disc3
  name: string
  hint: string
  live?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-mist transition-colors group-hover:text-chalk">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9rem] font-medium text-chalk">{name}</span>
        <span className="block truncate text-[0.72rem] text-dusk">{hint}</span>
      </span>
      {live && <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />}
    </button>
  )
}

/** A titled horizontal shelf of cards — the streaming-app "row". */
function Shelf({
  title,
  onMore,
  children,
}: {
  title: string
  onMore?: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[1.05rem] font-semibold text-chalk">{title}</h2>
        {onMore && (
          <button
            type="button"
            onClick={onMore}
            className="rounded-full text-[0.8rem] text-mist outline-none transition-colors hover:text-chalk focus-visible:underline"
          >
            See all
          </button>
        )}
      </div>
      <div className="scrollbar-none -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">{children}</div>
    </div>
  )
}
