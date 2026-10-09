import type { Card } from './card'
import { isWild } from './card'

/**
 * The number a wild stands in for, based on visual order.
 * A gap of one missing rank wins. Otherwise a wild before the naturals is
 * the low end, and a wild after them is the high end.
 */
export function wildRepresentedRank(cards: Card[]): number | null {
  const wildIdx = cards.findIndex(isWild)
  if (wildIdx < 0) return null
  const naturals = cards.filter((c) => !isWild(c)).map((c) => c.number)
  if (naturals.length === 0) return null
  const sorted = [...naturals].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] === 2) return sorted[i - 1] + 1
  }
  const firstNatural = cards.findIndex((c) => !isWild(c))
  if (wildIdx < firstNatural) return sorted[0] - 1
  return sorted[sorted.length - 1] + 1
}
