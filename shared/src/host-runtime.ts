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
import { decideBuy, runAIStep } from '../../web/src/game/ai'
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
/** Default lobby size when a room is created. */
export const DEFAULT_TABLE_SIZE = MIN_ROOM_PLAYERS
/** Auto-act if the current seat is silent this long. */
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000
/** Max client messages accepted per seat per rolling second. */
export const DEFAULT_RATE_LIMIT_PER_SEC = 12
/** Close room after sitting empty this long. */
export const DEFAULT_EMPTY_ROOM_MS = 30 * 60_000
/** Delay between host-driven AI steps while a bot should act. */
export const DEFAULT_AI_TICK_MS = 500
/** Periodic wake when nothing urgent is pending. */
export const DEFAULT_IDLE_ALARM_MS = 15_000

const BOT_AVATAR_IDS = ['b01', 'b02', 'b03', 'b04', 'b05', 'b06', 'b07', 'b08'] as const

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
  isOpen: boolean
}

export interface HostRuntimeSnapshot {
  roomCode: string
  passwordSalt: string
  passwordHash: string
  phase: RoomPhase
  tableSize: number
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
  aiTickMs?: number
  tableSize?: number
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
  private readonly aiTickMs: number

  private phase: RoomPhase = 'lobby'
  private tableSize: number = DEFAULT_TABLE_SIZE
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
    this.aiTickMs = opts.aiTickMs ?? DEFAULT_AI_TICK_MS
    const t = this.now()
    this.lastActivityMs = t
    this.lastSeatActionMs = t
    this.createdAtMs = t
    if (opts.snapshot) {
      this.phase = opts.snapshot.phase
      this.tableSize = clampTableSize(
        opts.snapshot.tableSize ?? opts.snapshot.seats.length ?? DEFAULT_TABLE_SIZE,
      )
      this.seats = opts.snapshot.seats.map((s) => ({
        ...s,
        sessionId: null,
        isOpen: s.isOpen ?? false,
      }))
      this.ensureLobbySlots()
      this.hostSeatIndex = opts.snapshot.hostSeatIndex
      this.game = opts.snapshot.game
      this.lastActivityMs = opts.snapshot.lastActivityMs
      this.lastSeatActionMs = opts.snapshot.lastSeatActionMs
      this.createdAtMs = opts.snapshot.createdAtMs
    } else {
      this.tableSize = clampTableSize(opts.tableSize ?? DEFAULT_TABLE_SIZE)
      this.seats = makeOpenSeats(this.tableSize)
    }
  }

  static async create(
    roomCode: string,
    password: string,
    now?: () => number,
    tableSize?: number,
  ): Promise<HostRuntime> {
    const salt = await randomSaltHex()
    const hash = await hashPassword(password, salt)
    return new HostRuntime({
      roomCode,
      passwordSalt: salt,
      passwordHash: hash,
      now,
      tableSize,
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
      tableSize: this.tableSize,
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
      case 'setTableSize':
        this.handleSetTableSize(seat, msg.tableSize)
        return
      case 'addBot':
        this.handleAddBot(seat)
        return
      case 'removeBot':
        this.handleRemoveBot(seat)
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
      if (this.needsAiTick()) {
        this.runAiTick()
      } else if (t - this.lastSeatActionMs >= this.idleTimeoutMs) {
        this.applyIdleAction()
      }
    }

    return this.wakeDelayMs()
  }

  /** Suggested delay until the next transport alarm wake. */
  wakeDelayMs(): number {
    if (this.phase === 'playing' && this.needsAiTick()) return this.aiTickMs
    return Math.min(DEFAULT_IDLE_ALARM_MS, this.idleTimeoutMs)
  }

  roomPublicState(): RoomPublicState {
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      seats: this.seats.map((s): RoomSeatPublic => ({
        seatIndex: s.seatIndex,
        displayName: s.displayName,
        avatarId: s.avatarId,
        ready: s.isAI ? true : s.ready,
        connected: s.sessionId !== null,
        isAI: s.isAI,
        isOpen: s.isOpen,
      })),
      tableSize: this.tableSize,
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

  private humanSeats(): SeatRecord[] {
    return this.seats.filter((s) => !s.isOpen && !s.isAI)
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

  private ensureLobbySlots(): void {
    if (this.phase !== 'lobby') return
    if (this.seats.length < this.tableSize) {
      const start = this.seats.length
      this.seats = [
        ...this.seats,
        ...makeOpenSeats(this.tableSize - this.seats.length).map((s, i) => ({
          ...s,
          seatIndex: start + i,
        })),
      ]
    } else if (this.seats.length > this.tableSize) {
      this.seats = this.seats.slice(0, this.tableSize).map((s, i) => ({ ...s, seatIndex: i }))
    } else {
      this.seats = this.seats.map((s, i) => ({ ...s, seatIndex: i }))
    }
  }

  private reassignHost(): void {
    const humans = this.humanSeats()
    this.hostSeatIndex = humans.length > 0 ? humans[0].seatIndex : null
  }

  private claimableSeat(): SeatRecord | undefined {
    return this.seats.find((s) => s.isOpen) ?? this.seats.find((s) => s.isAI)
  }

  private takenAvatarIds(): string[] {
    return this.seats.filter((s) => !s.isOpen).map((s) => s.avatarId)
  }

  private nextBotName(): string {
    const n = this.seats.filter((s) => s.isAI).length + 1
    return `Bot ${n}`
  }

  private fillSeatAsBot(seat: SeatRecord): void {
    const name = this.nextBotName()
    const avatarId = pickBotAvatar(this.takenAvatarIds())
    seat.isOpen = false
    seat.isAI = true
    seat.ready = true
    seat.sessionId = null
    seat.reconnectToken = ''
    seat.displayName = name
    seat.avatarId = avatarId
  }

  private clearSeatToOpen(seat: SeatRecord): void {
    seat.isOpen = true
    seat.isAI = false
    seat.ready = false
    seat.sessionId = null
    seat.reconnectToken = ''
    seat.displayName = ''
    seat.avatarId = ''
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
      if (existing && !existing.isOpen) {
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

    const already = this.seatBySession(sessionId)
    if (already) {
      this.send(sessionId, {
        type: 'joined',
        seatIndex: already.seatIndex,
        reconnectToken: already.reconnectToken,
        roomCode: this.roomCode,
      })
      this.broadcastRoom()
      return
    }

    const seat = this.claimableSeat()
    if (!seat) {
      this.send(sessionId, { type: 'error', message: 'Room is full' })
      return
    }

    const name = msg.displayName.trim() || `Player ${seat.seatIndex + 1}`
    const token = generateReconnectToken()
    seat.isOpen = false
    seat.isAI = false
    seat.displayName = name
    seat.avatarId = msg.avatarId || 'h01'
    seat.ready = false
    seat.reconnectToken = token
    seat.sessionId = sessionId
    if (this.hostSeatIndex === null) this.hostSeatIndex = seat.seatIndex

    this.send(sessionId, {
      type: 'joined',
      seatIndex: seat.seatIndex,
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
    this.clearSeatToOpen(seat)
    this.reassignHost()
    this.send(sessionId, { type: 'kicked', reason: 'Left the room' })
    this.broadcastRoom()
  }

  private handleSetReady(seat: SeatRecord, ready: boolean): void {
    if (seat.isOpen || seat.isAI) return
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

  private handleSetTableSize(seat: SeatRecord, tableSize: number): void {
    if (this.phase !== 'lobby') {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Game already started' })
      }
      return
    }
    if (seat.seatIndex !== this.hostSeatIndex) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Only the host can change table size' })
      }
      return
    }
    if (!Number.isInteger(tableSize) || tableSize < MIN_ROOM_PLAYERS || tableSize > MAX_ROOM_PLAYERS) {
      if (seat.sessionId) {
        this.send(seat.sessionId, {
          type: 'error',
          message: `Table size must be ${MIN_ROOM_PLAYERS}–${MAX_ROOM_PLAYERS}`,
        })
      }
      return
    }
    if (tableSize === this.tableSize) return

    if (tableSize > this.tableSize) {
      const extra = makeOpenSeats(tableSize - this.tableSize).map((s, i) => ({
        ...s,
        seatIndex: this.tableSize + i,
      }))
      this.seats = [...this.seats, ...extra]
      this.tableSize = tableSize
      this.broadcastRoom()
      return
    }

    for (let i = this.tableSize - 1; i >= tableSize; i--) {
      const s = this.seats[i]
      if (!s.isOpen && !s.isAI) {
        if (seat.sessionId) {
          this.send(seat.sessionId, {
            type: 'error',
            message: 'Cannot shrink: a player is in a seat that would be removed',
          })
        }
        return
      }
    }
    this.seats = this.seats.slice(0, tableSize).map((s, i) => ({ ...s, seatIndex: i }))
    this.tableSize = tableSize
    this.reassignHost()
    this.broadcastRoom()
  }

  private handleAddBot(seat: SeatRecord): void {
    if (this.phase !== 'lobby') {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Game already started' })
      }
      return
    }
    if (seat.seatIndex !== this.hostSeatIndex) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Only the host can add bots' })
      }
      return
    }
    const open = this.seats.find((s) => s.isOpen)
    if (!open) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'No open seats' })
      }
      return
    }
    this.fillSeatAsBot(open)
    this.broadcastRoom()
  }

  private handleRemoveBot(seat: SeatRecord): void {
    if (this.phase !== 'lobby') {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Game already started' })
      }
      return
    }
    if (seat.seatIndex !== this.hostSeatIndex) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Only the host can remove bots' })
      }
      return
    }
    let bot: SeatRecord | undefined
    for (let i = this.seats.length - 1; i >= 0; i--) {
      if (this.seats[i].isAI) {
        bot = this.seats[i]
        break
      }
    }
    if (!bot) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'No bots to remove' })
      }
      return
    }
    this.clearSeatToOpen(bot)
    this.broadcastRoom()
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
    if (this.tableSize < MIN_ROOM_PLAYERS) {
      if (seat.sessionId) {
        this.send(seat.sessionId, {
          type: 'error',
          message: `Need at least ${MIN_ROOM_PLAYERS} seats`,
        })
      }
      return
    }
    const humans = this.humanSeats()
    if (humans.length < 1) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'Need at least one human player' })
      }
      return
    }
    if (!humans.every((s) => s.ready)) {
      if (seat.sessionId) {
        this.send(seat.sessionId, { type: 'error', message: 'All players must be ready' })
      }
      return
    }

    // Empty slots become bots at start.
    for (const s of this.seats) {
      if (s.isOpen) this.fillSeatAsBot(s)
    }

    const setups: PlayerSetup[] = this.seats.map((s) => ({
      displayName: s.displayName,
      isAI: s.isAI,
      avatarId: s.avatarId,
    }))
    this.game = createGame(setups, { roundLeaderIndex: 0, shuffleSeats: false })
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
      case 'setTableSize':
      case 'addBot':
      case 'removeBot':
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
  }

  private needsAiTick(): boolean {
    if (this.phase !== 'playing' || !this.game) return false
    const g = this.game
    if (g.phase === 'game-end' || g.phase === 'round-end') return false
    if (g.phase === 'round-prep') {
      return g.players.some((p) => p.isAI && !g.ready[p.index])
    }
    if (g.phase === 'buy-window') {
      const current = g.players[g.currentPlayerIndex]
      if (current?.isAI) return true
      return g.players.some((p) => p.isAI && decideBuy(g, p.index))
    }
    if (g.phase === 'draw' || g.phase === 'play-or-discard') {
      return g.players[g.currentPlayerIndex]?.isAI === true
    }
    return false
  }

  private runAiTick(): void {
    if (!this.game) return
    const before = this.game
    const next = runAIStep(before)
    if (next === before) return
    if (next.lastError) return
    this.commitGame(next)
  }

  private applyIdleAction(): void {
    if (!this.game) return
    const g = this.game
    const seat = g.currentPlayerIndex

    if (g.phase === 'round-prep') {
      let s = g
      if (!s.ready[seat]) s = setReady(s, seat, true)
      for (const rec of this.seats) {
        if (!rec.sessionId && !rec.isAI && !s.ready[rec.seatIndex]) {
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

function clampTableSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TABLE_SIZE
  return Math.min(MAX_ROOM_PLAYERS, Math.max(MIN_ROOM_PLAYERS, Math.round(n)))
}

function makeOpenSeats(count: number): SeatRecord[] {
  const seats: SeatRecord[] = []
  for (let i = 0; i < count; i++) {
    seats.push({
      seatIndex: i,
      displayName: '',
      avatarId: '',
      ready: false,
      reconnectToken: '',
      sessionId: null,
      isAI: false,
      isOpen: true,
    })
  }
  return seats
}

function pickBotAvatar(taken: string[]): string {
  const set = new Set(taken)
  return BOT_AVATAR_IDS.find((id) => !set.has(id)) ?? BOT_AVATAR_IDS[0]
}
