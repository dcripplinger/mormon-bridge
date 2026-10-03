import { useState } from 'react'

interface Props {
  onStart: (playerNames: string[], aiCount: number) => void
}

export default function MenuScreen({ onStart }: Props) {
  const [numHumans, setNumHumans] = useState(1)
  const [numAI, setNumAI] = useState(2)
  const total = numHumans + numAI

  const handleStart = () => {
    if (total < 3 || total > 5) return
    const humanNames = Array.from({ length: numHumans }, (_, i) =>
      i === 0 ? 'You' : `P${i + 1}`,
    )
    const aiNames = Array.from({ length: numAI }, (_, i) => `AI ${i + 1}`)
    onStart([...humanNames, ...aiNames], numAI)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '32px',
        background: 'var(--bg)',
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 'clamp(2rem, 6vw, 4rem)',
            color: 'var(--accent)',
            letterSpacing: '0.04em',
            textShadow: '0 2px 12px rgba(201,168,76,0.3)',
          }}
        >
          Mormon Bridge
        </h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '8px', fontSize: '1rem' }}>
          A rummy card game for 3–5 players
        </p>
      </div>

      {/* Setup card */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          minWidth: '280px',
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Human players</span>
          <select
            value={numHumans}
            onChange={(e) => setNumHumans(Number(e.target.value))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '1rem',
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n} disabled={n + numAI > 5 || n + numAI < 3}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>AI players</span>
          <select
            value={numAI}
            onChange={(e) => setNumAI(Number(e.target.value))}
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '8px 12px',
              fontSize: '1rem',
            }}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={n} value={n} disabled={numHumans + n > 5 || numHumans + n < 3}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div
          style={{
            color: total >= 3 && total <= 5 ? 'var(--text-dim)' : 'var(--danger)',
            fontSize: '0.8rem',
          }}
        >
          Total: {total} player{total !== 1 ? 's' : ''}{' '}
          {total < 3 ? '(need at least 3)' : total > 5 ? '(max 5)' : ''}
        </div>

        <button
          onClick={handleStart}
          disabled={total < 3 || total > 5}
          style={{
            background: 'var(--accent)',
            color: '#1a1a1a',
            padding: '14px',
            borderRadius: '8px',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            transition: 'opacity 0.15s',
          }}
        >
          Start Game
        </button>
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', maxWidth: '320px', textAlign: 'center' }}>
        Round 1: 2 groups · Round 2: 1 group + 1 run · ... · Round 7: 3 runs
      </p>
    </div>
  )
}
