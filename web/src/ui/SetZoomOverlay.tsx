import { useEffect, useState } from 'react'
import type { Meld } from '../game/state'
import SetFan from './SetFan'

export interface SetZoomAnchor {
  meld: Meld
  rotationDeg: number
  centerX: number
  centerY: number
  width: number
  height: number
  cardW: number
  cardH: number
  cardRadius: number
}

interface SetZoomOverlayProps {
  anchor: SetZoomAnchor | null
  onClose: () => void
}

const FULL_CARD_W = 64
/** Zoom past a hand card so a tapped set reads clearly. */
const POP_FACTOR = 1.85

/**
 * Uniform scale that enlarges a table fan well past hand size, still inside the viewport.
 * Sideways fans swap width and height.
 */
export function poppedSetScale(
  layoutW: number,
  layoutH: number,
  rotationDeg: number,
  cardW: number,
  viewportW: number,
  viewportH: number,
): number {
  const sideways = Math.abs(rotationDeg) === 90
  const visW = Math.max(1, sideways ? layoutH : layoutW)
  const visH = Math.max(1, sideways ? layoutW : layoutH)
  const margin = 12
  const fit = Math.min(
    Math.max(1, viewportW - margin * 2) / visW,
    Math.max(1, viewportH - margin * 2) / visH,
  )
  const fullCard = cardW > 0 ? (FULL_CARD_W * POP_FACTOR) / cardW : fit
  return Math.max(1, Math.min(fit, fullCard))
}

export default function SetZoomOverlay({ anchor, onClose }: SetZoomOverlayProps) {
  const [grown, setGrown] = useState(false)
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 400,
    h: typeof window !== 'undefined' ? window.innerHeight : 700,
  }))

  useEffect(() => {
    if (!anchor) return
    setGrown(false)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setGrown(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [anchor])

  useEffect(() => {
    if (!anchor) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [anchor, onClose])

  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  if (!anchor) return null

  const scale = poppedSetScale(
    anchor.width,
    anchor.height,
    anchor.rotationDeg,
    anchor.cardW,
    viewport.w,
    viewport.h,
  )
  const shown = grown ? scale : 1

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'transparent',
      }}
    >
      <div
        data-set-zoom
        style={{
          position: 'fixed',
          left: anchor.centerX,
          top: anchor.centerY,
          width: anchor.width,
          height: anchor.height,
          transform: `translate(-50%, -50%) rotate(${anchor.rotationDeg}deg) scale(${shown})`,
          transformOrigin: 'center center',
          transition: 'transform 220ms cubic-bezier(0.2, 0.85, 0.2, 1)',
          pointerEvents: 'none',
        }}
      >
        <SetFan
          cards={anchor.meld.cards}
          cardW={anchor.cardW}
          cardH={anchor.cardH}
          cardRadius={anchor.cardRadius}
          maxWidth={anchor.width}
          meldType={anchor.meld.type}
        />
      </div>
    </div>
  )
}
