import {Suspense, useCallback, useMemo} from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Gamepad2, Loader2, MessagesSquare, Trophy, WifiOff, X } from 'lucide-react'

import { CoverAmbience } from '@/features/music/CoverAmbience'
import { useGameSession } from '@/features/games/useGameSession'
import type { GamePlayer, WirePen } from '@/features/games/types'
import { usePageVisible } from '@/hooks/usePageVisible'
import { cn } from '@/lib/utils'
import { lazyChunk } from '@/lib/lazyChunk'

const PenFightTable = lazyChunk(() => import('@/features/games/penfight/PenFightTable'))

const EASE = [0.16, 1, 0.3, 1] as const

/** Everyone standing in the room, as the lobby needs them. */
export type GameCandidate = { id: string; name: string; you: boolean }

/**
 * The Play stage.
 *
 * Same shape as Watch and Listen — full screen, portalled, opening out of the
 * control that summoned it — because it is the same kind of thing: an activity
 * the whole room is in, not a panel inside the hub.
 */
export function GamesStage({
  roomId,
  selfId,
  members,
  onClose,
  insetRight = 0,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  origin,
}: {
  roomId: string
  selfId: string | undefined
  members: GameCandidate[]
  onClose: () => void
  insetRight?: number
  panelOpen?: boolean
  onTogglePanel?: () => void
  unread?: number
  /** The control this opened from, so the reveal starts there. */
  origin?: DOMRect | null
}) {
  const { snapshot, motion: live, connected, send } = useGameSession(roomId, true)
  const visible = usePageVisible()

  const seat = useMemo<0 | 1 | null>(() => {
    if (!snapshot || !selfId) return null
    const index = snapshot.players.findIndex((player) => player.id === selfId)
    return index === 0 || index === 1 ? index : null
  }, [snapshot, selfId])

  /* Watching rather than playing is a first-class way to be here: the room is
     already together, and two people playing is three people watching. */
  const spectating = snapshot !== null && seat === null
  const myTurn = seat !== null && snapshot?.turn === seat && snapshot.winner === null

  const opponents = members.filter((member) => !member.you)

  const onMotion = useCallback(
    (pens: [WirePen, WirePen]) => send('game:motion', { pens }),
    [send],
  )
  const onSettled = useCallback(
    (pens: [WirePen, WirePen]) => send('game:settled', { pens }),
    [send],
  )

  const revealX = origin ? `${Math.round(origin.left + origin.width / 2)}px` : '50%'
  const revealY = origin ? `${Math.round(origin.top + origin.height / 2)}px` : '50%'

  return createPortal(
    <motion.div
      className="fixed left-0 top-0 z-[135] flex flex-col overflow-hidden bg-void transition-[padding] duration-500 ease-glass"
      style={{
        width: '100vw',
        height: '100dvh',
        paddingRight: `${insetRight}rem`,
        ['--reveal-x' as string]: revealX,
        ['--reveal-y' as string]: revealY,
        animation: 'stage-reveal 0.62s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <CoverAmbience palette={null} />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <span className="flex min-w-0 items-center gap-2">
          {snapshot && (
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 backdrop-blur-md">
              <span className="size-1.5 animate-signal-pulse rounded-full bg-emerald-400" />
              <span className="text-[0.72rem] text-chalk">
                {spectating ? 'Watching' : 'Playing'}
              </span>
            </span>
          )}
          {!connected && (
            <span className="flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1.5 text-signal-bright">
              <WifiOff aria-hidden className="size-3.5" />
              <span className="text-[0.72rem]">Reconnecting…</span>
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {onTogglePanel && (
            <button
              type="button"
              onClick={onTogglePanel}
              aria-label="Chat and call"
              aria-pressed={panelOpen}
              className={cn(
                'relative flex h-11 items-center gap-2 rounded-full border px-3.5 outline-none backdrop-blur-md sm:h-9 transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
                panelOpen
                  ? 'border-signal/50 bg-signal/15 text-chalk'
                  : 'border-white/10 bg-white/[0.04] text-chalk hover:bg-white/[0.1]',
              )}
            >
              <MessagesSquare aria-hidden className="size-4" />
              {unread > 0 && !panelOpen && (
                <span className="min-w-4 rounded-full bg-signal px-1 text-[0.62rem] font-semibold leading-4 text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Leave the game"
            className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-chalk outline-none backdrop-blur-md sm:size-9 transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <X aria-hidden className="size-4" />
          </button>
        </span>
      </header>

      {snapshot === null ? (
        <Lobby opponents={opponents} onStart={(opponent) => send('game:start', { opponent })} />
      ) : (
        <Match
          players={snapshot.players}
          scores={snapshot.scores}
          turn={snapshot.turn}
          winner={snapshot.winner}
          seat={seat}
          myTurn={myTurn}
          spectating={spectating}
        >
          <Suspense
            fallback={
              <span className="grid h-full place-items-center text-[0.8rem] text-mist">
                <Loader2 aria-hidden className="size-5 animate-spin" />
              </span>
            }
          >
            <PenFightTable
              pens={snapshot.pens}
              seat={seat ?? 0}
              myTurn={myTurn}
              canPlay={seat !== null && snapshot.winner === null}
              live={live}
              onFlick={() => undefined}
              onMotion={onMotion}
              onSettled={onSettled}
              paused={!visible}
            />
          </Suspense>
        </Match>
      )}

      {snapshot?.winner !== null && snapshot !== undefined && snapshot !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
          <button
            type="button"
            onClick={() => send('game:end')}
            className="pointer-events-auto rounded-full bg-chalk px-5 py-2.5 text-[0.82rem] font-medium text-void outline-none transition-transform duration-300 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Clear the desk
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  )
}

/** Nothing on the desk yet — pick who you are playing. */
function Lobby({
  opponents,
  onStart,
}: {
  opponents: GameCandidate[]
  onStart: (opponent: GamePlayer) => void
}) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
      <span className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-chalk backdrop-blur-md">
        <Gamepad2 aria-hidden className="size-6" />
      </span>
      <h2 className="mt-5 font-display text-[1.6rem] font-semibold tracking-[-0.02em] text-chalk">
        Pen Fight
      </h2>
      <p className="mt-2 max-w-sm text-center text-[0.86rem] leading-relaxed text-mist">
        Pull your pen back and let go. Knock theirs off the desk to take the round — but flick
        too hard and yours goes over the edge instead. First to three.
      </p>

      {opponents.length === 0 ? (
        <p className="mt-7 rounded-card border border-dashed border-white/15 bg-white/[0.02] px-5 py-4 text-center text-[0.82rem] text-mist">
          Nobody else is in the room yet. Pen fight takes two.
        </p>
      ) : (
        <div className="mt-7 w-full max-w-sm">
          <span className="block text-center text-[0.68rem] uppercase tracking-[0.16em] text-dusk">
            Who are you playing?
          </span>
          <div className="mt-3 flex flex-col gap-2">
            {opponents.map((opponent) => (
              <button
                key={opponent.id}
                type="button"
                onClick={() => onStart({ id: opponent.id, name: opponent.name })}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left outline-none backdrop-blur-md transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-[0.8rem] font-semibold text-chalk">
                  {opponent.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.9rem] text-chalk">
                  {opponent.name}
                </span>
                <span className="text-[0.72rem] text-dusk">Challenge</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** The desk, with the score above it and whose turn it is underneath. */
function Match({
  players,
  scores,
  turn,
  winner,
  seat,
  myTurn,
  spectating,
  children,
}: {
  players: [GamePlayer, GamePlayer]
  scores: [number, number]
  turn: 0 | 1
  winner: 0 | 1 | null
  seat: 0 | 1 | null
  myTurn: boolean
  spectating: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center gap-5 px-6 pb-2">
        {players.map((player, index) => (
          <span key={player.id} className="flex items-center gap-2.5">
            <span
              className={cn(
                'size-2 rounded-full',
                index === 0 ? 'bg-[#2f6fd0]' : 'bg-[#d0452f]',
                turn === index && winner === null && 'animate-signal-pulse',
              )}
            />
            <span
              className={cn(
                'text-[0.82rem]',
                index === seat ? 'font-medium text-chalk' : 'text-mist',
              )}
            >
              {index === seat ? 'You' : player.name}
            </span>
            <span className="font-mono text-[1rem] tabular-nums text-chalk">
              {scores[index]}
            </span>
          </span>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">{children}</div>

      <div className="flex h-14 shrink-0 items-center justify-center px-6">
        {winner !== null ? (
          <span className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 backdrop-blur-md">
            <Trophy aria-hidden className="size-4 text-amber-300" />
            <span className="text-[0.84rem] text-chalk">
              {winner === seat ? 'You win the desk' : `${players[winner].name} takes it`}
            </span>
          </span>
        ) : (
          <span className="text-[0.84rem] text-mist">
            {spectating
              ? `${players[turn].name} to flick`
              : myTurn
                ? 'Your turn — pull your pen back and let go'
                : `Waiting on ${players[turn].name}`}
          </span>
        )}
      </div>
    </div>
  )
}
