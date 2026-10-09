import type { Card } from './card'
import { isWild } from './card'
import { wildRepresentedRank } from './wild-rank'

/** Round requirements: index 0 = round 1 */
export const ROUND_REQUIREMENTS: ReadonlyArray<{ groups: number; runs: number }> = [
  { groups: 2, runs: 0 },
  { groups: 1, runs: 1 },
  { groups: 0, runs: 2 },
  { groups: 3, runs: 0 },
  { groups: 2, runs: 1 },
  { groups: 1, runs: 2 },
  { groups: 0, runs: 3 },
]

export const TOTAL_ROUNDS = ROUND_REQUIREMENTS.length

/** A group is 3+ cards of the same number; at most 1 wild may substitute. */
export function isValidGroup(cards: Card[]): boolean {
  if (cards.length < 3) return false
  let wilds = 0
  const numbers: number[] = []
  for (const c of cards) {
    if (isWild(c)) {
      wilds++
    } else {
      numbers.push(c.number)
    }
  }
  if (wilds > 1) return false
  if (numbers.length === 0) return false
  return numbers.every((n) => n === numbers[0])
}

/** A run is 4+ cards of the same color in consecutive order; at most 1 wild may substitute. */
export function isValidRun(cards: Card[]): boolean {
  if (cards.length < 4) return false
  let wilds = 0
  const colors: string[] = []
  const numbers: number[] = []
  for (const c of cards) {
    if (isWild(c)) {
      wilds++
    } else {
      colors.push(c.color)
      numbers.push(c.number)
    }
  }
  if (wilds > 1) return false
  if (numbers.length === 0) return false
  if (!colors.every((col) => col === colors[0])) return false
  numbers.sort((a, b) => a - b)
  let gaps = 0
  for (let i = 1; i < numbers.length; i++) {
    const diff = numbers[i] - numbers[i - 1]
    if (diff === 1) continue
    else if (diff === 2) gaps++
    else return false
  }
  if (wilds === 1 && gaps <= 1) return true
  if (wilds === 0 && gaps === 0) return true
  return false
}

export function scoreCard(card: Card): number {
  if (isWild(card)) return 20
  if (card.number >= 1 && card.number <= 8) return 5
  return 10
}

export function scoreHand(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + scoreCard(c), 0)
}

/**
 * Check whether a card can legally be added to an existing meld on the table.
 * Validates the 1-wild-per-meld limit and that the new set stays valid.
 */
export function canExtendMeld(
  meldCards: Card[],
  cardToAdd: Card,
  meldType: 'group' | 'run',
): boolean {
  if (meldType === 'group') return isValidGroup([...meldCards, cardToAdd])
  if (isValidRun([cardToAdd, ...meldCards]) || isValidRun([...meldCards, cardToAdd])) return true
  if (isWild(cardToAdd)) return false
  const wildIdx = meldCards.findIndex(isWild)
  if (wildIdx < 0) return false
  if (meldCards.some((c) => !isWild(c) && c.number === cardToAdd.number)) return false
  const rank = wildRepresentedRank(meldCards)
  if (rank == null || rank !== cardToAdd.number) return false
  const replaced = meldCards.slice()
  replaced[wildIdx] = cardToAdd
  return isValidRun(replaced)
}
