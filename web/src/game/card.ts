export type CardColor = 'red' | 'yellow' | 'green' | 'black'

export interface Card {
  id: string         // unique per card instance in the deck
  color: CardColor | 'wild'
  number: number     // 1-14 for normal cards, 0 for wild
}

export function isWild(card: Card): boolean {
  return card.color === 'wild'
}

export function cardDisplayText(card: Card): string {
  if (isWild(card)) return 'WILD'
  return `${card.color[0].toUpperCase()}${card.number}`
}

/** Image path served from /public/cards/ */
export function cardImagePath(card: Card): string {
  if (isWild(card)) return '/cards/wild.png'
  return `/cards/${card.color}_${String(card.number).padStart(2, '0')}.png`
}

export function compareCards(a: Card, b: Card): number {
  if (isWild(a) && isWild(b)) return 0
  if (isWild(a)) return 1
  if (isWild(b)) return -1
  const colorOrder: Record<CardColor, number> = { red: 0, yellow: 1, green: 2, black: 3 }
  const colDiff = colorOrder[a.color as CardColor] - colorOrder[b.color as CardColor]
  if (colDiff !== 0) return colDiff
  return a.number - b.number
}
