import {
  claimDiscardAsDraw,
  continueAfterRound,
  createGame,
  declareBuy,
  discard,
  drawFromDeck,
  extendMeld,
  goDown,
  keepPendingWild,
  reorderHand,
  revealOpeningDiscard,
  setReady,
  undoExtend,
  type GameState,
  type PlayerSetup,
} from '../../web/src/game/state'
import { DEFAULT_WILD_RULES } from '../../web/src/game/meld-play'
import { hashPassword, randomSaltHex, verifyPassword } from './password'
import type {
  ClientMessage,
  RoomPhase,
  RoomPublicState,
  RoomSeatPublic,
  ServerMessage,
} from './protocol'
import { projectView } from './project-view'
import { generateReconnectToken } from './reconnect-token'

export const MIN_ROOM_PLAYERS = 3
export const MAX_ROOM_PLAYERS = 5
/** Auto-act if the current seat is silent this long. */
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000
/** Max client messages accepted per seat per rolling second. */
export const DEFAULT_RATE_LIMIT_PER_SEC = 12
/** Close room after sitting empty this long. */
export const DEFAULT_EMPTY_ROOM_MS = 30 * 60_000

export interface HostSink {
  send(sessionId: string, msg: ServerMessage): void
}

export interface HostSession {
  sessionId: string
}

interface SeatRecord {
  seatIndex: number
  displayName: string
  avatarId: string
  ready: boolean
  reconnectToken: string
  sessionId: string | null
  isAI: boolean
}

export interface HostRuntimeSnapshot {
  roomCode: string
  passwordSalt: string
  passwordHash: string
  phase: RoomPhase
  seats: SeatRecord[]
  hostSeatIndex: number | null
  game: GameState | null
  lastActivityMs: number
  lastSeatActionMs: number
  createdAtMs: number
}

export interface HostRuntimeOptions {
  roomCode: string
  passwordSalt: string
  passwordHash: string
  now?: () => number
  idleTimeoutMs?: number
  rateLimitPerSec?: number
  emptyRoomMs?: number
  /** Seeded snapshot restore. */
  snapshot?: Omit<HostRuntimeSnapshot, 'roomCode' | 'passwordSalt' | 'passwordHash'>
}

/**
 * Transport-agnostic room authority. Durable Objects and a future client-host
 * both drive this with connect/message/disconnect + a sink for outbound messages.
 */
export class HostRuntime {
  readonly roomCode: string
  private readonly passwordSalt: string
  private readonly passwordHash: string
  private readonly now: () => number
  private readonly idleTimeoutMs: number
  private readonly rateLimitPerSec: number
  private readonly emptyRoomMs: number

  private phase: RoomPhase = 'lobby'
  private seats: SeatRecord[] = []
  private hostSeatIndex: number | null = null
  private game: GameState | null = null
  private lastActivityMs: number
  private lastSeatActionMs: number
  private createdAtMs: number
  private sink: HostSink | null = null

  /** sessionId → recent message timestamps (ms) for rate limiting */
  private readonly msgTimes = new Map<string, number[]>()

  constructor(opts: HostRuntimeOptions) {
    this.roomCode = opts.roomCode
    this.passwordSalt = opts.passwordSalt
    this.passwordHash = opts.passwordHash
    this.now = opts.now ?? Date.now
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.rateLimitPerSec = opts.rateLimitPerSec ?? DEFAULT_RATE_LIMIT_PER_SEC
    this.emptyRoomMs = opts.emptyRoomMs ?? DEFAULT_EMPTY_ROOM_MS
    const t = this.now()
    this.lastActivityMs = t
    this.lastSeatActionMs = t
    this.createdAtMs = t
    if (opts.snapshot) {
      this.phase = opts.snapshot.phase
      this.seats = opts.snapshot.seats.map((s) => ({ ...s, sessionId: null }))
      this.hostSeatIndex = opts.snapshot.hostSeatIndex
      this.game = opts.snapshot.game
      this.lastActivityMs = opts.snapshot.lastActivityMs
      this.lastSeatActionMs = opts.snapshot.lastSeatActionMs
      this.createdAtMs = opts.snapshot.createdAtMs
    }
  }

