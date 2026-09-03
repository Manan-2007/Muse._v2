import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { AnimatePresence, motion } from 'framer-motion'
import { DoorOpen, LogOut, MessagesSquare, Plus, Settings2, Users } from 'lucide-react'

import { useAuth } from '@/features/auth/AuthContext'
import { ActivityStage } from '@/features/dashboard/hub/ActivityStage'
import { ACTIVITIES, type ActivityId } from '@/features/dashboard/hub/activities'
import { CharacterParty, type HubMember } from '@/features/dashboard/hub/CharacterParty'
import { Fireflies } from '@/features/dashboard/hub/Fireflies'
import { HubDrawer } from '@/features/dashboard/hub/HubDrawer'
import { HubRail, type RailItem } from '@/features/dashboard/hub/HubRail'
import { HubSettings } from '@/features/dashboard/hub/HubSettings'
import { RoomChip } from '@/features/dashboard/hub/RoomChip'
import { RoomList } from '@/features/dashboard/hub/RoomList'
import { SceneBackdrop } from '@/features/dashboard/hub/SceneBackdrop'
import { groundFor, usePreferences } from '@/features/dashboard/hub/usePreferences'
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
import { GamesStage } from '@/features/games/GamesStage'
import { StudyStage } from '@/features/study/StudyStage'
import { WatchStage } from '@/features/watch/WatchStage'
import { CreateRoomForm } from '@/features/dashboard/components/CreateRoomForm'
import { usePresence, type Present } from '@/features/rooms/usePresence'
import { usePresenceWatch } from '@/features/rooms/usePresenceWatch'
import { useRooms } from '@/features/rooms/useRooms'
import { useEntrance } from '@/features/transition/EntranceContext'
import { usePointerTilt } from '@/hooks/usePointerTilt'
import { characterFor, hasRoster } from '@/lib/characters'
import { findScene, hasScenes } from '@/lib/scenes'

const EASE = [0.16, 1, 0.3, 1] as const

/** How many people stand in the scene before the rest are only a count. */
const MAX_ON_STAGE = 5

