import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import { FULL_DECK_SIZE } from '../game/deck'
import CardView from './CardView'

/** Visible edge layers at a full-deck pile. */
const MAX_LAYERS = 20

/**
 * Per-layer offset. Prior max depth was 10 * 1.5px = 15px;
 * target max depth is ~20% less (12px) across 20 closer layers.
 */
const LAYER_OFFSET_PX = 12 / MAX_LAYERS

/** Start showing a drag ghost after this much movement. */
const DRAG_THRESHOLD_PX = 8
/** Release at least this far from the pile origin to commit a draw. */
const DRAW_COMMIT_PX = 96
/** Snap-back duration when a drag-draw is canceled. */
const RETURN_SETTLE_MS = 220

const DECK_BACK_PLACEHOLDER: Card = { id: 'deck-under', color: 'wild', number: 0 }

/** Layers proportional to how full the pile is vs a complete deck. */
function layerCountFor(count: number): number {
  if (count <= 1) return 0
  const pct = Math.min(1, count / FULL_DECK_SIZE)
  return Math.max(1, Math.round(pct * MAX_LAYERS))
}

interface CardPileProps {
  count: number
  /** Top card to show. Null renders an empty dashed slot. */
  card: Card | null
  /**
   * Card revealed under the top while the top is being dragged.
   * For face-down piles, omit — a matching back is shown automatically.
   */
  underCard?: Card | null
  faceDown?: boolean
  /** Click / tap without dragging past the threshold. */
  onActivate?: () => void
  /** Allow drag-away-to-draw when drawing is legal. */
  canDrag?: boolean
  /**
   * Called when the top card is dragged far enough from the pile and released.
   * `sourceRect` is the ghost position at release (for flight animation).
   */
  onDragDraw?: (sourceRect: DOMRect) => void
}

function EmptySlot() {
  return (
    <div
      style={{
        width: 'var(--card-w)',
        height: 'var(--card-h)',
        borderRadius: 'var(--card-radius)',
        border: '2px dashed var(--border)',
      }}
    />
  )
}

