import { useEffect } from 'react'
import type { Meld } from '../game/state'
import CardView from './CardView'

interface SetZoomOverlayProps {
  meld: Meld | null
  playerName?: string
  onClose: () => void
}

/** Card size shown in the zoom overlay — use full card size for max readability. */
const ZOOM_CARD_W = 64
const ZOOM_CARD_H = 96

export default function SetZoomOverlay({ meld, playerName, onClose }: SetZoomOverlayProps) {
  // Dismiss on Escape key.
  useEffect(() => {
    if (!meld) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [meld, onClose])

  if (!meld) return null

  const typeLabel = meld.type === 'group' ? 'Group' : 'Run'
  const cardCount = meld.cards.length

  return (
    /* Backdrop — tap outside the card to dismiss */
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Panel — stop propagation so tapping cards doesn't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: '14px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          maxWidth: '92vw',
        }}
      >
        {/* Header */}
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-dim)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {playerName ? `${playerName} — ` : ''}
          {typeLabel} &middot; {cardCount} {cardCount === 1 ? 'card' : 'cards'}
        </div>

        {/* Cards — wrap if there are many */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            justifyContent: 'center',
          }}
        >
          {meld.cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              style={{ width: ZOOM_CARD_W, height: ZOOM_CARD_H }}
            />
          ))}
        </div>

        {/* Dismiss hint */}
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-dim)',
            opacity: 0.6,
          }}
        >
          Tap outside to close
        </div>
      </div>
    </div>
  )
}
