import type { Card } from './card'
import { isWild } from './card'
import { isValidGroup, isValidRun } from './rules'
import { wildRepresentedRank } from './wild-rank'

function wildRankInRange(cards: Card[]): boolean {
  const rank = wildRepresentedRank(cards)
  return rank == null || (rank >= 1 && rank <= 14)
}

export type MeldEnd = 'left' | 'right'

/** Where a moved wild may be taken from, and where it may be played. */
export interface WildRules {
  from: 'runs' | 'runs-or-groups' | 'nowhere'
  to: 'any-meld' | 'any-meld-or-hand' | 'same-meld'
}

export const DEFAULT_WILD_RULES: WildRules = {
  from: 'runs',
  to: 'any-meld',
}

export interface MeldPlay {
  cards: Card[]
  /** Index of the played card in `cards`. */
  index: number
  /** End the played card occupies. A middle replacement reports the nearer end. */
  side: MeldEnd
  displacedWild: Card | null
}

/** Wilds sit on the left of a group so the rightmost card shows the number. */
export function groupWildsOnLeft(cards: Card[]): Card[] {
  if (!cards.some(isWild)) return cards
  return [...cards.filter(isWild), ...cards.filter((c) => !isWild(c))]
}

export function allowsWildDisplacement(
  rules: WildRules,
  meldType: 'group' | 'run',
): boolean {
  if (rules.from === 'nowhere') return false
  if (rules.from === 'runs') return meldType === 'run'
  return true
}

/** Naturals stay in ascending visual order, and the set is a legal run. */
function isOrderedRun(cards: Card[]): boolean {
  if (!isValidRun(cards)) return false
  const naturals = cards.filter((c) => !isWild(c))
  for (let i = 1; i < naturals.length; i++) {
    if (naturals[i].number <= naturals[i - 1].number) return false
  }
  return wildRankInRange(cards)
}

/** Ends a card may be added to, without removing a wild. */
export function legalAddEnds(
  cards: Card[],
  meldType: 'group' | 'run',
  card: Card,
): MeldEnd[] {
  if (meldType === 'group') {
    if (isWild(card)) return isValidGroup([card, ...cards]) ? ['left'] : []
    return isValidGroup([...cards, card]) ? ['right'] : []
  }
  const ends: MeldEnd[] = []
  if (isOrderedRun([card, ...cards])) ends.push('left')
  if (isOrderedRun([...cards, card])) ends.push('right')
  return ends
}

/**
 * Where `card` lands on this meld.
 * A natural that matches the rank a wild is standing in for takes that wild's
 * slot when displacement is allowed. Otherwise the card is added on a legal end.
 * When both ends work, `side` picks one (default right).
 */
export function planMeldPlay(
  cards: Card[],
  meldType: 'group' | 'run',
  card: Card,
  side?: MeldEnd,
  allowDisplace = true,
): MeldPlay | null {
  if (!isWild(card) && allowDisplace && meldType === 'run') {
    const replaced = replaceWild(cards, card)
    if (replaced) return replaced
  }

  const ends = legalAddEnds(cards, meldType, card)
  if (ends.length === 0) return null
  const chosen = ends.length === 1 ? ends[0] : side === 'left' && ends.includes('left') ? 'left' : 'right'
  if (!ends.includes(chosen)) return null
  const next = chosen === 'left' ? [card, ...cards] : [...cards, card]
  return {
    cards: next,
    index: chosen === 'left' ? 0 : next.length - 1,
    side: chosen,
    displacedWild: null,
  }
}

function replaceWild(cards: Card[], card: Card): MeldPlay | null {
  const wildIdx = cards.findIndex(isWild)
  if (wildIdx < 0) return null
  if (cards.some((c) => !isWild(c) && c.number === card.number)) return null
  const rank = wildRepresentedRank(cards)
  if (rank == null || rank !== card.number || rank < 1 || rank > 14) return null
  const next = cards.slice()
  const wild = next[wildIdx]
  next[wildIdx] = card
  if (!isValidRun(next)) return null
  return {
    cards: next,
    index: wildIdx,
    side: wildIdx === 0 ? 'left' : 'right',
    displacedWild: wild,
  }
}

export interface WildDest {
  meldId: string
  side: MeldEnd
}

export function wildDestinations(
  melds: { id: string; type: 'group' | 'run'; cards: Card[] }[],
  wild: Card,
  rules: WildRules,
  sourceMeldId: string,
): WildDest[] {
  const pool =
    rules.to === 'same-meld' ? melds.filter((m) => m.id === sourceMeldId) : melds
  const dests: WildDest[] = []
  for (const meld of pool) {
    for (const side of legalAddEnds(meld.cards, meld.type, wild)) {
      dests.push({ meldId: meld.id, side })
    }
  }
  return dests
}

export function wildHasHome(
  melds: { id: string; type: 'group' | 'run'; cards: Card[] }[],
  wild: Card,
  rules: WildRules,
  sourceMeldId: string,
): boolean {
  if (rules.to === 'any-meld-or-hand') return true
  return wildDestinations(melds, wild, rules, sourceMeldId).length > 0
}
