import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'

export interface DrawFlightProps {
  card: Card
  sourceRect: DOMRect
  targetRef: React.RefObject<HTMLDivElement | null>
  onComplete: () => void
}

// Match CSS variable values
const CARD_W = 64
const CARD_H = 96

const DUR_TO_CENTER = 220
const DUR_HOLD = 380
const DUR_TO_HAND = 260

type Phase = 'initial' | 'to-center' | 'hold' | 'to-hand'

function DrawFlightInner({ card, sourceRect, targetRef, onComplete }: DrawFlightProps) {
  const [phase, setPhase] = useState<Phase>('initial')
  const [tgtPos, setTgtPos] = useState<{ x: number; y: number } | null>(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const srcX = sourceRect.left + sourceRect.width / 2
  const srcY = sourceRect.top + sourceRect.height / 2
  const ctrX = window.innerWidth / 2
  const ctrY = window.innerHeight / 2

  let posX: number
  let posY: number
  let scale: number
  switch (phase) {
    case 'initial':
      posX = srcX; posY = srcY; scale = 1
      break
    case 'to-center':
    case 'hold':
      posX = ctrX; posY = ctrY; scale = 1.12
      break
    default: // 'to-hand'
      posX = tgtPos?.x ?? ctrX; posY = tgtPos?.y ?? ctrY; scale = 1
      break
  }

  const transition = phase === 'initial' || phase === 'hold'
    ? 'none'
    : phase === 'to-center'
      ? `left ${DUR_TO_CENTER}ms ease, top ${DUR_TO_CENTER}ms ease, transform ${DUR_TO_CENTER}ms ease`
      : `left ${DUR_TO_HAND}ms ease, top ${DUR_TO_HAND}ms ease, transform ${DUR_TO_HAND}ms ease`

  useEffect(() => {
    let t1: ReturnType<typeof setTimeout>
    let t2: ReturnType<typeof setTimeout>
    let t3: ReturnType<typeof setTimeout>
    let t4: ReturnType<typeof setTimeout>

    // One frame delay so the initial (source) position is painted before we
    // change to 'to-center' and trigger the CSS transition.
    const raf = requestAnimationFrame(() => {
      setPhase('to-center')

      t1 = setTimeout(() => {
        // Arrived at center — hold, and measure the hand-end slot
        setPhase('hold')
        if (targetRef.current) {
          const r = targetRef.current.getBoundingClientRect()
          setTgtPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
        }
      }, DUR_TO_CENTER + 20)

      t2 = setTimeout(() => {
        // Re-measure right before flying to the hand (layout may have shifted)
        if (targetRef.current) {
          const r = targetRef.current.getBoundingClientRect()
          setTgtPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
        }
      }, DUR_TO_CENTER + DUR_HOLD - 20)

      t3 = setTimeout(() => {
        setPhase('to-hand')
      }, DUR_TO_CENTER + DUR_HOLD)

      t4 = setTimeout(() => {
        onCompleteRef.current()
      }, DUR_TO_CENTER + DUR_HOLD + DUR_TO_HAND + 20)
    })

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    }
  }, []) // intentionally empty — props captured via refs

  return (
    <div
      style={{
        position: 'fixed',
        left: posX - CARD_W / 2,
        top: posY - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        transition,
        transform: `scale(${scale})`,
        pointerEvents: 'none',
        zIndex: 1000,
        // Subtle glow at center to draw the eye
        boxShadow: phase === 'to-center' || phase === 'hold'
          ? '0 0 24px 6px rgba(201, 168, 76, 0.55)'
          : 'none',
        borderRadius: 6,
      }}
    >
      <CardView card={card} />
    </div>
  )
}

export default function DrawFlight(props: DrawFlightProps) {
  return createPortal(<DrawFlightInner {...props} />, document.body)
}
