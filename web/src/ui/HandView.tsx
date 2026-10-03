import type { Card } from '../game/card'
import CardView from './CardView'

interface HandViewProps {
  cards: Card[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  isActive: boolean
}

export default function HandView({ cards, selectedIds, onToggle, isActive }: HandViewProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        padding: '12px 16px',
        background: 'var(--hand-bg)',
        borderTop: '2px solid var(--border)',
        justifyContent: 'center',
        minHeight: 'calc(var(--card-h) + 36px)',
        alignItems: 'flex-end',
      }}
    >
      {cards.map((card) => (
        <CardView
          key={card.id}
          card={card}
          selected={selectedIds.has(card.id)}
          onClick={isActive ? () => onToggle(card.id) : undefined}
        />
      ))}
    </div>
  )
}
