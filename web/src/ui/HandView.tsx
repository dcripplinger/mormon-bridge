import type { Card } from '../game/card'
import CardView from './CardView'

interface HandViewProps {
  cards: Card[]
  selectedIds: Set<string>
  onToggle: (cardId: string) => void
  isActive: boolean
  /** Card currently in flight — shown as a same-size placeholder so the slot is held. */
  animatingCardId?: string
  /** Ref attached to the placeholder div so DrawFlight can measure the landing target. */
  endSlotRef?: React.RefObject<HTMLDivElement | null>
  /** Card that just landed — receives a brief scale-in animation. */
  landingCardId?: string
}

export default function HandView({
  cards,
  selectedIds,
  onToggle,
  isActive,
  animatingCardId,
  endSlotRef,
  landingCardId,
}: HandViewProps) {
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
      {cards.map((card) => {
        // Card in flight — render an invisible placeholder to hold the slot
        if (card.id === animatingCardId) {
          return (
            <div
              key={card.id}
              ref={endSlotRef}
              style={{
                width: 'var(--card-w)',
                height: 'var(--card-h)',
                flexShrink: 0,
              }}
            />
          )
        }

        // Normal card, possibly with a landing animation
        return (
          <div
            key={card.id}
            style={{
              flexShrink: 0,
              animation: card.id === landingCardId ? 'card-land 0.28s ease forwards' : undefined,
            }}
          >
            <CardView
              card={card}
              selected={selectedIds.has(card.id)}
              onClick={isActive ? () => onToggle(card.id) : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
