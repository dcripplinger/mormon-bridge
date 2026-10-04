import type { Card } from './card'
import { compareCards } from './card'
import { buildDeck, dealHands, shuffleDeck } from './deck'
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

export interface PlayerState {
  index: number
  displayName: string
  isAI: boolean
  hand: Card[]
  hasGoneDown: boolean
  cumulativeScore: number
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
  meldIdCounter: number
  // Transient: last error message for the UI to surface, cleared on next action
  lastError: string | null
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGame(playerNames: string[], aiCount: number): GameState {
  const numPlayers = playerNames.length
  if (numPlayers < 3 || numPlayers > 5) {
    throw new Error('Mormon Bridge requires 3-5 players')
  }
  const players: PlayerState[] = playerNames.map((name, i) => ({
    index: i,
    displayName: name,
    isAI: i >= numPlayers - aiCount,
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
 * A non-current, non-discarder player buys the top discard.
 * They receive the discard + a penalty card from the deck.
 * The current player then draws from the deck (buy window ends → play-or-discard).
 */
export function buyDiscard(state: GameState, buyerIndex: number): GameState {
  if (state.phase !== 'buy-window') return err(state, 'Not in buy window')
  if (buyerIndex === state.currentPlayerIndex) return err(state, 'Current player cannot buy')
  if (buyerIndex === state.lastDiscarderIndex) return err(state, 'Cannot buy your own discard')
  const top = topDiscard(state)
  if (!top) return err(state, 'No discard to buy')

  // Give discard to buyer
  let players = state.players.map((p) =>
    p.index === buyerIndex
      ? { ...p, hand: [...p.hand, top] }
      : p,
  )
  let s: GameState = { ...state, players, discardPile: state.discardPile.slice(0, -1) }

  // Penalty card for buyer
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

  // Current player draws from deck
  const drawResult = drawFromPile(s)
  if (!drawResult) return err(s, 'No cards left to draw')
  s = drawResult.state
  s = {
    ...s,
    players: s.players.map((p) =>
      p.index === s.currentPlayerIndex
        ? { ...p, hand: [...p.hand, drawResult.card] }
        : p,
    ),
    phase: 'play-or-discard',
    hasDrawnThisTurn: true,
    lastError: null,
  }
  return s
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
  const result = drawFromPile(state)
  if (!result) return err(state, 'Draw pile is empty')
  const { card, state: s } = result
  const players = s.players.map((p) =>
    p.index === s.currentPlayerIndex
      ? { ...p, hand: [...p.hand, card] }
      : p,
  )
  return {
    ...s,
    players,
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
    return err(state, `Need exactly ${totalMeldsNeeded} meld(s) to go down`)
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
    if (!isGroup && !isRun) return err(state, 'One or more melds are invalid')
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
    cards: m.cards,
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
 * Current player (already gone down) extends an existing meld on the table.
 */
export function extendMeld(state: GameState, meldId: string, cardId: string): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
  const currentPlayer = state.players[state.currentPlayerIndex]
  if (!currentPlayer.hasGoneDown) return err(state, 'Must go down before extending')

  const meldIdx = state.tableMetlds.findIndex((m) => m.id === meldId)
  if (meldIdx === -1) return err(state, 'Meld not found')
  const meld = state.tableMetlds[meldIdx]

  const result = removeFromHand(currentPlayer.hand, cardId)
  if (!result) return err(state, 'Card not in hand')
  const { card, hand: newHand } = result

  const newMeldCards = [...meld.cards, card]
  const valid =
    meld.type === 'group' ? isValidGroup(newMeldCards) : isValidRun(newMeldCards)
  if (!valid) return err(state, 'Card cannot be legally added to that meld')

  const tableMetlds = state.tableMetlds.map((m, i) =>
    i === meldIdx ? { ...m, cards: newMeldCards } : m,
  )
  const players = state.players.map((p) =>
    p.index === state.currentPlayerIndex
      ? { ...p, hand: newHand }
      : p,
  )

  const next: GameState = { ...state, players, tableMetlds, lastError: null }

  // Playing the last card ends the round immediately — no discard required
  if (newHand.length === 0) return finishRound(next)
  return next
}

/**
 * Current player discards a card to end their turn.
 */
export function discard(state: GameState, cardId: string): GameState {
  if (state.phase !== 'play-or-discard') return err(state, 'Not your play phase')
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
    lastError: null,
  }
}

function finishRound(state: GameState): GameState {
  // Tally scores from remaining hands
  const players = state.players.map((p) => ({
    ...p,
    cumulativeScore: p.cumulativeScore + scoreHand(p.hand),
  }))

  const nextRound = state.roundIndex + 1
  if (nextRound >= TOTAL_ROUNDS) {
    return { ...state, players, phase: 'game-end', lastError: null }
  }

  // Start next round, preserving cumulative scores
  return startRound({ players, roundIndex: nextRound, meldIdCounter: state.meldIdCounter })
}

// ---------------------------------------------------------------------------
// Simple AI
// ---------------------------------------------------------------------------

/**
 * Runs the AI for the current player if they are an AI.
 * Returns the new state (possibly after multiple AI sub-steps).
 * Only runs one "decision" per call; caller should loop/call repeatedly until
 * phase changes back to buy-window (human's turn) or game ends.
 */
export function runAIStep(state: GameState): GameState {
  const player = state.players[state.currentPlayerIndex]
  if (!player.isAI) return state

  switch (state.phase) {
    case 'buy-window':
      // Simple AI: always skip buying, draw from deck
      return drawFromDeck(state)
    case 'draw':
      return drawFromDeck(state)
    case 'play-or-discard': {
      // Simple AI: discard the most recently drawn card (appended at hand end)
      const hand = player.hand
      // Empty hand should already have ended the round via goDown/extendMeld
      if (hand.length === 0) return finishRound(state)
      // Discard the card most recently added (end of sorted hand = wild or highest number)
      const cardToDiscard = hand[hand.length - 1]
      return discard(state, cardToDiscard.id)
    }
    default:
      return state
  }
}
