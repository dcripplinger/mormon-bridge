import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Card } from '../game/card'
import {
  decideBuy,
  decideDraw,
  decidePlay,
  sampleBuyDelayMs,
  sampleDrawWindowMs,
  sampleThinkDelayMs,
} from '../game/ai'
import {
  canPlaceCard,
  canSubmit as canSubmitPrep,
  createPrepSlots,
  mergeVisibleHandOrder,
  placeCard,
  removeCard as removePrepCard,
  swapWildEnd,
  type PrepSlot,
} from '../game/go-down-prep'
import type { GameState, Meld } from '../game/state'
import {
  buyDiscard,
  canBuyDiscard,
  claimDiscardAsDraw,
  discard,
  drawFromDeck,
  extendMeld,
  goDown,
  reorderHand,
  topDiscard,
} from '../game/state'
import AvatarView from '../ui/AvatarView'
import CardPile from '../ui/CardPile'
import DrawFlight from '../ui/DrawFlight'
import GoDownPrep from '../ui/GoDownPrep'
import HandView from '../ui/HandView'
import OpponentSeat, { SEAT_AVATAR_SIZE, SEAT_EDGE_INSET_PX } from '../ui/OpponentSeat'
import PlayerSets from '../ui/PlayerSets'
import ScoreBoard from '../ui/ScoreBoard'
import SetZoomOverlay from '../ui/SetZoomOverlay'
import {
  placeOpponents,
  seatEdgeLeftPercent,
  seatEdgeTopPercent,
} from '../ui/seat-layout'
import type { OpponentSeatPlacement, SeatSide } from '../ui/seat-layout'
import { FULL_CARD_H, useTableLayout } from '../ui/use-table-layout'
import { usePortrait } from '../ui/use-portrait'

interface Props {
  initialState: GameState
  onReturnToMenu: () => void
  /** Called after every committed state change; fire-and-forget persistence. */
  onSave: (state: GameState) => void
  /** Called once when the game finishes (phase === 'game-end'); clears the save. */
  onGameEnd: () => void
}

type Action =
  | { type: 'BUY'; buyerIndex: number }
  | { type: 'CLAIM_DISCARD' }
  | { type: 'DRAW_DECK' }
  | { type: 'EXTEND'; meldId: string; cardId: string }
  | { type: 'DISCARD'; cardId: string }
  | { type: 'REORDER'; playerIndex: number; orderedIds: string[] }
  | { type: 'GO_DOWN'; meldCardArrays: string[][] }

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'BUY':
      return buyDiscard(state, action.buyerIndex)
    case 'CLAIM_DISCARD':
      return claimDiscardAsDraw(state)
    case 'DRAW_DECK':
      return drawFromDeck(state)
    case 'EXTEND':
      return extendMeld(state, action.meldId, action.cardId)
    case 'DISCARD':
      return discard(state, action.cardId)
    case 'REORDER':
      return reorderHand(state, action.playerIndex, action.orderedIds)
    case 'GO_DOWN':
      return goDown(state, action.meldCardArrays)
    default:
      return state
  }
}

interface FlightItem {
  card: Card
  sourceRect: DOMRect
  targetRef: React.RefObject<HTMLElement | null>
  faceDown?: boolean
  viaCenter?: boolean
  /** Card already in this player's hand — hide from seat until flight lands. */
  arrivalPlayerIndex?: number
  /** Dispatch after the card arrives (AI discard). */
  pendingAction?: Action
}

// ---------------------------------------------------------------------------
// Seat-relative set-pocket positioning helpers
// ---------------------------------------------------------------------------

/** Match scale constants from OpponentSeat.tsx. */
const SEAT_BASE_SCALE = 0.7
const SEAT_CROWDED_SCALE = 0.58

/**
 * Pixel distance from the screen edge to just inside the opponent seat's
 * card reach (used to position that player's set pocket).
 */
function setsInwardPx(placement: OpponentSeatPlacement): number {
  const scale = placement.sideCount > 1 ? SEAT_CROWDED_SCALE : SEAT_BASE_SCALE
  return SEAT_EDGE_INSET_PX + (FULL_CARD_H * scale) / 2 + 8
}

/** Absolute position style for an opponent's set pocket on the table. */
function setsPocketStyle(placement: OpponentSeatPlacement): React.CSSProperties {
  const inset = setsInwardPx(placement)
  const { side } = placement
  if (side === 'left') {
    return {
      position: 'absolute',
      left: inset,
      top: `${seatEdgeTopPercent(placement)}%`,
      transform: 'translateY(-50%)',
      zIndex: 1,
      pointerEvents: 'auto',
    }
  }
  if (side === 'right') {
    return {
      position: 'absolute',
      right: inset,
      top: `${seatEdgeTopPercent(placement)}%`,
      transform: 'translateY(-50%)',
      zIndex: 1,
      pointerEvents: 'auto',
    }
  }
  // 'top'
  return {
    position: 'absolute',
    top: inset,
    left: `${seatEdgeLeftPercent(placement)}%`,
    transform: 'translateX(-50%)',
    zIndex: 1,
    pointerEvents: 'auto',
  }
}

