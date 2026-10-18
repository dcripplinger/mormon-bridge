import type { Card } from './card'
import { isWild } from './card'

/**
 * Left-to-right order is the run. The wild occupies the rank it stands for:
 * the missing number in a one-card gap, or the end the player declared.
 * That declared rank is the only natural that can take the wild's place.
 */
export function runOrderFits(cards: Card[]): boolean {
  if (cards.length === 0) return true
  const wilds = cards.filter(isWild)
  if (wilds.length > 1) return false
  const naturals = cards.filter((c) => !isWild(c))
  if (naturals.length === 0) return true
  const color = naturals[0].color
  if (!naturals.every((c) => c.color === color)) return false
  const anchorIdx = cards.findIndex((c) => !isWild(c))
  const anchor = cards[anchorIdx].number
  for (let i = 0; i < cards.length; i++) {
    const expected = anchor + (i - anchorIdx)
    if (expected < 1 || expected > 14) return false
    if (!isWild(cards[i]) && cards[i].number !== expected) return false
  }
  return true
}

/** A complete run whose stored order is the rank order, wild included. */
export function isPositionedRun(cards: Card[]): boolean {
  return cards.length >= 4 && cards.some((c) => !isWild(c)) && runOrderFits(cards)
}

/**
 * The number a wild stands in for, read from its slot in the run.
 * Null when the cards are not in rank order.
 */
export function wildRepresentedRank(cards: Card[]): number | null {
  const wildIdx = cards.findIndex(isWild)
  if (wildIdx < 0 || !runOrderFits(cards)) return null
  const anchorIdx = cards.findIndex((c) => !isWild(c))
  if (anchorIdx < 0) return null
  return cards[anchorIdx].number + (wildIdx - anchorIdx)
}

/**
 * Place naturals in ascending order and seat the wild in the rank it fills.
 * A single missing rank takes the wild. Otherwise the wild stays on the end
 * it already occupies: before the naturals is the low end, after them is the high end.
 */
export function arrangeRun(cards: Card[]): Card[] {
  const wilds = cards.filter(isWild)
  const naturals = cards.filter((c) => !isWild(c)).slice().sort((a, b) => a.number - b.number)
  if (wilds.length !== 1) return [...naturals, ...wilds]
  const wild = wilds[0]
  for (let i = 1; i < naturals.length; i++) {
    if (naturals[i].number - naturals[i - 1].number === 2) {
      return [...naturals.slice(0, i), wild, ...naturals.slice(i)]
    }
  }
  const wildIdx = cards.findIndex(isWild)
  const firstNatural = cards.findIndex((c) => !isWild(c))
  if (firstNatural >= 0 && wildIdx < firstNatural) return [wild, ...naturals]
  return [...naturals, wild]
}