  static async create(roomCode: string, password: string, now?: () => number): Promise<HostRuntime> {
    const salt = await randomSaltHex()
    const hash = await hashPassword(password, salt)
    return new HostRuntime({
      roomCode,
      passwordSalt: salt,
      passwordHash: hash,
      now,
    })
  }

  setSink(sink: HostSink | null): void {
    this.sink = sink
  }

  serialize(): HostRuntimeSnapshot {
    return {
      roomCode: this.roomCode,
      passwordSalt: this.passwordSalt,
      passwordHash: this.passwordHash,
      phase: this.phase,
      seats: this.seats.map((s) => ({ ...s })),
      hostSeatIndex: this.hostSeatIndex,
      game: this.game,
      lastActivityMs: this.lastActivityMs,
      lastSeatActionMs: this.lastSeatActionMs,
      createdAtMs: this.createdAtMs,
    }
  }

  static fromSnapshot(snap: HostRuntimeSnapshot, now?: () => number): HostRuntime {
    return new HostRuntime({
      roomCode: snap.roomCode,
      passwordSalt: snap.passwordSalt,
      passwordHash: snap.passwordHash,
      now,
      snapshot: snap,
    })
  }

  onConnect(session: HostSession): void {
    this.touch()
    // Wait for join message; nothing to send yet.
    void session
  }

  async onMessage(sessionId: string, msg: ClientMessage): Promise<void> {
    this.touch()
    if (!this.allowRate(sessionId)) {
      this.send(sessionId, { type: 'error', message: 'Too many messages' })
      return
    }

    if (msg.type === 'join') {
      await this.handleJoin(sessionId, msg)
      return
    }

    const seat = this.seatBySession(sessionId)
    if (!seat) {
      this.send(sessionId, { type: 'error', message: 'Join the room first' })
      return
    }

    switch (msg.type) {
      case 'leave':
        this.handleLeave(sessionId, seat)
        return
      case 'setReady':
        this.handleSetReady(seat, msg.ready)
        return
      case 'startGame':
        this.handleStartGame(seat)
        return
      default:
        this.handlePlay(sessionId, seat, msg)
    }
  }

  onDisconnect(sessionId: string): void {
    this.touch()
    const seat = this.seatBySession(sessionId)
    if (seat) {
      seat.sessionId = null
      this.broadcastRoom()
      if (this.game) this.sendViewToSeat(seat)
    }
    this.msgTimes.delete(sessionId)
  }

  /**
   * Transport should call periodically (e.g. DO alarm).
   * Returns ms until next check, or null if the room should be destroyed.
   */
  onAlarm(): number | null {
    const t = this.now()
    if (this.connectedCount() === 0 && t - this.lastActivityMs >= this.emptyRoomMs) {
      this.phase = 'closed'
      return null
    }

    if (this.phase === 'playing' && this.game) {
      if (t - this.lastSeatActionMs >= this.idleTimeoutMs) {
        this.applyIdleAction()
      }
    }

    return Math.min(15_000, this.idleTimeoutMs)
  }

