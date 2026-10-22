import type { Card } from '../../web/src/game/card'
import type { MeldEnd } from '../../web/src/game/meld-play'
import type { Meld, TurnPhase } from '../../web/src/game/state'

/** Client → host (lobby + play). Seat identity comes from the session, not these fields. */
export type ClientMessage =
  | {
    type: 'join'
    password: string
    displayName: string
    avatarId: string
    /** Rebind an existing seat after disconnect. */
    reconnectToken?: string
  }
  | { type: 'setReady'; ready: boolean }
  | { type: 'leave' }
  | { type: 'startGame' }
  /** Host-only: fixed lobby size (3–5). */
  | { type: 'setTableSize'; tableSize: number }
  /** Host-only: turn an open seat into a bot. */
  | { type: 'addBot' }
  /** Host-only: turn a bot seat back into open. */
  | { type: 'removeBot' }
  | { type: 'declareBuy'; elapsedMs: number }
  | { type: 'claimDiscard' }
  | { type: 'drawDeck' }
  | { type: 'discard'; cardId: string }
  | { type: 'goDown'; meldCardArrays: string[][] }
  | { type: 'extend'; meldId: string; cardId: string; side?: MeldEnd }
  | { type: 'undoExtend' }
  | { type: 'keepWild' }
  | { type: 'continueRound' }
  | { type: 'reorderHand'; orderedIds: string[] }
  | { type: 'revealOpening' }

/** Host → client. */
export type ServerMessage =
  | {
    type: 'joined'
    seatIndex: number
    reconnectToken: string
    roomCode: string
  }
  | { type: 'roomState'; room: RoomPublicState }
  | { type: 'clientView'; view: ClientView }
  | { type: 'error'; message: string }
  | { type: 'kicked'; reason: string }
  | { type: 'roomClosed' }

export type RoomPhase = 'lobby' | 'playing' | 'closed'

export interface RoomSeatPublic {
  seatIndex: number
  displayName: string
  avatarId: string
  ready: boolean
  connected: boolean
  isAI: boolean
  /** Empty lobby slot — claimable by a joining human (or fillable as a bot). */
  isOpen: boolean
}

export interface RoomPublicState {
  roomCode: string
  phase: RoomPhase
  seats: RoomSeatPublic[]
  /** Host-chosen table size; lobby always has this many slots. */
  tableSize: number
  minPlayers: number
  maxPlayers: number
  /** Seat that created the room; may start when enough humans are seated. */
  hostSeatIndex: number | null
}

/** Fogged per-seat snapshot — never includes draw pile or other hands. */
export interface ClientView {
  seatIndex: number
  phase: TurnPhase
  roundIndex: number
  currentPlayerIndex: number
  roundLeaderIndex: number
  hasDrawnThisTurn: boolean
  lastDiscarderIndex: number | null
  /** Seats that have called buy (elapsedMs omitted). */
  buyCallerSeats: number[]
  tableMelds: Meld[]
  discardTop: Card | null
  discardCount: number
  drawCount: number
  ready: boolean[]
  roundVictorIndex: number | null
  lastError: string | null
  pendingWild: Card | null
  players: ClientPlayerView[]
  /** Only this seat's hand. */
  hand: Card[]
  extendHistoryLength: number
}

export interface ClientPlayerView {
  index: number
  displayName: string
  avatarId: string
  isAI: boolean
  handCount: number
  hasGoneDown: boolean
  cumulativeScore: number
  roundScores: number[]
}
