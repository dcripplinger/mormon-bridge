import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
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
import {
  DEFAULT_WILD_RULES,
  allowsWildDisplacement,
  legalAddEnds,
  planMeldPlay,
  wildHasHome,
  type MeldEnd,
  type WildRules,
} from '../game/meld-play'
import type { GameState, Meld } from '../game/state'
import {
  canBuyDiscard,
  declareBuy,
  claimDiscardAsDraw,
  discard,
  drawFromDeck,
  continueAfterRound,
  extendMeld,
  goDown,
  keepPendingWild,
  reorderHand,
  topDiscard,
  undoExtend,
} from '../game/state'
import type { GameSettings } from './types'
import AvatarView from '../ui/AvatarView'
import {
  BUY_BUBBLE_TEXT,
  OUT_BUBBLE_TEXT,
  NAME_BUBBLE_MS,
  SpeechBubbleLayer,
  buyBubbleRemainingMs,
  type SpeechBubbleModel,
  type SpeechBubbleSide,
} from '../ui/speech-bubble'
import CardPile from '../ui/CardPile'
import DrawFlight from '../ui/DrawFlight'
import GoDownPrep from '../ui/GoDownPrep'
import { predictedSlotCenter } from '../ui/fan-end'
import HandView from '../ui/HandView'
import TableCallout from '../ui/TableCallout'
import WildHold from '../ui/WildHold'
import OpponentSeat, { SEAT_AVATAR_SIZE, SEAT_EDGE_INSET_PX } from '../ui/OpponentSeat'
import PlayerSets from '../ui/PlayerSets'
import ScoreBoard from '../ui/ScoreBoard'
import SetZoomOverlay from '../ui/SetZoomOverlay'
import type { SetZoomAnchor } from '../ui/SetZoomOverlay'
import { placeOpponents } from '../ui/seat-layout'
import { fanWidthFor } from '../ui/SetFan'
import {
  humanHandVisiblePx,
  orientedPocketLayout,
  type SetRegion,
} from '../ui/table-regions'
import { FULL_CARD_H, useTableLayout } from '../ui/use-table-layout'
import { usePortrait } from '../ui/use-portrait'

interface Props {
  initialState: GameState
  onReturnToMenu: () => void
  /** Called after every committed state change; fire-and-forget persistence. */
  onSave: (state: GameState) => void
  /** Called once when the game finishes (phase === 'game-end'); clears the save. */
  onGameEnd: () => void
  settings?: GameSettings
}

function wildRulesOf(settings?: GameSettings): WildRules {
  if (!settings) return DEFAULT_WILD_RULES
  return { from: settings.wildMoveFrom, to: settings.wildMoveTo }
}

type Action =
  | { type: 'DECLARE_BUY'; buyerIndex: number }
  | { type: 'CLAIM_DISCARD' }
  | { type: 'DRAW_DECK' }
  | { type: 'EXTEND'; meldId: string; cardId: string; side?: MeldEnd; rules: WildRules }
  | { type: 'UNDO_EXTEND' }
  | { type: 'KEEP_WILD' }
  | { type: 'CONTINUE_ROUND' }
  | { type: 'DISCARD'; cardId: string }
  | { type: 'REORDER'; playerIndex: number; orderedIds: string[] }
  | { type: 'GO_DOWN'; meldCardArrays: string[][] }

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'DECLARE_BUY':
      return declareBuy(state, action.buyerIndex)
    case 'CLAIM_DISCARD':
      return claimDiscardAsDraw(state)
    case 'DRAW_DECK':
      return drawFromDeck(state)
    case 'EXTEND':
      return extendMeld(state, action.meldId, action.cardId, action.side, action.rules)
    case 'UNDO_EXTEND':
      return undoExtend(state)
    case 'KEEP_WILD':
      return keepPendingWild(state)
    case 'CONTINUE_ROUND':
      return continueAfterRound(state)
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
  /** Card still in this player's hand — hide it until the flight lands and the action applies. */
  leavingPlayerIndex?: number
  /** Dispatch after the card arrives (AI discard or extend). */
  pendingAction?: Action
  /** Screen center to land on when the destination card is not mounted yet. */
  targetPoint?: { x: number; y: number } | null
  endRotationDeg?: number
  endScale?: number
  startRotationDeg?: number
  startScale?: number
  /** Hide this card in its set until the flight arrives. */
  concealCardId?: string
  /** Hide the wild resting over the deck until the flight arrives. */
  concealPendingWild?: boolean
}

