import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'

export interface DrawFlightProps {
  card: Card
  sourceRect: DOMRect
  targetRef: React.RefObject<HTMLElement | null>
  onComplete: () => void
  /** Show card back while flying (opponent draws). */
  faceDown?: boolean
  /** Fly via screen center with a brief hold (default true). */
  viaCenter?: boolean
  /** Explicit landing center. Used when the destination card is not in the DOM yet. */
  targetPoint?: { x: number; y: number } | null
  /** Rotation of the set the card is joining, in degrees. */
  endRotationDeg?: number
  /** Scale at arrival relative to a full-size card. */
  endScale?: number
}

// Match CSS variable values
const CARD_W = 64
const CARD_H = 96

const DUR_TO_CENTER = 220
const DUR_HOLD = 380
const DUR_TO_HAND = 260
const DUR_DIRECT = 340

type Phase = 'initial' | 'to-center' | 'hold' | 'to-hand'

function DrawFlightInner({
  card,
  sourceRect,
  targetRef,
  onComplete,
  faceDown = false,
  viaCenter = true,
  targetPoint = null,
  endRotationDeg = 0,
  endScale,
}: DrawFlightProps) {
  const [phase, setPhase] = useState<Phase>('initial')
  const [tgtPos, setTgtPos] = useState<{ x: number; y: number } | null>(null)
  const onCompleteRef = useRef(onComplete)
  const targetRefStable = useRef(targetRef)

  useEffect(() => {
    onCompleteRef.current = onComplete
    targetRefStable.current = targetRef
  })

  const srcX = sourceRect.left + sourceRect.width / 2
  const srcY = sourceRect.top + sourceRect.height / 2
  const ctrX = window.innerWidth / 2
  const ctrY = window.innerHeight / 2

  let posX: number
  let posY: number
  let scale: number
  switch (phase) {
    case 'initial':
      posX = srcX
      posY = srcY
      scale = 1
      break
    case 'to-center':
    case 'hold':
      posX = ctrX
      posY = ctrY
      scale = 1.12
      break
    default: // 'to-hand'
      posX = tgtPos?.x ?? ctrX
      posY = tgtPos?.y ?? ctrY
      scale = endScale ?? (faceDown ? 0.7 : 1)
      break
  }

  const rotation = phase === 'to-hand' ? endRotationDeg : 0

  const transition =
    phase === 'initial' || phase === 'hold'
      ? 'none'
      : phase === 'to-center'
        ? `left ${DUR_TO_CENTER}ms ease, top ${DUR_TO_CENTER}ms ease, transform ${DUR_TO_CENTER}ms ease`
        : viaCenter
          ? `left ${DUR_TO_HAND}ms ease, top ${DUR_TO_HAND}ms ease, transform ${DUR_TO_HAND}ms ease`
          : `left ${DUR_DIRECT}ms ease, top ${DUR_DIRECT}ms ease, transform ${DUR_DIRECT}ms ease`

  useEffect(() => {
    let t1: ReturnType<typeof setTimeout> | undefined
    let t2: ReturnType<typeof setTimeout> | undefined
    let t3: ReturnType<typeof setTimeout> | undefined
    let t4: ReturnType<typeof setTimeout> | undefined

    const measureTarget = () => {
      if (targetPoint) return targetPoint
      const el = targetRefStable.current.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }

    const raf = requestAnimationFrame(() => {
      if (!viaCenter) {
        const tgt = measureTarget()
        if (tgt) setTgtPos(tgt)
        setPhase('to-hand')
        t4 = setTimeout(() => {
          onCompleteRef.current()
        }, DUR_DIRECT + 20)
        return
      }

      setPhase('to-center')

      t1 = setTimeout(() => {
        setPhase('hold')
        const tgt = measureTarget()
        if (tgt) setTgtPos(tgt)
      }, DUR_TO_CENTER + 20)

      t2 = setTimeout(() => {
        const tgt = measureTarget()
        if (tgt) setTgtPos(tgt)
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
      if (t1 !== undefined) clearTimeout(t1)
      if (t2 !== undefined) clearTimeout(t2)
      if (t3 !== undefined) clearTimeout(t3)
      if (t4 !== undefined) clearTimeout(t4)
    }
  }, [viaCenter, targetPoint])

  return (
    <div
      style={{
        position: 'fixed',
        left: posX - CARD_W / 2,
        top: posY - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        transition,
        transform: `rotate(${rotation}deg) scale(${scale})`,
        pointerEvents: 'none',
        zIndex: 1000,
        boxShadow:
          phase === 'to-center' || phase === 'hold'
            ? '0 0 24px 6px rgba(201, 168, 76, 0.55)'
            : 'none',
        borderRadius: 6,
      }}
    >
      <CardView card={card} faceDown={faceDown} />
    </div>
  )
}

export default function DrawFlight(props: DrawFlightProps) {
  return createPortal(<DrawFlightInner {...props} />, document.body)
}
