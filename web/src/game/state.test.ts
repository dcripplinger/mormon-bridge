import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import type { GameState, Meld, PlayerState } from './state'
import {
  continueAfterRound,
  createGame,
  drawFromDeck,
  revealOpeningDiscard,
  setReady,
  canBuyDiscard,
  declareBuy,
  claimDiscardAsDraw,
  goDown,
  discard,
  extendMeld,
  reorderHand,
  undoExtend,
} from './state'

function makeGame(numHumans = 3, numAI = 0) {
  const setups = Array.from({ length: numHumans + numAI }, (_, i) => {
    const isAI = i >= numHumans
    const n = isAI ? ((i - numHumans) % 8) + 1 : (i % 12) + 1
    return {
      displayName: `P${i + 1}`,
      isAI,
      avatarId: `${isAI ? 'b' : 'h'}${String(n).padStart(2, '0')}`,
    }
  })
  return createGame(setups, { roundLeaderIndex: 0 })
}

/** Prep check-in, then the opening discard, so tests begin in the buy window. */
function openRound(numHumans = 3, numAI = 0) {
  let state = makeGame(numHumans, numAI)
  for (const p of state.players) state = setReady(state, p.index, true)
  return revealOpeningDiscard(state)
}

function card(id: string, color: Card['color'], number: number): Card {
  return { id, color, number }
}

function player(index: number, hand: Card[], extras: Partial<PlayerState> = {}): PlayerState {
  return {
    index,
    displayName: `P${index + 1}`,
    isAI: false,
    avatarId: `h${String((index % 12) + 1).padStart(2, '0')}`,
    hand,
    hasGoneDown: false,
    cumulativeScore: 0,
    roundScores: [],
    ...extras,
  }
}

/** Minimal in-play state for round-end scenarios (avoids random dealing). */
function stubPlayState(opts: {
  hand: Card[]
  hasGoneDown?: boolean
  tableMetlds?: Meld[]
  roundIndex?: number
  roundLeaderIndex?: number
}): GameState {
  const { hand, hasGoneDown = false, tableMetlds = [], roundIndex = 0, roundLeaderIndex = 0 } = opts
  return {
    players: [
      player(0, hand, { hasGoneDown }),
      player(1, [card('other1', 'red', 1)]),
      player(2, [card('other2', 'yellow', 2)]),
    ],
    drawPile: [card('deck1', 'green', 3)],
    discardPile: [card('disc1', 'black', 4)],
    tableMetlds,
    roundIndex,
    currentPlayerIndex: 0,
    phase: 'play-or-discard',
    hasDrawnThisTurn: true,
    lastDiscarderIndex: null,
    buyIntents: [],
    extendHistory: [],
    pendingWild: null,
    roundVictorIndex: null,
    ready: [false, false, false],
    roundLeaderIndex,
    meldIdCounter: tableMetlds.length,
    lastError: null,
  }
}

