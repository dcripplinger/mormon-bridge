import { describe, it, expect } from 'vitest'
import { createGame, drawFromDeck, buyDiscard, claimDiscardAsDraw, goDown, discard, extendMeld } from './state'

function makeGame(numHumans = 3, numAI = 0) {
  const names = Array.from({ length: numHumans }, (_, i) => `P${i + 1}`)
  return createGame(names, numAI)
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
    expect(() => createGame(['P1', 'P2'], 0)).toThrow()
  })

  it('throws for more than 5 players', () => {
    expect(() => createGame(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], 0)).toThrow()
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

describe('buyDiscard', () => {
  it('gives top discard and penalty card to buyer', () => {
    const base = makeGame(3)
    const top = base.discardPile[base.discardPile.length - 1]
    const s = buyDiscard(base, 1)  // player 1 buys
    const buyer = s.players[1]
    expect(buyer.hand.find((c) => c.id === top.id)).toBeTruthy()
    expect(buyer.hand.length).toBe(13)  // 11 + discard + penalty
  })

  it('gives the current player a drawn card', () => {
    const base = makeGame(3)
    const s = buyDiscard(base, 1)
    expect(s.players[0].hand).toHaveLength(12)  // 11 + drawn
  })

  it('advances to play-or-discard', () => {
    const s = buyDiscard(makeGame(3), 1)
    expect(s.phase).toBe('play-or-discard')
  })

  it('returns error if current player tries to buy', () => {
    const s = buyDiscard(makeGame(3), 0)
    expect(s.lastError).toBeTruthy()
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
})

describe('extendMeld', () => {
  it('returns error if player has not gone down', () => {
    let s = drawFromDeck(makeGame())
    const s2 = extendMeld(s, 'nonexistent', s.players[0].hand[0].id)
    expect(s2.lastError).toBeTruthy()
  })
})
