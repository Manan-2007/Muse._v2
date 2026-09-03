import type { Server, Socket } from 'socket.io'

import { assertMembership } from '../services/room.service.js'
import { socketUser } from './presence.gateway.js'

/**
 * Pen fight, across the room.
 *
 * The server does not simulate anything. A pen fight is strictly turn-based —
 * one person flicks, everything settles, then it is the other person's turn —
 * so the client whose turn it is runs the physics and reports where things
 * ended up, and this relays that to everyone else. Nobody is simulating in
 * parallel, so there is nothing to reconcile.
 *
 * What the server *does* own is the part players would otherwise be able to
 * disagree about: who is playing, whose turn it is, and the score. Those are
 * decided here and broadcast, so a client cannot award itself a point by
 * saying so, and a spectator arriving mid-match is told the same story
 * everyone else has.
 */

const gameRoom = (roomId: string) => `game:${roomId}`

type Player = { id: string; name: string }

type Pen = {
  x: number
  z: number
  angle: number
  onDesk: boolean
}

type Match = {
  /** Bumped whenever a new match starts, so stale events can be ignored. */
  epoch: number
  /** Incremented on every state change — the ordering guard. */
  seq: number
  players: [Player, Player]
  /** Index into `players` of whoever may flick right now. */
  turn: 0 | 1
  scores: [number, number]
  pens: [Pen, Pen]
  /** Set once somebody has won; the match stays readable but takes no input. */
  winner: 0 | 1 | null
  /** True while a flick is playing out and no new one may be accepted. */
  settling: boolean
}

/** Live matches, by room. Ephemeral on purpose — see the note below. */
const matches = new Map<string, Match>()

/**
 * Where the pens start a round.
 *
 * Facing each other across the desk, offset slightly so the opening shot is a
 * decision rather than a straight line — a perfectly aligned break would make
 * the first flick the same every single time.
 */
function openingPens(): [Pen, Pen] {
  return [
    { x: -0.06, z: 0.14, angle: 0.18, onDesk: true },
    { x: 0.06, z: -0.14, angle: Math.PI - 0.18, onDesk: true },
  ]
}

const WINNING_SCORE = 3

function snapshot(roomId: string, match: Match) {
  return {
    roomId,
    epoch: match.epoch,
    seq: match.seq,
    players: match.players,
    turn: match.turn,
    scores: match.scores,
    pens: match.pens,
    winner: match.winner,
    settling: match.settling,
  }
}

function publish(io: Server, roomId: string, match: Match) {
  match.seq += 1
  io.to(gameRoom(roomId)).emit('game:state', snapshot(roomId, match))
}

function roomIdFrom(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = (raw as { roomId?: unknown }).roomId
  return typeof value === 'string' ? value : null
}

