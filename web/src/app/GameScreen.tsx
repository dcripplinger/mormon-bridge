import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { GameState } from '../game/state'
import {
  buyDiscard,
  canBuyDiscard,
  claimDiscardAsDraw,
  discard,
  drawFromDeck,
  extendMeld,
  goDown,
  reorderHand,
  runAIStep,
  topDiscard,
} from '../game/state'
import { ROUND_REQUIREMENTS } from '../game/rules'
import CardView from '../ui/CardView'
import HandView from '../ui/HandView'
import DrawFlight from '../ui/DrawFlight'
import ScoreBoard from '../ui/ScoreBoard'
import TableView from '../ui/TableView'

interface Props {
  initialState: GameState
  onReturnToMenu: () => void
}

type Action =
  | { type: 'BUY'; buyerIndex: number }
  | { type: 'CLAIM_DISCARD' }
  | { type: 'DRAW_DECK' }
  | { type: 'GO_DOWN'; melds: string[][] }
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
    case 'GO_DOWN':
      return goDown(state, action.melds)
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
  card: import('../game/card').Card
  sourceRect: DOMRect
}

export default function GameScreen({ initialState, onReturnToMenu }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetMeldId, setTargetMeldId] = useState<string | null>(null)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [discardHot, setDiscardHot] = useState(false)

  // ---- draw animation state ----
  const [flightQueue, setFlightQueue] = useState<FlightItem[]>([])
  const [landingCardId, setLandingCardId] = useState<string | null>(null)
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs for measuring source positions
  const deckWrapRef = useRef<HTMLDivElement | null>(null)
  const discardWrapRef = useRef<HTMLDivElement | null>(null)
  // Ref for the hand-end placeholder (landing target for DrawFlight)
  const endSlotRef = useRef<HTMLDivElement | null>(null)

  const activeFlightItem = flightQueue[0] ?? null
  const isFlying = activeFlightItem !== null

  const handleFlightComplete = useCallback(() => {
    setFlightQueue((prev) => {
      const [done, ...rest] = prev
      if (done) {
        // Clear any existing landing timer
        if (landingTimerRef.current !== null) clearTimeout(landingTimerRef.current)
        setLandingCardId(done.card.id)
        landingTimerRef.current = setTimeout(() => setLandingCardId(null), 320)
      }
      return rest
    })
  }, [])

  // Clean up landing timer on unmount
  useEffect(() => () => {
    if (landingTimerRef.current !== null) clearTimeout(landingTimerRef.current)
  }, [])

  const currentPlayer = state.players[state.currentPlayerIndex]
  const top = topDiscard(state)
  const req = ROUND_REQUIREMENTS[state.roundIndex]

  // Run AI turns automatically
  useEffect(() => {
    if (state.phase === 'game-end' || state.phase === 'round-end') return
    if (!currentPlayer.isAI) return
    const timer = setTimeout(() => {
      const next = runAIStep(state)
      if (next !== state) {
        if (state.phase === 'buy-window') dispatch({ type: 'DRAW_DECK' })
        else if (state.phase === 'draw') dispatch({ type: 'DRAW_DECK' })
        else if (state.phase === 'play-or-discard') {
          const card = currentPlayer.hand[currentPlayer.hand.length - 1]
          if (card) dispatch({ type: 'DISCARD', cardId: card.id })
        }
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [state, currentPlayer])

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

  // ---- draw handlers (queue animation, then dispatch) ----

  const handleDrawDeck = useCallback(() => {
    const rect = deckWrapRef.current?.getBoundingClientRect()
    const topCard = state.drawPile.length > 0
      ? state.drawPile[state.drawPile.length - 1]
      : null
    dispatch({ type: 'DRAW_DECK' })
    if (rect && topCard) {
      setFlightQueue((prev) => [...prev, { card: topCard, sourceRect: rect }])
    }
  }, [state.drawPile])

  const handleClaimDiscard = useCallback(() => {
    const rect = discardWrapRef.current?.getBoundingClientRect()
    const topCard = topDiscard(state)
    dispatch({ type: 'CLAIM_DISCARD' })
    if (rect && topCard) {
      setFlightQueue((prev) => [...prev, { card: topCard, sourceRect: rect }])
    }
  }, [state])

  const handleBuy = useCallback((buyerIndex: number) => {
    const discardRect = discardWrapRef.current?.getBoundingClientRect()
    const deckRect = deckWrapRef.current?.getBoundingClientRect()
    const topCard = topDiscard(state)
    // Penalty card is the current top of deck; penalty comes from the same pile
    // after the discard is removed, but the deck order is the same so use top-1.
    // If pile only has 1 card and reshuffle would be needed, skip penalty animation.
    const penaltyCard = state.drawPile.length > 0
      ? state.drawPile[state.drawPile.length - 1]
      : null
    dispatch({ type: 'BUY', buyerIndex })
    if (discardRect && topCard) {
      const items: FlightItem[] = [{ card: topCard, sourceRect: discardRect }]
      if (deckRect && penaltyCard) {
        items.push({ card: penaltyCard, sourceRect: deckRect })
      }
      setFlightQueue((prev) => [...prev, ...items])
    }
  }, [state])

  const handleGoDown = () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    const totalNeeded = req.groups + req.runs
    if (ids.length < totalNeeded * 3) {
      alert(
        `Select all cards for your groups and runs. Round ${state.roundIndex + 1} needs ${req.groups} group(s) and ${req.runs} run(s).`,
      )
      return
    }
    const groupSize = req.groups > 0 ? Math.floor(ids.length / totalNeeded) : 0
    const melds: string[][] = []
    let i = 0
    for (let g = 0; g < req.groups; g++) {
      melds.push(ids.slice(i, i + 3))
      i += 3
    }
    for (let r = 0; r < req.runs; r++) {
      const remaining = ids.slice(i)
      melds.push(r < req.runs - 1 ? remaining.slice(0, 4) : remaining)
      i += 4
    }
    void groupSize
    dispatch({ type: 'GO_DOWN', melds })
    clearSelection()
  }

  const handleExtend = (meldId: string) => {
    if (selectedIds.size !== 1) {
      setTargetMeldId(meldId)
      return
    }
    const cardId = [...selectedIds][0]
    dispatch({ type: 'EXTEND', meldId, cardId })
    clearSelection()
  }

  const humanPlayerIndex = state.players.findIndex((p) => !p.isAI)

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

  // ---- render game-end ----
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
            <div key={p.index} style={{ marginBottom: '10px', fontSize: rank === 0 ? '1.2rem' : '1rem' }}>
              <span style={{ color: 'var(--text)' }}>
                {rank + 1}. {p.displayName}
              </span>
              <span style={{ color: 'var(--text-dim)', marginLeft: '12px' }}>
                {p.cumulativeScore} pts
              </span>
              {rank === 0 && (
                <span style={{ marginLeft: '8px', color: 'var(--text)' }}>👑</span>
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

  const canDrawDeck = isHumanTurn && (isBuyWindow || state.phase === 'draw') && !isFlying
  const canClaimDiscard = isHumanTurn && isBuyWindow && !isFlying
  const canDiscardDrag = isHumanTurn && isPlayOrDiscard && !isFlying
  const canReorderHand = humanPlayerIndex !== -1 && !isFlying
  const canSelectCards = isHumanTurn && isPlayOrDiscard && !isFlying

  const showBuy =
    humanPlayerIndex !== -1 && canBuyDiscard(state, humanPlayerIndex) && !isFlying
  const showPlayActions = isHumanTurn && isPlayOrDiscard

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-felt)',
      }}
    >
      {/* ===== TABLE LAYER =====
          Owns the full playfield. Layout here must never depend on UI chrome. */}
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
            // Reserve space for up to two hand rows (60% overlap) + optional pager.
            paddingBottom: 'calc(var(--card-h) * 1.4 + 64px)',
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

        {/* Draw + discard — center of the table */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '42%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            gap: '28px',
            alignItems: 'flex-start',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          {/* Deck */}
          <div
            ref={deckWrapRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: 'auto',
            }}
          >
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Deck ({state.drawPile.length})
            </span>
            <CardView
              card={{ id: 'deck', color: 'wild', number: 0 }}
              faceDown
              onClick={canDrawDeck ? handleDrawDeck : undefined}
            />
          </div>

          {/* Discard */}
          <div
            ref={discardWrapRef}
            data-discard-zone
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
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
            <span style={{ fontSize: '0.7rem', color: discardHot ? 'var(--text)' : 'var(--text-dim)' }}>
              Discard
            </span>
            {top ? (
              <CardView
                card={top}
                onClick={canClaimDiscard ? handleClaimDiscard : undefined}
              />
            ) : (
              <div
                style={{
                  width: 'var(--card-w)',
                  height: 'var(--card-h)',
                  borderRadius: 'var(--card-radius)',
                  border: '2px dashed var(--border)',
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ===== UI LAYER =====
          Absolute overlays only. pointer-events none on the shell so clicks
          pass through to the table; interactive children re-enable them. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      >
        {/* Error bar */}
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

        {/* Menu — opens round / player flyout */}
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

        {/* Action strip (buy / go down / clear) */}
        {(showBuy || showPlayActions) && (
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              right: '58px',
              display: 'flex',
              gap: '8px',
              padding: '6px 10px',
              alignItems: 'center',
              flexWrap: 'wrap',
              background: 'rgba(17, 34, 17, 0.72)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              pointerEvents: 'auto',
            }}
          >
            {showBuy && (
              <button
                onClick={() => handleBuy(humanPlayerIndex)}
                style={{
                  background: 'var(--danger)',
                  color: '#fff',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  animation: 'pulse 1s ease-in-out infinite alternate',
                }}
              >
                Buy it!
              </button>
            )}
            {showPlayActions && (
              <>
                {!currentPlayer.hasGoneDown && (
                  <button
                    onClick={handleGoDown}
                    disabled={selectedIds.size === 0}
                    style={{
                      background: 'var(--accent)',
                      color: '#1a1a1a',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 'bold',
                    }}
                  >
                    Go Down
                  </button>
                )}
                {currentPlayer.hasGoneDown && state.tableMetlds.length > 0 && selectedIds.size === 1 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', alignSelf: 'center' }}>
                    Click a group or run to add your card
                  </div>
                )}
                {selectedIds.size > 0 && (
                  <button
                    onClick={clearSelection}
                    style={{
                      background: 'transparent',
                      color: 'var(--text-dim)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      fontSize: '0.8rem',
                    }}
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Human's hand */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
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
            inflightCardIds={new Set(flightQueue.map((f) => f.card.id))}
            activeFlightCardId={activeFlightItem?.card.id}
            endSlotRef={endSlotRef}
            landingCardId={landingCardId ?? undefined}
          />
        </div>
      </div>

      <ScoreBoard
        players={state.players}
        currentPlayerIndex={state.currentPlayerIndex}
        roundIndex={state.roundIndex}
        open={scoresOpen}
        onClose={() => setScoresOpen(false)}
      />

      {/* Draw flight overlay — rendered via portal so position:fixed is viewport-relative */}
      {activeFlightItem && (
        <DrawFlight
          key={activeFlightItem.card.id}
          card={activeFlightItem.card}
          sourceRect={activeFlightItem.sourceRect}
          targetRef={endSlotRef}
          onComplete={handleFlightComplete}
        />
      )}

      <style>{`
        @keyframes pulse {
          from { box-shadow: 0 0 0 0 rgba(192,57,43,0.6); }
          to   { box-shadow: 0 0 8px 4px rgba(192,57,43,0); }
        }
      `}</style>
    </div>
  )
}