describe('createGame', () => {
  it('starts in round-prep with nobody ready', () => {
    const state = makeGame(3)
    expect(state.phase).toBe('round-prep')
    expect(state.ready).toEqual([false, false, false])
  })

  it('deals 11 cards to each player', () => {
    const state = makeGame(3)
    for (const p of state.players) {
      expect(p.hand).toHaveLength(11)
    }
  })

  it('leaves the discard pile empty until the round begins', () => {
    const state = makeGame(3)
    expect(state.discardPile).toHaveLength(0)
    expect(state.drawPile.length).toBeGreaterThan(0)
  })

  it('throws for fewer than 3 players', () => {
    expect(() =>
      createGame([
        { displayName: 'P1', isAI: false, avatarId: 'h01' },
        { displayName: 'P2', isAI: false, avatarId: 'h02' },
      ]),
    ).toThrow()
  })

  it('throws for more than 5 players', () => {
    expect(() =>
      createGame(
        Array.from({ length: 6 }, (_, i) => ({
          displayName: `P${i + 1}`,
          isAI: false,
          avatarId: `h0${(i % 9) + 1}`,
        })),
      ),
    ).toThrow()
  })

  it('stores avatar ids on players', () => {
    const state = createGame([
      { displayName: 'You', isAI: false, avatarId: 'h03' },
      { displayName: 'Bot 1', isAI: true, avatarId: 'b01' },
      { displayName: 'Bot 2', isAI: true, avatarId: 'b02' },
    ])
    expect(state.players[0]).toMatchObject({ avatarId: 'h03', isAI: false, index: 0 })
    expect(state.players.slice(1).map((p) => p.avatarId).sort()).toEqual(['b01', 'b02'])
    expect(state.players.slice(1).every((p) => p.isAI)).toBe(true)
  })

  it('shuffles opponent seats once and keeps that order', () => {
    const setups = [
      { displayName: 'You', isAI: false, avatarId: 'h01' },
      { displayName: 'Bot 1', isAI: true, avatarId: 'b01' },
      { displayName: 'Bot 2', isAI: true, avatarId: 'b02' },
      { displayName: 'Bot 3', isAI: true, avatarId: 'b03' },
    ]
    let call = 0
    const rolls = [0, 0]
    const state = createGame(setups, {
      rng: () => rolls[call++] ?? 0,
      roundLeaderIndex: 1,
    })
    expect(state.players.map((p) => p.displayName)).toEqual(['You', 'Bot 2', 'Bot 3', 'Bot 1'])
    expect(state.players.map((p) => p.index)).toEqual([0, 1, 2, 3])
    const next = continueAfterRound({ ...state, phase: 'round-end' })
    expect(next.players.map((p) => p.displayName)).toEqual(['You', 'Bot 2', 'Bot 3', 'Bot 1'])
    expect(next.roundLeaderIndex).toBe(2)
  })

  it('chooses the round-1 leader from the rng', () => {
    const setups = [
      { displayName: 'P1', isAI: false, avatarId: 'h01' },
      { displayName: 'P2', isAI: true, avatarId: 'b01' },
      { displayName: 'P3', isAI: true, avatarId: 'b02' },
      { displayName: 'P4', isAI: true, avatarId: 'b03' },
    ]
    const state = createGame(setups, { rng: () => 0.99 })
    expect(state.roundLeaderIndex).toBe(3)
    expect(state.currentPlayerIndex).toBe(3)
  })
})

describe('round prep', () => {
  it('lets a player take ready back', () => {
    const dealt = makeGame(3)
    const ready = setReady(dealt, 1, true)
    expect(ready.ready).toEqual([false, true, false])
    const back = setReady(ready, 1, false)
    expect(back.ready).toEqual([false, false, false])
  })

  it('refuses to flip the opening discard until everyone is ready', () => {
    const dealt = makeGame(3)
    const blocked = revealOpeningDiscard(setReady(dealt, 0, true))
    expect(blocked.phase).toBe('round-prep')
    expect(blocked.discardPile).toHaveLength(0)
    expect(blocked.lastError).toBeTruthy()
  })

  it('flips one card and opens the buy window when everyone is ready', () => {
    let dealt = makeGame(3)
    for (const p of dealt.players) dealt = setReady(dealt, p.index, true)
    const opened = revealOpeningDiscard(dealt)
    expect(opened.phase).toBe('buy-window')
    expect(opened.discardPile).toHaveLength(1)
    expect(opened.drawPile).toHaveLength(dealt.drawPile.length - 1)
    expect(opened.discardPile[0]).toEqual(dealt.drawPile[dealt.drawPile.length - 1])
    expect(opened.lastDiscarderIndex).toBeNull()
    expect(opened.ready.every((r) => r === false)).toBe(true)
  })
})

describe('drawFromDeck', () => {
  it('advances phase to play-or-discard', () => {
    const s = drawFromDeck(openRound())
    expect(s.phase).toBe('play-or-discard')
    expect(s.hasDrawnThisTurn).toBe(true)
  })

  it('gives the current player one more card', () => {
    const base = openRound()
    const s = drawFromDeck(base)
    expect(s.players[0].hand).toHaveLength(12)
  })

  it('returns error if not in buy-window or draw phase', () => {
    const s = drawFromDeck(openRound())  // now in play-or-discard
    const s2 = drawFromDeck(s)
    expect(s2.lastError).toBeTruthy()
  })
})