export default function CardPile({
  count,
  card,
  underCard = null,
  faceDown,
  onActivate,
  canDrag,
  onDragDraw,
}: CardPileProps) {
  const canInteract = Boolean(onActivate || (canDrag && onDragDraw))

  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [farEnough, setFarEnough] = useState(false)
  const faceRef = useRef<HTMLDivElement | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    active: boolean
    ghostX: number
    ghostY: number
    homeX: number
    homeY: number
    originX: number
    originY: number
    cardW: number
    cardH: number
  } | null>(null)
  const latestRef = useRef({
    canDrag: Boolean(canDrag),
    onActivate,
    onDragDraw,
  })
  latestRef.current = {
    canDrag: Boolean(canDrag),
    onActivate,
    onDragDraw,
  }

  useEffect(() => () => {
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
  }, [])

  useEffect(() => {
    const clearDrag = () => {
      dragRef.current = null
      setDragging(false)
      setSettling(false)
      setGhostPos(null)
      setFarEnough(false)
    }

    const beginReturnSettle = (drag: NonNullable<typeof dragRef.current>) => {
      // Keep the lifted-card pile look while the ghost flies home.
      setDragging(true)
      setSettling(true)
      setFarEnough(false)
      setGhostPos({ x: drag.ghostX, y: drag.ghostY })
      dragRef.current = null

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setGhostPos({ x: drag.homeX, y: drag.homeY })
          if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null
            clearDrag()
          }, RETURN_SETTLE_MS)
        })
      })
    }

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const L = latestRef.current

      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        if (!L.canDrag || !L.onDragDraw) return
        drag.active = true
        setDragging(true)
      }

      const gx = e.clientX - drag.offsetX
      const gy = e.clientY - drag.offsetY
      drag.ghostX = gx
      drag.ghostY = gy
      setGhostPos({ x: gx, y: gy })

      const away = Math.hypot(
        gx + drag.cardW / 2 - drag.originX,
        gy + drag.cardH / 2 - drag.originY,
      )
      setFarEnough(away >= DRAW_COMMIT_PX)
    }

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const L = latestRef.current

      if (!drag.active) {
        clearDrag()
        L.onActivate?.()
        return
      }

      const away = Math.hypot(
        drag.ghostX + drag.cardW / 2 - drag.originX,
        drag.ghostY + drag.cardH / 2 - drag.originY,
      )
      if (away >= DRAW_COMMIT_PX && L.onDragDraw) {
        const sourceRect = new DOMRect(drag.ghostX, drag.ghostY, drag.cardW, drag.cardH)
        clearDrag()
        L.onDragDraw(sourceRect)
        return
      }

      beginReturnSettle(drag)
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

  const onFacePointerDown = (e: React.PointerEvent) => {
    if (!canInteract) return
    if (e.button !== 0) return
    if (dragRef.current || settling) return

    e.preventDefault()
    e.stopPropagation()
    const target = faceRef.current
    if (!target) return
    const rect = target.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      active: false,
      ghostX: rect.left,
      ghostY: rect.top,
      homeX: rect.left,
      homeY: rect.top,
      originX: rect.left + rect.width / 2,
      originY: rect.top + rect.height / 2,
      cardW: rect.width,
      cardH: rect.height,
    }
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // window listeners still work without capture
    }
  }

  // While dragging the top card, the pile visually has one fewer card.
  const displayCount = dragging ? Math.max(0, count - 1) : count
  const layers = layerCountFor(displayCount)
  const depth = layers * LAYER_OFFSET_PX

  const remainingFace: Card | null = dragging
    ? underCard ?? (faceDown && displayCount > 0 ? DECK_BACK_PLACEHOLDER : null)
    : card

  if ((!card || count <= 0) && !dragging) {
    return <EmptySlot />
  }

  return (
    <>
      {displayCount <= 0 ? (
        <EmptySlot />
      ) : (
        <div
          style={{
            position: 'relative',
            width: `calc(var(--card-w) + ${depth}px)`,
            height: `calc(var(--card-h) + ${depth}px)`,
            // Grow up-left so the bottom-right (base) card slot stays fixed in layout.
            marginTop: -depth,
            marginLeft: -depth,
            flexShrink: 0,
          }}
        >
          {Array.from({ length: layers }, (_, i) => {
            // i=0 is deepest, flush with the bottom-right base; each step moves up-left.
            const fromBase = i * LAYER_OFFSET_PX
            return (
              <div
                key={i}
                aria-hidden
                style={{
                  position: 'absolute',
                  right: fromBase,
                  bottom: fromBase,
                  width: 'var(--card-w)',
                  height: 'var(--card-h)',
                  borderRadius: 'var(--card-radius)',
                  background: 'linear-gradient(145deg, #e8dfc8 0%, #c9b896 55%, #b5a47e 100%)',
                  border: '1px solid #9a8b6a',
                  boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.35)',
                  zIndex: i,
                }}
              />
            )
          })}
          {/* Resting top card — or the revealed under-card while dragging. */}
          {remainingFace && (
            <div
              ref={dragging ? undefined : faceRef}
              onPointerDown={
                dragging || !canInteract ? undefined : onFacePointerDown
              }
              style={{
                position: 'absolute',
                right: depth,
                bottom: depth,
                width: 'var(--card-w)',
                height: 'var(--card-h)',
                zIndex: layers + 1,
                touchAction: 'none',
                cursor: dragging || !canInteract ? 'default' : 'grab',
                pointerEvents: dragging ? 'none' : 'auto',
              }}
            >
              <CardView
                card={remainingFace}
                faceDown={dragging ? Boolean(faceDown && !underCard) : faceDown}
              />
            </div>
          )}
        </div>
      )}

      {dragging && ghostPos && card && createPortal(
        <div
          style={{
            position: 'fixed',
            left: ghostPos.x,
            top: ghostPos.y,
            width: 'var(--card-w)',
            height: 'var(--card-h)',
            zIndex: 1000,
            pointerEvents: 'none',
            filter: settling
              ? 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
              : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.45))',
            transform: settling
              ? 'scale(1) rotate(0deg)'
              : farEnough
                ? 'scale(1.08) rotate(-3deg)'
                : 'scale(1.06) rotate(-3deg)',
            transition: settling
              ? `left ${RETURN_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `top ${RETURN_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `transform ${RETURN_SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), ` +
                `filter ${RETURN_SETTLE_MS}ms ease`
              : 'transform 0.12s ease',
          }}
        >
          <CardView card={card} faceDown={faceDown} />
        </div>,
        document.body,
      )}
    </>
  )
}
