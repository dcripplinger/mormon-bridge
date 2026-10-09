import type { Card } from './card'
import { compareCards } from './card'
import { buildDeck, dealHands, shuffleDeck } from './deck'
import {
  DEFAULT_WILD_RULES,
  allowsWildDisplacement,
  groupWildsOnLeft,
  planMeldPlay,
  wildHasHome,
  type MeldEnd,
  type WildRules,
} from './meld-play'
import { ROUND_REQUIREMENTS, TOTAL_ROUNDS, isValidGroup, isValidRun, scoreHand } from './rules'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TurnPhase =
  | 'buy-window'      // before draw: other players may buy the top discard
  | 'draw'            // current player chooses deck or discard (if no buy happened)
  | 'play-or-discard' // current player may play melds, then must discard
  | 'round-end'       // round is over; scores tallied
  | 'game-end'        // all 7 rounds played

export interface Meld {
  id: string
  ownerIndex: number
  type: 'group' | 'run'
  cards: Card[]
}

/** One play onto an existing set, newest last. Undo walks this list backward. */
export interface ExtendRecord {
  meldId: string | null
  playedCardId: string
  previousCards: Card[]
  fromPendingWild: boolean
  displacedWildId: string | null
}

export interface PlayerState {
  index: number
  displayName: string
  isAI: boolean
  /** Curated avatar id from `avatars/catalog`. */
  avatarId: string
  hand: Card[]
  hasGoneDown: boolean
  cumulativeScore: number
}

/** Inputs used to start a local game from the menu. */
export interface PlayerSetup {
  displayName: string
  isAI: boolean
  avatarId: string
}