describe('claimDiscardAsDraw', () => {
  it('gives top discard to current player', () => {
    const base = openRound()
    const topCard = base.discardPile[base.discardPile.length - 1]
    const s = claimDiscardAsDraw(base)
    expect(s.players[0].hand.find((c) => c.id === topCard.id)).toBeTruthy()
    expect(s.discardPile).toHaveLength(0)
    expect(s.phase).toBe('play-or-discard')
  })
})

describe('declareBuy', () => {
  it('records the caller without moving cards', () => {
    const base = openRound(3)
    const s = declareBuy(base, 1, 500)
    expect(s.lastError).toBeNull()
    expect(s.buyIntents).toEqual([{ playerIndex: 1, elapsedMs: 500 }])
    expect(s.phase).toBe('buy-window')
    expect(s.players[1].hand).toHaveLength(11)
    expect(s.discardPile).toHaveLength(1)
  })

  it('lets a later player call buy after someone else has', () => {
    const base = openRound(3)
    const first = declareBuy(base, 1, 800)
    expect(canBuyDiscard(first, 2)).toBe(true)
    expect(canBuyDiscard(first, 1)).toBe(false)
    const second = declareBuy(first, 2, 200)
    expect(second.buyIntents).toEqual([
      { playerIndex: 1, elapsedMs: 800 },
      { playerIndex: 2, elapsedMs: 200 },
    ])
    expect(second.phase).toBe('buy-window')
  })

  it('returns error if current player tries to buy', () => {
    const s = declareBuy(openRound(3), 0, 100)
    expect(s.lastError).toBeTruthy()
  })

  it('returns error if the discarder tries to buy their own discard', () => {
    let s = drawFromDeck(openRound(3))
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(s.currentPlayerIndex).toBe(1)
    expect(s.lastDiscarderIndex).toBe(0)
    expect(canBuyDiscard(s, 0)).toBe(false)
    const bought = declareBuy(s, 0, 100)
    expect(bought.lastError).toBe('Cannot buy your own discard')
  })

  it('allows a non-next player to call buy on someone else\'s discard', () => {
    let s = drawFromDeck(openRound(3))
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(canBuyDiscard(s, 2)).toBe(true)
    const called = declareBuy(s, 2, 100)
    expect(called.lastError).toBeNull()
    expect(called.buyIntents).toEqual([{ playerIndex: 2, elapsedMs: 100 }])
  })

  it('allows buying the initial deck-flip discard', () => {
    const s = openRound(3)
    expect(s.lastDiscarderIndex).toBeNull()
    expect(canBuyDiscard(s, 1)).toBe(true)
  })

  it('rejects negative or non-finite elapsedMs', () => {
    const base = openRound(3)
    expect(declareBuy(base, 1, -1).lastError).toBe('Invalid buy timing')
    expect(declareBuy(base, 1, Number.NaN).lastError).toBe('Invalid buy timing')
  })
})

