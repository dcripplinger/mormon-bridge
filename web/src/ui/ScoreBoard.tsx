import { useEffect } from 'react'
import type { PlayerState } from '../game/state'

interface ScoreBoardProps {
  players: PlayerState[]
  currentPlayerIndex: number
  roundIndex: number
  open: boolean
  onClose: () => void
}

export default function ScoreBoard({
  players,
  currentPlayerIndex,
  roundIndex,
  open,
  onClose,
}: ScoreBoardProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close scores"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
          border: 'none',
          padding: 0,
          zIndex: 40,
          cursor: 'pointer',
        }}
      />

      {/* Flyout panel */}
      <aside
        role="dialog"
        aria-label="Round scores"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(280px, 85vw)',
          background: 'var(--surface)',
          borderLeft: '2px solid var(--border)',
          padding: '16px 14px',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '0.9rem',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.35)',
          animation: 'score-flyout-in 0.18s ease-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <div style={{ color: 'var(--accent)', fontWeight: 'bold', fontSize: '1.05rem' }}>
            Round {roundIndex + 1} / 7
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              width: '32px',
              height: '32px',
              fontSize: '1.1rem',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {players.map((p) => (
          <div
            key={p.index}
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: p.index === currentPlayerIndex ? 'var(--surface-2)' : undefined,
              border:
                p.index === currentPlayerIndex
                  ? '1px solid var(--accent-dim)'
                  : '1px solid transparent',
            }}
          >
            <div style={{ color: p.hasGoneDown ? 'var(--accent)' : 'var(--text)' }}>
              {p.displayName}
              {p.isAI ? ' 🤖' : ''}
              {p.hasGoneDown ? ' ✓' : ''}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '2px' }}>
              {p.hand.length} cards · {p.cumulativeScore} pts
            </div>
          </div>
        ))}
      </aside>

      <style>{`
        @keyframes score-flyout-in {
          from { transform: translateX(100%); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