function numberFrom(raw: unknown, key: string): number | null {
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A pen as sent by a client, rejected unless every field is sane. */
function penFrom(raw: unknown): Pen | null {
  if (typeof raw !== 'object' || raw === null) return null
  const x = numberFrom(raw, 'x')
  const z = numberFrom(raw, 'z')
  const angle = numberFrom(raw, 'angle')
  const onDesk = (raw as { onDesk?: unknown }).onDesk
  if (x === null || z === null || angle === null || typeof onDesk !== 'boolean') return null

  /* Clamped rather than trusted. A client reporting a pen a kilometre away
     would otherwise scroll it off everyone else's desk forever. */
  const limit = 2
  if (Math.abs(x) > limit || Math.abs(z) > limit) return null

  return { x, z, angle, onDesk }
}

export function attachGameGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    const state = socketUser(socket)
    if (!state) return

    const self: Player = { id: state.userId, name: state.name }

    /** Rooms whose table this socket is sitting at. */
    const seated = new Set<string>()
    /** Rooms this socket has already proved membership of. */
    const verified = new Set<string>()

    const may = async (roomId: string | null): Promise<boolean> => {
      if (!roomId) return false
      if (verified.has(roomId)) return true
      try {
        await assertMembership(state.userId, roomId)
        verified.add(roomId)
        return true
      } catch {
        return false
      }
    }

    socket.on('game:open', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return

      seated.add(roomId)
      await socket.join(gameRoom(roomId))

      const match = matches.get(roomId)
      if (match) socket.emit('game:state', snapshot(roomId, match))
      else socket.emit('game:state', null)
    })

    socket.on('game:close', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId) return
      seated.delete(roomId)
      await socket.leave(gameRoom(roomId))
    })

    /**
     * Start a match against someone else in the room.
     *
     * Deliberately not an invitation with an accept step. Everyone here is
     * already in the same room and already talking; a challenge that has to be
     * accepted is a dialog in the way of a game that takes thirty seconds.
     * Starting it puts it on everyone's screen, and the other player either
     * takes their turn or does not.
     */
    socket.on('game:start', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!(await may(roomId)) || !roomId) return

      const opponent = (raw as { opponent?: unknown }).opponent
      if (typeof opponent !== 'object' || opponent === null) return
      const opponentId = (opponent as { id?: unknown }).id
      const opponentName = (opponent as { name?: unknown }).name
      if (typeof opponentId !== 'string' || typeof opponentName !== 'string') return
      if (opponentId === self.id) return

      const existing = matches.get(roomId)
      /* One match per room at a time. A second table would need somewhere to
         put it, and the room only has the one desk. */
      if (existing && existing.winner === null) return

      const match: Match = {
        epoch: (existing?.epoch ?? 0) + 1,
        seq: 0,
        players: [self, { id: opponentId, name: opponentName }],
        turn: 0,
        scores: [0, 0],
        pens: openingPens(),
        winner: null,
        settling: false,
      }

      matches.set(roomId, match)
      publish(io, roomId, match)
    })

    /**
     * A flick, as it happens.
     *
     * Relayed rather than recorded: this is the live animation, arriving many
     * times a second while the pens are moving, and it is worth nothing once
     * they stop. Only the sender's own turn may produce these, so a second
     * player cannot shove the pens around on someone else's go.
     */
    socket.on('game:motion', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !seated.has(roomId)) return

      const match = matches.get(roomId)
      if (!match || match.winner !== null) return
      if (match.players[match.turn]?.id !== self.id) return

      const pens = (raw as { pens?: unknown }).pens
      if (!Array.isArray(pens) || pens.length !== 2) return
      const parsed = pens.map(penFrom)
      if (parsed.some((pen) => pen === null)) return

      /* Straight out to the others, not back to the sender — they are the one
         running the simulation and already know. */
      socket.to(gameRoom(roomId)).emit('game:motion', {
        roomId,
        epoch: match.epoch,
        pens: parsed as [Pen, Pen],
      })
    })

    /**
     * The pens have stopped. Score it and hand the turn over.
     *
     * The client reports *where things ended up*; the server decides what that
     * means. Splitting it this way is what stops a player claiming a point
     * they did not win, while still keeping the physics on the one machine
     * that ran it.
     */
    socket.on('game:settled', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !seated.has(roomId)) return

      const match = matches.get(roomId)
      if (!match || match.winner !== null) return

      const seat = match.players.findIndex((player) => player.id === self.id)
      if (seat !== match.turn) return

      const pens = (raw as { pens?: unknown }).pens
      if (!Array.isArray(pens) || pens.length !== 2) return
      const parsed = pens.map(penFrom)
      if (parsed.some((pen) => pen === null)) return

      match.pens = parsed as [Pen, Pen]

      /*
       * Scoring, which is the whole game in three lines: knocking the other
       * pen off wins the round, and flicking your own off loses it. Both at
       * once is a wash — it happens, and awarding it to nobody is fairer than
       * picking one.
       */
      const mineOff = !match.pens[seat]!.onDesk
      const theirsOff = !match.pens[seat === 0 ? 1 : 0]!.onDesk

      if (theirsOff && !mineOff) match.scores[seat] += 1
      else if (mineOff && !theirsOff) match.scores[seat === 0 ? 1 : 0] += 1

      const decided = theirsOff || mineOff
      if (decided) {
        /* A round is over, so the desk is reset for the next one. */
        match.pens = openingPens()
        if (match.scores[0] >= WINNING_SCORE) match.winner = 0
        else if (match.scores[1] >= WINNING_SCORE) match.winner = 1
      }

      /* The loser of a round opens the next one; otherwise play alternates. */
      match.turn = match.turn === 0 ? 1 : 0
      match.settling = false

      publish(io, roomId, match)
    })

    /** Clear the table — either player may, and anyone may once it is over. */
    socket.on('game:end', async (raw: unknown) => {
      const roomId = roomIdFrom(raw)
      if (!roomId || !seated.has(roomId)) return

      const match = matches.get(roomId)
      if (!match) return
      const playing = match.players.some((player) => player.id === self.id)
      if (!playing && match.winner === null) return

      matches.delete(roomId)
      io.to(gameRoom(roomId)).emit('game:state', null)
    })

    socket.on('disconnect', () => {
      seated.clear()
    })
  })
}
