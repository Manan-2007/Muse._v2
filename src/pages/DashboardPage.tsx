import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { AnimatePresence, motion } from 'framer-motion'
import { Disc3, Home, ListMusic, LogOut, MessagesSquare, Play, Plus, Search, Users } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { BottomNav, type NavItem } from '@/components/layout/BottomNav'
import { Logo } from '@/components/layout/Logo'
import { ACTIVITIES, type ActivityId } from '@/features/dashboard/hub/activities'
import { HubDrawer } from '@/features/dashboard/hub/HubDrawer'
import { MuseBackdrop } from '@/features/dashboard/hub/MuseBackdrop'
import { RoomList } from '@/features/dashboard/hub/RoomList'
import { VoiceButton } from '@/features/dashboard/hub/VoiceButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { StageFailed } from '@/features/dashboard/hub/StageFailed'
import { MusicDock } from '@/features/music/MusicDock'
import { MusicProvider } from '@/features/music/MusicProvider'
import { MusicStage } from '@/features/music/MusicStage'
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

type Panel = 'rooms' | 'create'

/**
 * The hub.
 *
 * One screen, fixed, no scroll. Everything the room can do is reachable from
 * where you stand, which is the whole premise — the moment this page scrolls it
 * stops reading as a place and starts reading as a document.
 *
 * Depth that genuinely needs a list (rooms, settings) goes into a drawer, so
 * scrolling always happens inside something that is visibly a panel.
 */