/** Share of a set region each fan may use, and the upright row width that results. */
function pocketFanLayout(region: SetRegion, melds: Meld[], cardW: number): {
  perFan: number
  contentAlong: number
} {
  const sideways = region.rotationDeg === 90 || region.rotationDeg === -90
  const along = (sideways ? region.rect.height : region.rect.width) - 8
  const gap = 6
  const perFan = Math.max(
    1,
    (along - gap * Math.max(0, melds.length - 1)) / Math.max(1, melds.length),
  )
  const contentAlong =
    melds.reduce((sum, meld) => sum + fanWidthFor(cardW, meld.cards.length, perFan, meld.cards), 0) +
    gap * Math.max(0, melds.length - 1)
  return { perFan, contentAlong }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameScreen({ initialState, onReturnToMenu, onSave, onGameEnd, settings }: Props) {
  const rules = useMemo(() => wildRulesOf(settings), [settings])
  const [state, dispatch] = useReducer(reducer, initialState)

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

  const [hoveredMeldId, setHoveredMeldId] = useState<string | null>(null)
  const [hoveredMeldSide, setHoveredMeldSide] = useState<MeldEnd | null>(null)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [discardHot, setDiscardHot] = useState(false)
  const [zoomedMeld, setZoomedMeld] = useState<SetZoomAnchor | null>(null)
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
  const wildHoldRef = useRef<HTMLDivElement | null>(null)
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
  const layout = useTableLayout(humanPlayerIndex, opponentSeats)
  const handWrapRef = useRef<HTMLDivElement | null>(null)
  const meldRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>())
  const cardRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>())
  const cardRefFor = (cardId: string) => {
    let ref = cardRefs.current.get(cardId)
    if (!ref) {
      ref = { current: null }
      cardRefs.current.set(cardId, ref)
    }
    return ref
  }
  const meldRefFor = (meldId: string) => {
    let ref = meldRefs.current.get(meldId)
    if (!ref) {
      ref = { current: null }
      meldRefs.current.set(meldId, ref)
    }
    return ref
  }

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

  const rootRef = useRef<HTMLDivElement | null>(null)
  const bubbleSeq = useRef(0)
  const [bubbles, setBubbles] = useState<SpeechBubbleModel[]>([])
  const bubblesRef = useRef(bubbles)
  bubblesRef.current = bubbles
  const bubbleTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const buyDismissScheduled = useRef<Set<number>>(new Set())
  const [anchors, setAnchors] = useState<Record<number, { x: number; y: number }>>({})
  const [callout, setCallout] = useState<{ text: string; tone: 'fanfare' | 'hint' } | null>(null)
  const calloutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bootCallout = useRef(true)
  const prevCalloutPhase = useRef(state.phase)
  const announcedRound = useRef<number | null>(null)

  const showFanfare = useCallback((text: string) => {
    if (calloutTimer.current) clearTimeout(calloutTimer.current)
    setCallout({ text, tone: 'fanfare' })
    calloutTimer.current = setTimeout(() => {
      setCallout((current) => (current?.tone === 'fanfare' && current.text === text ? null : current))
    }, 1600)
  }, [])

  const showBubble = useCallback((playerIndex: number, text: string, kind: SpeechBubbleModel['kind']) => {
    const id = ++bubbleSeq.current
    const shownAt = Date.now()
    setBubbles((prev) => [...prev, { id, playerIndex, text, shownAt, kind }])
    if (kind === 'name' || kind === 'out') {
      const timer = setTimeout(() => {
        setBubbles((prev) => prev.filter((b) => b.id !== id))
      }, NAME_BUBBLE_MS)
      bubbleTimers.current.push(timer)
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of bubbleTimers.current) clearTimeout(timer)
    }
  }, [])

  // Buy bubbles leave only after the window closes and each has been up for 2s.
  useEffect(() => {
    if (state.phase === 'buy-window') return
    const resolvedAt = Date.now()
    for (const bubble of bubblesRef.current) {
      if (bubble.kind !== 'buy') continue
      if (buyDismissScheduled.current.has(bubble.id)) continue
      buyDismissScheduled.current.add(bubble.id)
      const wait = buyBubbleRemainingMs(bubble.shownAt, resolvedAt, resolvedAt) ?? 0
      const timer = setTimeout(() => {
        setBubbles((prev) => prev.filter((b) => b.id !== bubble.id))
      }, wait)
      bubbleTimers.current.push(timer)
    }
  }, [state.phase, state.currentPlayerIndex, state.roundIndex])

  // Hold the finished table, let the player say they're out, then deal.
  useEffect(() => {
    if (state.phase !== 'round-end') return
    const victor = state.roundVictorIndex
    if (victor != null) showBubble(victor, OUT_BUBBLE_TEXT, 'out')
    const timer = setTimeout(() => dispatch({ type: 'CONTINUE_ROUND' }), 1600)
    return () => clearTimeout(timer)
  }, [state.phase, state.roundIndex, state.roundVictorIndex, showBubble])

  // Round open and the human's turn. Fresh deals name the round.
  useEffect(() => {
    const entered = prevCalloutPhase.current !== state.phase
    prevCalloutPhase.current = state.phase
    const freshDeal =
      state.phase === 'buy-window' &&
      state.tableMetlds.length === 0 &&
      state.players.every((p) => !p.hasGoneDown) &&
      state.currentPlayerIndex === humanPlayerIndex
    const roundLine = freshDeal && announcedRound.current !== state.roundIndex
    if (roundLine) announcedRound.current = state.roundIndex
    if (bootCallout.current) {
      bootCallout.current = false
      if (state.phase === 'buy-window' && !currentPlayer.isAI) {
        showFanfare(roundLine ? `Round ${state.roundIndex + 1} — your turn` : 'Your turn')
      }
      return
    }
    if (!entered || state.phase !== 'buy-window' || currentPlayer.isAI) return
    showFanfare(roundLine ? `Round ${state.roundIndex + 1} — your turn` : 'Your turn')
  }, [
    state.phase,
    state.roundIndex,
    state.currentPlayerIndex,
    state.tableMetlds,
    state.players,
    humanPlayerIndex,
    currentPlayer.isAI,
    showFanfare,
  ])

  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      const next: Record<number, { x: number; y: number }> = {}
      root.querySelectorAll<HTMLElement>('[data-avatar-anchor]').forEach((el) => {
        const idx = Number(el.dataset.avatarAnchor)
        if (Number.isNaN(idx)) return
        const rect = el.getBoundingClientRect()
        next[idx] = {
          x: rect.left - rootRect.left + rect.width / 2,
          y: rect.top - rootRect.top + rect.height / 2,
        }
      })
      setAnchors(next)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [bubbles, portrait, state.currentPlayerIndex])

  const flightTarget = useCallback((playerIndex: number) => {
    return playerIndex === humanPlayerIndex ? endSlotRef : handAnchorRefs[playerIndex]
  }, [handAnchorRefs, humanPlayerIndex])

  const arrivalFor = useCallback((playerIndex: number) => {
    return playerIndex === humanPlayerIndex ? undefined : playerIndex
  }, [humanPlayerIndex])

  const pushDrawFlights = useCallback((s: GameState, sourceRect?: DOMRect) => {
    const next = drawFromDeck(s)
    if (next.lastError) {
      dispatch({ type: 'DRAW_DECK' })
      return
    }
    const deckRect = sourceRect ?? deckWrapRef.current?.getBoundingClientRect()
    const discardRect = discardWrapRef.current?.getBoundingClientRect()
    const buyerIndex = s.phase === 'buy-window' ? s.buyIntents[0] : undefined

    if (buyerIndex !== undefined) {
      const topCard = topDiscard(s)
      const oldIds = new Set(s.players[buyerIndex].hand.map((c) => c.id))
      const gained = next.players[buyerIndex].hand.filter((c) => !oldIds.has(c.id))
      const penalty = gained.find((c) => c.id !== topCard?.id) ?? null
      const buyerTarget = flightTarget(buyerIndex)
      if (discardRect && topCard && buyerTarget) {
        enqueueFlight({
          card: topCard,
          sourceRect: discardRect,
          targetRef: buyerTarget,
          faceDown: false,
          viaCenter: true,
          arrivalPlayerIndex: arrivalFor(buyerIndex),
        })
      }
      if (deckRect && penalty && buyerTarget) {
        enqueueFlight({
          card: penalty,
          sourceRect: deckRect,
          targetRef: buyerTarget,
          faceDown: buyerIndex !== humanPlayerIndex,
          viaCenter: true,
          arrivalPlayerIndex: arrivalFor(buyerIndex),
        })
      }
    }

    const drawer = s.currentPlayerIndex
    const oldDrawer = new Set(s.players[drawer].hand.map((c) => c.id))
    const drawn = next.players[drawer].hand.find((c) => !oldDrawer.has(c.id)) ?? null
    const drawerTarget = flightTarget(drawer)
    if (deckRect && drawn && drawerTarget) {
      enqueueFlight({
        card: drawn,
        sourceRect: deckRect,
        targetRef: drawerTarget,
        faceDown: drawer !== humanPlayerIndex,
        viaCenter: true,
        arrivalPlayerIndex: arrivalFor(drawer),
      })
    }
    dispatch({ type: 'DRAW_DECK' })
  }, [arrivalFor, enqueueFlight, flightTarget, humanPlayerIndex])

  // Bots call buy on their own timers. Declaring does not reset the active player's wait.
  const buyWindowKey = `${state.roundIndex}:${state.currentPlayerIndex}:${top?.id ?? ''}:${state.phase}`
  useEffect(() => {
    if (animBusy) return
    if (state.phase !== 'buy-window') return
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const p of state.players) {
      if (!p.isAI) continue
      if (!canBuyDiscard(state, p.index)) continue
      if (!decideBuy(state, p.index)) continue
      const delay = sampleBuyDelayMs()
      timers.push(setTimeout(() => {
        const s = stateRef.current
        if (!canBuyDiscard(s, p.index)) return
        dispatch({ type: 'DECLARE_BUY', buyerIndex: p.index })
        showBubble(p.index, BUY_BUBBLE_TEXT, 'buy')
      }, delay))
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [buyWindowKey, animBusy, showBubble])

  // Active bot chooses claim (deny buys) or deck (resolve the first buy, then draw).
  useEffect(() => {
    if (animBusy) return
    if (!currentPlayer.isAI) return
    if (state.phase !== 'buy-window' && state.phase !== 'draw') return
    const delay = state.phase === 'buy-window' ? sampleDrawWindowMs() : sampleThinkDelayMs()
    const playerIndex = currentPlayer.index
    const timer = setTimeout(() => {
      const s = stateRef.current
      if (s.currentPlayerIndex !== playerIndex) return
      if (s.phase === 'buy-window') {
        if (decideDraw(s) === 'claim') {
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
        } else {
          pushDrawFlights(s)
        }
      } else if (s.phase === 'draw') {
        pushDrawFlights(s)
      }
    }, delay)
    return () => clearTimeout(timer)
  }, [
    animBusy,
    currentPlayer.index,
    currentPlayer.isAI,
    enqueueFlight,
    handAnchorRefs,
    pushDrawFlights,
    state.phase,
    state.roundIndex,
  ])

  const rotationForMeld = useCallback((meldId: string) => {
    const meld = stateRef.current.tableMetlds.find((m) => m.id === meldId)
    if (!meld || meld.ownerIndex === humanPlayerIndex) return 0
    return layout.regions.find((region) => region.playerIndex === meld.ownerIndex)?.rotationDeg ?? 0
  }, [humanPlayerIndex, layout.regions])

  const beginExtendFlight = useCallback((
    card: Card,
    meldId: string,
    sourceRect: DOMRect,
    side?: MeldEnd,
    leavingPlayerIndex?: number,
  ) => {
    const s = stateRef.current
    const preview = extendMeld(s, meldId, card.id, side, rules)
    if (preview.lastError) return
    const endsRound = preview.roundIndex !== s.roundIndex || preview.phase === 'game-end'
    const rotation = rotationForMeld(meldId)
    const scale = layout.setCardW / 64
    const action = {
      type: 'EXTEND' as const,
      meldId,
      cardId: card.id,
      side,
      rules,
    }
    if (endsRound) {
      const fan = document.querySelector<HTMLElement>(`[data-meld-id="${CSS.escape(meldId)}"]`)
      const meld = s.tableMetlds.find((m) => m.id === meldId)
      const ownerMelds = s.tableMetlds.filter((m) => m.ownerIndex === meld?.ownerIndex)
      const region = layout.regions.find((r) => r.playerIndex === meld?.ownerIndex)
      const perFan = region ? pocketFanLayout(region, ownerMelds, layout.setCardW).perFan : layout.setCardW
      const plan = meld
        ? planMeldPlay(
            meld.cards,
            meld.type,
            card,
            side,
            allowsWildDisplacement(rules, meld.type),
          )
        : null
      const targetPoint = fan && plan
        ? predictedSlotCenter(fan, plan.index, plan.cards, layout.setCardW, perFan, rotation)
        : null
      enqueueFlight({
        card,
        sourceRect,
        targetRef: meldRefFor(meldId),
        targetPoint,
        faceDown: false,
        viaCenter: false,
        endRotationDeg: rotation,
        endScale: scale,
        leavingPlayerIndex,
        pendingAction: action,
      })
      return
    }
    dispatch(action)
    enqueueFlight({
      card,
      sourceRect,
      targetRef: cardRefFor(card.id),
      faceDown: false,
      viaCenter: false,
      endRotationDeg: rotation,
      endScale: scale,
      concealCardId: card.id,
      leavingPlayerIndex,
    })
  }, [enqueueFlight, layout.regions, layout.setCardW, rotationForMeld, rules])

  // AI: current-bot play (paused while animating)
  useEffect(() => {
    if (animBusy) return
    if (state.phase === 'game-end' || state.phase === 'round-end') return

    const timers: ReturnType<typeof setTimeout>[] = []

    if (state.phase === 'play-or-discard' && currentPlayer.isAI) {
      const delay = sampleThinkDelayMs()
      timers.push(
        setTimeout(() => {
          const s = stateRef.current
          if (s.phase !== 'play-or-discard') return
          if (s.players[s.currentPlayerIndex]?.index !== currentPlayer.index) return

          const plan = decidePlay(s, Math.random, rules)
          const step = plan.steps[0]
          if (!step) return

          if (step.type === 'goDown') {
            dispatch({ type: 'GO_DOWN', meldCardArrays: step.melds })
            return
          }

          if (step.type === 'keep-wild') {
            dispatch({ type: 'KEEP_WILD' })
            return
          }

          if (step.type === 'extend') {
            const player = s.players[s.currentPlayerIndex]
            const card =
              player.hand.find((c) => c.id === step.cardId) ??
              (s.pendingWild?.id === step.cardId ? s.pendingWild : undefined)
            if (!card) return
            const fromWild = s.pendingWild?.id === card.id
            const seatEl = handAnchorRefs[player.index]?.current
            const sourceRect = fromWild
              ? new DOMRect(window.innerWidth / 2 - 32, window.innerHeight * 0.42 - 48, 64, 96)
              : (seatEl?.getBoundingClientRect() ??
                new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 64, 96))
            beginExtendFlight(card, step.meldId, sourceRect, step.side, fromWild ? undefined : player.index)
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
  }, [state, currentPlayer, animBusy, humanPlayerIndex, handAnchorRefs, enqueueFlight, rules, beginExtendFlight])

  const handleDrawDeck = useCallback((sourceRect?: DOMRect) => {
    pushDrawFlights(state, sourceRect)
  }, [pushDrawFlights, state])

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
    const next = declareBuy(state, humanPlayerIndex)
    dispatch({ type: 'DECLARE_BUY', buyerIndex: humanPlayerIndex })
    if (!next.lastError) showBubble(humanPlayerIndex, BUY_BUBBLE_TEXT, 'buy')
  }, [state, humanPlayerIndex, showBubble])

  const handleDropToMeld = useCallback((
    cardId: string,
    meldId: string,
    sourceRect: DOMRect,
    side?: MeldEnd,
  ) => {
    if (humanPlayerIndex === -1) return
    const player = state.players[humanPlayerIndex]
    if (!player || player.isAI || !player.hasGoneDown) return
    if (state.phase !== 'play-or-discard' || state.currentPlayerIndex !== humanPlayerIndex) return
    const card = state.pendingWild?.id === cardId
      ? state.pendingWild
      : player.hand.find((c) => c.id === cardId)
    if (!card) return
    setHoveredMeldId(null)
    setHoveredMeldSide(null)
    beginExtendFlight(
      card,
      meldId,
      sourceRect,
      side,
      state.pendingWild?.id === cardId ? undefined : humanPlayerIndex,
    )
  }, [beginExtendFlight, humanPlayerIndex, state.currentPlayerIndex, state.pendingWild, state.phase, state.players])

  const handleUndo = useCallback(() => {
    const s = stateRef.current
    const rec = s.extendHistory[s.extendHistory.length - 1]
    if (!rec || s.phase !== 'play-or-discard') return
    const player = s.players[s.currentPlayerIndex]
    const scale = layout.setCardW / 64
    const fallback = new DOMRect(
      window.innerWidth / 2 - 32,
      window.innerHeight / 2 - 48,
      64,
      96,
    )

    if (rec.meldId == null) {
      const card = player?.hand.find((c) => c.id === rec.playedCardId)
      const el = document.querySelector<HTMLElement>(
        `[data-hand-card][data-card-id="${CSS.escape(rec.playedCardId)}"]`,
      )
      dispatch({ type: 'UNDO_EXTEND' })
      if (!card) return
      enqueueFlight({
        card,
        sourceRect: el?.getBoundingClientRect() ?? fallback,
        targetRef: wildHoldRef,
        faceDown: false,
        viaCenter: false,
        endScale: 1,
        concealPendingWild: true,
      })
      return
    }

    const meld = s.tableMetlds.find((m) => m.id === rec.meldId)
    const played = meld?.cards.find((c) => c.id === rec.playedCardId)
    if (!meld || !played) {
      dispatch({ type: 'UNDO_EXTEND' })
      return
    }
    const rotation = rotationForMeld(rec.meldId)
    const sourceEl = cardRefFor(played.id).current
    const sourceRect = sourceEl?.getBoundingClientRect() ?? fallback
    const wild =
      rec.displacedWildId && s.pendingWild?.id === rec.displacedWildId
        ? s.pendingWild
        : null
    const wildEl = wild ? document.querySelector<HTMLElement>('[data-wild-hold]') : null
    const wildRect = wildEl?.getBoundingClientRect() ?? null

    dispatch({ type: 'UNDO_EXTEND' })

    enqueueFlight({
      card: played,
      sourceRect,
      targetRef: rec.fromPendingWild ? wildHoldRef : endSlotRef,
      faceDown: false,
      viaCenter: false,
      startRotationDeg: rotation,
      startScale: scale,
      endRotationDeg: 0,
      endScale: 1,
      concealPendingWild: rec.fromPendingWild,
    })

    if (wild && wildRect) {
      enqueueFlight({
        card: wild,
        sourceRect: wildRect,
        targetRef: cardRefFor(wild.id),
        faceDown: false,
        viaCenter: false,
        endRotationDeg: rotation,
        endScale: scale,
        concealCardId: wild.id,
      })
    }
  }, [enqueueFlight, layout.setCardW, rotationForMeld])

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
    setHoveredMeldId(null)
    setDiscardHot(false)
  }, [])

  // Pop a set up from its place on the table.
  const zoomMeld = useCallback((meldId: string, rotationDeg: number) => {
    const meld = state.tableMetlds.find((m) => m.id === meldId)
    const fan = document.querySelector<HTMLElement>(
      `[data-meld-id="${CSS.escape(meldId)}"]`,
    )
    if (!meld || !fan) return
    const rect = fan.getBoundingClientRect()
    const cardEl = fan.firstElementChild as HTMLElement | null
    setZoomedMeld({
      meld,
      rotationDeg,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      width: fan.offsetWidth,
      height: fan.offsetHeight,
      cardW: cardEl?.offsetWidth || layout.setCardW,
      cardH: cardEl?.offsetHeight || layout.setCardH,
      cardRadius: layout.setCardRadius,
    })
  }, [state.tableMetlds, layout.setCardW, layout.setCardH, layout.setCardRadius])

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
  const canDiscardDrag =
    isHumanTurn && isPlayOrDiscard && !animBusy && !prepOpen && !state.pendingWild
  const canReorderHand = humanPlayerIndex !== -1 && !animBusy
  const canPlayOntoSets =
    !animBusy &&
    !prepOpen &&
    humanPlayerIndex !== -1 &&
    isHumanTurn &&
    isPlayOrDiscard &&
    state.players[humanPlayerIndex].hasGoneDown
  /** Hand drags onto sets. A held wild is dragged from the table center instead. */
  const canExtend = canPlayOntoSets && !state.pendingWild
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
    for (const flight of flightQueue) {
      if (flight.leavingPlayerIndex === playerIndex) n -= 1
    }
    return Math.max(0, n)
  }

  // ---------------------------------------------------------------------------
  // Layout values derived from the viewport-responsive TableLayout
  // ---------------------------------------------------------------------------

  // Visible portion of the human hand above the screen bottom:
  //   hand height = 1.4×card (two overlapping rows)
  //   hang         = card/3 + handExtraHang  (off-screen)
  //   visible      = 1.4×card - hang
  const handVisibleH = humanHandVisiblePx(layout.handExtraHang)
  // Bottom offset for the hand wrapper (negative = hang below fold).
  const handBottomOffset = -(FULL_CARD_H / 3 + layout.handExtraHang)

  const cardForPlay = (cardId: string): Card | undefined => {
    if (state.pendingWild?.id === cardId) return state.pendingWild
    if (humanPlayerIndex === -1) return undefined
    return state.players[humanPlayerIndex]?.hand.find((c) => c.id === cardId)
  }

  const canDropToMeld = (cardId: string, meldId: string) => {
    if (!canPlayOntoSets) return false
    if (state.pendingWild && state.pendingWild.id !== cardId) return false
    const card = cardForPlay(cardId)
    const meld = state.tableMetlds.find((m) => m.id === meldId)
    if (!card || !meld) return false
    const plan = planMeldPlay(
      meld.cards,
      meld.type,
      card,
      undefined,
      allowsWildDisplacement(rules, meld.type),
    )
    if (!plan) return false
    if (!plan.displacedWild) return true
    const nextMelds = state.tableMetlds.map((m) =>
      m.id === meld.id ? { ...m, cards: plan.cards } : m,
    )
    return wildHasHome(nextMelds, plan.displacedWild, rules, meld.id)
  }

  const meldEnds = (cardId: string, meldId: string): MeldEnd[] => {
    const card = cardForPlay(cardId)
    const meld = state.tableMetlds.find((m) => m.id === meldId)
    if (!card || !meld) return []
    const plan = planMeldPlay(
      meld.cards,
      meld.type,
      card,
      undefined,
      allowsWildDisplacement(rules, meld.type),
    )
    if (plan?.displacedWild) return [plan.side]
    return legalAddEnds(meld.cards, meld.type, card)
  }

  const bubbleSide = (playerIndex: number): SpeechBubbleSide => {
    if (playerIndex === humanPlayerIndex) return 'bottom'
    return opponentSeats.find((seat) => seat.playerIndex === playerIndex)?.side ?? 'top'
  }

  return (
    <div
      ref={rootRef}
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
              onRevealName={() => showBubble(player.index, player.displayName, 'name')}
            />
          )
        })}

        {/* Set pockets share the pile layer and stay outside the deck and discard. */}
        {layout.regions.map((region) => {
          const melds = meldsByPlayer.get(region.playerIndex) ?? []
          if (melds.length === 0) return null
          const { perFan, contentAlong } = pocketFanLayout(region, melds, layout.setCardW)
          const box = orientedPocketLayout(
            region.rect,
            region.rotationDeg,
            contentAlong,
            layout.setCardH,
          )
          return (
            <div
              key={`sets-${region.playerIndex}`}
              data-set-region={region.side}
              style={{
                position: 'absolute',
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                transform: box.transform,
                transformOrigin: 'center center',
                zIndex: 1,
                pointerEvents: 'none',
              }}
            >
              <PlayerSets
                melds={melds}
                direction="row"
                cardW={layout.setCardW}
                cardH={layout.setCardH}
                cardRadius={layout.setCardRadius}
                maxFanWidth={perFan}
                targetMeldId={hoveredMeldId}
                activeEnd={hoveredMeldSide}
                hiddenCardId={
                  flightQueue.find((flight) => flight.concealCardId)?.concealCardId ?? null
                }
                cardRefFor={cardRefFor}
                onTap={(meldId) => zoomMeld(meldId, region.rotationDeg)}
                fanRefFor={meldRefFor}
              />
            </div>
          )
        })}

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
          ref={handWrapRef}
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
            canReorder={canReorderHand}
            canDiscard={canDiscardDrag}
            discardZoneRef={discardWrapRef}
            onReorder={handleReorder}
            onDiscardCard={handleDiscardCard}
            onDiscardHoverChange={setDiscardHot}
            inflightCardIds={
              new Set([
                ...flightQueue
                  .filter((f) =>
                    f.leavingPlayerIndex === humanPlayerIndex ||
                    (f.arrivalPlayerIndex === undefined && f.targetRef === endSlotRef),
                  )
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
            meldDropZones={
              canExtend
                ? state.tableMetlds.map((meld) => ({
                    meldId: meld.id,
                    ref: meldRefFor(meld.id),
                    rotationDeg: rotationForMeld(meld.id),
                  }))
                : undefined
            }
            canDropToMeld={canExtend ? canDropToMeld : undefined}
            meldEnds={canExtend ? meldEnds : undefined}
            onMeldHoverChange={
              canExtend
                ? (meldId, side) => {
                    setHoveredMeldId(meldId)
                    setHoveredMeldSide(side ?? null)
                  }
                : undefined
            }
            onDropToMeld={canExtend ? handleDropToMeld : undefined}
            showUndo={canPlayOntoSets && state.extendHistory.length > 0}
            onUndo={handleUndo}
          />
        </div>

        {humanPlayerIndex !== -1 && (
          <div
            data-avatar-anchor={humanPlayerIndex}
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

      {(state.pendingWild &&
        (canPlayOntoSets || flightQueue.some((flight) => flight.concealPendingWild))) && (
        <WildHold
          card={state.pendingWild}
          topPct={layout.pileTopPct}
          zones={state.tableMetlds.map((meld) => ({
            meldId: meld.id,
            ref: meldRefFor(meld.id),
            rotationDeg: rotationForMeld(meld.id),
          }))}
          canDrop={(meldId) => canDropToMeld(state.pendingWild!.id, meldId)}
          endsFor={(meldId) => meldEnds(state.pendingWild!.id, meldId)}
          onHover={(meldId, side) => {
            setHoveredMeldId(meldId)
            setHoveredMeldSide(side ?? null)
          }}
          onDrop={(meldId, side, rect) => {
            if (!state.pendingWild) return
            handleDropToMeld(state.pendingWild.id, meldId, rect, side)
          }}
          hidden={flightQueue.some((flight) => flight.concealPendingWild)}
          holdRef={wildHoldRef}
          handRef={rules.to === 'any-meld-or-hand' ? handWrapRef : undefined}
          onKeep={
            rules.to === 'any-meld-or-hand'
              ? () => dispatch({ type: 'KEEP_WILD' })
              : undefined
          }
        />
      )}

      <TableCallout text={callout?.text ?? null} tone={callout?.tone ?? 'fanfare'} top={layout.pileTopPct} />

      <SpeechBubbleLayer bubbles={bubbles} anchors={anchors} sideFor={bubbleSide} />

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
          targetPoint={activeFlightItem.targetPoint}
          endRotationDeg={activeFlightItem.endRotationDeg}
          endScale={activeFlightItem.endScale}
          startRotationDeg={activeFlightItem.startRotationDeg}
          startScale={activeFlightItem.startScale}
          onComplete={handleFlightComplete}
        />
      )}

      <SetZoomOverlay
        anchor={zoomedMeld}
        onClose={() => setZoomedMeld(null)}
      />
    </div>
  )
}
