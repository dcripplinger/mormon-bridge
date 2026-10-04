export type SeatSide = 'left' | 'right' | 'top'

export interface OpponentSeatPlacement {
  playerIndex: number
  side: SeatSide
  /** Index among seats sharing this side, in clockwise order. */
  sideIndex: number
  sideCount: number
}

/**
 * Place opponents around the table relative to the human at the bottom.
 * Order is clockwise by turn order (next player after human first).
 *
 * 3: left, right
 * 4: left, top, right
 * 5 landscape: left, top, top, right
 * 5 portrait: left, left, right, right (no top)
 */
export function placeOpponents(
  playerCount: number,
  humanIndex: number,
  portrait: boolean,
): OpponentSeatPlacement[] {
  if (playerCount < 3 || playerCount > 5) return []
  if (humanIndex < 0 || humanIndex >= playerCount) return []

  const clockwise: number[] = []
  for (let i = 1; i < playerCount; i++) {
    clockwise.push((humanIndex + i) % playerCount)
  }

  if (playerCount === 3) {
    return [
      seat(clockwise[0], 'left', 0, 1),
      seat(clockwise[1], 'right', 0, 1),
    ]
  }

  if (playerCount === 4) {
    return [
      seat(clockwise[0], 'left', 0, 1),
      seat(clockwise[1], 'top', 0, 1),
      seat(clockwise[2], 'right', 0, 1),
    ]
  }

  // 5 players
  if (portrait) {
    return [
      seat(clockwise[0], 'left', 0, 2),
      seat(clockwise[1], 'left', 1, 2),
      seat(clockwise[2], 'right', 0, 2),
      seat(clockwise[3], 'right', 1, 2),
    ]
  }

  return [
    seat(clockwise[0], 'left', 0, 1),
    seat(clockwise[1], 'top', 0, 2),
    seat(clockwise[2], 'top', 1, 2),
    seat(clockwise[3], 'right', 0, 1),
  ]
}

function seat(
  playerIndex: number,
  side: SeatSide,
  sideIndex: number,
  sideCount: number,
): OpponentSeatPlacement {
  return { playerIndex, side, sideIndex, sideCount }
}

/** Vertical position along left/right edge (percent of viewport height). */
export function seatEdgeTopPercent(placement: OpponentSeatPlacement): number {
  const { side, sideIndex, sideCount } = placement
  if (side === 'top') return 0
  if (sideCount === 1) return 46
  // Left: index 0 near human (lower), then upper. Right: clockwise hits upper first.
  if (side === 'left') {
    return sideIndex === 0 ? 66 : 30
  }
  return sideIndex === 0 ? 30 : 66
}

/** Horizontal position along top edge (percent of viewport width). */
export function seatEdgeLeftPercent(placement: OpponentSeatPlacement): number {
  const { side, sideIndex, sideCount } = placement
  if (side !== 'top') return 50
  if (sideCount === 1) return 50
  return sideIndex === 0 ? 34 : 66
}