export function DashboardPage() {
  const { user, signOut } = useAuth()
  const { phase } = useEntrance()
  const { rooms, loading, error, create, join, setOnline } = useRooms()

  /*
   * Which room you're standing in, and what you're doing, live in the URL.
   *
   * Held as component state these survived nothing: a refresh dropped you back
   * to the room list, and the back button — with no history entry to pop —
   * walked out of the hub entirely rather than closing what was open. Both read
   * as the app losing your place, because it was.
   *
   * The panel deliberately stays local. It's a disclosure on the current
   * screen, not a place, and putting it in history would mean back-button
   * presses spent dismissing a drawer.
   */
  const [params, setParams] = useSearchParams()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [sideOpen, setSideOpen] = useState(false)
  /** Where the music page should open from — the box of whatever summoned it. */
  const [musicOrigin, setMusicOrigin] = useState<DOMRect | null>(null)
  /** Same, for the watch page. */
  const [watchOrigin, setWatchOrigin] = useState<DOMRect | null>(null)

  const activeRoomId = params.get('room')
  /* Validated rather than cast — `?activity=` is user-editable, and an
     unknown id would otherwise be handed straight to `findActivity`. */
  const activityParam = params.get('activity')
  const activity = ACTIVITIES.some((entry) => entry.id === activityParam)
    ? (activityParam as ActivityId)
    : null

  /*
   * Whether you have stepped out of the room's listening session.
   *
   * Personal, and not the room's business: leaving closes your own socket
   * session and stops your audio, while everyone else carries on. Opening
   * Listen again clears it and rejoins wherever the room has reached.
   */
  const [leftMusic, setLeftMusic] = useState(false)
  useEffect(() => {
    if (activity === 'music') setLeftMusic(false)
  }, [activity])

  /*
   * Entering, switching, or leaving a room — in one URL write.
   *
   * It has to be one write. These setters go through `setSearchParams`, whose
   * updater reads the *committed* location, and React batches everything in a
   * click handler before committing any of it. So two calls in the same
   * handler both start from the same "before" state and the second silently
   * discards the first — which is exactly what happened when picking a room
   * set `?room=` and then cleared the activity: the room never landed and
   * clicking a room appeared to do nothing at all.
   *
   * Clearing the activity belongs here regardless. An activity only means
   * something inside a room, so arriving in one starts you in the room itself
   * rather than in whatever the last room happened to have open.
   */
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
    (id: ActivityId | null) => {
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

  /*
   * Chat and the call are mounted for as long as you are in the room, not for
   * as long as the panel is open — closing the panel must not drop the call or
   * stop messages arriving, it just hides them.
   */
  const chat = useChat(activeRoomId)
  const call = useMeshCall(activeRoomId)

  /*
   * Which face is floating over the screen, by socket id — or 'self'.
   *
   * Held here rather than in the panel because the whole point of it is to
   * outlive the panel: you pop somebody out so you can shut the panel and
   * still see them while a film is on.
   */
  const [poppedOut, setPoppedOut] = useState<string | null>(null)

  /*
   * The floating face has to be a face that is still there.
   *
   * Peers leave, connections drop, the call ends, and the room changes — each
   * of which can strand a window showing a stream that will never produce
   * another frame. Cleared here rather than in each of those paths, so a new
   * way to leave cannot forget to do it.
   */
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
  }, [
    poppedOut,
    call.localStream,
    call.peers,
    call.muted,
    call.cameraOff,
    call.hasCamera,
    user?.name,
  ])

  useEffect(() => {
    if (poppedOut && (call.status !== 'live' || !floating)) setPoppedOut(null)
  }, [poppedOut, call.status, floating])

  /* Nothing to talk to once you have left. */
  useEffect(() => {
    if (!activeRoomId) setSideOpen(false)
  }, [activeRoomId])

  /*
   * Whether the panel can sit *beside* the room rather than over it.
   *
   * Below this the two do not both fit, and insetting anyway is worse than
   * useless: the right-hand rail was being pushed a full panel-width inward
   * on a screen barely wider than the panel, which put every button on it off
   * the left edge of the phone and on top of the other rail. Over a certain
   * narrowness the only honest layout is an overlay.
   */
  const sideBySide = useMediaQuery('(min-width: 60rem)')
  const inset = sideOpen && sideBySide ? PANEL_WIDTH_REM : 0

  /*
   * Presence follows the room you are *standing in*, not every room you belong
   * to.
   *
   * The socket join is what puts you in the presence map, so subscribing to all
   * of them would mean anyone with the dashboard open counts as being in every
   * shared room at once — and the party around you would fill with people who
   * only had a tab open. Walking in is the signal.
   */
  const presenceRooms = useMemo(() => (activeRoomId ? [activeRoomId] : []), [activeRoomId])

  /**
   * Who is in the room right now, straight from presence.
   *
   * Kept separately from `room.members` on purpose. That list is fetched once
   * when the page loads, so anyone who joins the room afterwards is present but
   * missing from it — and filtering presence through a stale cache is what made
   * two people in the same room see different parties depending on who loaded
   * first. Presence carries names, so it can stand on its own.
   */
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

  /*
   * Every room you belong to, watched read-only, so the list is right before
   * you walk into any of them. Previously these counts came from the one REST
   * fetch on load and went stale the moment anybody moved — which is why a
   * room with someone already in it looked empty until you joined it.
   */
  const watchedRooms = useMemo(() => rooms.map((room) => room.id).sort(), [rooms])
  usePresenceWatch(watchedRooms, handlePresence)

  /* Leaving stops the updates, so the last-known list would otherwise stick
     around and keep showing a live count for a room you walked out of. */
  const lastPresenced = useRef<string | null>(null)
  useEffect(() => {
    const previous = lastPresenced.current
    if (previous && previous !== activeRoomId) {
      setOnline(previous, [])
      setRoster((current) => ({ ...current, [previous]: [] }))
    }
    lastPresenced.current = activeRoomId
  }, [activeRoomId, setOnline])

  /* A fixed single screen. Locking the document is what stops a stray wheel
     event from revealing a strip of page under the hub. */
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  /*
   * A room held outside the list.
   *
   * The personal (solo) room is deliberately absent from `rooms`, and a
   * deep-linked or freshly opened room may not be in it yet either. This holds
   * whichever room is active but unlisted, so the rest of the page resolves it
   * the same as any other.
   */
  const [detachedRoom, setDetachedRoom] = useState<Room | null>(null)

  const activeRoom = activeRoomId
    ? (rooms.find((room) => room.id === activeRoomId) ??
      (detachedRoom?.id === activeRoomId ? detachedRoom : undefined))
    : undefined

  /*
   * Resolve an active room that is not in the list, and bail on one that has
   * genuinely gone. Fetching first is what lets the solo room — which is never
   * listed — survive a refresh instead of bouncing you back to the hub; a room
   * that was deleted or that you were removed from answers 404/403 and clears.
   */
  useEffect(() => {
    if (!activeRoomId || loading || activeRoom) return
    let cancelled = false
    fetchRoom(activeRoomId)
      .then((room) => {
        if (!cancelled) setDetachedRoom(room)
      })
      .catch(() => {
        if (!cancelled) setActiveRoomId(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeRoomId, activeRoom, loading, setActiveRoomId])

  /** Which content tab the home shell is showing. */
  const [tab, setTab] = useState<'home' | 'rooms'>('home')
  /** Which section the solo player opens on, set by the navbar. */
  const [musicView, setMusicView] = useState<'search' | 'liked' | 'playlists'>('search')

  /* Open the solo player: find-or-create the personal room, then walk straight
     into its Listen stage in a single URL write. The navbar passes which
     section to land on (Search vs Library). */
  const openSolo = useCallback(
    async (view: 'search' | 'liked' | 'playlists' = 'search') => {
      setMusicView(view)
      const room = await fetchPersonalRoom()
      setDetachedRoom(room)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.set('room', room.id)
          next.set('activity', 'music')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  /*
   * Who is in the room right now, as a small set of faces — no 3D characters,
   * just initials on a chip with a live dot. You are always first.
   */
  const present = useMemo(() => {
    if (!user || !activeRoom) return []
    const here = roster[activeRoom.id] ?? []
    const others = here.filter((person) => person.userId !== user.id)
    return [
      { id: user.id, name: user.name, you: true },
      ...others.map((person) => ({ id: person.userId, name: person.name, you: false })),
    ]
  }, [user, activeRoom, roster])

  /* Watching is a room event, not a private toggle — the hub has to know a
     session is live so it can badge the button and offer the way in. */
  const watch = useWatchPulse(activeRoomId)

  /* Enter a shared room and drop straight into its listening stage. */
  const enterRoom = useCallback(
    (roomId: string) => {
      setTab('rooms')
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.set('room', roomId)
          next.set('activity', 'music')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  /* The one navbar, Muse._v1's bottom tab bar. Home and Rooms switch the
     browse content; Search and Library open the solo player on that section. */
  const navItems: NavItem[] = [
    {
      key: 'home',
      label: 'Home',
      icon: Home,
      active: tab === 'home' && !activity,
      onClick: () => setTab('home'),
    },
    {
      key: 'search',
      label: 'Search',
      icon: Search,
      active: activity === 'music' && musicView === 'search',
      onClick: () => void openSolo('search'),
    },
    {
      key: 'library',
      label: 'Library',
      icon: Disc3,
      active: activity === 'music' && musicView !== 'search',
      onClick: () => void openSolo('liked'),
    },
    {
      key: 'rooms',
      label: 'Rooms',
      icon: Users,
      active: tab === 'rooms' && !activity,
      live: Boolean(activeRoom && (chat.unread > 0 || call.othersOnCall > 0)) || watch.viewers.length > 0,
      onClick: () => setTab('rooms'),
    },
  ]

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name.split(' ')[0]

  /* While the corridor plays the hub stays mounted but invisible, so the room
     fetch is already in flight by the time it hands off. */
  const revealed = phase !== 'tunnel'

  return (
    <MusicProvider
      roomId={activeRoom?.id ?? null}
      /* A film brings its own soundtrack, and someone who closed the dock has
         asked to be left out — both pause this client without touching the
         room, so the queue and everyone else's playback survive. */
      enabled={activity !== 'watch' && !leftMusic}
    >
    {/* Not visible, and not optional: this is the only surface the browser
        extension and this page can both see. See ExtensionBridge. */}
    <ExtensionBridge roomId={activeRoom?.id ?? null} roomName={activeRoom?.name ?? null} />

    <motion.main
      className="fixed inset-0 flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: revealed ? 1 : 0 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <MuseBackdrop />

      {revealed && (
        <>
          {/* Top bar: the mark, and who you are. */}
          <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={() => setTab('home')}
              className="flex items-center gap-2.5 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <Logo />
              <span className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-chalk">
                Muse<span className="text-signal">.</span>
              </span>
            </button>

            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                title={user?.name}
                className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-signal to-signal-deep text-[0.75rem] font-semibold text-white"
              >
                {user?.name.slice(0, 1).toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-full border border-white/12 px-3.5 py-1.5 text-[0.8rem] text-mist outline-none transition-colors hover:border-white/25 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                Sign out
              </button>
            </div>
          </header>

          {/* Scrollable content — the home dashboard, or your rooms. */}
          <div
            data-lenis-prevent
            className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-28 sm:px-8"
          >
            <div className="mx-auto w-full max-w-3xl">
              {tab === 'home' ? (
                <HomeContent
                  greeting={greeting}
                  firstName={firstName}
                  rooms={rooms}
                  activeRoom={activeRoom}
                  onListen={() => void openSolo('search')}
                  onLibrary={() => void openSolo('liked')}
                  onPlaylists={() => void openSolo('playlists')}
                  onOpenRooms={() => setTab('rooms')}
                  onEnterRoom={enterRoom}
                />
              ) : (
                <RoomsContent
                  rooms={rooms}
                  loading={loading}
                  activeRoom={activeRoom}
                  activeRoomId={activeRoomId}
                  onEnter={enterRoom}
                  onCreate={() => setPanel('create')}
                  onJoin={async (code) => {
                    const room = await join(code)
                    enterRoom(room.id)
                    return room
                  }}
                  onOpenChat={() => setSideOpen(true)}
                  onLeave={() => setActiveRoomId(null)}
                />
              )}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="pointer-events-none absolute inset-x-0 top-16 z-20 mx-auto max-w-sm px-6 text-center text-[0.8rem] text-signal-bright"
            >
              {error}
            </p>
          )}

          <BottomNav items={navItems} insetRight={inset} />
        </>
      )}

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
              /* No button to grow out of here — the toast isn't one. */
              setWatchOrigin(null)
              setActivity('watch')
              watch.dismiss()
            }}
            onDismiss={watch.dismiss}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activity === 'watch' && activeRoom && (
          <WatchStage
            key="watch"
            origin={watchOrigin}
            roomId={activeRoom.id}
            selfId={user?.id}
            onClose={() => setActivity(null)}
            insetRight={inset}
            panelOpen={sideOpen}
            unread={chat.unread}
            onTogglePanel={() => setSideOpen((open) => !open)}
          />
        )}

        {activity === 'music' && activeRoom && (
          /*
           * Bounded, because this screen drives a third-party player whose
           * failures arrive as un-stacked cross-origin errors. Without this a
           * bad video takes the hub down with it and leaves a black page.
           */
          <ErrorBoundary
            key="music"
            resetKey={activeRoom.id}
            fallback={(_error, reset) => (
              <StageFailed
                title="The music page hit a problem"
                onRetry={reset}
                onClose={() => setActivity(null)}
              />
            )}
          >
            <MusicStage
              origin={musicOrigin}
              selfId={user?.id}
              initialView={musicView}
              onClose={() => setActivity(null)}
              insetRight={inset}
              panelOpen={sideOpen}
              unread={chat.unread}
              onTogglePanel={() => setSideOpen((open) => !open)}
            />
          </ErrorBoundary>
        )}

      </AnimatePresence>

      {/*
        The music keeps going when you leave its page — that is the point of
        it living above this screen. Hidden while the record view is open (it
        is the same session, full size) and while a film is on, which pauses
        the music outright rather than layering two soundtracks.
      */}
      {activeRoom && (
        <MusicDock
          visible={activity !== 'music' && activity !== 'watch' && !leftMusic}
          onOpen={(from) => {
            setMusicOrigin(from ?? null)
            setActivity('music')
          }}
          onLeave={() => setLeftMusic(true)}
          insetRight={inset}
        />
      )}

      <AnimatePresence>
        {sideOpen && activeRoom && (
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
        {panel === 'rooms' && (
          <HubDrawer
            key="rooms"
            title="Your rooms"
            subtitle="Walk into one and everyone who's there stands with you."
            onClose={() => setPanel(null)}
          >
            {loading ? (
              <div className="h-40 animate-pulse rounded-card bg-white/[0.04]" />
            ) : (
              <RoomList
                rooms={rooms}
                activeRoomId={activeRoom?.id}
                onWalkIn={(room) => {
                  setActiveRoomId(room.id)
                  setPanel(null)
                }}
                onJoin={async (code) => {
                  const room = await join(code)
                  /* Straight in — you typed a code to be somewhere, not to add
                     a row to a list. */
                  setActiveRoomId(room.id)
                  setPanel(null)
                  return room
                }}
              />
            )}
          </HubDrawer>
        )}

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
                /* Straight into it — creating a room and then having to find it
                   in a list is a step nobody wants. */
                setActiveRoomId(room.id)
                setPanel(null)
                return room
              }}
            />
          </HubDrawer>
        )}

      </AnimatePresence>
    </motion.main>
    </MusicProvider>
  )
}