/** Fans lay out horizontally for top/human; stacked vertically for left/right. */
function setsDirection(side: SeatSide | 'human'): 'row' | 'column' {
  return side === 'top' || side === 'human' ? 'row' : 'column'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameScreen({ initialState, onReturnToMenu, onSave, onGameEnd }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const layout = useTableLayout()

  // Autosave on every state change; clear the save when the game ends.
  const onSaveRef = useRef(onSave)
  const onGameEndRef = useRef(onGameEnd)
  onSaveRef.current = onSave
  onGameEndRef.current = onGameEnd
  useEffect(() => {
    if (state.phase === 'game-end') {
      onGameEndRef.current()
    } else {
      onSaveRef.current(state)
    }
  }, [state])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetMeldId, setTargetMeldId] = useState<string | null>(null)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [discardHot, setDiscardHot] = useState(false)
  const [zoomedMeld, setZoomedMeld] = useState<Meld | null>(null)
  const portrait = usePortrait()

  // ---- Go-Down prep state ----
  const [prepOpen, setPrepOpen] = useState(false)
  const [prepSlots, setPrepSlots] = useState<PrepSlot[]>([])
  const [prepHoveredSlotIndex, setPrepHoveredSlotIndex] = useState<number | null>(null)
  const [returningCardIds, setReturningCardIds] = useState<Set<string>>(() => new Set())
  const prepSlotDropZoneRefs = useRef<Array<React.RefObject<HTMLDivElement | null>>>(
    Array.from({ length: 3 }, () => ({ current: null })),
  )

  // ---- draw / discard animation state ----
  const [flightQueue, setFlightQueue] = useState<FlightItem[]>([])
  const flightQueueRef = useRef<FlightItem[]>([])
  const [landingCardId, setLandingCardId] = useState<string | null>(null)
  /** Visual-only: card leaving an opponent seat before DISCARD is applied. */
  const [pendingDiscard, setPendingDiscard] = useState<{
    playerIndex: number
    cardId: string
  } | null>(null)
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const deckWrapRef = useRef<HTMLDivElement | null>(null)
  const discardWrapRef = useRef<HTMLDivElement | null>(null)
  const endSlotRef = useRef<HTMLDivElement | null>(null)
  const handAnchorRefs = useMemo(
    () =>
      Array.from({ length: initialState.players.length }, () => ({
        current: null as HTMLDivElement | null,
      })),
    [initialState.players.length],
  )

  const activeFlightItem = flightQueue[0] ?? null
  const isFlying = activeFlightItem !== null
  const animBusy = isFlying || pendingDiscard !== null

  const enqueueFlight = useCallback((item: FlightItem) => {
    flightQueueRef.current = [...flightQueueRef.current, item]
    setFlightQueue(flightQueueRef.current)
  }, [])

  const handleFlightComplete = useCallback(() => {
    const [done, ...rest] = flightQueueRef.current
    if (!done) return
    flightQueueRef.current = rest
    setFlightQueue(rest)

    if (done.pendingAction) {
      dispatch(done.pendingAction)
      setPendingDiscard(null)
      return
    }
    if (done.arrivalPlayerIndex === undefined) {
      if (landingTimerRef.current !== null) clearTimeout(landingTimerRef.current)
      setLandingCardId(done.card.id)
      landingTimerRef.current = setTimeout(() => setLandingCardId(null), 320)
    }
  }, [])

  useEffect(() => () => {
    if (landingTimerRef.current !== null) clearTimeout(landingTimerRef.current)
  }, [])

  const currentPlayer = state.players[state.currentPlayerIndex]
  const top = topDiscard(state)
  const humanPlayerIndex = state.players.findIndex((p) => !p.isAI)
  const opponentSeats =
    humanPlayerIndex === -1
      ? []
      : placeOpponents(state.players.length, humanPlayerIndex, portrait)

  // Keep a live state ref so AI timers can bail if the window already closed.
  const stateRef = useRef(state)
  stateRef.current = state

  // Melds grouped by owner so each player's set pocket can render its own fans.
  const meldsByPlayer = useMemo(() => {
    const map = new Map<number, Meld[]>()
    for (const meld of state.tableMetlds) {
      const list = map.get(meld.ownerIndex) ?? []
      list.push(meld)
      map.set(meld.ownerIndex, list)
    }
    return map
  }, [state.tableMetlds])

  // AI: buy-race for eligible bots + current-bot draw/play (paused while animating)
  useEffect(() => {
    if (animBusy) return
    if (state.phase === 'game-end' || state.phase === 'round-end') return

    const timers: ReturnType<typeof setTimeout>[] = []

    const animateAiDrawDeck = (playerIndex: number) => {
      const s = stateRef.current
      const rect = deckWrapRef.current?.getBoundingClientRect()
      const topCard =
        s.drawPile.length > 0 ? s.drawPile[s.drawPile.length - 1] : null
      const targetRef = handAnchorRefs[playerIndex]
      dispatch({ type: 'DRAW_DECK' })
      if (rect && topCard && targetRef) {
        enqueueFlight({
          card: topCard,
          sourceRect: rect,
          targetRef,
          faceDown: true,
          viaCenter: true,
          arrivalPlayerIndex: playerIndex,
        })
      }
    }

    const animateAiClaim = (playerIndex: number) => {
      const s = stateRef.current
      const rect = discardWrapRef.current?.getBoundingClientRect()
      const topCard = topDiscard(s)
      const targetRef = handAnchorRefs[playerIndex]
      dispatch({ type: 'CLAIM_DISCARD' })
      if (rect && topCard && targetRef) {
        enqueueFlight({
          card: topCard,
          sourceRect: rect,
          targetRef,
          faceDown: false,
          viaCenter: true,
          arrivalPlayerIndex: playerIndex,
        })
      }
    }

    const animateAiBuy = (buyerIndex: number) => {
      const s = stateRef.current
      if (!canBuyDiscard(s, buyerIndex)) return
      const discardRect = discardWrapRef.current?.getBoundingClientRect()
      const deckRect = deckWrapRef.current?.getBoundingClientRect()
      const topCard = topDiscard(s)
      const targetRef = handAnchorRefs[buyerIndex]
      const nextState = buyDiscard(s, buyerIndex)
      const oldHandIds = new Set(s.players[buyerIndex].hand.map((c) => c.id))
      const penaltyCard =
        nextState.players[buyerIndex].hand.find(
          (c) => c.id !== topCard?.id && !oldHandIds.has(c.id),
        ) ?? null

      dispatch({ type: 'BUY', buyerIndex })

      if (discardRect && topCard && targetRef) {
        enqueueFlight({
          card: topCard,
          sourceRect: discardRect,
          targetRef,
          faceDown: false,
          viaCenter: true,
          arrivalPlayerIndex: buyerIndex,
        })
      }
      if (deckRect && penaltyCard && targetRef) {
        enqueueFlight({
          card: penaltyCard,
          sourceRect: deckRect,
          targetRef,
          faceDown: true,
          viaCenter: true,
          arrivalPlayerIndex: buyerIndex,
        })
      }
      // Current player also drew from the deck as part of buyDiscard —
      // animate that card to the current seat when the buyer is not current.
      const currentIdx = s.currentPlayerIndex
      const currentOldIds = new Set(s.players[currentIdx].hand.map((c) => c.id))
      const currentDrawn =
        nextState.players[currentIdx].hand.find((c) => !currentOldIds.has(c.id)) ?? null
      const currentTarget = handAnchorRefs[currentIdx]
      if (deckRect && currentDrawn && currentTarget) {
        enqueueFlight({
          card: currentDrawn,
          sourceRect: deckRect,
          targetRef: currentTarget,
          faceDown: currentIdx !== humanPlayerIndex,
          viaCenter: true,
          arrivalPlayerIndex: currentIdx,
        })
      }
    }

    if (state.phase === 'buy-window') {
      for (const p of state.players) {
        if (!p.isAI) continue
        if (!canBuyDiscard(state, p.index)) continue
        if (!decideBuy(state, p.index)) continue
        const delay = sampleBuyDelayMs()
        timers.push(
          setTimeout(() => {
            const s = stateRef.current
            if (!canBuyDiscard(s, p.index)) return
            animateAiBuy(p.index)
          }, delay),
        )
      }

      if (currentPlayer.isAI) {
        const delay = sampleDrawWindowMs()
        timers.push(
          setTimeout(() => {
            const s = stateRef.current
            if (s.phase !== 'buy-window' && s.phase !== 'draw') return
            if (s.currentPlayerIndex !== currentPlayer.index) return
            const choice = decideDraw(s)
            if (choice === 'claim') animateAiClaim(currentPlayer.index)
            else animateAiDrawDeck(currentPlayer.index)
          }, delay),
        )
      }
    } else if (state.phase === 'draw' && currentPlayer.isAI) {
      const delay = sampleThinkDelayMs()
      timers.push(
        setTimeout(() => {
          const s = stateRef.current
          if (s.phase !== 'draw') return
          animateAiDrawDeck(currentPlayer.index)
        }, delay),
      )
    } else if (state.phase === 'play-or-discard' && currentPlayer.isAI) {
      const delay = sampleThinkDelayMs()
      timers.push(
        setTimeout(() => {
          const s = stateRef.current
          if (s.phase !== 'play-or-discard') return
          if (s.players[s.currentPlayerIndex]?.index !== currentPlayer.index) return

          const plan = decidePlay(s)
          const step = plan.steps[0]
          if (!step) return

          if (step.type === 'goDown') {
            dispatch({ type: 'GO_DOWN', meldCardArrays: step.melds })
            return
          }

          if (step.type === 'extend') {
            dispatch({ type: 'EXTEND', meldId: step.meldId, cardId: step.cardId })
            return
          }

          if (step.type === 'discard') {
            const player = s.players[s.currentPlayerIndex]
            const card = player.hand.find((c) => c.id === step.cardId)
            if (!card) return
            const seatEl = handAnchorRefs[player.index]?.current
            const sourceRect =
              seatEl?.getBoundingClientRect() ??
              new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 64, 96)
            setPendingDiscard({ playerIndex: player.index, cardId: card.id })
            enqueueFlight({
              card,
              sourceRect,
              targetRef: discardWrapRef,
              faceDown: false,
              viaCenter: false,
              pendingAction: { type: 'DISCARD', cardId: card.id },
            })
          }
        }, delay),
      )
    }

    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [state, currentPlayer, animBusy, humanPlayerIndex, handAnchorRefs, enqueueFlight])

  const toggleCard = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = () => {
    setSelectedIds(new Set())
    setTargetMeldId(null)
  }

  const handleDrawDeck = useCallback((sourceRect?: DOMRect) => {
    const rect = sourceRect ?? deckWrapRef.current?.getBoundingClientRect()
    const topCard = state.drawPile.length > 0
      ? state.drawPile[state.drawPile.length - 1]
      : null
    dispatch({ type: 'DRAW_DECK' })
    if (rect && topCard) {
      enqueueFlight({
        card: topCard,
        sourceRect: rect,
        targetRef: endSlotRef,
        faceDown: false,
        viaCenter: true,
      })
    }
  }, [state.drawPile, enqueueFlight])

  const handleClaimDiscard = useCallback((sourceRect?: DOMRect) => {
    const rect = sourceRect ?? discardWrapRef.current?.getBoundingClientRect()
    const topCard = topDiscard(state)
    dispatch({ type: 'CLAIM_DISCARD' })
    if (rect && topCard) {
      enqueueFlight({
        card: topCard,
        sourceRect: rect,
        targetRef: endSlotRef,
        faceDown: false,
        viaCenter: true,
      })
    }
  }, [state, enqueueFlight])

  const handleBuy = useCallback(() => {
    if (humanPlayerIndex === -1) return
    const discardRect = discardWrapRef.current?.getBoundingClientRect()
    const deckRect = deckWrapRef.current?.getBoundingClientRect()
    const topCard = topDiscard(state)

    const nextState = buyDiscard(state, humanPlayerIndex)
    const oldHandIds = new Set(state.players[humanPlayerIndex].hand.map((c) => c.id))
    const penaltyCard =
      nextState.players[humanPlayerIndex].hand.find(
        (c) => c.id !== topCard?.id && !oldHandIds.has(c.id),
      ) ?? null

    dispatch({ type: 'BUY', buyerIndex: humanPlayerIndex })

    if (discardRect && topCard) {
      enqueueFlight({
        card: topCard,
        sourceRect: discardRect,
        targetRef: endSlotRef,
        faceDown: false,
        viaCenter: true,
      })
    }

    if (deckRect && penaltyCard) {
      enqueueFlight({
        card: penaltyCard,
        sourceRect: deckRect,
        targetRef: endSlotRef,
        faceDown: false,
        viaCenter: true,
      })
    }
  }, [state, humanPlayerIndex, enqueueFlight])

  const handleExtend = (meldId: string) => {
    if (selectedIds.size !== 1) {
      setTargetMeldId(meldId)
      return
    }
    const cardId = [...selectedIds][0]
    dispatch({ type: 'EXTEND', meldId, cardId })
    clearSelection()
  }

  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      if (humanPlayerIndex === -1) return
      const fullHand = state.players[humanPlayerIndex].hand
      const prepIds = new Set<string>()
      for (const slot of prepSlots) {
        for (const card of slot.cards) prepIds.add(card.id)
      }
      const merged = mergeVisibleHandOrder(
        fullHand.map((c) => c.id),
        orderedIds,
        prepIds,
      )
      if (!merged) return
      dispatch({ type: 'REORDER', playerIndex: humanPlayerIndex, orderedIds: merged })
    },
    [humanPlayerIndex, state.players, prepSlots],
  )

  const handleDiscardCard = useCallback((cardId: string) => {
    dispatch({ type: 'DISCARD', cardId })
    setSelectedIds((prev) => {
      if (!prev.has(cardId)) return prev
      const next = new Set(prev)
      next.delete(cardId)
      return next
    })
    setTargetMeldId(null)
    setDiscardHot(false)
  }, [])

  // If a meld target is selected and exactly one card is selected, extend it.
  useEffect(() => {
    if (targetMeldId && selectedIds.size === 1) {
      const cardId = [...selectedIds][0]
      dispatch({ type: 'EXTEND', meldId: targetMeldId, cardId })
      clearSelection()
    }
  }, [targetMeldId, selectedIds])

  // Open the zoom overlay for a meld (opponent tap, or human tap outside extend phase).
  const zoomMeld = useCallback((meldId: string) => {
    const meld = state.tableMetlds.find((m) => m.id === meldId)
    if (meld) setZoomedMeld(meld)
  }, [state.tableMetlds])

  // ---- Go-Down prep handlers ----

  const prepCardIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>()
    for (const slot of prepSlots) {
      for (const card of slot.cards) ids.add(card.id)
    }
    return ids
  }, [prepSlots])

  const openPrep = useCallback(() => {
    setPrepSlots(createPrepSlots(state.roundIndex))
    setPrepOpen(true)
    setReturningCardIds(new Set())
  }, [state.roundIndex])

  const returnPrepCardsToHand = useCallback(() => {
    const ids = new Set<string>()
    for (const slot of prepSlots) {
      for (const card of slot.cards) ids.add(card.id)
    }
    setReturningCardIds(ids)
    setPrepSlots((prev) => prev.map((s) => ({ ...s, cards: [] })))
    setPrepHoveredSlotIndex(null)
  }, [prepSlots])

  const cancelPrep = useCallback(() => {
    setPrepSlots([])
    setPrepOpen(false)
    setPrepHoveredSlotIndex(null)
    setReturningCardIds(new Set())
  }, [])

  const handleDropToSlot = useCallback(
    (cardId: string, slotIndex: number, sideHint: 'left' | 'right') => {
      const humanPlayer = humanPlayerIndex !== -1 ? state.players[humanPlayerIndex] : null
      const card = humanPlayer?.hand.find((c) => c.id === cardId)
      if (!card) return
      setPrepSlots((prev) => {
        const slot = prev[slotIndex]
        if (!slot) return prev
        const updated = placeCard(slot, card, sideHint)
        if (!updated) return prev
        return prev.map((s, i) => (i === slotIndex ? updated : s))
      })
    },
    [humanPlayerIndex, state.players],
  )

  const canDropToSlot = useCallback(
    (cardId: string, slotIndex: number) => {
      const slot = prepSlots[slotIndex]
      if (!slot) return false
      const humanPlayer = humanPlayerIndex !== -1 ? state.players[humanPlayerIndex] : null
      const card = humanPlayer?.hand.find((c) => c.id === cardId)
      if (!card) return false
      return canPlaceCard(slot, card)
    },
    [prepSlots, humanPlayerIndex, state.players],
  )

  const handleRemoveCardFromSlot = useCallback(
    (slotId: string, cardId: string) => {
      setPrepSlots((prev) =>
        prev.map((s) => {
          if (s.id !== slotId) return s
          const { slot: updated } = removePrepCard(s, cardId)
          return updated
        }),
      )
    },
    [],
  )

  const handleMoveCardSlotToSlot = useCallback(
    (fromSlotId: string, cardId: string, toSlotId: string, sideHint: 'left' | 'right') => {
      setPrepSlots((prev) => {
        const fromIdx = prev.findIndex((s) => s.id === fromSlotId)
        const toIdx = prev.findIndex((s) => s.id === toSlotId)
        if (fromIdx === -1 || toIdx === -1) return prev

        if (fromSlotId === toSlotId) {
          // Same-slot wild end-swap.
          const swapped = swapWildEnd(prev[fromIdx])
          if (!swapped) return prev
          return prev.map((s, i) => (i === fromIdx ? swapped : s))
        }

        const fromSlot = prev[fromIdx]
        const card = fromSlot.cards.find((c) => c.id === cardId)
        if (!card) return prev

        const { slot: fromUpdated } = removePrepCard(fromSlot, cardId)
        const toSlot = prev[toIdx]
        if (!canPlaceCard(toSlot, card)) return prev
        const toUpdated = placeCard(toSlot, card, sideHint)
        if (!toUpdated) return prev

        return prev.map((s, i) =>
          i === fromIdx ? fromUpdated : i === toIdx ? toUpdated : s,
        )
      })
    },
    [],
  )

  const handleSubmitPrep = useCallback(() => {
    if (!canSubmitPrep(prepSlots)) return
    const meldCardArrays = prepSlots.map((s) => s.cards.map((c) => c.id))
    dispatch({ type: 'GO_DOWN', meldCardArrays })
    setPrepSlots([])
    setPrepOpen(false)
    setPrepHoveredSlotIndex(null)
  }, [prepSlots])

  if (state.phase === 'game-end') {
    const sorted = [...state.players].sort((a, b) => a.cumulativeScore - b.cumulativeScore)
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '24px',
        }}
      >
        <h1 style={{ color: 'var(--text)', fontSize: '2rem' }}>Game Over</h1>
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '24px 40px',
          }}
        >
          {sorted.map((p, rank) => (
            <div
              key={p.index}
              style={{
                marginBottom: '10px',
                fontSize: rank === 0 ? '1.2rem' : '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <AvatarView avatarId={p.avatarId} size={rank === 0 ? 40 : 32} alt="" />
              <span style={{ color: 'var(--text)' }}>
                {rank + 1}. {p.displayName}
              </span>
              <span style={{ color: 'var(--text-dim)' }}>
                {p.cumulativeScore} pts
              </span>
              {rank === 0 && (
                <span style={{ color: 'var(--text)' }}>👑</span>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={onReturnToMenu}
          style={{
            background: 'var(--accent)',
            color: '#1a1a1a',
            padding: '12px 32px',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: 'bold',
          }}
        >
          Return to Menu
        </button>
      </div>
    )
  }

  const isHumanTurn = !currentPlayer.isAI
  const isPlayOrDiscard = state.phase === 'play-or-discard'
  const isBuyWindow = state.phase === 'buy-window'

  const canDrawDeck = isHumanTurn && (isBuyWindow || state.phase === 'draw') && !animBusy
  const canClaimDiscard = isHumanTurn && isBuyWindow && !animBusy
  const canBuy = humanPlayerIndex !== -1 && canBuyDiscard(state, humanPlayerIndex) && !animBusy
  const canDiscardDrag = isHumanTurn && isPlayOrDiscard && !animBusy && !prepOpen
  const canReorderHand = humanPlayerIndex !== -1 && !animBusy
  const canSelectCards = isHumanTurn && isPlayOrDiscard && !animBusy && !prepOpen
  /** Whether the human can extend melds on the table. */
  const canExtend =
    humanPlayerIndex !== -1 &&
    isHumanTurn &&
    isPlayOrDiscard &&
    state.players[humanPlayerIndex].hasGoneDown
  /** Whether the GO DOWN button is available. */
  const canGoDown =
    !prepOpen &&
    humanPlayerIndex !== -1 &&
    isHumanTurn &&
    isPlayOrDiscard &&
    !state.players[humanPlayerIndex].hasGoneDown &&
    !animBusy

  /** Hand cards visible in the hand panel (prep-committed cards are hidden). */
  const humanHandForDisplay = useMemo(() => {
    if (humanPlayerIndex === -1) return []
    const hand = state.players[humanPlayerIndex].hand
    if (prepCardIds.size === 0) return hand
    return hand.filter((c) => !prepCardIds.has(c.id))
  }, [humanPlayerIndex, state.players, prepCardIds])

  const arrivalCounts = new Map<number, number>()
  for (const f of flightQueue) {
    if (f.arrivalPlayerIndex === undefined) continue
    arrivalCounts.set(
      f.arrivalPlayerIndex,
      (arrivalCounts.get(f.arrivalPlayerIndex) ?? 0) + 1,
    )
  }

  const visibleOpponentCount = (playerIndex: number, handLength: number): number => {
    let n = handLength - (arrivalCounts.get(playerIndex) ?? 0)
    if (pendingDiscard?.playerIndex === playerIndex) n -= 1
    return Math.max(0, n)
  }

  // ---------------------------------------------------------------------------
  // Layout values derived from the viewport-responsive TableLayout
  // ---------------------------------------------------------------------------

  // Visible portion of the human hand above the screen bottom:
  //   hand height = 1.4×card (two overlapping rows)
  //   hang         = card/3 + handExtraHang  (off-screen)
  //   visible      = 1.4×card - hang
  const handVisibleH = FULL_CARD_H * (1.4 - 1 / 3) - layout.handExtraHang
  // Human set strip sits 8px above the visible hand top.
  const humanSetsBottom = Math.round(handVisibleH + 8)
  // Bottom offset for the hand wrapper (negative = hang below fold).
  const handBottomOffset = -(FULL_CARD_H / 3 + layout.handExtraHang)

  // Per-side max fan widths — scale with set card width.
  const humanFanW = Math.round(layout.setCardW * 2.5 + 10)
  const sideFanW = Math.round(layout.setCardW * 2.0 + 8)
  const topFanW = Math.round(layout.setCardW * 2.2 + 8)

  const opponentFanW = (side: SeatSide): number =>
    side === 'top' ? topFanW : sideFanW

  const humanMelds = humanPlayerIndex !== -1 ? (meldsByPlayer.get(humanPlayerIndex) ?? []) : []

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-felt)',
      }}
    >
      {/* ===== TABLE LAYER ===== */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
        }}
      >
        {/* Opponent seats — around the rim */}
        {opponentSeats.map((placement) => {
          const player = state.players[placement.playerIndex]
          if (!player) return null
          return (
            <OpponentSeat
              key={player.index}
              placement={placement}
              displayName={player.displayName}
              avatarId={player.avatarId}
              cardCount={visibleOpponentCount(player.index, player.hand.length)}
              isCurrent={player.index === state.currentPlayerIndex}
              handAnchorRef={handAnchorRefs[player.index]}
            />
          )
        })}

        {/* Opponent set pockets — just inside each seat's inward card reach */}
        {opponentSeats.map((placement) => {
          const player = state.players[placement.playerIndex]
          if (!player) return null
          const melds = meldsByPlayer.get(player.index) ?? []
          if (melds.length === 0) return null
          return (
            <div key={`sets-${player.index}`} style={setsPocketStyle(placement)}>
              <PlayerSets
                melds={melds}
                direction={setsDirection(placement.side)}
                cardW={layout.setCardW}
                cardH={layout.setCardH}
                cardRadius={layout.setCardRadius}
                maxFanWidth={opponentFanW(placement.side)}
                onTap={zoomMeld}
              />
            </div>
          )
        })}

        {/* Human set strip — above the visible hand, centered */}
        {humanMelds.length > 0 && humanPlayerIndex !== -1 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: humanSetsBottom,
              zIndex: 1,
              pointerEvents: 'auto',
            }}
          >
            <PlayerSets
              melds={humanMelds}
              direction="row"
              cardW={layout.setCardW}
              cardH={layout.setCardH}
              cardRadius={layout.setCardRadius}
              maxFanWidth={humanFanW}
              targetMeldId={targetMeldId}
              onTap={canExtend ? handleExtend : zoomMeld}
            />
          </div>
        )}

        {/* Draw + discard + Buy — center of the table.
            The outer div positions the anchor; the inner div centers and scales. */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: layout.pileTopPct,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              transform: `translate(-50%, -50%) scale(${layout.pileScale})`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            {/* Piles row — deck and discard bottom-aligned */}
            <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-end' }}>
              <div
                ref={deckWrapRef}
                style={{
                  pointerEvents: 'auto',
                  padding: '6px',
                  margin: '-6px',
                }}
              >
                <CardPile
                  count={state.drawPile.length}
                  card={
                    state.drawPile.length > 0
                      ? { id: 'deck', color: 'wild', number: 0 }
                      : null
                  }
                  faceDown
                  onActivate={canDrawDeck ? () => handleDrawDeck() : undefined}
                  canDrag={canDrawDeck}
                  onDragDraw={canDrawDeck ? handleDrawDeck : undefined}
                />
              </div>

              <div
                ref={discardWrapRef}
                data-discard-zone
                style={{
                  pointerEvents: 'auto',
                  padding: '6px',
                  margin: '-6px',
                  borderRadius: '10px',
                  transition: 'box-shadow 0.15s ease, background 0.15s ease, transform 0.15s ease',
                  background: discardHot ? 'rgba(232, 164, 34, 0.18)' : 'transparent',
                  boxShadow: discardHot
                    ? '0 0 0 3px var(--accent), 0 0 22px rgba(232, 164, 34, 0.45)'
                    : 'none',
                  transform: discardHot ? 'scale(1.06)' : 'scale(1)',
                }}
              >
                <CardPile
                  count={state.discardPile.length}
                  card={top}
                  underCard={
                    state.discardPile.length > 1
                      ? state.discardPile[state.discardPile.length - 2]
                      : null
                  }
                  onActivate={canClaimDiscard ? () => handleClaimDiscard() : undefined}
                  canDrag={canClaimDiscard}
                  onDragDraw={canClaimDiscard ? handleClaimDiscard : undefined}
                />
              </div>
            </div>

            {/* Button row — mirrors the 28px pile gap:
                  left cell (deck column) → GO DOWN
                  right cell (discard column) → BUY IT */}
            <div
              style={{
                display: 'flex',
                gap: '28px',
                width: '100%',
                pointerEvents: 'auto',
              }}
            >
              {/* Deck column: GO DOWN */}
              <div style={{ width: 'var(--card-w)', flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={!canGoDown}
                  onClick={openPrep}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    background: canGoDown ? 'var(--accent)' : 'var(--surface-2)',
                    color: canGoDown ? '#1a1a1a' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    cursor: canGoDown ? 'pointer' : 'default',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  GO DOWN
                </button>
              </div>

              {/* Discard column: BUY IT */}
              <div style={{ width: 'var(--card-w)', flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={!canBuy}
                  onClick={handleBuy}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    background: 'var(--danger)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    cursor: canBuy ? 'pointer' : 'default',
                    animation: canBuy ? 'buy-pulse 1.4s ease-in-out infinite alternate' : 'none',
                  }}
                >
                  BUY IT!
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== UI LAYER ===== */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {state.lastError && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              background: 'var(--danger-dim)',
              color: '#fff',
              padding: '6px 12px',
              fontSize: '0.85rem',
              textAlign: 'center',
              pointerEvents: 'auto',
            }}
          >
            {state.lastError}
          </div>
        )}

        <button
          type="button"
          onClick={() => setScoresOpen(true)}
          aria-label="Open round and player info"
          aria-expanded={scoresOpen}
          aria-haspopup="dialog"
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            pointerEvents: 'auto',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Human's hand — only seat at the bottom; hang below the fold.
            Use bottom offset (not transform) so HandView's position:fixed drag
            ghost stays viewport-relative and is not clipped. */}
        {/* Go-Down prep modal — fixed overlay, independent of hand position */}
        {prepOpen && (
          <GoDownPrep
            slots={prepSlots}
            slotDropZoneRefs={prepSlotDropZoneRefs.current}
            highlightedSlotIndex={prepHoveredSlotIndex}
            isSubmitEnabled={canSubmitPrep(prepSlots)}
            onSubmit={handleSubmitPrep}
            onCancel={cancelPrep}
            onReturnCardsToHand={returnPrepCardsToHand}
            onRemoveCard={handleRemoveCardFromSlot}
            onMoveCard={handleMoveCardSlotToSlot}
            bottomInset={Math.round(handVisibleH + 10)}
            compact={layout.isShortLandscape}
          />
        )}

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: handBottomOffset,
            pointerEvents: 'auto',
          }}
        >
          <HandView
            cards={humanHandForDisplay}
            selectedIds={selectedIds}
            onToggle={toggleCard}
            canSelect={canSelectCards}
            canReorder={canReorderHand}
            canDiscard={canDiscardDrag}
            discardZoneRef={discardWrapRef}
            onReorder={handleReorder}
            onDiscardCard={handleDiscardCard}
            onDiscardHoverChange={setDiscardHot}
            inflightCardIds={
              new Set([
                ...flightQueue
                  .filter((f) => f.arrivalPlayerIndex === undefined && f.targetRef === endSlotRef)
                  .map((f) => f.card.id),
                ...returningCardIds,
              ])
            }
            activeFlightCardId={
              activeFlightItem?.targetRef === endSlotRef
                ? activeFlightItem.card.id
                : undefined
            }
            endSlotRef={endSlotRef}
            landingCardId={landingCardId ?? undefined}
            prepSlotRefs={prepOpen ? prepSlotDropZoneRefs.current : undefined}
            onDropToSlot={prepOpen ? handleDropToSlot : undefined}
            canDropToSlot={prepOpen ? canDropToSlot : undefined}
            onPrepSlotHoverChange={prepOpen ? setPrepHoveredSlotIndex : undefined}
          />
        </div>

        {humanPlayerIndex !== -1 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: SEAT_EDGE_INSET_PX,
              transform: 'translateX(-50%)',
              zIndex: 50,
              pointerEvents: 'none',
              lineHeight: 0,
            }}
          >
            <AvatarView
              avatarId={state.players[humanPlayerIndex].avatarId}
              size={SEAT_AVATAR_SIZE}
              alt={state.players[humanPlayerIndex].displayName}
              active={state.currentPlayerIndex === humanPlayerIndex}
            />
          </div>
        )}
      </div>

      <ScoreBoard
        players={state.players}
        currentPlayerIndex={state.currentPlayerIndex}
        roundIndex={state.roundIndex}
        open={scoresOpen}
        onClose={() => setScoresOpen(false)}
      />

      {activeFlightItem && (
        <DrawFlight
          key={`${activeFlightItem.card.id}-${activeFlightItem.arrivalPlayerIndex ?? 'h'}-${activeFlightItem.pendingAction ? 'd' : 'a'}`}
          card={activeFlightItem.card}
          sourceRect={activeFlightItem.sourceRect}
          targetRef={activeFlightItem.targetRef}
          faceDown={activeFlightItem.faceDown}
          viaCenter={activeFlightItem.viaCenter}
          onComplete={handleFlightComplete}
        />
      )}

      {/* Zoom overlay — tap outside or press Escape to dismiss */}
      <SetZoomOverlay
        meld={zoomedMeld}
        playerName={
          zoomedMeld != null
            ? state.players[zoomedMeld.ownerIndex]?.displayName
            : undefined
        }
        onClose={() => setZoomedMeld(null)}
      />
    </div>
  )
}
