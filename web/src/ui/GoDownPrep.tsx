import React, { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import { isWild } from '../game/card'
import { canPlaceCard, type PrepSlot } from '../game/go-down-prep'
import CardView from './CardView'

// ---------------------------------------------------------------------------
// Card / slot sizing
// ---------------------------------------------------------------------------

/** Full-size cards inside the modal for build comfort. */
const SLOT_CARD_W = 64
const SLOT_CARD_H = 96
const SLOT_CARD_RADIUS = 6

/** Pre-determined slot content area width — roomy enough for ~6 cards. */
const SLOT_PRE_WIDTH = 210

/** Overlap rules for the in-slot fan. */
const SLOT_MIN_STEP = 14 // ≥14 px of each card's left face exposed
const SLOT_MAX_STEP = Math.round(SLOT_CARD_W * 0.65) // ≤65% of cardW step (≥35% overlap)

const DRAG_THRESHOLD_PX = 8
/** Ghost flight into a slot (or back to source) after release. */
export const PREP_SETTLE_MS = 220
/** Stagger between cancel-return flights (slot order, left to right). */
const CANCEL_STAGGER_MS = 50

/**
 * Viewport position a card should settle into inside a prep slot.
 * Left hint lands at the start of the fan; right hint lands just past the last card.
 */
export function prepSlotLandingPos(
  slotEl: HTMLElement,
  sideHint: 'left' | 'right',
): { x: number; y: number } {
  const area = slotEl.querySelector<HTMLElement>('[data-prep-card-area]')
  const r = (area ?? slotEl).getBoundingClientRect()
  const cardEls = area
    ? Array.from(area.querySelectorAll<HTMLElement>('[data-slot-card]'))
    : []
  if (cardEls.length === 0 || sideHint === 'left') {
    return { x: r.left, y: r.top }
  }
  const first = cardEls[0].getBoundingClientRect()
  const last = cardEls[cardEls.length - 1].getBoundingClientRect()
  const step =
    cardEls.length <= 1
      ? SLOT_MIN_STEP
      : (last.left - first.left) / (cardEls.length - 1)
  return { x: last.left + step, y: last.top }
}

function useElementWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(SLOT_PRE_WIDTH)
  useEffect(() => {
    if (!el) return
    const update = () => setW(el.clientWidth || SLOT_PRE_WIDTH)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

// ---------------------------------------------------------------------------
// SlotFan
// ---------------------------------------------------------------------------

interface SlotFanProps {
  slot: PrepSlot
  draggingCardId: string | null
  onCardPointerDown: (cardId: string, card: Card, e: React.PointerEvent) => void
  /** Available width of the slot card area; fans pack within this. */
  maxWidth: number
}

function SlotFan({ slot, draggingCardId, onCardPointerDown, maxWidth }: SlotFanProps) {
  const { cards } = slot
  const count = cards.length
  if (count === 0) return null

  const fanMax = Math.max(SLOT_CARD_W, maxWidth)
  const step =
    count <= 1
      ? 0
      : Math.min(SLOT_MAX_STEP, Math.max(SLOT_MIN_STEP, (fanMax - SLOT_CARD_W) / (count - 1)))
  const fanW = count <= 1 ? SLOT_CARD_W : SLOT_CARD_W + (count - 1) * step

  return (
    <div style={{ position: 'relative', width: fanW, height: SLOT_CARD_H, flexShrink: 0 }}>
      {cards.map((card, i) => {
        const isDragging = draggingCardId === card.id
        const wildAtEnd =
          slot.type === 'run' &&
          isWild(card) &&
          (i === 0 || i === cards.length - 1) &&
          (isWild(cards[0]) || isWild(cards[cards.length - 1]))
        return (
          <div
            key={card.id}
            onPointerDown={(e) => onCardPointerDown(card.id, card, e)}
            data-slot-card={card.id}
            style={{
              position: 'absolute',
              left: i * step,
              top: 0,
              width: SLOT_CARD_W,
              height: SLOT_CARD_H,
              zIndex: isDragging ? count + 5 : i + 1,
              cursor: 'grab',
              touchAction: 'none',
              opacity: isDragging ? 0.25 : 1,
              filter: isDragging ? 'none' : 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))',
              transition: 'opacity 0.1s',
            }}
          >
            <CardView card={card} style={{ width: SLOT_CARD_W, height: SLOT_CARD_H, borderRadius: SLOT_CARD_RADIUS }} />
            {/* Wild-at-end indicator so player knows it can be swapped */}
            {isWild(card) && wildAtEnd && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '0.5rem',
                  color: 'rgba(255,255,255,0.55)',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.04em',
                }}
              >
                drag to swap
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface PrepSlotBoxProps {
  slot: PrepSlot
  dropRef: React.RefObject<HTMLDivElement | null>
  isHighlighted: boolean
  compact: boolean
  draggingCardId: string | null
  onCardPointerDown: (cardId: string, card: Card, e: React.PointerEvent) => void
}

function PrepSlotBox({
  slot,
  dropRef,
  isHighlighted,
  compact,
  draggingCardId,
  onCardPointerDown,
}: PrepSlotBoxProps) {
  const [areaEl, setAreaEl] = useState<HTMLDivElement | null>(null)
  const areaW = useElementWidth(areaEl)

  return (
    <div
      ref={dropRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 6 : 8,
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: 10,
        border: isHighlighted
          ? '2px solid var(--accent)'
          : '2px dashed rgba(255,255,255,0.18)',
        background: isHighlighted
          ? 'rgba(232,164,34,0.10)'
          : 'rgba(255,255,255,0.04)',
        flex: '1 1 170px',
        maxWidth: SLOT_PRE_WIDTH + 24,
        minWidth: SLOT_CARD_W + 24,
        boxSizing: 'border-box',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div
        style={{
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '0.09em',
          color: slot.type === 'group' ? '#8ecf8e' : '#8ec8e8',
          textTransform: 'uppercase',
        }}
      >
        {slot.type === 'group' ? 'Group' : 'Run'}
      </div>

      <div
        ref={setAreaEl}
        data-prep-card-area
        style={{
          position: 'relative',
          width: '100%',
          height: SLOT_CARD_H,
          flexShrink: 0,
        }}
      >
        {slot.cards.length === 0 ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: SLOT_CARD_RADIUS,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.15)',
              fontSize: '2rem',
              userSelect: 'none',
            }}
          >
            +
          </div>
        ) : (
          <SlotFan
            slot={slot}
            maxWidth={areaW}
            draggingCardId={draggingCardId}
            onCardPointerDown={onCardPointerDown}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GoDownPrep
// ---------------------------------------------------------------------------

export interface GoDownPrepProps {
  slots: PrepSlot[]
  slotDropZoneRefs: Array<React.RefObject<HTMLDivElement | null>>
  highlightedSlotIndex: number | null
  isSubmitEnabled: boolean
  onSubmit: () => void
  onCancel: () => void
  onRemoveCard: (slotId: string, cardId: string) => void
  onMoveCard: (
    fromSlotId: string,
    cardId: string,
    toSlotId: string,
    sideHint: 'left' | 'right',
  ) => void
  /**
   * Called at the start of cancel: cards leave prep slots (and reappear in
   * the hand as empty inflight placeholders) while ghosts are still flying.
   */
  onReturnCardsToHand: () => void
  /**
   * Pixels reserved at the bottom of the viewport for the hand.
   * The panel is laid out in the remaining space above this inset
   * so it never covers the cards.
   */
  bottomInset: number
  /** Tighter padding/gaps for short landscape viewports. */
  compact?: boolean
}

interface SlotDragState {
  fromSlotId: string
  cardId: string
  draggedCard: Card
  pointerId: number
  startX: number
  startY: number
  ghostX: number
  ghostY: number
  offsetX: number
  offsetY: number
  active: boolean
  wildAtEnd: boolean
  sourceX: number
  sourceY: number
}

export default function GoDownPrep({
  slots,
  slotDropZoneRefs,
  highlightedSlotIndex,
  isSubmitEnabled,
  onSubmit,
  onCancel,
  onRemoveCard,
  onMoveCard,
  onReturnCardsToHand,
  bottomInset,
  compact = false,
}: GoDownPrepProps) {
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [draggedCard, setDraggedCard] = useState<Card | null>(null)
  const [isSettling, setIsSettling] = useState(false)
  const dragRef = useRef<SlotDragState | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [localHoverIndex, setLocalHoverIndex] = useState<number | null>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settlingRef = useRef(false)

  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const onRemoveCardRef = useRef(onRemoveCard)
  const onMoveCardRef = useRef(onMoveCard)
  onRemoveCardRef.current = onRemoveCard
  onMoveCardRef.current = onMoveCard
  const slotRefsRef = useRef(slotDropZoneRefs)
  slotRefsRef.current = slotDropZoneRefs
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const onReturnCardsRef = useRef(onReturnCardsToHand)
  onReturnCardsRef.current = onReturnCardsToHand

  const [cancelGhosts, setCancelGhosts] = useState<Array<{
    card: Card
    x: number
    y: number
    settling: boolean
  }>>([])
  const cancellingRef = useRef(false)
  const cancelTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearDragVisual = () => {
    settlingRef.current = false
    setDraggingCardId(null)
    setGhostPos(null)
    setDraggedCard(null)
    setIsSettling(false)
    hoverIndexRef.current = null
    setLocalHoverIndex(null)
  }

  const beginSettle = (
    fromX: number,
    fromY: number,
    getTarget: () => { x: number; y: number } | null,
    onDone: () => void,
  ) => {
    settlingRef.current = true
    setIsSettling(true)
    setGhostPos({ x: fromX, y: fromY })
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const tgt = getTarget()
        if (!tgt) {
          onDone()
          return
        }
        setGhostPos(tgt)
        if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null
          onDone()
        }, PREP_SETTLE_MS)
      })
    })
  }

  useEffect(() => () => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
    for (const t of cancelTimersRef.current) clearTimeout(t)
  }, [])

  const startCancel = () => {
    if (cancellingRef.current) return

    const items: Array<{ card: Card; x: number; y: number; settling: boolean }> = []
    for (const slot of slotsRef.current) {
      for (const card of slot.cards) {
        const el = document.querySelector<HTMLElement>(
          `[data-slot-card="${CSS.escape(card.id)}"]`,
        )
        const r = el?.getBoundingClientRect()
        items.push({
          card,
          x: r?.left ?? 0,
          y: r?.top ?? 0,
          settling: false,
        })
      }
    }

    if (items.length === 0) {
      onCancelRef.current()
      return
    }

    cancellingRef.current = true
    setCancelGhosts(items)
    onReturnCardsRef.current()

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        items.forEach((item, i) => {
          const t = setTimeout(() => {
            const target = document.querySelector<HTMLElement>(
              `[data-hand-card][data-card-id="${CSS.escape(item.card.id)}"]`,
            )
            const r = target?.getBoundingClientRect()
            setCancelGhosts((prev) =>
              prev.map((g) =>
                g.card.id === item.card.id
                  ? { ...g, x: r?.left ?? g.x, y: r?.top ?? g.y, settling: true }
                  : g,
              ),
            )
          }, i * CANCEL_STAGGER_MS)
          cancelTimersRef.current.push(t)
        })
        const done = setTimeout(() => {
          onCancelRef.current()
        }, (items.length - 1) * CANCEL_STAGGER_MS + PREP_SETTLE_MS + 40)
        cancelTimersRef.current.push(done)
      })
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const slotIndexAtPoint = (cx: number, cy: number): number => {
      const refs = slotRefsRef.current
      for (let i = 0; i < refs.length; i++) {
        const el = refs[i].current
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return i
      }
      return -1
    }

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      if (settlingRef.current) return

      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return
        drag.active = true
        setDraggingCardId(drag.cardId)
        setDraggedCard(drag.draggedCard)
      }

      const gx = e.clientX - drag.offsetX
      const gy = e.clientY - drag.offsetY
      drag.ghostX = gx
      drag.ghostY = gy
      setGhostPos({ x: gx, y: gy })

      // Highlight a slot only when it is a valid drop for this card.
      let newIndex: number | null = null
      const idx = slotIndexAtPoint(e.clientX, e.clientY)
      if (idx !== -1) {
        const slot = slotsRef.current[idx]
        if (slot) {
          if (slot.id === drag.fromSlotId) {
            if (drag.wildAtEnd) newIndex = idx
          } else if (canPlaceCard(slot, drag.draggedCard)) {
            newIndex = idx
          }
        }
      }
      if (newIndex !== hoverIndexRef.current) {
        hoverIndexRef.current = newIndex
        setLocalHoverIndex(newIndex)
      }
    }

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      dragRef.current = null

      hoverIndexRef.current = null
      setLocalHoverIndex(null)

      if (!drag.active) {
        clearDragVisual()
        return
      }

      const cx = e.clientX
      const cy = e.clientY
      const targetSlotIndex = slotIndexAtPoint(cx, cy)
      const fromX = drag.ghostX
      const fromY = drag.ghostY
      const sourcePos = { x: drag.sourceX, y: drag.sourceY }

      if (targetSlotIndex === -1) {
        // Dropped outside — return to hand, then fly the ghost onto the hand card.
        onRemoveCardRef.current(drag.fromSlotId, drag.cardId)
        beginSettle(fromX, fromY, () => {
          const el = document.querySelector<HTMLElement>(
            `[data-hand-card][data-card-id="${drag.cardId}"]`,
          )
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { x: r.left, y: r.top }
        }, clearDragVisual)
        return
      }

      const targetSlot = slotsRef.current[targetSlotIndex]
      const slotEl = slotRefsRef.current[targetSlotIndex]?.current
      if (!targetSlot || !slotEl) {
        beginSettle(fromX, fromY, () => sourcePos, clearDragVisual)
        return
      }

      const slotRect = slotEl.getBoundingClientRect()
      const sideHint: 'left' | 'right' =
        cx < slotRect.left + slotRect.width / 2 ? 'left' : 'right'

      if (targetSlot.id === drag.fromSlotId) {
        if (drag.wildAtEnd) {
          const fromSlot = slotsRef.current.find((s) => s.id === drag.fromSlotId)
          const wildAtLeft = !!fromSlot && fromSlot.cards[0]?.id === drag.cardId
          const destHint: 'left' | 'right' = wildAtLeft ? 'right' : 'left'
          beginSettle(
            fromX,
            fromY,
            () => prepSlotLandingPos(slotEl, destHint),
            () => {
              onMoveCardRef.current(drag.fromSlotId, drag.cardId, targetSlot.id, sideHint)
              clearDragVisual()
            },
          )
        } else {
          beginSettle(fromX, fromY, () => sourcePos, clearDragVisual)
        }
        return
      }

      if (!canPlaceCard(targetSlot, drag.draggedCard)) {
        beginSettle(fromX, fromY, () => sourcePos, clearDragVisual)
        return
      }

      beginSettle(
        fromX,
        fromY,
        () => prepSlotLandingPos(slotEl, sideHint),
        () => {
          onMoveCardRef.current(drag.fromSlotId, drag.cardId, targetSlot.id, sideHint)
          clearDragVisual()
        },
      )
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

  const handleCardPointerDown = (
    slotId: string,
    card: Card,
    slot: PrepSlot,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return
    if (dragRef.current || isSettling || cancellingRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cardIdx = slot.cards.findIndex((c) => c.id === card.id)
    const wildAtEnd =
      slot.type === 'run' &&
      isWild(card) &&
      (cardIdx === 0 || cardIdx === slot.cards.length - 1)
    dragRef.current = {
      fromSlotId: slotId,
      cardId: card.id,
      draggedCard: card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      ghostX: rect.left,
      ghostY: rect.top,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      active: false,
      wildAtEnd,
      sourceX: rect.left,
      sourceY: rect.top,
    }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch { /* optional */ }
  }

  return (
    <>
      {/*
        Safe-area frame sits above the hand (bottomInset) and never covers it.
        pointer-events:none so clicks fall through to the table/hand around the panel.
      */}
      <div
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          right: 8,
          bottom: bottomInset,
          zIndex: 201,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: cancelGhosts.length > 0 ? 'none' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: compact ? 10 : 16,
            padding: compact ? '12px 12px 10px' : '18px 16px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
            width: 'min(100%, 760px)',
            maxHeight: '100%',
            overflow: 'auto',
            boxSizing: 'border-box',
          }}
        >
        {/* Header */}
        <div style={{ textAlign: 'center', color: 'var(--text)', fontSize: compact ? '0.72rem' : '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Go Down
        </div>

        {/* Slots — wrap so 3-wide, 2+1, or stacked all work */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: compact ? 8 : 12,
            width: '100%',
          }}
        >
          {slots.map((slot, i) => (
            <PrepSlotBox
              key={slot.id}
              slot={slot}
              dropRef={slotDropZoneRefs[i]!}
              isHighlighted={highlightedSlotIndex === i || localHoverIndex === i}
              compact={compact}
              draggingCardId={draggingCardId}
              onCardPointerDown={(_cardId, card, e) =>
                handleCardPointerDown(slot.id, card, slot, e)
              }
            />
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            disabled={cancelGhosts.length > 0}
            onClick={startCancel}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              fontSize: '0.78rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: cancelGhosts.length > 0 ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isSubmitEnabled || cancelGhosts.length > 0}
            onClick={onSubmit}
            style={{
              padding: '10px 24px',
              background: isSubmitEnabled ? 'var(--accent)' : 'var(--surface-2)',
              color: isSubmitEnabled ? '#1a1a1a' : 'var(--text-dim)',
              border: 'none',
              borderRadius: 7,
              fontSize: '0.78rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: isSubmitEnabled ? 'pointer' : 'default',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            GO DOWN
          </button>
        </div>
      </div>
      </div>

      {/* Drag ghost */}
      {draggedCard && ghostPos && (
        <div
          style={{
            position: 'fixed',
            left: ghostPos.x,
            top: ghostPos.y,
            width: SLOT_CARD_W,
            height: SLOT_CARD_H,
            zIndex: 500,
            pointerEvents: 'none',
            filter: isSettling
              ? 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
              : 'drop-shadow(0 10px 20px rgba(0,0,0,0.55))',
            transform: isSettling
              ? 'scale(1) rotate(0deg)'
              : 'scale(1.07) rotate(-3deg)',
            transition: isSettling
              ? `left ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `top ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `transform ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `filter ${PREP_SETTLE_MS}ms ease`
              : 'none',
          }}
        >
          <CardView card={draggedCard} style={{ width: SLOT_CARD_W, height: SLOT_CARD_H, borderRadius: SLOT_CARD_RADIUS }} />
        </div>
      )}

      {/* Cancel-return ghosts — fly to original hand positions in slot order */}
      {cancelGhosts.map((g) => (
        <div
          key={g.card.id}
          style={{
            position: 'fixed',
            left: g.x,
            top: g.y,
            width: SLOT_CARD_W,
            height: SLOT_CARD_H,
            zIndex: 500,
            pointerEvents: 'none',
            filter: g.settling
              ? 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))'
              : 'drop-shadow(0 10px 20px rgba(0,0,0,0.55))',
            transform: g.settling
              ? 'scale(1) rotate(0deg)'
              : 'scale(1.04) rotate(-2deg)',
            transition: g.settling
              ? `left ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `top ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `transform ${PREP_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `filter ${PREP_SETTLE_MS}ms ease`
              : 'none',
          }}
        >
          <CardView card={g.card} style={{ width: SLOT_CARD_W, height: SLOT_CARD_H, borderRadius: SLOT_CARD_RADIUS }} />
        </div>
      ))}
    </>
  )
}
