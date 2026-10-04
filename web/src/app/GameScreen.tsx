import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Card } from '../game/card'
import type { GameState } from '../game/state'
import {
  buyDiscard,
  canBuyDiscard,
  claimDiscardAsDraw,
  discard,
  drawFromDeck,
  extendMeld,
  reorderHand,
  topDiscard,
} from '../game/state'
import AvatarView from '../ui/AvatarView'
import CardPile from '../ui/CardPile'
import DrawFlight from '../ui/DrawFlight'
import HandView from '../ui/HandView'
import OpponentSeat, { SEAT_AVATAR_SIZE, SEAT_EDGE_INSET_PX } from '../ui/OpponentSeat'
import ScoreBoard from '../ui/ScoreBoard'
import TableView from '../ui/TableView'
import { placeOpponents } from '../ui/seat-layout'
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

export default function GameScreen({ initialState, onReturnToMenu, onSave, onGameEnd }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Autosave on every state change; clear the save when the game ends.
  // Use a ref for the callbacks so this effect never needs to re-register.
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
  const portrait = usePortrait()

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
    // Keep the ref in sync before any re-entrant completion callbacks.
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

  // Run AI turns automatically (paused while a card is in flight)
  useEffect(() => {
    if (animBusy) return
    if (state.phase === 'game-end' || state.phase === 'round-end') return
    if (!currentPlayer.isAI) return

    // Give the human time to buy if they're eligible; otherwise keep snappy.
    const aiDelay =
      humanPlayerIndex !== -1 && canBuyDiscard(state, humanPlayerIndex) ? 2800 : 700

    const timer = setTimeout(() => {
      if (state.phase === 'buy-window' || state.phase === 'draw') {
        const rect = deckWrapRef.current?.getBoundingClientRect()
        const topCard =
          state.drawPile.length > 0
            ? state.drawPile[state.drawPile.length - 1]
            : null
        const targetRef = handAnchorRefs[currentPlayer.index]
        dispatch({ type: 'DRAW_DECK' })
        if (rect && topCard && targetRef) {
          enqueueFlight({
            card: topCard,
            sourceRect: rect,
            targetRef,
            faceDown: true,
            viaCenter: true,
            arrivalPlayerIndex: currentPlayer.index,
          })
        }
        return
      }

      if (state.phase === 'play-or-discard') {
        const hand = currentPlayer.hand
        if (hand.length === 0) return
        const card = hand[hand.length - 1]
        const seatEl = handAnchorRefs[currentPlayer.index]?.current
        const sourceRect =
          seatEl?.getBoundingClientRect() ??
          new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 64, 96)
        setPendingDiscard({ playerIndex: currentPlayer.index, cardId: card.id })
        enqueueFlight({
          card,
          sourceRect,
          targetRef: discardWrapRef,
          faceDown: false,
          viaCenter: false,
          pendingAction: { type: 'DISCARD', cardId: card.id },
        })
      }
    }, aiDelay)

    return () => clearTimeout(timer)
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

    // Peek at the result to learn the penalty card's identity before dispatching.
    const nextState = buyDiscard(state, humanPlayerIndex)
    const oldHandIds = new Set(state.players[humanPlayerIndex].hand.map((c) => c.id))
    const penaltyCard =
      nextState.players[humanPlayerIndex].hand.find(
        (c) => c.id !== topCard?.id && !oldHandIds.has(c.id),
      ) ?? null

    // Dispatch now — both new cards are immediately in state but will be hidden
    // by inflightCardIds while their flights are queued.
    dispatch({ type: 'BUY', buyerIndex: humanPlayerIndex })

    // Flight 1: discard card from discard pile → hand
    if (discardRect && topCard) {
      enqueueFlight({
        card: topCard,
        sourceRect: discardRect,
        targetRef: endSlotRef,
        faceDown: false,
        viaCenter: true,
      })
    }

    // Flight 2: penalty card from deck → hand (sequential after flight 1)
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
      dispatch({ type: 'REORDER', playerIndex: humanPlayerIndex, orderedIds })
    },
    [humanPlayerIndex],
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

  // If a meld target is selected and exactly one card is selected, extend it
  useEffect(() => {
    if (targetMeldId && selectedIds.size === 1) {
      const cardId = [...selectedIds][0]
      dispatch({ type: 'EXTEND', meldId: targetMeldId, cardId })
      clearSelection()
    }
  }, [targetMeldId, selectedIds])

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
  const canDiscardDrag = isHumanTurn && isPlayOrDiscard && !animBusy
  const canReorderHand = humanPlayerIndex !== -1 && !animBusy
  const canSelectCards = isHumanTurn && isPlayOrDiscard && !animBusy

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
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            // Hand hangs by 1/3 card; reserve the still-visible portion.
            paddingBottom: 'calc(var(--card-h) * 1.4 - var(--card-h) / 3 + 64px)',
          }}
        >
          <TableView
            melds={state.tableMetlds}
            playerNames={state.players.map((p) => p.displayName)}
            selectedCardIds={selectedIds}
            onClickMeld={
              isHumanTurn && isPlayOrDiscard && currentPlayer.hasGoneDown
                ? handleExtend
                : undefined
            }
          />
        </div>

        {/* Opponent seats — around the rim, human stays at the bottom only */}
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

        {/* Draw + discard + Buy — center of the table */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '42%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            zIndex: 1,
            pointerEvents: 'none',
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

          {/* Buy button — own row below, aligned under the discard pile */}
          <button
            type="button"
            disabled={!canBuy}
            onClick={handleBuy}
            style={{
              alignSelf: 'flex-end',
              width: 'var(--card-w)',
              padding: '13px 0',
              background: 'var(--danger)',
              color: '#fff',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              pointerEvents: 'auto',
              animation: canBuy ? 'buy-pulse 1.4s ease-in-out infinite alternate' : 'none',
            }}
          >
            BUY IT!
          </button>
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

        {/* Human's hand — only seat at the bottom; hang ~1/3 of the bottom row.
            Use bottom offset (not transform) so HandView's position:fixed drag
            ghost stays viewport-relative and is not clipped. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(var(--card-h) / -3)',
            pointerEvents: 'auto',
          }}
        >
          <HandView
            cards={humanPlayerIndex !== -1 ? state.players[humanPlayerIndex].hand : []}
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
              new Set(
                flightQueue
                  .filter((f) => f.arrivalPlayerIndex === undefined && f.targetRef === endSlotRef)
                  .map((f) => f.card.id),
              )
            }
            activeFlightCardId={
              activeFlightItem?.targetRef === endSlotRef
                ? activeFlightItem.card.id
                : undefined
            }
            endSlotRef={endSlotRef}
            landingCardId={landingCardId ?? undefined}
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
    </div>
  )
}
