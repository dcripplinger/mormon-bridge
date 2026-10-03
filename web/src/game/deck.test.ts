import { describe, it, expect } from 'vitest'
import { buildDeck, dealHands, STARTING_HAND_SIZE } from './deck'

describe('buildDeck', () => {
  it('creates 171 cards', () => {
    expect(buildDeck()).toHaveLength(171)
  })

  it('has 3 wilds', () => {
    const deck = buildDeck()
    expect(deck.filter((c) => c.color === 'wild')).toHaveLength(3)
  })

  it('has 42 red cards (3 copies x 14)', () => {
    const deck = buildDeck()
    expect(deck.filter((c) => c.color === 'red')).toHaveLength(42)
  })

  it('gives all cards unique ids', () => {
    const deck = buildDeck()
    const ids = new Set(deck.map((c) => c.id))
    expect(ids.size).toBe(deck.length)
  })
})

describe('dealHands', () => {
  it('deals 11 cards to each player', () => {
    const deck = buildDeck()
    const { hands } = dealHands(deck, 4)
    for (const hand of hands) {
      expect(hand).toHaveLength(STARTING_HAND_SIZE)
    }
  })

  it('leaves the correct number of cards in the draw pile', () => {
    const deck = buildDeck()
    const numPlayers = 4
    const { drawPile } = dealHands(deck, numPlayers)
    expect(drawPile).toHaveLength(171 - numPlayers * STARTING_HAND_SIZE)
  })
})