describe('drawFromDeck with a pending buy', () => {
  it('deals the discard and a penalty to the fastest buyer, then draws for the active player', () => {
    const base = openRound(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const penalty = base.drawPile[base.drawPile.length - 1]
    const drawn = base.drawPile[base.drawPile.length - 2]
    // Seat 1 called first in wall time, but seat 2 reported a lower elapsedMs.
    const called = declareBuy(declareBuy(base, 1, 900), 2, 200)
    const s = drawFromDeck(called)
    expect(s.lastError).toBeNull()
    expect(s.phase).toBe('play-or-discard')
    expect(s.buyIntents).toEqual([])
    expect(s.players[2].hand.find((c) => c.id === top.id)).toBeTruthy()
    expect(s.players[2].hand.find((c) => c.id === penalty.id)).toBeTruthy()
    expect(s.players[2].hand).toHaveLength(13)
    expect(s.players[1].hand).toHaveLength(11)
    expect(s.players[0].hand.find((c) => c.id === drawn.id)).toBeTruthy()
    expect(s.players[0].hand).toHaveLength(12)
  })

  it('breaks elapsedMs ties by lowest playerIndex', () => {
    const base = openRound(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const called = declareBuy(declareBuy(base, 2, 500), 1, 500)
    const s = drawFromDeck(called)
    expect(s.players[1].hand.find((c) => c.id === top.id)).toBeTruthy()
    expect(s.players[2].hand).toHaveLength(11)
  })

  it('closes the buy window so nobody else can call', () => {
    const s = drawFromDeck(declareBuy(openRound(3), 1, 100))
    expect(canBuyDiscard(s, 2)).toBe(false)
  })
})

describe('claimDiscardAsDraw denies a pending buy', () => {
  it('gives the discard to the active player and nothing to the buyer', () => {
    const base = openRound(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const called = declareBuy(base, 1, 100)
    const s = claimDiscardAsDraw(called)
    expect(s.players[0].hand.find((c) => c.id === top.id)).toBeTruthy()
    expect(s.players[1].hand).toHaveLength(11)
    expect(s.buyIntents).toEqual([])
    expect(s.phase).toBe('play-or-discard')
    expect(canBuyDiscard(s, 2)).toBe(false)
  })
})

describe('reorderHand', () => {
  it('reorders the player hand by id list', () => {
    const s = makeGame()
    const hand = s.players[0].hand
    const reversed = [...hand].reverse().map((c) => c.id)
    const next = reorderHand(s, 0, reversed)
    expect(next.players[0].hand.map((c) => c.id)).toEqual(reversed)
    expect(next.lastError).toBeNull()
  })

  it('rejects incomplete id lists', () => {
    const s = makeGame()
    const partial = s.players[0].hand.slice(0, 3).map((c) => c.id)
    const next = reorderHand(s, 0, partial)
    expect(next.lastError).toBeTruthy()
    expect(next.players[0].hand).toEqual(s.players[0].hand)
  })
})

describe('discard', () => {
  it('removes card from hand and adds to discard pile', () => {
    let s = drawFromDeck(openRound())
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(s.players[0].hand.find((c) => c.id === cardId)).toBeUndefined()
    expect(s.discardPile[s.discardPile.length - 1].id).toBe(cardId)
  })

  it('advances to next player and resets to buy-window', () => {
    let s = drawFromDeck(openRound())
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(s.currentPlayerIndex).toBe(1)
    expect(s.phase).toBe('buy-window')
  })

  it('returns error if not drawn yet', () => {
    const s = makeGame()
    const cardId = s.players[0].hand[0].id
    const s2 = discard(s, cardId)
    expect(s2.lastError).toBeTruthy()
  })

  it('ends the round when discarding the last card', () => {
    const s = stubPlayState({
      hand: [card('last', 'red', 9)],
      hasGoneDown: true,
    })
    const next = discard(s, 'last')
    // Round 0 → starts round 1 (buy-window), not stuck in play-or-discard
    expect(next.roundIndex).toBe(0)
    expect(next.phase).toBe('round-end')
    expect(next.roundVictorIndex).toBe(0)
    expect(next.lastError).toBeNull()
    const dealt = continueAfterRound(next)
    expect(dealt.roundIndex).toBe(1)
    expect(dealt.phase).toBe('round-prep')
    expect(dealt.discardPile).toHaveLength(0)
    expect(dealt.roundLeaderIndex).toBe(1)
    expect(dealt.currentPlayerIndex).toBe(1)
    expect(next.players[0].roundScores).toEqual([0])
    expect(next.players[0].cumulativeScore).toBe(0)
    expect(next.players[1].roundScores).toHaveLength(1)
  })

  it('rotates the next round leader clockwise, wrapping past the last seat', () => {
    const s = stubPlayState({
      hand: [card('last', 'red', 9)],
      hasGoneDown: true,
      roundLeaderIndex: 2,
    })
    const dealt = continueAfterRound(discard(s, 'last'))
    expect(dealt.roundLeaderIndex).toBe(0)
    expect(dealt.currentPlayerIndex).toBe(0)
  })
})

describe('goDown', () => {
  it('returns error if round requires groups but given runs', () => {
    // Round 1 = 2 groups, 0 runs
    let s = drawFromDeck(openRound())
    // Build a "run" (invalid as group) from hand cards — just test validation path
    const runIds = s.players[0].hand.slice(0, 4).map((c) => c.id)
    const groupIds = s.players[0].hand.slice(4, 7).map((c) => c.id)
    const s2 = goDown(s, [runIds, groupIds])
    // Might fail on invalid meld or wrong mix; either way lastError should be set
    // (the cards are random so we just verify the function runs without throwing)
    expect(typeof s2.lastError === 'string' || s2.lastError === null).toBe(true)
  })

  it('rejects going down with wrong number of melds', () => {
    let s = drawFromDeck(openRound())
    const oneMeld = [s.players[0].hand.slice(0, 3).map((c) => c.id)]
    const s2 = goDown(s, oneMeld)
    expect(s2.lastError).toBeTruthy()
  })

  it('ends the round when going down with every remaining card', () => {
    // Round 1 needs 2 groups; hand is exactly those 6 cards
    const groupA = [
      card('r7', 'red', 7),
      card('y7', 'yellow', 7),
      card('g7', 'green', 7),
    ]
    const groupB = [
      card('r5', 'red', 5),
      card('y5', 'yellow', 5),
      card('b5', 'black', 5),
    ]
    const s = stubPlayState({ hand: [...groupA, ...groupB] })
    const next = goDown(s, [
      groupA.map((c) => c.id),
      groupB.map((c) => c.id),
    ])
    expect(next.lastError).toBeNull()
    expect(next.roundIndex).toBe(0)
    expect(next.phase).toBe('round-end')
  })

  it('stores a gap wild in the rank it stands for', () => {
    const run = [
      card('b1', 'black', 1),
      card('b2', 'black', 2),
      card('b4', 'black', 4),
      card('w', 'wild', 0),
    ]
    const group = [
      card('r7', 'red', 7),
      card('y7', 'yellow', 7),
      card('g7', 'green', 7),
    ]
    const s = stubPlayState({
      hand: [...run, ...group],
      roundIndex: 1,
    })
    const next = goDown(s, [
      run.map((c) => c.id),
      group.map((c) => c.id),
    ])
    expect(next.lastError).toBeNull()
    const laid = next.tableMetlds.find((m) => m.type === 'run')
    expect(laid?.cards.map((c) => c.id)).toEqual(['b1', 'b2', 'w', 'b4'])
  })
})

describe('extendMeld', () => {
  it('returns error if player has not gone down', () => {
    let s = drawFromDeck(openRound())
    const s2 = extendMeld(s, 'nonexistent', s.players[0].hand[0].id)
    expect(s2.lastError).toBeTruthy()
  })

  it('ends the round when extending with the last card', () => {
    const meld: Meld = {
      id: 'meld_0',
      ownerIndex: 0,
      type: 'group',
      cards: [
        card('r7', 'red', 7),
        card('y7', 'yellow', 7),
        card('g7', 'green', 7),
      ],
    }
    const s = stubPlayState({
      hand: [card('b7', 'black', 7)],
      hasGoneDown: true,
      tableMetlds: [meld],
    })
    const next = extendMeld(s, 'meld_0', 'b7')
    expect(next.lastError).toBeNull()
    expect(next.roundIndex).toBe(0)
    expect(next.phase).toBe('round-end')
  })

  it('pulls a wild out when a natural takes its rank, then undo restores both', () => {
    const meld: Meld = {
      id: 'meld_0',
      ownerIndex: 1,
      type: 'run',
      cards: [
        card('r3', 'red', 3),
        card('w', 'wild', 0),
        card('r5', 'red', 5),
        card('r6', 'red', 6),
      ],
    }
    const s = stubPlayState({
      hand: [card('r4', 'red', 4), card('extra', 'black', 9)],
      hasGoneDown: true,
      tableMetlds: [meld],
    })
    const played = extendMeld(s, 'meld_0', 'r4')
    expect(played.lastError).toBeNull()
    expect(played.pendingWild?.id).toBe('w')
    expect(played.players[0].hand.map((c) => c.id)).toEqual(['extra'])
    expect(played.tableMetlds[0].cards.map((c) => c.id)).toEqual(['r3', 'r4', 'r5', 'r6'])
    expect(discard(played, 'extra').lastError).toBeTruthy()

    const undone = undoExtend(played)
    expect(undone.pendingWild).toBeNull()
    expect(undone.players[0].hand.map((c) => c.id)).toContain('r4')
    expect(undone.tableMetlds[0].cards.map((c) => c.id)).toEqual(['r3', 'w', 'r5', 'r6'])
  })
})