export interface GameState {
  players: PlayerState[]
  drawPile: Card[]
  discardPile: Card[]
  tableMetlds: Meld[]    // melds currently on the table
  roundIndex: number     // 0-based (round 1 = index 0)
  currentPlayerIndex: number
  phase: TurnPhase
  hasDrawnThisTurn: boolean
  /** Player who discarded the current top card, or null if it was flipped from the deck. */
  lastDiscarderIndex: number | null
  /**
   * Players who have called buy this window, earliest first.
   * The first caller receives the discard if the active player draws from the deck.
   * Later callers are recorded so everyone who wanted the card is known; they do not take it.
   */
  buyIntents: number[]
  /** Plays onto existing sets this turn. Cleared when the turn or round ends. */
  extendHistory: ExtendRecord[]
  /**
   * Wild pulled out of a set. It must be played before any other action.
   * It is not in a hand while this is set.
   */
  pendingWild: Card | null
  /** Who emptied their hand, while phase is round-end. */
  roundVictorIndex: number | null
  meldIdCounter: number
  // Transient: last error message for the UI to surface, cleared on next action
  lastError: string | null
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGame(setups: PlayerSetup[]): GameState {
  const numPlayers = setups.length
  if (numPlayers < 3 || numPlayers > 5) {
    throw new Error('Mormon Bridge requires 3-5 players')
  }
  const players: PlayerState[] = setups.map((s, i) => ({
    index: i,
    displayName: s.displayName,
    isAI: s.isAI,
    avatarId: s.avatarId,
    hand: [],
    hasGoneDown: false,
    cumulativeScore: 0,
  }))
  return startRound({ players, roundIndex: 0, meldIdCounter: 0 })
}

function startRound(opts: {
  players: PlayerState[]
  roundIndex: number
  meldIdCounter: number
}): GameState {
  const { roundIndex, meldIdCounter } = opts
  const raw = buildDeck()
  const shuffled = shuffleDeck(raw)
  const { hands, drawPile } = dealHands(shuffled, opts.players.length)

  // Flip one card to start discard pile
  const firstDiscard = drawPile[drawPile.length - 1]
  const pile = drawPile.slice(0, drawPile.length - 1)

  const players: PlayerState[] = opts.players.map((p, i) => ({
    ...p,
    hand: sortHand([...hands[i]]),
    hasGoneDown: false,
    // cumulative score carries over
  }))

  return {
    players,
    drawPile: pile,
    discardPile: firstDiscard ? [firstDiscard] : [],
    tableMetlds: [],
    roundIndex,
    currentPlayerIndex: 0,
    phase: 'buy-window',
    hasDrawnThisTurn: false,
    lastDiscarderIndex: null,
    buyIntents: [],
    extendHistory: [],
    pendingWild: null,
    roundVictorIndex: null,
    meldIdCounter,
    lastError: null,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort(compareCards)
}

/**
 * Manually reorder a player's hand. orderedIds must be a permutation of the
 * current hand card ids.
 */
export function reorderHand(
  state: GameState,
  playerIndex: number,
  orderedIds: string[],
): GameState {
  const player = state.players[playerIndex]
  if (!player) return err(state, 'Invalid player')
  if (orderedIds.length !== player.hand.length) return err(state, 'Invalid hand order')
  const byId = new Map(player.hand.map((c) => [c.id, c]))
  const hand: Card[] = []
  for (const id of orderedIds) {
    const card = byId.get(id)
    if (!card) return err(state, 'Invalid hand order')
    hand.push(card)
  }
  return {
    ...state,
    players: state.players.map((p) =>
      p.index === playerIndex ? { ...p, hand } : p,
    ),
    lastError: null,
  }
}

export function topDiscard(state: GameState): Card | null {
  return state.discardPile[state.discardPile.length - 1] ?? null
}

/**
 * Eligible buyers are everyone except the current player (they draw/claim instead)
 * and the player who just discarded (cannot buy back their own discard).
 * Initial deck-flip discards have no discarder and may be bought by non-current players.
 */
export function canBuyDiscard(state: GameState, buyerIndex: number): boolean {
  if (state.phase !== 'buy-window') return false
  if (buyerIndex === state.currentPlayerIndex) return false
  if (buyerIndex === state.lastDiscarderIndex) return false
  if (state.buyIntents.includes(buyerIndex)) return false
  if (!topDiscard(state)) return false
  return true
}

function err(state: GameState, msg: string): GameState {
  return { ...state, lastError: msg }
}

function removeFromHand(hand: Card[], cardId: string): { card: Card; hand: Card[] } | null {
  const idx = hand.findIndex((c) => c.id === cardId)
  if (idx === -1) return null
  const card = hand[idx]
  return { card, hand: [...hand.slice(0, idx), ...hand.slice(idx + 1)] }
}

function drawFromPile(state: GameState): { card: Card; state: GameState } | null {
  if (state.drawPile.length === 0) {
    // Reshuffle discard into draw pile, keeping top discard
    const discardLen = state.discardPile.length
    if (discardLen <= 1) return null
    const top = state.discardPile[discardLen - 1]
    const newDraw = shuffleDeck(state.discardPile.slice(0, discardLen - 1))
    state = { ...state, drawPile: newDraw, discardPile: [top] }
  }
  if (state.drawPile.length === 0) return null
  const card = state.drawPile[state.drawPile.length - 1]
  return { card, state: { ...state, drawPile: state.drawPile.slice(0, -1) } }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Record that a player wants the top discard. Does not move cards.
 * The first caller wins if the active player later draws from the deck.
 * Later callers are still recorded; the window stays open until the active player acts.
 */
export function declareBuy(state: GameState, buyerIndex: number): GameState {
  if (state.phase !== 'buy-window') return err(state, 'Not in buy window')
  if (buyerIndex === state.currentPlayerIndex) return err(state, 'Current player cannot buy')
  if (buyerIndex === state.lastDiscarderIndex) return err(state, 'Cannot buy your own discard')
  if (!topDiscard(state)) return err(state, 'No discard to buy')
  if (state.buyIntents.includes(buyerIndex)) return err(state, 'Already buying')
  return {
    ...state,
    buyIntents: [...state.buyIntents, buyerIndex],
    lastError: null,
  }
}

/** Give the top discard and a deck penalty card to the winning buyer. Phase stays put. */
function awardBuy(state: GameState, buyerIndex: number): GameState {
  const top = topDiscard(state)
  if (!top) return err(state, 'No discard to buy')

  let players = state.players.map((p) =>
    p.index === buyerIndex
      ? { ...p, hand: [...p.hand, top] }
      : p,
  )
  let s: GameState = { ...state, players, discardPile: state.discardPile.slice(0, -1) }

  const penaltyResult = drawFromPile(s)
  if (penaltyResult) {
    s = penaltyResult.state
    s = {
      ...s,
      players: s.players.map((p) =>
        p.index === buyerIndex
          ? { ...p, hand: [...p.hand, penaltyResult.card] }
          : p,
      ),
    }
  }
  return { ...s, lastError: null }
}

/**
 * Current player claims the top discard as their own draw (buy window ends).
 */
export function claimDiscardAsDraw(state: GameState): GameState {
  if (state.phase !== 'buy-window') return err(state, 'Not in buy window')
  const top = topDiscard(state)
  if (!top) return err(state, 'No discard to claim')
  const players = state.players.map((p) =>
    p.index === state.currentPlayerIndex
      ? { ...p, hand: [...p.hand, top] }
      : p,
  )
  return {
    ...state,
    players,
    discardPile: state.discardPile.slice(0, -1),
    buyIntents: [],
    phase: 'play-or-discard',
    hasDrawnThisTurn: true,
    lastError: null,
  }
}

/**
 * Current player draws from the deck (skipping the discard option).
 */
export function drawFromDeck(state: GameState): GameState {
  if (state.phase !== 'buy-window' && state.phase !== 'draw') {
    return err(state, 'Cannot draw now')
  }

  let s = state
  if (s.phase === 'buy-window' && s.buyIntents.length > 0) {
    s = awardBuy(s, s.buyIntents[0])
    if (s.lastError) return s
  }

  const result = drawFromPile(s)
  if (!result) return err(s, 'Draw pile is empty')
  const { card, state: drawn } = result
  const players = drawn.players.map((p) =>
    p.index === drawn.currentPlayerIndex
      ? { ...p, hand: [...p.hand, card] }
      : p,
  )
  return {
    ...drawn,
    players,
    buyIntents: [],
    phase: 'play-or-discard',
    hasDrawnThisTurn: true,
    lastError: null,
  }
}

/**
 * Current player goes down: simultaneously plays all required melds for this round.
 * melds: array of card-id arrays, each representing one group or run (in any order).
 * The function auto-detects group vs run.
 */
export function goDown(state: GameState, melds: string[][]): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  const currentPlayer = state.players[state.currentPlayerIndex]
  if (currentPlayer.hasGoneDown) return err(state, 'Already gone down this round')

  const req = ROUND_REQUIREMENTS[state.roundIndex]
  const totalMeldsNeeded = req.groups + req.runs
  if (melds.length !== totalMeldsNeeded) {
    return err(state, `Need exactly ${totalMeldsNeeded} group(s) and/or run(s) to go down`)
  }

  // Resolve card objects from hand
  const hand = [...currentPlayer.hand]
  const resolved: { type: 'group' | 'run'; cards: Card[] }[] = []
  for (const cardIds of melds) {
    const cards: Card[] = []
    for (const cid of cardIds) {
      const idx = hand.findIndex((c) => c.id === cid)
      if (idx === -1) return err(state, `Card ${cid} not in hand`)
      cards.push(hand[idx])
      hand.splice(idx, 1)
    }
    const isGroup = isValidGroup(cards)
    const isRun = isValidRun(cards)
    if (!isGroup && !isRun) return err(state, 'One or more groups or runs are invalid')
    resolved.push({ type: isGroup ? 'group' : 'run', cards })
  }

  // Validate the correct mix of groups and runs
  const groupCount = resolved.filter((m) => m.type === 'group').length
  const runCount = resolved.filter((m) => m.type === 'run').length
  if (groupCount !== req.groups || runCount !== req.runs) {
    return err(
      state,
      `Round ${state.roundIndex + 1} requires ${req.groups} group(s) and ${req.runs} run(s)`,
    )
  }

  // Build new melds and update state
  let counter = state.meldIdCounter
  const newMelds: Meld[] = resolved.map((m) => ({
    id: `meld_${counter++}`,
    ownerIndex: state.currentPlayerIndex,
    type: m.type,
    cards: m.type === 'group' ? groupWildsOnLeft(m.cards) : m.cards,
  }))

  const players = state.players.map((p) =>
    p.index === state.currentPlayerIndex
      ? { ...p, hand, hasGoneDown: true }
      : p,
  )

  const next: GameState = {
    ...state,
    players,
    tableMetlds: [...state.tableMetlds, ...newMelds],
    meldIdCounter: counter,
    lastError: null,
  }

  // Playing the last card(s) ends the round immediately — no discard required
  if (hand.length === 0) return finishRound(next)
  return next
}

/**
 * Current player (already gone down) plays a card onto an existing meld.
 * A natural that takes a wild's rank pulls that wild out; it must be played next.
 * `side` chooses the end when a wild can legally extend either end of a run.
 */
export function extendMeld(
  state: GameState,
  meldId: string,
  cardId: string,
  side?: MeldEnd,
  rules: WildRules = DEFAULT_WILD_RULES,
): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  const currentPlayer = state.players[state.currentPlayerIndex]
  if (!currentPlayer.hasGoneDown) return err(state, 'Must go down before extending')

  const fromPending = state.pendingWild?.id === cardId
  if (state.pendingWild && !fromPending) return err(state, 'Play the wild first')

  const meldIdx = state.tableMetlds.findIndex((m) => m.id === meldId)
  if (meldIdx === -1) return err(state, 'Group or run not found')
  const meld = state.tableMetlds[meldIdx]

  let card: Card
  let newHand = currentPlayer.hand
  if (fromPending && state.pendingWild) {
    card = state.pendingWild
  } else {
    const result = removeFromHand(currentPlayer.hand, cardId)
    if (!result) return err(state, 'Card not in hand')
    card = result.card
    newHand = result.hand
  }

  const allowDisplace = allowsWildDisplacement(rules, meld.type)
  const plan = planMeldPlay(meld.cards, meld.type, card, side, allowDisplace)
  if (!plan) return err(state, 'Card cannot be legally added to that group or run')

  let tableMetlds = state.tableMetlds.map((m, i) =>
    i === meldIdx ? { ...m, cards: plan.cards } : m,
  )

  let pendingWild: Card | null = fromPending ? null : state.pendingWild
  if (plan.displacedWild) {
    if (!wildHasHome(tableMetlds, plan.displacedWild, rules, meld.id)) {
      return err(state, 'That wild has nowhere to go')
    }
    pendingWild = plan.displacedWild
  }

  const players = state.players.map((p) =>
    p.index === state.currentPlayerIndex ? { ...p, hand: newHand } : p,
  )

  const record: ExtendRecord = {
    meldId,
    playedCardId: card.id,
    previousCards: meld.cards,
    fromPendingWild: fromPending,
    displacedWildId: plan.displacedWild?.id ?? null,
  }

  const next: GameState = {
    ...state,
    players,
    tableMetlds,
    extendHistory: [...state.extendHistory, record],
    pendingWild,
    lastError: null,
  }

  if (newHand.length === 0 && !pendingWild) return finishRound(next)
  return next
}

/** Put the held wild back into the current player's hand. */
export function keepPendingWild(state: GameState): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  const wild = state.pendingWild
  if (!wild) return err(state, 'No wild to keep')
  const players = state.players.map((p) =>
    p.index === state.currentPlayerIndex ? { ...p, hand: [...p.hand, wild] } : p,
  )
  const record: ExtendRecord = {
    meldId: null,
    playedCardId: wild.id,
    previousCards: [],
    fromPendingWild: true,
    displacedWildId: null,
  }
  return {
    ...state,
    players,
    pendingWild: null,
    extendHistory: [...state.extendHistory, record],
    lastError: null,
  }
}