  roomPublicState(): RoomPublicState {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      seats: this.seats.map((s): RoomSeatPublic => ({
        seatIndex: s.seatIndex,
        displayName: s.displayName,
        avatarId: s.avatarId,
        ready: s.ready,
        connected: s.sessionId !== null,
        isAI: s.isAI,
      })),
      minPlayers: MIN_ROOM_PLAYERS,
      maxPlayers: MAX_ROOM_PLAYERS,
      hostSeatIndex: this.hostSeatIndex,
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private touch(): void {
    this.lastActivityMs = this.now()
  }

  private touchSeatAction(): void {
    this.lastSeatActionMs = this.now()
  }

  private connectedCount(): number {
    return this.seats.filter((s) => s.sessionId !== null).length
  }

  private allowRate(sessionId: string): boolean {
    const t = this.now()
    const windowStart = t - 1000
    const prev = (this.msgTimes.get(sessionId) ?? []).filter((x) => x >= windowStart)
    if (prev.length >= this.rateLimitPerSec) {
      this.msgTimes.set(sessionId, prev)
      return false
    }
    prev.push(t)
    this.msgTimes.set(sessionId, prev)
    return true
  }

  private send(sessionId: string, msg: ServerMessage): void {
    this.sink?.send(sessionId, msg)
  }

  private seatBySession(sessionId: string): SeatRecord | undefined {
    return this.seats.find((s) => s.sessionId === sessionId)
  }

  private broadcastRoom(): void {
    const room = this.roomPublicState()
    for (const s of this.seats) {
      if (s.sessionId) this.send(s.sessionId, { type: 'roomState', room })
    }
  }

  private broadcastViews(): void {
    if (!this.game) return
    for (const s of this.seats) {
      if (s.sessionId) this.sendViewToSeat(s)
    }
  }

  private sendViewToSeat(seat: SeatRecord): void {
    if (!this.game || !seat.sessionId) return
    this.send(seat.sessionId, {
      type: 'clientView',
      view: projectView(this.game, seat.seatIndex),
    })
  }

  private async handleJoin(
    sessionId: string,
    msg: Extract<ClientMessage, { type: 'join' }>,
  ): Promise<void> {
    if (this.phase === 'closed') {
      this.send(sessionId, { type: 'error', message: 'Room is closed' })
      return
    }

    const ok = await verifyPassword(msg.password, this.passwordSalt, this.passwordHash)
    if (!ok) {
      this.send(sessionId, { type: 'error', message: 'Wrong password' })
      return
    }

    if (msg.reconnectToken) {
      const existing = this.seats.find((s) => s.reconnectToken === msg.reconnectToken)
      if (existing) {
        if (existing.sessionId && existing.sessionId !== sessionId) {
          this.send(existing.sessionId, { type: 'kicked', reason: 'Reconnected elsewhere' })
        }
        existing.sessionId = sessionId
        existing.displayName = msg.displayName.trim() || existing.displayName
        if (msg.avatarId) existing.avatarId = msg.avatarId
        this.send(sessionId, {
          type: 'joined',
          seatIndex: existing.seatIndex,
          reconnectToken: existing.reconnectToken,
          roomCode: this.roomCode,
        })
        this.broadcastRoom()
        if (this.game) this.sendViewToSeat(existing)
        return
      }
      this.send(sessionId, { type: 'error', message: 'Invalid reconnect token' })
      return
    }

    if (this.phase !== 'lobby') {
      this.send(sessionId, { type: 'error', message: 'Game already in progress' })
      return
    }

    if (this.seats.length >= MAX_ROOM_PLAYERS) {
      this.send(sessionId, { type: 'error', message: 'Room is full' })
      return
    }

    const name = msg.displayName.trim() || `Player ${this.seats.length + 1}`
    const seatIndex = this.seats.length
    const token = generateReconnectToken()
    const seat: SeatRecord = {
      seatIndex,
      displayName: name,
      avatarId: msg.avatarId || 'human-1',
      ready: false,
      reconnectToken: token,
      sessionId,
      isAI: false,
    }
    this.seats.push(seat)
    if (this.hostSeatIndex === null) this.hostSeatIndex = seatIndex

    this.send(sessionId, {
      type: 'joined',
      seatIndex,
      reconnectToken: token,
      roomCode: this.roomCode,
    })
    this.broadcastRoom()
  }

  private handleLeave(sessionId: string, seat: SeatRecord): void {
    if (this.phase === 'playing') {
      seat.sessionId = null
      this.broadcastRoom()
      return
    }
    this.seats = this.seats
      .filter((s) => s.seatIndex !== seat.seatIndex)
      .map((s, i) => ({ ...s, seatIndex: i }))
    // Lobby host is always the lowest seat (creator tends to be seat 0).
    this.hostSeatIndex = this.seats.length > 0 ? 0 : null
    this.send(sessionId, { type: 'kicked', reason: 'Left the room' })
    this.broadcastRoom()
  }

  private handleSetReady(seat: SeatRecord, ready: boolean): void {
    if (this.phase === 'lobby') {
      seat.ready = ready
      this.broadcastRoom()
      return
    }
    if (this.phase === 'playing' && this.game && this.game.phase === 'round-prep') {
      this.commitGame(setReady(this.game, seat.seatIndex, ready))
      if (this.game && this.game.ready.every(Boolean)) {
        this.commitGame(revealOpeningDiscard(this.game))
      }
    }
  }

  private handleStartGame(seat: SeatRecord): void {
    if (this.phase !== 'lobby') {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Game already started' })
      }
      return
    }
    if (seat.seatIndex !== this.hostSeatIndex) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Only the host can start' })
      }
      return
    }
    if (this.seats.length < MIN_ROOM_PLAYERS) {
      if (seat.sessionId) {
        this.send(seat.sessionId, {
          type: 'error',
          message: `Need at least ${MIN_ROOM_PLAYERS} players`,
        })
      }
      return
    }
    if (!this.seats.every((s) => s.ready)) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'All players must be ready' })
      }
      return
    }

    const setups: PlayerSetup[] = this.seats.map((s) => ({
      displayName: s.displayName,
      isAI: s.isAI,
      avatarId: s.avatarId,
    }))
    this.game = createGame(setups, { roundLeaderIndex: 0 })
    // Lobby ready already satisfied; mark round-prep ready so opening can proceed
    // via per-seat setReady during round-prep (hands just dealt).
    this.phase = 'playing'
    this.touchSeatAction()
    this.broadcastRoom()
    this.broadcastViews()
  }

  private handlePlay(
    sessionId: string,
    seat: SeatRecord,
    msg: ClientMessage,
  ): void {
    if (this.phase !== 'playing' || !this.game) {
      this.send(sessionId, { type: 'error', message: 'Not in a game' })
      return
    }

    const g = this.game
    let next: GameState = g

    switch (msg.type) {
      case 'declareBuy':
        next = declareBuy(g, seat.seatIndex, msg.elapsedMs)
        break
      case 'claimDiscard':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = claimDiscardAsDraw(g)
        break
      case 'drawDeck':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = drawFromDeck(g)
        break
      case 'discard':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = discard(g, msg.cardId)
        break
      case 'goDown':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = goDown(g, msg.meldCardArrays)
        break
      case 'extend':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = extendMeld(g, msg.meldId, msg.cardId, msg.side, DEFAULT_WILD_RULES)
        break
      case 'undoExtend':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = undoExtend(g)
        break
      case 'keepWild':
        if (g.currentPlayerIndex !== seat.seatIndex) {
          this.send(sessionId, { type: 'error', message: 'Not your turn' })
          return
        }
        next = keepPendingWild(g)
        break
      case 'continueRound':
        next = continueAfterRound(g)
        break
      case 'reorderHand':
        next = reorderHand(g, seat.seatIndex, msg.orderedIds)
        break
      case 'revealOpening':
        // Only used if all ready without auto-reveal path
        if (!g.ready.every(Boolean)) {
          this.send(sessionId, { type: 'error', message: 'Not everyone is ready' })
          return
        }
        next = revealOpeningDiscard(g)
        break
      case 'setReady':
      case 'join':
      case 'leave':
      case 'startGame':
        return
      default:
        this.send(sessionId, { type: 'error', message: 'Unknown action' })
        return
    }

    if (next.lastError) {
      this.send(sessionId, { type: 'error', message: next.lastError })
      return
    }

    this.commitGame(next)
  }

  private commitGame(next: GameState): void {
    this.game = next
    this.touchSeatAction()
    this.broadcastViews()
    if (next.phase === 'game-end') {
      // Keep phase playing until clients leave; room stays open for rematch later
    }
  }

  private applyIdleAction(): void {
    if (!this.game) return
    const g = this.game
    const seat = g.currentPlayerIndex

    if (g.phase === 'round-prep') {
      let s = g
      if (!s.ready[seat]) s = setReady(s, seat, true)
      // Also ready any disconnected seats
      for (const rec of this.seats) {
        if (!rec.sessionId && !s.ready[rec.seatIndex]) {
          s = setReady(s, rec.seatIndex, true)
        }
      }
      if (s.ready.every(Boolean)) s = revealOpeningDiscard(s)
      this.commitGame(s)
      return
    }

    if (g.phase === 'buy-window' || g.phase === 'draw') {
      this.commitGame(drawFromDeck(g))
      return
    }

    if (g.phase === 'play-or-discard') {
      const hand = g.players[seat]?.hand
      if (hand && hand.length > 0) {
        this.commitGame(discard(g, hand[hand.length - 1].id))
      }
      return
    }

    if (g.phase === 'round-end') {
      this.commitGame(continueAfterRound(g))
    }
  }
}
