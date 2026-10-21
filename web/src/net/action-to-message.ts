import type { ClientMessage } from '@mormon-bridge/shared'
import type { GameScreenAction } from '../app/GameScreen'

/** Map a local GameScreen action to a host ClientMessage (seat is implied by session). */
export function actionToClientMessage(action: GameScreenAction): ClientMessage | null {
  switch (action.type) {
    case 'DECLARE_BUY':
      return { type: 'declareBuy', elapsedMs: action.elapsedMs }
    case 'CLAIM_DISCARD':
      return { type: 'claimDiscard' }
    case 'DRAW_DECK':
      return { type: 'drawDeck' }
    case 'DISCARD':
      return { type: 'discard', cardId: action.cardId }
    case 'GO_DOWN':
      return { type: 'goDown', meldCardArrays: action.meldCardArrays }
    case 'EXTEND':
      return { type: 'extend', meldId: action.meldId, cardId: action.cardId, side: action.side }
    case 'UNDO_EXTEND':
      return { type: 'undoExtend' }
    case 'KEEP_WILD':
      return { type: 'keepWild' }
    case 'CONTINUE_ROUND':
      return { type: 'continueRound' }
    case 'SET_READY':
      return { type: 'setReady', ready: action.ready }
    case 'REORDER':
      return { type: 'reorderHand', orderedIds: action.orderedIds }
    case 'REVEAL_OPENING':
      return { type: 'revealOpening' }
    default:
      return null
  }
}