/** Undo the latest play onto an existing set. Going down, draws, and discards stay. */
export function undoExtend(state: GameState): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  const history = state.extendHistory
  if (history.length === 0) return err(state, 'Nothing to undo')
  const rec = history[history.length - 1]
  const player = state.players[state.currentPlayerIndex]

  let pendingWild = state.pendingWild
  let hand = player.hand

  if (rec.meldId == null) {
    const removed = removeFromHand(hand, rec.playedCardId)
    if (!removed) return err(state, 'Wild is not in hand')
    hand = removed.hand
    pendingWild = removed.card
  } else {
    const meld = state.tableMetlds.find((m) => m.id === rec.meldId)
    const played = meld?.cards.find((c) => c.id === rec.playedCardId)
    if (!meld || !played) return err(state, 'Played card is no longer on that set')
    if (rec.fromPendingWild) pendingWild = played
    else hand = [...hand, played]
    if (rec.displacedWildId) pendingWild = null
  }

  const tableMetlds =
    rec.meldId == null
      ? state.tableMetlds
      : state.tableMetlds.map((m) =>
          m.id === rec.meldId ? { ...m, cards: rec.previousCards } : m,
        )

  return {
    ...state,
    players: state.players.map((p) =>
      p.index === state.currentPlayerIndex ? { ...p, hand } : p,
    ),
    tableMetlds,
    extendHistory: history.slice(0, -1),
    pendingWild,
    lastError: null,
  }
}

