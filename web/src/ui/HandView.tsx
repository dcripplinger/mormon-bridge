import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'
import { fanEndAtPoint } from './fan-end'
import { ghostLiftedOrigin } from './ghost-lift'
import { prepSlotLandingPos } from './GoDownPrep'

interface HandViewProps {
  cards: Card[]
  /** Allow drag-to-reorder within the hand. */
  canReorder: boolean
  /** Allow dropping a dragged card onto the discard pile. */
  canDiscard: boolean
  /** Element used as the discard drop target (pile wrapper). */
  discardZoneRef?: React.RefObject<HTMLElement | null>
  onReorder?: (orderedIds: string[]) => void
  onDiscardCard?: (cardId: string) => void
  onDiscardHoverChange?: (hovering: boolean) => void
  /** Cards currently in the flight queue — held as empty slots until each lands. */
  inflightCardIds?: ReadonlySet<string>
  /** The flight currently animating — its empty slot is the DrawFlight landing target. */
  activeFlightCardId?: string
  /** Ref attached to the active flight placeholder so DrawFlight can measure the landing target. */
  endSlotRef?: React.RefObject<HTMLDivElement | null>
  /** Card that just landed — receives a brief scale-in animation. */
  landingCardId?: string
  // ---- Go-Down prep support ----
  /** Drop zones for prep slots — lets hand-drag drop directly into a slot. */
  prepSlotRefs?: Array<React.RefObject<HTMLDivElement | null>>
  /** Called when a hand card is released over a prep slot. */
  onDropToSlot?: (cardId: string, slotIndex: number, sideHint: 'left' | 'right') => void
  /** True when this card may legally land in the given prep slot. */
  canDropToSlot?: (cardId: string, slotIndex: number) => boolean
  /** Called with the slot index being hovered during drag, or null when none. */
  onPrepSlotHoverChange?: (slotIndex: number | null) => void
  /** Table sets that can receive a dragged card. */
  meldDropZones?: Array<{
    meldId: string
    ref: React.RefObject<HTMLElement | null>
    rotationDeg: number
  }>
  /** True when this card may legally be played onto that set. */
  canDropToMeld?: (cardId: string, meldId: string) => boolean
  /** Legal ends for this card on that set. Two ends means the pointer picks. */
  meldEnds?: (cardId: string, meldId: string) => Array<'left' | 'right'>
  onMeldHoverChange?: (meldId: string | null, side?: 'left' | 'right') => void
  /** Release over a legal set. sourceRect is the dragged card's last box. */
  onDropToMeld?: (
    cardId: string,
    meldId: string,
    sourceRect: DOMRect,
    side?: 'left' | 'right',
  ) => void
  /** Undo plays onto existing sets. Mirrors the lower hand-scroll circle. */
  showUndo?: boolean
  onUndo?: () => void
}

/** Fixed capacity — width only changes spacing, never row membership. */
export const CARDS_PER_ROW = 14
export const ROWS_PER_PAGE = 2
export const HAND_PAGE_SIZE = CARDS_PER_ROW * ROWS_PER_PAGE

const EMPTY_ID_SET: ReadonlySet<string> = new Set()
const DRAG_THRESHOLD_PX = 8
/** Ghost flight into the hand slot after a reorder release. */
const REORDER_SETTLE_MS = 220
/** Brief pop on the card once it lands in its new slot. */
const REORDER_POP_MS = 500

/** Width reserved for the side chevron column when pagination is active. */
const PAGER_W = 40
/** Visible circle shared by the hand pager and the undo control. */
const SIDE_CIRCLE = 22
/** Gap between the hand's vertical midpoint and the lower side circle. */
const LOWER_CIRCLE_PAD = 12
/** Padding above the card rows inside the hand block. */
const HAND_BLOCK_PAD_TOP = 14
/**
 * Distance from the bottom of the hand block to the lower side circle.
 * The circle is centered in the two-row hand (pad + 1.4×card), then shifted
 * down by LOWER_CIRCLE_PAD. The hand is bottom-anchored and its lower portion
 * hangs off the screen, so this offset is measured from the bottom — a
 * shorter one-row hand must not recompute it from its own midpoint.
 */
const LOWER_CIRCLE_BOTTOM = `calc((${HAND_BLOCK_PAD_TOP}px + var(--card-h) * 1.4) / 2 - ${LOWER_CIRCLE_PAD + SIDE_CIRCLE}px)`
/** Circle inset that mirrors the pager column (right: -10, width PAGER_W). */
const SIDE_CIRCLE_OUTSET = (PAGER_W - SIDE_CIRCLE) / 2 - 10
/** Duration of the slide-in animation when changing hand pages. */
const PAGE_SLIDE_MS = 220
/** Milliseconds to hover a chevron before triggering a page during drag. */
const DRAG_HOVER_DELAY_MS = 500
/** Cooldown between successive drag-hover page triggers. */
const DRAG_HOVER_COOLDOWN_MS = 500