/**
 * Home — Muse._v1's dashboard, music-first.
 *
 * A greeting, one big invitation to start listening on your own, the shortcuts
 * that used to be quick links, and a glance at the rooms you belong to. Solo is
 * the headline; rooms are one tap away rather than the whole screen.
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

  /* The shelves — your recent tracks and playlists, drawn from your personal
     room. Fetched here so Home reads like a streaming app's front page rather
     than a launcher. Tapping opens the player. */
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

      {/* The one invitation that matters: put something on, just for you. */}
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
                  <img src={track.artwork} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
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
                    <img src={cover} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
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
 * Rooms — the social half, kept to its own tab so Home stays about the music.
 */
function RoomsContent({
  rooms,
  loading,
  activeRoom,
  activeRoomId,
  onEnter,
  onCreate,
  onJoin,
  onOpenChat,
  onLeave,
}: {
  rooms: Room[]
  loading: boolean
  activeRoom: Room | undefined
  activeRoomId: string | null
  onEnter: (roomId: string) => void
  onCreate: () => void
  onJoin: (code: string) => Promise<Room>
  onOpenChat: () => void
  onLeave: () => void
}) {
  return (
    <div className="space-y-6 py-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.1rem)] font-semibold tracking-[-0.02em] text-chalk">
          Rooms
        </h1>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-2 rounded-full bg-chalk px-4 py-2 text-[0.85rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <Plus aria-hidden className="size-4" />
          New room
        </button>
      </div>

      {activeRoom && !activeRoom.personal && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-signal/30 bg-signal/[0.08] p-4">
          <span className="size-2 shrink-0 animate-signal-pulse rounded-full bg-signal" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.9rem] font-medium text-chalk">
              You&apos;re in {activeRoom.name}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onEnter(activeRoom.id)}
            className="rounded-full bg-chalk px-3.5 py-1.5 text-[0.8rem] font-medium text-void outline-none transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            aria-label="Chat & call"
            className="grid size-9 place-items-center rounded-full border border-white/12 text-chalk outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <MessagesSquare aria-hidden className="size-4" />
          </button>
          <VoiceButton roomId={activeRoomId} />
          <button
            type="button"
            onClick={onLeave}
            aria-label="Leave room"
            className="grid size-9 place-items-center rounded-full border border-white/12 text-mist outline-none transition-colors hover:border-signal/40 hover:text-signal-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <LogOut aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-card bg-white/[0.04]" />
      ) : (
        <RoomList
          rooms={rooms}
          activeRoomId={activeRoom?.id}
          onWalkIn={(room) => onEnter(room.id)}
          onJoin={onJoin}
        />
      )}
    </div>
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
