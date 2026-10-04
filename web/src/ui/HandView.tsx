import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'

interface HandViewProps {
  cards: Card[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  /** Allow click-to-select (meld building). */
  canSelect: boolean
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

/** Front row covers 60% of the back row. */
const ROW_OVERLAP_PULL = 'calc(var(--card-h) * -0.6)'
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
 * Resolve a drop insert index from the pointer using topmost hand-card under the
 * cursor (works with overlapping rows). Index is relative to `cards` excluding
 * the dragged card (i.e. insert position into the "others" list).
 */
function insertIndexAtPoint(
  clientX: number,
  clientY: number,
  cards: Card[],
  dragId: string,
): number | null {
  const others = cards.filter((c) => c.id !== dragId)
  if (others.length === 0) return 0

  const hits = document.elementsFromPoint(clientX, clientY)
  for (const el of hits) {
    const cardEl = (el as HTMLElement).closest?.('[data-hand-card][data-card-id]') as
      | HTMLElement
      | null
    if (!cardEl) continue
    const id = cardEl.dataset.cardId
    if (!id || id === dragId) continue
    const idx = others.findIndex((c) => c.id === id)
    if (idx < 0) continue
    const rect = cardEl.getBoundingClientRect()
    const after = clientX > rect.left + rect.width / 2
    return after ? idx + 1 : idx
  }
  return null
}

interface HandRowProps {
  cards: Card[]
  selectedIds: Set<string>
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
}

function HandRow({
  cards,
  selectedIds,
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
}: HandRowProps) {
  const pullIn = Math.max(0, cardW - step)

  return (
    <div
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
            <CardView
              card={card}
              selected={selectedIds.has(card.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

export default function HandView({
  cards,
  selectedIds,
  onToggle,
  canSelect,
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
}: HandViewProps) {
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [cardW, setCardW] = useState(64)
  const [availableW, setAvailableW] = useState(320)
  const [page, setPage] = useState(0)
  const pendingIds = inflightCardIds ?? EMPTY_ID_SET

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewCards, setPreviewCards] = useState<Card[] | null>(null)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
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
    order: Card[]
    ghostX: number
    ghostY: number
  } | null>(null)

  const displayCards = previewCards ?? cards
  const pageCount = Math.max(1, Math.ceil(displayCards.length / HAND_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const canInteract = canSelect || canReorder || canDiscard

  // Keep page in range when the hand shrinks.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  // Jump to the page that contains the active flight / landing card so the slot stays measurable.
  useEffect(() => {
    const focusId = activeFlightCardId ?? landingCardId
    if (!focusId) return
    const idx = cards.findIndex((c) => c.id === focusId)
    if (idx < 0) return
    setPage(Math.floor(idx / HAND_PAGE_SIZE))
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
  }, [displayCards.length, safePage])

  useEffect(() => () => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
    if (popTimerRef.current !== null) clearTimeout(popTimerRef.current)
  }, [])

  // Latest props/state for window pointer handlers (stable effect).
  const latestRef = useRef({
    cards,
    canSelect,
    canReorder,
    canDiscard,
    discardZoneRef,
    onReorder,
    onDiscardCard,
    onDiscardHoverChange,
    onToggle,
  })
  latestRef.current = {
    cards,
    canSelect,
    canReorder,
    canDiscard,
    discardZoneRef,
    onReorder,
    onDiscardCard,
    onDiscardHoverChange,
    onToggle,
  }

  useEffect(() => {
    const clearLift = () => {
      setDraggingId(null)
      setPreviewCards(null)
      setGhostPos(null)
      setIsSettling(false)
    }

    const playSettlePop = (cardId: string) => {
      if (popTimerRef.current !== null) clearTimeout(popTimerRef.current)
      setSettlePopId(cardId)
      popTimerRef.current = setTimeout(() => {
        setSettlePopId((id) => (id === cardId ? null : id))
        popTimerRef.current = null
      }, REORDER_POP_MS)
    }

    /** Fly the ghost into its hand slot, then commit reorder + pop. */
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

    const finish = (commit: 'reorder' | 'discard' | 'cancel' | 'click') => {
      const drag = dragRef.current
      dragRef.current = null
      const cardId = drag?.cardId
      const order = drag?.order
      const wasOverDiscard = drag?.overDiscard ?? false
      const L = latestRef.current

      if (drag?.overDiscard) L.onDiscardHoverChange?.(false)

      if (!cardId) {
        clearLift()
        return
      }

      if (commit === 'discard' && wasOverDiscard && L.canDiscard) {
        clearLift()
        L.onDiscardCard?.(cardId)
        return
      }
      if (commit === 'reorder' && L.canReorder && order) {
        beginReorderSettle(cardId, order, drag.ghostX, drag.ghostY)
        return
      }
      clearLift()
      if (commit === 'click' && L.canSelect) {
        L.onToggle(cardId)
      }
    }

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const L = latestRef.current

      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        if (!L.canReorder && !L.canDiscard) return
        drag.active = true
        setDraggingId(drag.cardId)
        setPreviewCards(drag.order)
      }

      const gx = e.clientX - drag.offsetX
      const gy = e.clientY - drag.offsetY
      drag.ghostX = gx
      drag.ghostY = gy
      setGhostPos({ x: gx, y: gy })

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

      if (!overDiscard && L.canReorder) {
        const insertAt = insertIndexAtPoint(e.clientX, e.clientY, drag.order, drag.cardId)
        if (insertAt !== null) {
          const next = orderWithInsert(drag.order, drag.cardId, insertAt)
          const changed = next.some((c, i) => c.id !== drag.order[i]?.id)
          if (changed) {
            drag.order = next
            setPreviewCards(next)
          }
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

  const pageStart = safePage * HAND_PAGE_SIZE
  const pageCards = displayCards.slice(pageStart, pageStart + HAND_PAGE_SIZE)
  const backRow = pageCards.slice(0, CARDS_PER_ROW)
  const frontRow = pageCards.slice(CARDS_PER_ROW, HAND_PAGE_SIZE)
  const hasFrontRow = frontRow.length > 0

  // < 14 total: relax spacing for the actual count.
  // >= 14 total: lock spacing to a full 14-card row and reuse it on every row.
  const packingCount =
    displayCards.length < CARDS_PER_ROW ? Math.max(displayCards.length, 1) : CARDS_PER_ROW
  const step = computeStep(availableW, cardW, packingCount)

  // Block is always the width of a full packing row so partial front rows
  // share the same left edge; the block itself stays centered in the panel.
  const handBlockWidth = rowPixelWidth(cardW, step, packingCount)

  const showPager = displayCards.length > HAND_PAGE_SIZE
  const rangeStart = displayCards.length === 0 ? 0 : pageStart + 1
  const rangeEnd = pageStart + pageCards.length

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
      {showPager && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '4px',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            aria-label="Previous hand page"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              width: '36px',
              height: '32px',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ‹
          </button>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', minWidth: '7.5rem', textAlign: 'center' }}>
            {rangeStart}–{rangeEnd} of {displayCards.length}
          </span>
          <button
            type="button"
            aria-label="Next hand page"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              width: '36px',
              height: '32px',
              fontSize: '1rem',
              lineHeight: 1,
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* Full-width rail used only to measure panel width; hand block is centered inside. */}
      <div ref={measureRef} style={{ width: '100%' }}>
        <div
          style={{
            width: handBlockWidth > 0 ? handBlockWidth : '100%',
            maxWidth: '100%',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            paddingTop: '14px',
            minHeight: hasFrontRow
              ? 'calc(var(--card-h) * 1.4 + 14px)'
              : 'calc(var(--card-h) + 14px)',
          }}
        >
          {/* Back row (cards 1–14 of the page) */}
          <HandRow
            cards={backRow}
            selectedIds={selectedIds}
            onCardPointerDown={onCardPointerDown}
            canInteract={canInteract && !isSettling}
            inflightCardIds={pendingIds}
            activeFlightCardId={activeFlightCardId}
            endSlotRef={endSlotRef}
            landingCardId={landingCardId}
            settlePopId={settlePopId}
            draggingId={draggingId}
            zBase={0}
            step={step}
            cardW={cardW}
          />

          {/* Front row overlaps the back row by half a card; higher z for hit-testing. */}
          {hasFrontRow && (
            <div style={{ marginTop: ROW_OVERLAP_PULL }}>
              <HandRow
                cards={frontRow}
                selectedIds={selectedIds}
                onCardPointerDown={onCardPointerDown}
                canInteract={canInteract && !isSettling}
                inflightCardIds={pendingIds}
                activeFlightCardId={activeFlightCardId}
                endSlotRef={endSlotRef}
                landingCardId={landingCardId}
                settlePopId={settlePopId}
                draggingId={draggingId}
                zBase={CARDS_PER_ROW}
                step={step}
                cardW={cardW}
              />
            </div>
          )}
        </div>
      </div>

      {/* Drag ghost — follows the pointer; settles into the slot on release */}
      {draggedCard && ghostPos && (
        <div
          style={{
            position: 'fixed',
            left: ghostPos.x,
            top: ghostPos.y,
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
          <CardView card={draggedCard} selected={selectedIds.has(draggedCard.id)} />
        </div>
      )}
    </div>
  )
}
