import type { PlayerState } from '../game/state'

interface ScoreBoardProps {
  players: PlayerState[]
  currentPlayerIndex: number
  roundIndex: number
}

export default function ScoreBoard({ players, currentPlayerIndex, roundIndex }: ScoreBoardProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 12px',
        background: 'var(--surface)',
        borderLeft: '2px solid var(--border)',
        minWidth: '140px',
        fontSize: '0.85rem',
      }}
    >
      <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '6px' }}>
        Round {roundIndex + 1} / 7
      </div>
      {players.map((p) => (
        <div
          key={p.index}
          style={{
            padding: '4px 6px',
            borderRadius: '4px',
            background: p.index === currentPlayerIndex ? 'var(--surface-2)' : undefined,
            border: p.index === currentPlayerIndex ? '1px solid var(--accent-dim)' : '1px solid transparent',
          }}
        >
          <span style={{ color: p.hasGoneDown ? 'var(--accent)' : 'var(--text)' }}>
            {p.displayName}
            {p.isAI ? ' 🤖' : ''}
            {p.hasGoneDown ? ' ✓' : ''}
          </span>
          <br />
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            {p.hand.length} cards · {p.cumulativeScore} pts
          </span>
        </div>
      ))}
    </div>
  )
}
