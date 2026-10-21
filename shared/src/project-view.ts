import type { GameState } from '../../web/src/game/state'
import { topDiscard } from '../../web/src/game/state'
import type { ClientPlayerView, ClientView } from './protocol'

/** Build a fogged view for one seat. Never includes draw pile or other hands. */
export function projectView(state: GameState, seatIndex: number): ClientView {
  const players: ClientPlayerView[] = state.players.map((p) => ({
    index: p.index,
    displayName: p.displayName,
    avatarId: p.avatarId,
    isAI: p.isAI,
    handCount: p.hand.length,
    hasGoneDown: p.hasGoneDown,
    cumulativeScore: p.cumulativeScore,
    roundScores: [...p.roundScores],
  }))

  const me = state.players[seatIndex]
  const hand = me ? me.hand.map((c) => ({ ...c })) : []

  return {
    seatIndex,
    phase: state.phase,
    roundIndex: state.roundIndex,
    currentPlayerIndex: state.currentPlayerIndex,
    roundLeaderIndex: state.roundLeaderIndex,
    hasDrawnThisTurn: state.hasDrawnThisTurn,
    lastDiscarderIndex: state.lastDiscarderIndex,
    buyCallerSeats: state.buyIntents.map((b) => b.playerIndex),
    tableMelds: state.tableMetlds.map((m) => ({
      ...m,
      cards: m.cards.map((c) => ({ ...c })),
    })),
    discardTop: topDiscard(state) ? { ...topDiscard(state)! } : null,
    discardCount: state.discardPile.length,
    drawCount: state.drawPile.length,
    ready: [...state.ready],
    roundVictorIndex: state.roundVictorIndex,
    lastError: state.currentPlayerIndex === seatIndex ? state.lastError : null,
    pendingWild: state.pendingWild ? { ...state.pendingWild } : null,
    players,
    hand,
    extendHistoryLength: state.extendHistory.length,
  }
}