/** Front row covers 60% of the back row (kept for documentation). */
const _ROW_OVERLAP_PULL = 'calc(var(--card-h) * -0.6)'
void _ROW_OVERLAP_PULL
/** Soft max gap between cards on a wide screen (px past card width = slight separation). */
const MAX_STEP_EXTRA = 6

function computeStep(availableWidth: number, cardW: number, count: number): number {
  if (count <= 1) return cardW
  const ideal = (availableWidth - cardW) / (count - 1)
  // Always fit the packing count; on wide screens stop at a small gap rather than stretching.
  return Math.min(cardW + MAX_STEP_EXTRA, Math.max(1, ideal))
}

function rowPixelWidth(cardW: number, step: number, count: number): number {
  if (count <= 0) return 0
  if (count === 1) return cardW
  return cardW + (count - 1) * step
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/** Build a new order by placing dragId at insertIndex among the other cards. */
function orderWithInsert(cards: Card[], dragId: string, insertIndex: number): Card[] {
  const dragged = cards.find((c) => c.id === dragId)
  if (!dragged) return cards
  const others = cards.filter((c) => c.id !== dragId)
  const clamped = Math.max(0, Math.min(insertIndex, others.length))
  return [...others.slice(0, clamped), dragged, ...others.slice(clamped)]
}

/**
 * Resolve a drop insert index using row-band locking.
 *
 * 1. Determine which row the pointer is in (front row checked first since it
 *    visually overlaps the back row).
 * 2. Within that row, compute the insert position from pointer X against each
 *    card's midpoint — ignoring elementsFromPoint so gaps and empty space in
 *    the row still resolve cleanly.
 * 3. Map the row-local position back to a global "others" insert index.
 *
 * Index is relative to `cards` excluding the dragged card.
 */
function insertIndexAtPoint(
  clientX: number,
  clientY: number,
  cards: Card[],
  dragId: string,
  containerEl: HTMLElement,
): number | null {
  const others = cards.filter((c) => c.id !== dragId)
  if (others.length === 0) return 0

  // Identify which row band the pointer is in (front row has higher z so check first).
  const frontRowEl = containerEl.querySelector<HTMLElement>('[data-hand-row="front"]')
  const backRowEl = containerEl.querySelector<HTMLElement>('[data-hand-row="back"]')

  let targetRowEl: HTMLElement | null = null
  if (frontRowEl) {
    const r = frontRowEl.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) targetRowEl = frontRowEl
  }
  if (!targetRowEl && backRowEl) {
    const r = backRowEl.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) targetRowEl = backRowEl
  }
  if (!targetRowEl) return null

  // Collect non-dragged card elements in this row, sorted left→right.
  const rowCardEls = Array.from(
    targetRowEl.querySelectorAll<HTMLElement>('[data-hand-card][data-card-id]'),
  )
    .filter((el) => el.dataset.cardId !== dragId)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.left - b.rect.left)

  if (rowCardEls.length === 0) return null

  // Find insert slot from pointer X (left-half → before, right-half → after).
  let rowInsert = rowCardEls.length // default: after all cards in this row
  for (let i = 0; i < rowCardEls.length; i++) {
    const { rect } = rowCardEls[i]
    if (clientX < rect.left + rect.width / 2) {
      rowInsert = i
      break
    }
  }

  // Map row-local insert index to global others index.
  if (rowInsert === 0) {
    const firstId = rowCardEls[0].el.dataset.cardId!
    const idx = others.findIndex((c) => c.id === firstId)
    return idx < 0 ? null : idx
  }
  if (rowInsert >= rowCardEls.length) {
    const lastId = rowCardEls[rowCardEls.length - 1].el.dataset.cardId!
    const idx = others.findIndex((c) => c.id === lastId)
    return idx < 0 ? null : idx + 1
  }
  const targetId = rowCardEls[rowInsert].el.dataset.cardId!
  const idx = others.findIndex((c) => c.id === targetId)
  return idx < 0 ? null : idx
}

interface HandRowProps {
  cards: Card[]
  onCardPointerDown: (cardId: string, e: React.PointerEvent) => void
  canInteract: boolean
  inflightCardIds: ReadonlySet<string>
  activeFlightCardId?: string
  endSlotRef?: React.RefObject<HTMLDivElement | null>
  landingCardId?: string
  /** Card that just finished a reorder settle — brief pop. */
  settlePopId?: string | null
  draggingId: string | null
  /** Base z-index for this row (front row should be higher). */
  zBase: number
  step: number
  cardW: number
  /** Identifies this row for drag row-band hit-testing ('hidden' = off-screen, no hit-test). */
  rowName: 'back' | 'front' | 'hidden'
}

