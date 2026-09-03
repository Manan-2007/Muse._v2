/** A pen as it travels over the wire — position and heading, nothing else. */
export type WirePen = {
  x: number
  z: number
  angle: number
  onDesk: boolean
}

export type GamePlayer = { id: string; name: string }

/**
 * The match, as the server tells it.
 *
 * Whose turn it is and what the score is live here rather than on either
 * client, because they are the two things players would otherwise be able to
 * disagree about. Where the pens are is also here, but only at rest — the
 * movement between one resting position and the next arrives separately, as
 * `game:motion`, and is never worth storing.
 */
export type GameSnapshot = {
  roomId: string
  epoch: number
  seq: number
  players: [GamePlayer, GamePlayer]
  turn: 0 | 1
  scores: [number, number]
  pens: [WirePen, WirePen]
  winner: 0 | 1 | null
  settling: boolean
}

/** Live pen positions mid-flick, relayed from whoever is taking the turn. */
export type GameMotion = {
  roomId: string
  epoch: number
  pens: [WirePen, WirePen]
}
