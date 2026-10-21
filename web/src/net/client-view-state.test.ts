import { describe, expect, it } from 'vitest'
import type { ClientView } from '@mormon-bridge/shared'
import { clientViewToGameState } from './client-view-state'

function sampleView(): ClientView {
  return {
    seatIndex: 1,
    phase: 'buy-window',
    roundIndex: 0,
    currentPlayerIndex: 0,
    roundLeaderIndex: 0,
    hasDrawnThisTurn: false,
    lastDiscarderIndex: null,
    buyCallerSeats: [2],
    tableMelds: [],
    discardTop: { id: 'd1', color: 'red', number: 5 },
    discardCount: 1,
    drawCount: 10,
    ready: [true, true, true],
    roundVictorIndex: null,
    lastError: null,
    pendingWild: null,
    players: [
      {
        index: 0,
        displayName: 'A',
        avatarId: 'a',
        isAI: false,
        handCount: 11,
        hasGoneDown: false,
        cumulativeScore: 0,
        roundScores: [],
      },
      {
        index: 1,
        displayName: 'B',
        avatarId: 'b',
        isAI: false,
        handCount: 2,
        hasGoneDown: false,
        cumulativeScore: 0,
        roundScores: [],
      },
      {
        index: 2,
        displayName: 'C',
        avatarId: 'c',
        isAI: false,
        handCount: 11,
        hasGoneDown: false,
        cumulativeScore: 0,
        roundScores: [],
      },
    ],
    hand: [
      { id: 'h1', color: 'green', number: 3 },
      { id: 'h2', color: 'black', number: 9 },
    ],
    extendHistoryLength: 0,
  }
}

describe('clientViewToGameState', () => {
  it('keeps the viewer hand and stubs other hands', () => {
    const state = clientViewToGameState(sampleView())
    expect(state.players[1].hand.map((c) => c.id)).toEqual(['h1', 'h2'])
    expect(state.players[0].hand).toHaveLength(11)
    expect(state.players[0].hand[0].id.startsWith('__stub-')).toBe(true)
    expect(state.buyIntents).toEqual([{ playerIndex: 2, elapsedMs: 0 }])
    expect(state.drawPile).toHaveLength(10)
  })
})
