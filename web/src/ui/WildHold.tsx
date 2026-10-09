import { useRef, useState } from 'react'
import type { Card } from '../game/card'
import type { MeldEnd } from '../game/meld-play'
import CardView from './CardView'
import { fanEndAtPoint } from './fan-end'
import { ghostLiftedOrigin } from './ghost-lift'

interface WildZone {
  meldId: string
  ref: React.RefObject<HTMLElement | null>
  rotationDeg: number
}

interface WildHoldProps {
  card: Card
  /** Pile anchor: percent from the top of the table, matching the deck. */
  topPct: string
  zones: WildZone[]
  canDrop: (meldId: string) => boolean
  endsFor: (meldId: string) => MeldEnd[]
  onHover: (meldId: string | null, side?: MeldEnd) => void
  onDrop: (meldId: string, side: MeldEnd, sourceRect: DOMRect) => void
  /** Drop back into the hand when the rules allow keeping the wild. */
  handRef?: React.RefObject<HTMLElement | null>
  onKeep?: () => void
}

function pointInRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/** Wild that must be replayed. It rests over the deck until it is dragged onto a set. */
export default function WildHold({
  card,
  topPct,
  zones,
  canDrop,
  endsFor,
  onHover,
  onDrop,
  handRef,
  onKeep,
}: WildHoldProps) {
  const restRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    active: boolean
    meldId: string | null
    side: MeldEnd
  } | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [lifted, setLifted] = useState(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, active: false, meldId: null, side: 'right' }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    drag.active = true
    setLifted(true)
    setPointer({ x: e.clientX, y: e.clientY })
    let meldId: string | null = null
    let side: MeldEnd = 'right'
    for (const zone of zones) {
      const el = zone.ref.current
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (!pointInRect(e.clientX, e.clientY, rect)) continue
      if (!canDrop(zone.meldId)) continue
      meldId = zone.meldId
      const ends = endsFor(zone.meldId)
      side = ends.length > 1
        ? fanEndAtPoint(e.clientX, e.clientY, rect, zone.rotationDeg)
        : (ends[0] ?? 'right')
      break
    }
    if (meldId !== drag.meldId || side !== drag.side) {
      drag.meldId = meldId
      drag.side = side
      onHover(meldId, meldId ? side : undefined)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    setLifted(false)
    setPointer(null)
    onHover(null)
    if (!drag?.active) return
    if (drag.meldId) {
      const origin = ghostLiftedOrigin(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      onDrop(drag.meldId, drag.side, new DOMRect(origin.x, origin.y, 64, 96))
      return
    }
    const hand = handRef?.current
    if (onKeep && hand && pointInRect(e.clientX, e.clientY, hand.getBoundingClientRect())) {
      onKeep()
    }
  }

  const ghost = pointer
    ? ghostLiftedOrigin(pointer.x, pointer.y, window.innerWidth, window.innerHeight)
    : null

  return (
    <>
      <div
        ref={restRef}
        data-wild-hold
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute',
          left: '50%',
          top: topPct,
          width: 64,
          height: 96,
          transform: 'translate(-50%, -50%)',
          zIndex: 30,
          pointerEvents: 'auto',
          visibility: lifted ? 'hidden' : 'visible',
          filter: 'drop-shadow(0 10px 16px rgba(0,0,0,0.45))',
          cursor: 'grab',
        }}
      >
        <CardView card={card} />
      </div>
      {lifted && ghost && (
        <div
          data-drag-ghost
          style={{
            position: 'fixed',
            left: ghost.x,
            top: ghost.y,
            width: 64,
            height: 96,
            zIndex: 1000,
            pointerEvents: 'none',
            transform: 'scale(1.06) rotate(-3deg)',
            filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.45))',
          }}
        >
          <CardView card={card} />
        </div>
      )}
    </>
  )
}
