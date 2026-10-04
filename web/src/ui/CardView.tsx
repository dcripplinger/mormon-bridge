import type { Card } from '../game/card'
import { cardImagePath } from '../game/card'

interface CardViewProps {
  card: Card
  selected?: boolean
  faceDown?: boolean
  onClick?: () => void
  style?: React.CSSProperties
}

export default function CardView({ card, selected, faceDown, onClick, style }: CardViewProps) {
  const src = faceDown ? '/cards/back.png' : cardImagePath(card)
  return (
    <img
      src={src}
      alt={faceDown ? 'Card back' : `${card.color} ${card.number}`}
      onClick={onClick}
      style={{
        width: 'var(--card-w)',
        height: 'var(--card-h)',
        borderRadius: 'var(--card-radius)',
        border: selected ? '2px solid var(--accent)' : '2px solid transparent',
        transform: selected ? 'translateY(var(--selected-lift))' : undefined,
        cursor: onClick ? 'pointer' : 'inherit',
        transition: 'transform 0.12s ease, border-color 0.12s ease',
        flexShrink: 0,
        objectFit: 'contain',
        ...style,
      }}
    />
  )
}
