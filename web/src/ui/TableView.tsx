import type { Meld } from '../game/state'
import CardView from './CardView'

interface TableViewProps {
  melds: Meld[]
  playerNames: string[]
  selectedCardIds: Set<string>
  onClickMeld?: (meldId: string) => void
}

export default function TableView({ melds, playerNames, selectedCardIds, onClickMeld }: TableViewProps) {
  if (melds.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '16px', fontSize: '0.9rem' }}>
        No melds played yet
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '12px',
      }}
    >
      {melds.map((meld) => (
        <div
          key={meld.id}
          onClick={onClickMeld ? () => onClickMeld(meld.id) : undefined}
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px',
            cursor: onClickMeld ? 'pointer' : 'default',
          }}
        >
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '6px' }}>
            {playerNames[meld.ownerIndex]} · {meld.type}
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {meld.cards.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedCardIds.has(card.id)}
                style={{ width: '48px', height: '72px' }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