function HandRow({
  cards,
  onCardPointerDown,
  canInteract,
  inflightCardIds,
  activeFlightCardId,
  endSlotRef,
  landingCardId,
  settlePopId,
  draggingId,
  zBase,
  step,
  cardW,
  rowName,
}: HandRowProps) {
  const pullIn = Math.max(0, cardW - step)

  return (
    <div
      data-hand-row={rowName}
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        width: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {cards.map((card, index) => {
        const z = zBase + index + 1
        const marginLeft = index === 0 ? 0 : -pullIn
        const isDragging = draggingId === card.id

        // Still in flight (active or queued) — keep an empty slot of card size.
        if (inflightCardIds.has(card.id)) {
          return (
            <div
              key={card.id}
              ref={card.id === activeFlightCardId ? endSlotRef : undefined}
              data-hand-card
              data-card-id={card.id}
              style={{
                width: 'var(--card-w)',
                height: 'var(--card-h)',
                flexShrink: 0,
                marginLeft,
                zIndex: z,
                position: 'relative',
              }}
            />
          )
        }

        return (
          <div
            key={card.id}
            data-hand-card
            data-card-id={card.id}
            onPointerDown={
              canInteract ? (e) => onCardPointerDown(card.id, e) : undefined
            }
            style={{
              flexShrink: 0,
              marginLeft,
              zIndex: isDragging ? zBase + cards.length + 2 : z,
              position: 'relative',
              pointerEvents: 'auto',
              filter: isDragging
                ? 'none'
                : 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.35))',
              opacity: isDragging ? 0.35 : 1,
              touchAction: 'none',
              cursor: canInteract ? 'grab' : 'default',
              animation: !isDragging
                ? card.id === settlePopId
                  ? `card-settle ${REORDER_POP_MS}ms ease-in-out both`
                  : card.id === landingCardId
                    ? 'card-land 0.28s ease forwards'
                    : undefined
                : undefined,
            }}
          >
            <CardView card={card} />
          </div>
        )
      })}
    </div>
  )
}

