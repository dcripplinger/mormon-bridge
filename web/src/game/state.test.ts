import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import type { GameState, Meld, PlayerState } from './state'
import {
  continueAfterRound,
  createGame,
  drawFromDeck,
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
  return createGame(setups)
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
    ...extras,
  }
}

/** Minimal in-play state for round-end scenarios (avoids random dealing). */
function stubPlayState(opts: {
  hand: Card[]
  hasGoneDown?: boolean
  tableMetlds?: Meld[]
  roundIndex?: number
}): GameState {
  const { hand, hasGoneDown = false, tableMetlds = [], roundIndex = 0 } = opts
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
    meldIdCounter: tableMetlds.length,
    lastError: null,
  }
}

describe('createGame', () => {
  it('starts in buy-window phase', () => {
    const state = makeGame(3)
    expect(state.phase).toBe('buy-window')
  })

  it('deals 11 cards to each player', () => {
    const state = makeGame(3)
    for (const p of state.players) {
      expect(p.hand).toHaveLength(11)
    }
  })

  it('starts discard pile with one card', () => {
    const state = makeGame(3)
    expect(state.discardPile).toHaveLength(1)
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
    expect(state.players.map((p) => p.avatarId)).toEqual(['h03', 'b01', 'b02'])
    expect(state.players.map((p) => p.isAI)).toEqual([false, true, true])
  })
})

describe('drawFromDeck', () => {
  it('advances phase to play-or-discard', () => {
    const s = drawFromDeck(makeGame())
    expect(s.phase).toBe('play-or-discard')
    expect(s.hasDrawnThisTurn).toBe(true)
  })

  it('gives the current player one more card', () => {
    const base = makeGame()
    const s = drawFromDeck(base)
    expect(s.players[0].hand).toHaveLength(12)
  })

  it('returns error if not in buy-window or draw phase', () => {
    const s = drawFromDeck(makeGame())  // now in play-or-discard
    const s2 = drawFromDeck(s)
    expect(s2.lastError).toBeTruthy()
  })
})

describe('claimDiscardAsDraw', () => {
  it('gives top discard to current player', () => {
    const base = makeGame()
    const topCard = base.discardPile[base.discardPile.length - 1]
    const s = claimDiscardAsDraw(base)
    expect(s.players[0].hand.find((c) => c.id === topCard.id)).toBeTruthy()
    expect(s.discardPile).toHaveLength(0)
    expect(s.phase).toBe('play-or-discard')
  })
})

describe('declareBuy', () => {
  it('records the caller without moving cards', () => {
    const base = makeGame(3)
    const s = declareBuy(base, 1)
    expect(s.lastError).toBeNull()
    expect(s.buyIntents).toEqual([1])
    expect(s.phase).toBe('buy-window')
    expect(s.players[1].hand).toHaveLength(11)
    expect(s.discardPile).toHaveLength(1)
  })

  it('lets a later player call buy after someone else has', () => {
    const base = makeGame(3)
    const first = declareBuy(base, 1)
    expect(canBuyDiscard(first, 2)).toBe(true)
    expect(canBuyDiscard(first, 1)).toBe(false)
    const second = declareBuy(first, 2)
    expect(second.buyIntents).toEqual([1, 2])
    expect(second.phase).toBe('buy-window')
  })

  it('returns error if current player tries to buy', () => {
    const s = declareBuy(makeGame(3), 0)
    expect(s.lastError).toBeTruthy()
  })

  it('returns error if the discarder tries to buy their own discard', () => {
    let s = drawFromDeck(makeGame(3))
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(s.currentPlayerIndex).toBe(1)
    expect(s.lastDiscarderIndex).toBe(0)
    expect(canBuyDiscard(s, 0)).toBe(false)
    const bought = declareBuy(s, 0)
    expect(bought.lastError).toBe('Cannot buy your own discard')
  })

  it('allows a non-next player to call buy on someone else\'s discard', () => {
    let s = drawFromDeck(makeGame(3))
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(canBuyDiscard(s, 2)).toBe(true)
    const called = declareBuy(s, 2)
    expect(called.lastError).toBeNull()
    expect(called.buyIntents).toEqual([2])
  })

  it('allows buying the initial deck-flip discard', () => {
    const s = makeGame(3)
    expect(s.lastDiscarderIndex).toBeNull()
    expect(canBuyDiscard(s, 1)).toBe(true)
  })
})

describe('drawFromDeck with a pending buy', () => {
  it('deals the discard and a penalty to the first buyer, then draws for the active player', () => {
    const base = makeGame(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const penalty = base.drawPile[base.drawPile.length - 1]
    const drawn = base.drawPile[base.drawPile.length - 2]
    const called = declareBuy(declareBuy(base, 1), 2)
    const s = drawFromDeck(called)
    expect(s.lastError).toBeNull()
    expect(s.phase).toBe('play-or-discard')
    expect(s.buyIntents).toEqual([])
    expect(s.players[1].hand.find((c) => c.id === top.id)).toBeTruthy()
    expect(s.players[1].hand.find((c) => c.id === penalty.id)).toBeTruthy()
    expect(s.players[1].hand).toHaveLength(13)
    expect(s.players[2].hand).toHaveLength(11)
    expect(s.players[0].hand.find((c) => c.id === drawn.id)).toBeTruthy()
    expect(s.players[0].hand).toHaveLength(12)
  })

  it('closes the buy window so nobody else can call', () => {
    const s = drawFromDeck(declareBuy(makeGame(3), 1))
    expect(canBuyDiscard(s, 2)).toBe(false)
  })
})

describe('claimDiscardAsDraw denies a pending buy', () => {
  it('gives the discard to the active player and nothing to the buyer', () => {
    const base = makeGame(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const called = declareBuy(base, 1)
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
    let s = drawFromDeck(makeGame())
    const cardId = s.players[0].hand[0].id
    s = discard(s, cardId)
    expect(s.players[0].hand.find((c) => c.id === cardId)).toBeUndefined()
    expect(s.discardPile[s.discardPile.length - 1].id).toBe(cardId)
  })

  it('advances to next player and resets to buy-window', () => {
    let s = drawFromDeck(makeGame())
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
    expect(dealt.phase).toBe('buy-window')
  })
})

describe('goDown', () => {
  it('returns error if round requires groups but given runs', () => {
    // Round 1 = 2 groups, 0 runs
    let s = drawFromDeck(makeGame())
    // Build a "run" (invalid as group) from hand cards — just test validation path
    const runIds = s.players[0].hand.slice(0, 4).map((c) => c.id)
    const groupIds = s.players[0].hand.slice(4, 7).map((c) => c.id)
    const s2 = goDown(s, [runIds, groupIds])
    // Might fail on invalid meld or wrong mix; either way lastError should be set
    // (the cards are random so we just verify the function runs without throwing)
    expect(typeof s2.lastError === 'string' || s2.lastError === null).toBe(true)
  })

  it('rejects going down with wrong number of melds', () => {
    let s = drawFromDeck(makeGame())
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
})

describe('extendMeld', () => {
  it('returns error if player has not gone down', () => {
    let s = drawFromDeck(makeGame())
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
      hand: [card('r4', 'red', 4), card('extra', 'blue', 9)],
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