type Panel = 'rooms' | 'create' | 'settings'

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
  const { user } = useAuth()
  const { phase } = useEntrance()
  const { rooms, loading, error, create, join, setOnline } = useRooms()
  const { preferences, update } = usePreferences(user?.id)
  const tilt = usePointerTilt()

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
  /** Same, for the games page. */
  const [gamesOrigin, setGamesOrigin] = useState<DOMRect | null>(null)
  const [studyOrigin, setStudyOrigin] = useState<DOMRect | null>(null)

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

  /* Resolved, not the raw preference — with nothing chosen the hub derives a
     character from your user id, and that is what others must be told. */
  const myCharacter = user ? characterFor(user.id, preferences.characterId)?.id : undefined

  usePresence(presenceRooms, handlePresence, myCharacter)

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

  const activeRoom = activeRoomId ? rooms.find((room) => room.id === activeRoomId) : undefined

  /* The room vanishing under you — deleted, or membership revoked — should put
     you back in the solo hub rather than leave a dangling id. */
  useEffect(() => {
    if (activeRoomId && !loading && !activeRoom) setActiveRoomId(null)
  }, [activeRoomId, activeRoom, loading, setActiveRoomId])

  const scene = findScene(preferences.sceneId)

  const party = useMemo<HubMember[]>(() => {
    if (!user) return []

    const you: HubMember = {
      id: user.id,
      name: user.name,
      status: 'here',
      owner: activeRoom?.ownerId === user.id,
      you: true,
      character: characterFor(user.id, preferences.characterId),
    }

    if (!activeRoom) return [you]

    /* Ownership still comes from the room — presence knows who is here, not
       what they are to the room. */
    const others = (roster[activeRoom.id] ?? [])
      .filter((person) => person.userId !== user.id)
      .slice(0, MAX_ON_STAGE - 1)
      .map<HubMember>((person) => ({
        id: person.userId,
        name: person.name,
        status: 'here',
        owner: activeRoom.ownerId === person.userId,
        you: false,
        /* Their choice, carried on presence. Falls back to the id-derived one
           for anyone on an older client that isn't announcing it. */
        character: characterFor(person.userId, person.characterId),
      }))

    /* You stand in the middle of your own party rather than at one end. */
    const line = [...others]
    line.splice(Math.floor(line.length / 2), 0, you)
    return line
  }, [user, activeRoom, roster, preferences.characterId])

  /* Watching is a room event, not a private toggle — the hub has to know a
     session is live so it can badge the button and offer the way in. */
  const watch = useWatchPulse(activeRoomId)

  const leftItems: RailItem[] = activeRoom
    ? ACTIVITIES.map((entry) => ({
        key: entry.id,
        label: entry.label,
        hint:
          entry.id === 'watch' && watch.viewers.length > 0
            ? `${watch.viewers.length} watching`
            : entry.hint,
        icon: entry.icon,
        active: activity === entry.id,
        live: entry.id === 'watch' && watch.viewers.length > 0,
        /* The music and watch pages open out of this control — see
           `MusicStage` and `WatchStage`. */
        onClick: (from) => {
          if (entry.id === 'music') setMusicOrigin(from ?? null)
          if (entry.id === 'watch') setWatchOrigin(from ?? null)
          if (entry.id === 'games') setGamesOrigin(from ?? null)
        if (entry.id === 'study') setStudyOrigin(from ?? null)
          setActivity(entry.id)
        },
      }))
    : [
        {
          key: 'create',
          label: 'Create Room',
          hint: 'Start your own space',
          icon: Plus,
          onClick: () => setPanel('create'),
        },
        {
          key: 'join',
          label: 'Join Room',
          hint: rooms.length > 0 ? `${rooms.length} waiting` : 'Walk into one',
          icon: DoorOpen,
          onClick: () => setPanel('rooms'),
        },
      ]

  const rightItems: RailItem[] = [
    ...(activeRoom
      ? [
          {
            key: 'talk',
            label: 'Chat & call',
            hint:
              call.othersOnCall > 0
                ? `${call.othersOnCall} on the call`
                : chat.unread > 0
                  ? `${chat.unread} new`
                  : 'Talk to the room',
            icon: MessagesSquare,
            active: sideOpen,
            live: call.othersOnCall > 0 || chat.unread > 0,
            onClick: () => setSideOpen((open) => !open),
          } satisfies RailItem,
        ]
      : []),
    {
      key: 'rooms',
      label: activeRoom ? 'Switch room' : 'Your rooms',
      hint: activeRoom ? 'Somewhere else' : 'Everywhere you belong',
      icon: Users,
      onClick: () => setPanel('rooms'),
    },
    {
      key: 'settings',
      label: 'Settings',
      hint: 'Backdrop and character',
      icon: Settings2,
      onClick: () => setPanel('settings'),
    },
    ...(activeRoom
      ? [
          {
            key: 'leave',
            label: 'Leave',
            hint: 'Back to the hub',
            icon: LogOut,
            danger: true,
            /* Leaving clears the activity too — see `setActiveRoomId`. */
            onClick: () => setActiveRoomId(null),
          } satisfies RailItem,
        ]
      : []),
  ]

  /* While the corridor plays the hub stays mounted but invisible, so the room
     fetch is already in flight by the time it hands off. */
  const revealed = phase !== 'tunnel'
  const needsAssets = !hasScenes || !hasRoster

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
      className="fixed inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: revealed ? 1 : 0 }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <SceneBackdrop scene={scene} tilt={tilt} />
      <Fireflies className="pointer-events-none absolute inset-0 size-full" />

      {revealed && (
        <>
          <CharacterParty
            members={party}
            tilt={tilt}
            ground={groundFor(preferences, scene?.id)}
            insetRight={inset}
            /* Every activity opens a stage that covers the hub completely, so
               the party behind it has nothing to draw for. */
            covered={activity !== null}
          />

          <HubRail side="left" items={leftItems} />
          <HubRail side="right" items={rightItems} insetRight={inset} />

          {/*
            Everything along the bottom of the room, in one column against the
            left edge.
            
            It used to centre itself across the whole width while the music dock
            pinned itself to the right, and the two had no idea about each
            other — so the moment a track was on, the dock grew leftward into
            the middle and sat on top of the room code. Anchored to opposite
            edges they cannot reach each other at any width, which is a
            property of the layout rather than a number that has to be kept
            in step. The notice stacks above rather than beside, so it cannot
            collide with the chip either.
          */}
          <div
            className="pointer-events-none absolute bottom-6 left-0 z-20 flex flex-col items-start gap-2.5 px-6 transition-[right] duration-500 ease-glass"
            /*
             * Stops short of both the panel and the dock's corner.
             * 
             * Capping its own width was not enough on its own: as the window
             * narrows, the space between the two edges shrinks faster than any
             * fixed cap, so the two zones still met somewhere around a
             * thousand pixels. Ending the box where the dock's territory
             * begins means the gap is held open by the layout at every width,
             * and the chip inside truncates instead of running underneath.
             */
            style={{ right: `calc(${inset}rem + min(23rem, 34%))` }}
          >
            {(error || needsAssets) && (
              <div className="hidden max-w-xs md:block">
                {error ? (
                  <p
                    role="alert"
                    className="glass-pill-ink rounded-card px-4 py-3 text-[0.78rem] leading-relaxed text-signal-bright"
                  >
                    {error}
                  </p>
                ) : (
                  <p className="glass-pill-ink rounded-card px-4 py-3 text-[0.78rem] leading-relaxed text-mist">
                    {!hasScenes && !hasRoster
                      ? 'No backdrops or characters yet — Settings shows where to drop them.'
                      : !hasScenes
                        ? 'No backdrops yet — Settings shows where to drop them.'
                        : 'No characters yet — Settings shows where to drop them.'}
                  </p>
                )}
              </div>
            )}

            {activeRoom && (
              /* One line, never two. Wrapping made this cluster tall enough
                 to reach up into the band the nameplates sit in, and two
                 things that are each correctly placed still collide if they
                 are allowed to grow into each other. The chip truncates
                 instead, which is the one of the two that can afford to. */
              <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-2.5">
                <RoomChip room={activeRoom} />
                <VoiceButton roomId={activeRoomId} />
              </div>
            )}
          </div>
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
              onClose={() => setActivity(null)}
              insetRight={inset}
              panelOpen={sideOpen}
              unread={chat.unread}
              onTogglePanel={() => setSideOpen((open) => !open)}
            />
          </ErrorBoundary>
        )}

        {activity === 'games' && activeRoom && (
          /*
           * Bounded like the others: this one runs a physics loop and a WebGL
           * canvas, and a throw inside `useFrame` would otherwise take the hub
           * down with it rather than just the game.
           */
          <ErrorBoundary
            key="games"
            resetKey={activeRoom.id}
            fallback={(_error, reset) => (
              <StageFailed
                title="The game hit a problem"
                onRetry={reset}
                onClose={() => setActivity(null)}
              />
            )}
          >
            <GamesStage
              roomId={activeRoom.id}
              selfId={user?.id}
              members={party.map((member) => ({
                id: member.id,
                name: member.name,
                you: member.you,
              }))}
              origin={gamesOrigin}
              onClose={() => setActivity(null)}
              insetRight={inset}
              panelOpen={sideOpen}
              unread={chat.unread}
              onTogglePanel={() => setSideOpen((open) => !open)}
            />
          </ErrorBoundary>
        )}

        {activity === 'study' && activeRoom && (
          <ErrorBoundary
            key="study"
            resetKey={activeRoom.id}
            fallback={(_error, reset) => (
              <StageFailed
                title="The study page hit a problem"
                onRetry={reset}
                onClose={() => setActivity(null)}
              />
            )}
          >
            <StudyStage
              roomId={activeRoom.id}
              selfId={user?.id}
              origin={studyOrigin}
              onClose={() => setActivity(null)}
              insetRight={inset}
              panelOpen={sideOpen}
              unread={chat.unread}
              onTogglePanel={() => setSideOpen((open) => !open)}
            />
          </ErrorBoundary>
        )}

        {/* Anything not yet built says so rather than miming. */}
        {activity &&
          activity !== 'watch' &&
          activity !== 'music' &&
          activity !== 'games' &&
          activity !== 'study' && (
          <ActivityStage id={activity} onClose={() => setActivity(null)} />
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

        {panel === 'settings' && (
          <HubDrawer
            key="settings"
            title="Settings"
            subtitle="Yours, not the room's — everyone dresses their own hub."
            onClose={() => setPanel(null)}
          >
            <HubSettings
              preferences={preferences}
              onChange={update}
              activeCharacterId={
                user ? characterFor(user.id, preferences.characterId)?.id : undefined
              }
            />
          </HubDrawer>
        )}
      </AnimatePresence>
    </motion.main>
    </MusicProvider>
  )
}
