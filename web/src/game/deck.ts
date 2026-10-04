import type { Card, CardColor } from './card'

const COLORS: CardColor[] = ['red', 'yellow', 'green', 'black']
const COPIES = 3
const WILDS_PER_COPY = 1

/** Full undealt deck size: 3 * (4*14 + 1) = 171 */
export const FULL_DECK_SIZE = COPIES * (COLORS.length * 14 + WILDS_PER_COPY)

export function buildDeck(): Card[] {
  const cards: Card[] = []
  let id = 0
  for (let copy = 0; copy < COPIES; copy++) {
    for (const color of COLORS) {
      for (let n = 1; n <= 14; n++) {
        cards.push({ id: `${color}_${n}_${copy}`, color, number: n })
        id++
      }
    }
    for (let w = 0; w < WILDS_PER_COPY; w++) {
      cards.push({ id: `wild_${copy}_${w}`, color: 'wild', number: 0 })
      id++
    }
  }
  return cards
}

export function shuffleDeck(cards: Card[]): Card[] {
  const arr = [...cards]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export const STARTING_HAND_SIZE = 11

/** Deal hands round-robin, returning [hands, remainingDraw] */
export function dealHands(
  drawPile: Card[],
  numPlayers: number,
): { hands: Card[][]; drawPile: Card[] } {
  const pile = [...drawPile]
  const hands: Card[][] = Array.from({ length: numPlayers }, () => [])
  for (let i = 0; i < STARTING_HAND_SIZE; i++) {
    for (let p = 0; p < numPlayers; p++) {
      const card = pile.pop()
      if (card) hands[p].push(card)
    }
  }
  return { hands, drawPile: pile }
}