/**
 * Current player discards a card to end their turn.
 */
export function discard(state: GameState, cardId: string): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  if (state.pendingWild) return err(state, 'Play the wild before discarding')
  if (!state.hasDrawnThisTurn) return err(state, 'Must draw before discarding')
  const currentPlayer = state.players[state.currentPlayerIndex]
  const result = removeFromHand(currentPlayer.hand, cardId)
  if (!result) return err(state, 'Card not in hand')
  const { card, hand: newHand } = result

  let players = state.players.map((p) =>
    p.index === state.currentPlayerIndex ? { ...p, hand: newHand } : p,
  )
  const discardPile = [...state.discardPile, card]
  let s: GameState = {
    ...state,
    players,
    discardPile,
    lastDiscarderIndex: state.currentPlayerIndex,
    lastError: null,
  }

  // Check if this player emptied their hand → round ends
  if (newHand.length === 0) {
    return finishRound(s)
  }
  return advanceTurn(s)
}

function advanceTurn(state: GameState): GameState {
  const next = (state.currentPlayerIndex + 1) % state.players.length
  return {
    ...state,
    currentPlayerIndex: next,
    phase: 'buy-window',
    hasDrawnThisTurn: false,
    buyIntents: [],
    extendHistory: [],
    pendingWild: null,
    roundVictorIndex: null,
    lastError: null,
  }
}

function finishRound(state: GameState): GameState {
  const players = state.players.map((p) => ({
    ...p,
    cumulativeScore: p.cumulativeScore + scoreHand(p.hand),
  }))
  const victor = state.players.findIndex((p) => p.hand.length === 0)

  return {
    ...state,
    players,
    phase: 'round-end',
    extendHistory: [],
    pendingWild: null,
    roundVictorIndex: victor === -1 ? state.currentPlayerIndex : victor,
    lastError: null,
  }
}

/** Leave the held table and deal the next round, or show the final scores. */
export function continueAfterRound(state: GameState): GameState {
  if (state.phase !== 'round-end') return state
  const nextRound = state.roundIndex + 1
  if (nextRound >= TOTAL_ROUNDS) {
    return { ...state, phase: 'game-end', roundVictorIndex: null, lastError: null }
  }
  return startRound({
    players: state.players,
    roundIndex: nextRound,
    meldIdCounter: state.meldIdCounter,
  })
}
