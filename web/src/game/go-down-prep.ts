import type { Card } from './card'
import { isWild } from './card'
import { groupWildsOnLeft } from './meld-play'
import { ROUND_REQUIREMENTS, isValidGroup, isValidRun } from './rules'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrepSlot {
  id: string
  type: 'group' | 'run'
  cards: Card[]
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create the initial empty prep slots for the given round. */
export function createPrepSlots(roundIndex: number): PrepSlot[] {
  const req = ROUND_REQUIREMENTS[roundIndex]
  const slots: PrepSlot[] = []
  let n = 0
  for (let i = 0; i < req.groups; i++) {
    slots.push({ id: `prep_${n++}`, type: 'group', cards: [] })
  }
  for (let i = 0; i < req.runs; i++) {
    slots.push({ id: `prep_${n++}`, type: 'run', cards: [] })
  }
  return slots
}

// ---------------------------------------------------------------------------
// Partial-run validation (order-aware)
// ---------------------------------------------------------------------------

/**
 * A valid ordered partial run satisfies all of these:
 * - At most 1 wild.
 * - All non-wild cards share the same color.
 * - Non-wild cards appear in the card array in strictly ascending number order
 *   (left-to-right = ascending, matching the visual fan layout).
 * - Non-wild numbers, when sorted, form a consecutive sequence or have exactly
 *   one gap of 2 (which the single wild fills).
 * - Wild at the left end does not represent a number < 1.
 * - Wild at the right end does not represent a number > 14.
 *
 * No minimum length is required (any length including 0 is accepted).
 */
function isValidPartialRun(cards: Card[]): boolean {
  if (cards.length === 0) return true

  const naturals = cards.filter((c) => !isWild(c))
  const wildCount = cards.length - naturals.length

  if (wildCount > 1) return false
  if (naturals.length === 0) return true // a lone wild is a valid start

  // Non-wild cards must appear in strictly ascending order in the visual array.
  let prev = -Infinity
  for (const card of cards) {
    if (isWild(card)) continue
    if (card.number <= prev) return false
    prev = card.number
  }

  // All non-wild cards must share the same color.
  const color = naturals[0].color
  if (!naturals.every((c) => c.color === color)) return false

  // Gap check on sorted natural numbers.
  const nums = naturals.map((c) => c.number).sort((a, b) => a - b)
  let gaps = 0
  for (let i = 1; i < nums.length; i++) {
    const diff = nums[i] - nums[i - 1]
    if (diff === 1) continue
    if (diff === 2) {
      gaps++
      continue
    }
    return false // gap too large to bridge with one wild
  }
  if (gaps > 1) return false
  if (gaps === 1 && wildCount === 0) return false // gap but no wild to fill it

  // Bounds: wild at left end would represent nums[0]-1; that must be ≥ 1.
  // Wild at right end would represent nums[last]+1; that must be ≤ 14.
  if (wildCount === 1) {
    if (isWild(cards[0])) {
      if (nums[0] - 1 < 1) return false
    } else if (isWild(cards[cards.length - 1])) {
      if (nums[nums.length - 1] + 1 > 14) return false
    }
    // Wild in the middle fills a gap between two naturals; always in-bounds.
  }

  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * True if the given card can be placed into the slot (at either end).
 * The sideHint parameter has no effect on the boolean result; it only
 * influences which end is chosen in placeCard when both ends are valid.
 */
export function canPlaceCard(slot: PrepSlot, card: Card): boolean {
  if (slot.type === 'group') return canPlaceInGroup(slot, card)
  return canPlaceInRun(slot, card)
}

function canPlaceInGroup(slot: PrepSlot, card: Card): boolean {
  if (slot.cards.length === 0) return true
  if (isWild(card)) return !slot.cards.some(isWild)
  const naturals = slot.cards.filter((c) => !isWild(c))
  if (naturals.length === 0) return true // only a wild so far — any natural OK
  return card.number === naturals[0].number
}

function canPlaceInRun(slot: PrepSlot, card: Card): boolean {
  if (slot.cards.length === 0) return true
  return (
    isValidPartialRun([card, ...slot.cards]) ||
    isValidPartialRun([...slot.cards, card])
  )
}

/**
 * Place card into the slot.
 * Returns an updated PrepSlot, or null if placement is not valid.
 *
 * For run slots, sideHint breaks ties when both ends are valid (default right).
 * For group slots, sideHint is ignored. Wilds are kept on the left.
 */
export function placeCard(
  slot: PrepSlot,
  card: Card,
  sideHint?: 'left' | 'right',
): PrepSlot | null {
  if (slot.type === 'group') {
    if (!canPlaceInGroup(slot, card)) return null
    return { ...slot, cards: groupWildsOnLeft([...slot.cards, card]) }
  }
  return placeInRun(slot, card, sideHint)
}

function placeInRun(
  slot: PrepSlot,
  card: Card,
  sideHint?: 'left' | 'right',
): PrepSlot | null {
  if (slot.cards.length === 0) return { ...slot, cards: [card] }

  const withLeft = [card, ...slot.cards]
  const withRight = [...slot.cards, card]
  const leftOk = isValidPartialRun(withLeft)
  const rightOk = isValidPartialRun(withRight)

  if (!leftOk && !rightOk) return null
  if (leftOk && !rightOk) return { ...slot, cards: withLeft }
  if (!leftOk) return { ...slot, cards: withRight }
  // Both valid — honour sideHint; default to right.
  return sideHint === 'left'
    ? { ...slot, cards: withLeft }
    : { ...slot, cards: withRight }
}

/**
 * Remove a card from a slot by id.
 *
 * For run slots: if the remaining cards no longer form a valid ordered
 * partial run (e.g. removing a middle card breaks continuity), every
 * remaining card spills back to the hand.
 *
 * For group slots: any subset of a valid partial group is itself valid,
 * so removal never cascades.
 */
export function removeCard(
  slot: PrepSlot,
  cardId: string,
): { slot: PrepSlot; spilled: Card[] } {
  const remaining = slot.cards.filter((c) => c.id !== cardId)
  if (remaining.length === slot.cards.length) return { slot, spilled: [] }

  if (slot.type === 'group') {
    return { slot: { ...slot, cards: remaining }, spilled: [] }
  }

  if (isValidPartialRun(remaining)) {
    return { slot: { ...slot, cards: remaining }, spilled: [] }
  }

  // Cascade: remaining cards all go back to hand.
  return { slot: { ...slot, cards: [] }, spilled: remaining }
}

/** True when this slot's cards form a complete, valid set (ready for submission). */
export function isSlotComplete(slot: PrepSlot): boolean {
  return slot.type === 'group'
    ? isValidGroup(slot.cards)
    : isValidRun(slot.cards)
}

/** True when every slot is complete — the Submit button may be enabled. */
export function canSubmit(slots: PrepSlot[]): boolean {
  return slots.length > 0 && slots.every(isSlotComplete)
}

/**
 * Swap the wild in a run slot from one end to the other (left ↔ right).
 * Only valid when the wild is already at position 0 or the last position.
 * Wild in the middle (filling a gap) cannot be end-swapped.
 * Returns null if not applicable or if the swap would produce an invalid state.
 */
export function swapWildEnd(slot: PrepSlot): PrepSlot | null {
  if (slot.type !== 'run') return null

  const wildCard = slot.cards.find(isWild)
  if (!wildCard) return null

  const wildAtLeft = isWild(slot.cards[0])
  const wildAtRight = isWild(slot.cards[slot.cards.length - 1])
  if (!wildAtLeft && !wildAtRight) return null // wild is in the middle

  const withoutWild = slot.cards.filter((c) => !isWild(c))
  const newCards = wildAtLeft
    ? [...withoutWild, wildCard]
    : [wildCard, ...withoutWild]

  return isValidPartialRun(newCards) ? { ...slot, cards: newCards } : null
}

/**
 * Merge a new order of the *visible* (non-prep) cards with the full hand,
 * leaving prep-slot cards in their current indexes as holes.
 *
 * Returns null if `visibleOrderedIds` is not a permutation of the non-prep
 * cards in `fullHandIds`.
 */
export function mergeVisibleHandOrder(
  fullHandIds: string[],
  visibleOrderedIds: string[],
  prepCardIds: ReadonlySet<string>,
): string[] | null {
  const heldIds = fullHandIds.filter((id) => !prepCardIds.has(id))
  if (visibleOrderedIds.length !== heldIds.length) return null

  const heldSet = new Set(heldIds)
  const seen = new Set<string>()
  for (const id of visibleOrderedIds) {
    if (!heldSet.has(id) || seen.has(id)) return null
    seen.add(id)
  }

  const queue = [...visibleOrderedIds]
  const merged: string[] = []
  for (const id of fullHandIds) {
    if (prepCardIds.has(id)) {
      merged.push(id)
    } else {
      const next = queue.shift()
      if (!next) return null
      merged.push(next)
    }
  }
  return merged
}
