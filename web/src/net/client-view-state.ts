import type { ClientView } from '@mormon-bridge/shared'
import type { Card } from '../game/card'
import type { GameState } from '../game/state'

/** Opaque placeholders so hand counts render; never shown face-up for other seats. */
function stubCards(count: number, seat: number): Card[] {
  const out: Card[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: `__stub-${seat}-${i}`,
      color: 'black',
      number: 1,
    })
  }
  return out
}

function stubDrawPile(count: number): Card[] {
  const out: Card[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: `__draw-${i}`,
      color: 'black',
      number: 1,
    })
  }
  return out
}

/**
 * Build a local GameState shadow from a fogged ClientView so GameScreen can render.
 * Draw pile / other hands are stubs — not authoritative.
 */
export function clientViewToGameState(view: ClientView): GameState {
  return {
    players: view.players.map((p) => ({
      index: p.index,
      displayName: p.displayName,
      isAI: p.isAI,
      avatarId: p.avatarId,
      hand: p.index === view.seatIndex ? view.hand.map((c) => ({ ...c })) : stubCards(p.handCount, p.index),
      hasGoneDown: p.hasGoneDown,
      cumulativeScore: p.cumulativeScore,
      roundScores: [...p.roundScores],
    })),
    drawPile: stubDrawPile(view.drawCount),
    discardPile: (() => {
      if (!view.discardTop) return []
      const pile: Card[] = []
      for (let i = 0; i < Math.max(0, view.discardCount - 1); i++) {
        pile.push({ id: `__disc-${i}`, color: 'black', number: 1 })
      }
      pile.push({ ...view.discardTop })
      return pile
    })(),
    tableMetlds: view.tableMelds.map((m) => ({
      ...m,
      cards: m.cards.map((c) => ({ ...c })),
    })),
    roundIndex: view.roundIndex,
    currentPlayerIndex: view.currentPlayerIndex,
    phase: view.phase,
    hasDrawnThisTurn: view.hasDrawnThisTurn,
    lastDiscarderIndex: view.lastDiscarderIndex,
    buyIntents: view.buyCallerSeats.map((playerIndex) => ({
      playerIndex,
      elapsedMs: 0,
    })),
    extendHistory: [],
    pendingWild: view.pendingWild ? { ...view.pendingWild } : null,
    roundVictorIndex: view.roundVictorIndex,
    ready: [...view.ready],
    roundLeaderIndex: view.roundLeaderIndex,
    meldIdCounter: 0,
    lastError: view.lastError,
  }
}