export default function HandView({
  cards,
  canReorder,
  canDiscard,
  discardZoneRef,
  onReorder,
  onDiscardCard,
  onDiscardHoverChange,
  inflightCardIds,
  activeFlightCardId,
  endSlotRef,
  landingCardId,
  prepSlotRefs,
  onDropToSlot,
  canDropToSlot,
  onPrepSlotHoverChange,
  meldDropZones,
  canDropToMeld,
  onMeldHoverChange,
  onDropToMeld,
  meldEnds,
  showUndo,
  onUndo,
}: HandViewProps) {
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [cardW, setCardW] = useState(64)
  const [availableW, setAvailableW] = useState(320)
  const [rowOffset, setRowOffset] = useState(0)
  const pendingIds = inflightCardIds ?? EMPTY_ID_SET

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewCards, setPreviewCards] = useState<Card[] | null>(null)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [ghostPointer, setGhostPointer] = useState<{ x: number; y: number } | null>(null)
  const [isSettling, setIsSettling] = useState(false)
  const [settlePopId, setSettlePopId] = useState<string | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{
    cardId: string
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    active: boolean
    overDiscard: boolean
    overSlotIndex: number | null
    overMeldId: string | null
    overMeldSide: 'left' | 'right' | null
    cardW: number
    cardH: number
    order: Card[]
    ghostX: number
    ghostY: number
  } | null>(null)

  // Refs for side chevrons — used for drag hover-to-page
  const prevChevronRef = useRef<HTMLButtonElement | null>(null)
  const nextChevronRef = useRef<HTMLButtonElement | null>(null)
  const hoverChevronRef = useRef<'prev' | 'next' | null>(null)
  const hoverChevronTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const displayCards = previewCards ?? cards
  // Each pager step moves by exactly one row. Compute the max valid row offset
  // so the last visible row is always the last row that has cards.
  const rowCount = Math.ceil(displayCards.length / CARDS_PER_ROW)
  const maxRowOffset = Math.max(0, rowCount - ROWS_PER_PAGE)
  const safeRowOffset = Math.min(rowOffset, maxRowOffset)
  const showPager = displayCards.length > HAND_PAGE_SIZE
  const canInteract =
    canReorder || canDiscard || (meldDropZones?.length ?? 0) > 0 || (prepSlotRefs?.length ?? 0) > 0

  // Keep row offset in range when the hand shrinks.
  useEffect(() => {
    if (rowOffset > maxRowOffset) setRowOffset(maxRowOffset)
  }, [rowOffset, maxRowOffset])

  // Scroll to the row that contains the active flight / landing card so the slot stays measurable.
  useEffect(() => {
    const focusId = activeFlightCardId ?? landingCardId
    if (!focusId) return
    const idx = cards.findIndex((c) => c.id === focusId)
    if (idx < 0) return
    const targetRow = Math.floor(idx / CARDS_PER_ROW)
    const maxRO = Math.max(0, Math.ceil(cards.length / CARDS_PER_ROW) - ROWS_PER_PAGE)
    setRowOffset(Math.max(0, Math.min(maxRO, targetRow)))
  }, [activeFlightCardId, landingCardId, cards])

  // Sync preview if underlying cards change mid-drag (e.g. flight lands).
  useEffect(() => {
    if (!draggingId && !isSettling) setPreviewCards(null)
  }, [cards, draggingId, isSettling])

  useEffect(() => {
    const el = measureRef.current
    if (!el) return

    const update = () => {
      // Prefer measuring a real card; fall back to CSS variable size.
      const cardEl = el.querySelector<HTMLElement>('[data-hand-card]')
      setCardW(cardEl?.offsetWidth || 64)
      setAvailableW(el.clientWidth)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [displayCards.length, safeRowOffset])

  useEffect(() => () => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
    if (popTimerRef.current !== null) clearTimeout(popTimerRef.current)
    if (hoverChevronTimerRef.current !== null) clearTimeout(hoverChevronTimerRef.current)
  }, [])

  // Latest props/state for window pointer handlers (stable effect).
  const latestRef = useRef({
    cards,
    canReorder,
    canDiscard,
    discardZoneRef,
    onReorder,
    onDiscardCard,
    onDiscardHoverChange,
    maxRowOffset,
    safeRowOffset,
    showPager,
    prepSlotRefs,
    onDropToSlot,
    canDropToSlot,
    onPrepSlotHoverChange,
    meldDropZones,
    canDropToMeld,
    onMeldHoverChange,
    onDropToMeld,
    meldEnds,
  })
  latestRef.current = {
    cards,
    canReorder,
    canDiscard,
    discardZoneRef,
    onReorder,
    onDiscardCard,
    onDiscardHoverChange,
    maxRowOffset,
    safeRowOffset,
    showPager,
    prepSlotRefs,
    onDropToSlot,
    canDropToSlot,
    onPrepSlotHoverChange,
    meldDropZones,
    canDropToMeld,
    onMeldHoverChange,
    onDropToMeld,
    meldEnds,
  }

  useEffect(() => {
    const clearLift = () => {
      setDraggingId(null)
      setPreviewCards(null)
      setGhostPos(null)
      setGhostPointer(null)
      setIsSettling(false)
      if (hoverChevronTimerRef.current !== null) {
        clearTimeout(hoverChevronTimerRef.current)
        hoverChevronTimerRef.current = null
      }
      hoverChevronRef.current = null
    }

    const playSettlePop = (cardId: string) => {
      if (popTimerRef.current !== null) clearTimeout(popTimerRef.current)
      setSettlePopId(cardId)
      popTimerRef.current = setTimeout(() => {
        setSettlePopId((id) => (id === cardId ? null : id))
        popTimerRef.current = null
      }, REORDER_POP_MS)
    }

    /** Fly the ghost into a prep slot, then commit the drop. */
    const beginSlotDropSettle = (
      cardId: string,
      fromX: number,
      fromY: number,
      slotIndex: number,
      sideHint: 'left' | 'right',
    ) => {
      setDraggingId(cardId)
      setGhostPos({ x: fromX, y: fromY })
      setIsSettling(true)

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const L = latestRef.current
          const slotEl = L.prepSlotRefs?.[slotIndex]?.current
          const pos = slotEl ? prepSlotLandingPos(slotEl, sideHint) : null
          if (!pos) {
            clearLift()
            L.onDropToSlot?.(cardId, slotIndex, sideHint)
            return
          }
          setGhostPos(pos)
          if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null
            clearLift()
            L.onDropToSlot?.(cardId, slotIndex, sideHint)
          }, REORDER_SETTLE_MS)
        })
      })
    }
    const beginReorderSettle = (
      cardId: string,
      order: Card[],
      fromX: number,
      fromY: number,
    ) => {
      const L = latestRef.current
      const changed =
        order.length !== L.cards.length ||
        order.some((c, i) => c.id !== L.cards[i]?.id)

      // Keep the preview gap while the ghost flies home.
      setPreviewCards(order)
      setDraggingId(cardId)
      setGhostPos({ x: fromX, y: fromY })
      setIsSettling(true)

      const finishSettle = () => {
        clearLift()
        if (changed) L.onReorder?.(order.map((c) => c.id))
        playSettlePop(cardId)
      }

      // Double-rAF: paint ghost at release point, then transition to the slot.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const slot = measureRef.current?.querySelector<HTMLElement>(
            `[data-hand-card][data-card-id="${cardId}"]`,
          )
          if (!slot) {
            finishSettle()
            return
          }
          const rect = slot.getBoundingClientRect()
          setGhostPos({ x: rect.left, y: rect.top })
          if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null
            finishSettle()
          }, REORDER_SETTLE_MS)
        })
      })
    }

    /**
     * Called when the pointer first enters a chevron while dragging.
     * Pages after DRAG_HOVER_DELAY_MS, then again every DRAG_HOVER_COOLDOWN_MS
     * as long as the pointer stays on that chevron.
     */
    function triggerHoverPage(target: 'prev' | 'next') {
      hoverChevronTimerRef.current = setTimeout(() => {
        hoverChevronTimerRef.current = null
        if (hoverChevronRef.current !== target) return
        const L = latestRef.current
        const canGo = target === 'prev' ? L.safeRowOffset > 0 : L.safeRowOffset < L.maxRowOffset
        if (canGo) {
          setRowOffset((r) =>
            target === 'prev' ? Math.max(0, r - 1) : Math.min(L.maxRowOffset, r + 1),
          )
        }
        // Cooldown, then re-trigger if pointer is still hovering.
        hoverChevronTimerRef.current = setTimeout(() => {
          hoverChevronTimerRef.current = null
          if (hoverChevronRef.current === target) triggerHoverPage(target)
        }, DRAG_HOVER_COOLDOWN_MS)
      }, DRAG_HOVER_DELAY_MS)
    }

    const finish = (commit: 'reorder' | 'discard' | 'cancel' | 'click') => {
      const drag = dragRef.current
      dragRef.current = null
      const cardId = drag?.cardId
      const order = drag?.order
      const wasOverDiscard = drag?.overDiscard ?? false
      const wasOverSlotIndex = drag?.overSlotIndex ?? null
      const L = latestRef.current

      if (drag?.overDiscard) L.onDiscardHoverChange?.(false)
      if (drag?.overSlotIndex !== null && drag?.overSlotIndex !== undefined) {
        L.onPrepSlotHoverChange?.(null)
      }

      if (!cardId) {
        clearLift()
        return
      }

      // Drop onto prep slot — highest priority over discard/reorder.
      if (commit !== 'click' && wasOverSlotIndex !== null && L.onDropToSlot && drag) {
        const slotEl = L.prepSlotRefs?.[wasOverSlotIndex]?.current
        let sideHint: 'left' | 'right' = 'right'
        if (slotEl) {
          const r = slotEl.getBoundingClientRect()
          sideHint = drag.ghostX + drag.offsetX < r.left + r.width / 2 ? 'left' : 'right'
        }
        const lifted = ghostLiftedOrigin(
          drag.ghostX + drag.offsetX,
          drag.ghostY + drag.offsetY,
          window.innerWidth,
          window.innerHeight,
        )
        beginSlotDropSettle(cardId, lifted.x, lifted.y, wasOverSlotIndex, sideHint)
        return
      }

      if (commit === 'discard' && wasOverDiscard && L.canDiscard) {
        clearLift()
        L.onDiscardCard?.(cardId)
        return
      }
      if (commit === 'reorder' && L.canReorder && order) {
        const lifted = ghostLiftedOrigin(
          drag.ghostX + drag.offsetX,
          drag.ghostY + drag.offsetY,
          window.innerWidth,
          window.innerHeight,
        )
        beginReorderSettle(cardId, order, lifted.x, lifted.y)
        return
      }
      clearLift()
    }

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const L = latestRef.current

      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        const hasPrepTarget = (L.prepSlotRefs?.length ?? 0) > 0 && !!L.onDropToSlot
        const hasMeldTarget = (L.meldDropZones?.length ?? 0) > 0 && !!L.onDropToMeld
        if (!L.canReorder && !L.canDiscard && !hasPrepTarget && !hasMeldTarget) return
        drag.active = true
        setDraggingId(drag.cardId)
        setPreviewCards(drag.order)
      }

      const gx = e.clientX - drag.offsetX
      const gy = e.clientY - drag.offsetY
      drag.ghostX = gx
      drag.ghostY = gy
      setGhostPos({ x: gx, y: gy })
      setGhostPointer({ x: e.clientX, y: e.clientY })

      let overDiscard = false
      if (L.canDiscard && L.discardZoneRef?.current) {
        overDiscard = pointInRect(
          e.clientX,
          e.clientY,
          L.discardZoneRef.current.getBoundingClientRect(),
        )
      }
      if (overDiscard !== drag.overDiscard) {
        drag.overDiscard = overDiscard
        L.onDiscardHoverChange?.(overDiscard)
      }

      // Prep slot hover detection — only light up a valid drop target.
      if (L.prepSlotRefs && L.prepSlotRefs.length > 0) {
        let newSlotIndex: number | null = null
        for (let i = 0; i < L.prepSlotRefs.length; i++) {
          const el = L.prepSlotRefs[i].current
          if (!el) continue
          if (pointInRect(e.clientX, e.clientY, el.getBoundingClientRect())) {
            const allowed = L.canDropToSlot
              ? L.canDropToSlot(drag.cardId, i)
              : true
            if (allowed) newSlotIndex = i
            break
          }
        }
        if (newSlotIndex !== drag.overSlotIndex) {
          drag.overSlotIndex = newSlotIndex
          L.onPrepSlotHoverChange?.(newSlotIndex)
        }
      }

      let overMeldId: string | null = null
      let overMeldSide: 'left' | 'right' | null = null
      if (L.meldDropZones && L.onDropToMeld) {
        for (const zone of L.meldDropZones) {
          const el = zone.ref.current
          if (!el) continue
          const rect = el.getBoundingClientRect()
          if (!pointInRect(e.clientX, e.clientY, rect)) continue
          const allowed = L.canDropToMeld ? L.canDropToMeld(drag.cardId, zone.meldId) : false
          if (allowed) {
            overMeldId = zone.meldId
            const ends = L.meldEnds?.(drag.cardId, zone.meldId) ?? ['right']
            overMeldSide = ends.length > 1
              ? fanEndAtPoint(e.clientX, e.clientY, rect, zone.rotationDeg)
              : (ends[0] ?? 'right')
            break
          }
        }
      }
      if (overMeldId !== drag.overMeldId || overMeldSide !== drag.overMeldSide) {
        drag.overMeldId = overMeldId
        drag.overMeldSide = overMeldSide
        L.onMeldHoverChange?.(overMeldId, overMeldSide ?? undefined)
      }

      if (!overDiscard && !overMeldId && L.canReorder) {
        const containerEl = measureRef.current
        const insertAt = containerEl
          ? insertIndexAtPoint(e.clientX, e.clientY, drag.order, drag.cardId, containerEl)
          : null
        if (insertAt !== null) {
          const next = orderWithInsert(drag.order, drag.cardId, insertAt)
          const changed = next.some((c, i) => c.id !== drag.order[i]?.id)
          if (changed) {
            drag.order = next
            setPreviewCards(next)
          }
        }
      }

      // Drag hover-to-page: detect when pointer lingers over a side chevron.
      if (L.showPager) {
        let newHover: 'prev' | 'next' | null = null
        if (L.safeRowOffset > 0 && prevChevronRef.current) {
          if (pointInRect(e.clientX, e.clientY, prevChevronRef.current.getBoundingClientRect()))
            newHover = 'prev'
        }
        if (!newHover && L.safeRowOffset < L.maxRowOffset && nextChevronRef.current) {
          if (pointInRect(e.clientX, e.clientY, nextChevronRef.current.getBoundingClientRect()))
            newHover = 'next'
        }
        if (newHover !== hoverChevronRef.current) {
          if (hoverChevronTimerRef.current !== null) {
            clearTimeout(hoverChevronTimerRef.current)
            hoverChevronTimerRef.current = null
          }
          hoverChevronRef.current = newHover
          if (newHover !== null) triggerHoverPage(newHover)
        }
      }
    }

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const L = latestRef.current
      if (!drag.active) {
        finish('click')
        return
      }
      if (drag.overMeldId && L.onDropToMeld) {
        const meldId = drag.overMeldId
        const cardId = drag.cardId
        const lifted = ghostLiftedOrigin(
          e.clientX,
          e.clientY,
          window.innerWidth,
          window.innerHeight,
        )
        const rect = new DOMRect(lifted.x, lifted.y, drag.cardW, drag.cardH)
        drag.overSlotIndex = null
        finish('cancel')
        L.onMeldHoverChange?.(null)
        L.onDropToMeld(cardId, meldId, rect, drag.overMeldSide ?? undefined)
        return
      }
      if (drag.overDiscard && L.canDiscard) {
        finish('discard')
        return
      }
      finish(L.canReorder ? 'reorder' : 'cancel')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (hoverChevronTimerRef.current !== null) {
        clearTimeout(hoverChevronTimerRef.current)
        hoverChevronTimerRef.current = null
      }
    }
  }, [])

  const onCardPointerDown = (cardId: string, e: React.PointerEvent) => {
    if (!canInteract) return
    if (e.button !== 0) return
    // Don't start a new drag while one is active or settling
    if (dragRef.current || isSettling) return
    if (pendingIds.has(cardId)) return

    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    dragRef.current = {
      cardId,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      active: false,
      overDiscard: false,
      overSlotIndex: null,
      overMeldId: null,
      overMeldSide: null,
      cardW: rect.width,
      cardH: rect.height,
      order: [...(previewCards ?? cards)],
      ghostX: rect.left,
      ghostY: rect.top,
    }
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // capture is optional; window listeners still work
    }
  }

  /** Shift the visible window by one row; the CSS transition animates the strip. */
  const goPage = (dir: 'prev' | 'next') => {
    setRowOffset((r) =>
      dir === 'prev' ? Math.max(0, r - 1) : Math.min(maxRowOffset, r + 1),
    )
  }

  // Build every row from displayCards; the strip renders them all and a clip
  // viewport shows only the two visible ones.  Scrolling is pure CSS transform.
  const allRows = Array.from({ length: rowCount }, (_, i) =>
    displayCards.slice(i * CARDS_PER_ROW, (i + 1) * CARDS_PER_ROW),
  )
  const hasFrontRow = displayCards.length > CARDS_PER_ROW

  // < 14 total: relax spacing for the actual count.
  // >= 14 total: lock spacing to a full 14-card row and reuse it on every row.
  const packingCount =
    displayCards.length < CARDS_PER_ROW ? Math.max(displayCards.length, 1) : CARDS_PER_ROW
  // When the pager is visible it floats over the right edge; reserve enough
  // width so the centred hand block clears the chevron column.
  // The pager (width PAGER_W, right:-10) has its left edge at
  //   measureRef.right − (PAGER_W − 10) = measureRef.right − 30 px.
  // For a centred block to stay left of that, cardLayoutW must be reduced by
  //   2 × 30 = 60 px (centering halves the one-sided margin).
  // The hand block is still centred against the full measureRef width, so
  // optical centering is unaffected.
  const cardLayoutW = showPager ? Math.max(0, availableW - (PAGER_W - 10) * 2) : availableW
  const step = computeStep(cardLayoutW, cardW, packingCount)

  // Block is always the width of a full packing row so partial front rows
  // share the same left edge; the block itself stays centered in the panel.
  const handBlockWidth = rowPixelWidth(cardW, step, packingCount)

  const draggedCard = draggingId
    ? displayCards.find((c) => c.id === draggingId) ?? null
    : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: '8px 12px 10px',
        background: 'transparent',
        pointerEvents: 'none',
      }}
    >
      {/*
        Measurement rail — full available width so the hand block centers itself
        on the whole screen, regardless of whether the pager is present.
        The pager floats as an absolute overlay at the right edge.
      */}
      <div ref={measureRef} style={{ width: '100%', position: 'relative' }}>
        {/*
          Hand block — centered on the full measureRef width.
          Each row is absolutely positioned so it can move to its own target
          slot independently. Visible rows land at 0 (back) and 0.4×card-h
          (front); hidden rows park at -1×card-h (above) or 1.4×card-h
          (below). `transition: transform` on every row makes all three
          positions animate simultaneously — a true carousel with no DOM
          teardown and no bleed-through from adjacent rows.
        */}
        <div
          style={{
            width: handBlockWidth > 0 ? handBlockWidth : '100%',
            maxWidth: '100%',
            margin: '0 auto',
            paddingTop: HAND_BLOCK_PAD_TOP,
            minHeight: hasFrontRow
              ? 'calc(var(--card-h) * 1.4 + 14px)'
              : 'calc(var(--card-h) + 14px)',
          }}
        >
          {/*
            Clip container: sized to exactly the two-row visible area.
            `overflow: hidden` ensures rows outside that area are invisible.
          */}
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              height: hasFrontRow ? 'calc(var(--card-h) * 1.4)' : 'var(--card-h)',
            }}
          >
            {allRows.map((rowCards, i) => {
              const isVisible = i >= safeRowOffset && i < safeRowOffset + ROWS_PER_PAGE
              const rowName = i === safeRowOffset ? 'back' as const
                : i === safeRowOffset + 1 ? 'front' as const
                : 'hidden' as const

              // Target vertical position for this row:
              //   back row  → 0
              //   front row → 0.4 × card-h  (overlap pull)
              //   above clip → -1 × card-h  (parked fully above)
              //   below clip → 1.4 × card-h (parked fully below)
              const translateY =
                i < safeRowOffset
                  ? 'calc(var(--card-h) * -1)'
                  : i === safeRowOffset
                    ? '0px'
                    : i === safeRowOffset + 1
                      ? 'calc(var(--card-h) * 0.4)'
                      : 'calc(var(--card-h) * 1.4)'

              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${translateY})`,
                    transition: `transform ${PAGE_SLIDE_MS}ms ease`,
                    pointerEvents: isVisible ? undefined : 'none',
                  }}
                >
                  <HandRow
                    cards={rowCards}
                    onCardPointerDown={onCardPointerDown}
                    canInteract={isVisible && canInteract && !isSettling}
                    inflightCardIds={pendingIds}
                    activeFlightCardId={activeFlightCardId}
                    endSlotRef={endSlotRef}
                    landingCardId={landingCardId}
                    settlePopId={settlePopId}
                    draggingId={draggingId}
                    zBase={i * CARDS_PER_ROW}
                    step={step}
                    cardW={cardW}
                    rowName={rowName}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {showUndo && (
          <button
            type="button"
            aria-label="Undo last play"
            onClick={onUndo}
            style={{
              position: 'absolute',
              left: SIDE_CIRCLE_OUTSET,
              bottom: LOWER_CIRCLE_BOTTOM,
              width: SIDE_CIRCLE,
              height: SIDE_CIRCLE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '50%',
              cursor: 'pointer',
              padding: 0,
              zIndex: 5,
              pointerEvents: 'auto',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.5 3.5 L3 6.5 L6.5 9.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3.5 6.5 H9.2 a3.2 3.2 0 0 1 0 6.4 H7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {/* Side pager — floats at the right edge. Each button fills half the
            container so the entire half is clickable/hoverable; the visible
            circle is an inner <span> centered inside that hit area. */}
        {showPager && (
          <div
            style={{
              position: 'absolute',
              right: -10,
              top: 0,
              bottom: 0,
              width: PAGER_W,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              pointerEvents: 'auto',
            }}
          >
            {/*
              Each button fills its half of the container (flex: 1) for a large
              hit area.  The visible circle is pinned toward the centre of the
              container — prev uses alignItems: flex-end + paddingBottom and
              next uses alignItems: flex-start + paddingTop — so both circles
              sit near the vertical midpoint with a 24 px gap between them,
              matching where they were before.
            */}
            <button
              ref={prevChevronRef}
              type="button"
              aria-label="Previous hand page"
              disabled={safeRowOffset <= 0}
              onClick={() => goPage('prev')}
              style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                paddingBottom: LOWER_CIRCLE_PAD,
                background: 'transparent',
                border: 'none',
                cursor: safeRowOffset <= 0 ? 'default' : 'pointer',
              }}
            >
              <span
                style={{
                  width: SIDE_CIRCLE,
                  height: SIDE_CIRCLE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '50%',
                  opacity: safeRowOffset <= 0 ? 0.4 : 1,
                  pointerEvents: 'none',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 10 L8 5 L13 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
            <button
              ref={nextChevronRef}
              type="button"
              aria-label="Next hand page"
              disabled={safeRowOffset >= maxRowOffset}
              onClick={() => goPage('next')}
              style={{
                flex: 1,
                width: '100%',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: LOWER_CIRCLE_PAD,
                background: 'transparent',
                border: 'none',
                cursor: safeRowOffset >= maxRowOffset ? 'default' : 'pointer',
              }}
            >
              <span
                style={{
                  width: SIDE_CIRCLE,
                  height: SIDE_CIRCLE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '50%',
                  opacity: safeRowOffset >= maxRowOffset ? 0.4 : 1,
                  pointerEvents: 'none',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 6 L8 11 L13 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Drag ghost — lifted above the pointer; settles into the slot on release */}
      {draggedCard && ghostPos && (
        <div
          data-drag-ghost
          style={{
            position: 'fixed',
            left: isSettling || !ghostPointer
              ? ghostPos.x
              : ghostLiftedOrigin(
                  ghostPointer.x,
                  ghostPointer.y,
                  window.innerWidth,
                  window.innerHeight,
                ).x,
            top: isSettling || !ghostPointer
              ? ghostPos.y
              : ghostLiftedOrigin(
                  ghostPointer.x,
                  ghostPointer.y,
                  window.innerWidth,
                  window.innerHeight,
                ).y,
            width: 'var(--card-w)',
            height: 'var(--card-h)',
            zIndex: 1000,
            pointerEvents: 'none',
            filter: isSettling
              ? 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
              : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.45))',
            transform: isSettling
              ? 'scale(1) rotate(0deg)'
              : 'scale(1.06) rotate(-3deg)',
            transition: isSettling
              ? `left ${REORDER_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `top ${REORDER_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `transform ${REORDER_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `filter ${REORDER_SETTLE_MS}ms ease`
              : 'none',
          }}
        >
          <CardView card={draggedCard} />
        </div>
      )}
    </div>
  )
}
