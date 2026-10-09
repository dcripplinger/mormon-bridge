import { describe, expect, it } from 'vitest'
import type { Card, CardColor } from './card'
import {
  canPlaceCard,
  canSubmit,
  createPrepSlots,
  isSlotComplete,
  mergeVisibleHandOrder,
  placeCard,
  removeCard,
  swapWildEnd,
  type PrepSlot,
} from './go-down-prep'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const c = (color: CardColor, num: number, id = `${color}${num}`): Card => ({
  id,
  color,
  number: num,
})
const wild = (id = 'w'): Card => ({ id, color: 'wild', number: 0 })

const groupSlot = (cards: Card[] = [], id = 'g'): PrepSlot => ({
  id,
  type: 'group',
  cards,
})
const runSlot = (cards: Card[] = [], id = 'r'): PrepSlot => ({
  id,
  type: 'run',
  cards,
})

// ---------------------------------------------------------------------------
// createPrepSlots
// ---------------------------------------------------------------------------

describe('createPrepSlots', () => {
  it('round 0 → 2 groups, 0 runs', () => {
    const slots = createPrepSlots(0)
    expect(slots).toHaveLength(2)
    expect(slots.every((s) => s.type === 'group')).toBe(true)
  })

  it('round 1 → 1 group, 1 run', () => {
    const slots = createPrepSlots(1)
    expect(slots).toHaveLength(2)
    expect(slots[0].type).toBe('group')
    expect(slots[1].type).toBe('run')
  })

  it('round 5 → 1 group, 2 runs', () => {
    const slots = createPrepSlots(5)
    expect(slots).toHaveLength(3)
    expect(slots[0].type).toBe('group')
    expect(slots[1].type).toBe('run')
    expect(slots[2].type).toBe('run')
  })

  it('round 6 → 0 groups, 3 runs', () => {
    const slots = createPrepSlots(6)
    expect(slots).toHaveLength(3)
    expect(slots.every((s) => s.type === 'run')).toBe(true)
  })

  it('all slots start empty', () => {
    const slots = createPrepSlots(3)
    expect(slots.every((s) => s.cards.length === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// canPlaceCard — groups
// ---------------------------------------------------------------------------

describe('canPlaceCard groups', () => {
  it('empty slot accepts any card', () => {
    expect(canPlaceCard(groupSlot(), c('red', 5))).toBe(true)
    expect(canPlaceCard(groupSlot(), wild())).toBe(true)
  })

  it('wild-only slot accepts any natural card', () => {
    expect(canPlaceCard(groupSlot([wild()]), c('red', 7))).toBe(true)
  })

  it('wild-only slot rejects a second wild', () => {
    expect(canPlaceCard(groupSlot([wild('w1')]), wild('w2'))).toBe(false)
  })

  it('natural slot accepts same-number card of any color', () => {
    const slot = groupSlot([c('red', 5)])
    expect(canPlaceCard(slot, c('green', 5))).toBe(true)
    expect(canPlaceCard(slot, c('black', 5))).toBe(true)
  })

  it('natural slot rejects different number', () => {
    const slot = groupSlot([c('red', 5)])
    expect(canPlaceCard(slot, c('red', 6))).toBe(false)
  })

  it('natural + wild slot accepts same-number card', () => {
    const slot = groupSlot([c('red', 5), wild()])
    expect(canPlaceCard(slot, c('green', 5))).toBe(true)
  })

  it('natural + wild slot rejects second wild', () => {
    const slot = groupSlot([c('red', 5), wild('w1')])
    expect(canPlaceCard(slot, wild('w2'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// placeCard — groups
// ---------------------------------------------------------------------------

describe('placeCard groups', () => {
  it('appends natural to empty slot', () => {
    const result = placeCard(groupSlot(), c('red', 5))
    expect(result?.cards).toEqual([c('red', 5)])
  })

  it('appends wild to empty slot', () => {
    const result = placeCard(groupSlot(), wild())
    expect(result?.cards).toHaveLength(1)
    expect(result?.cards[0].color).toBe('wild')
  })

  it('appends second card to non-empty slot', () => {
    const slot = groupSlot([c('red', 5)])
    const result = placeCard(slot, c('green', 5))
    expect(result?.cards).toHaveLength(2)
  })

  it('puts a wild on the left of a group', () => {
    const slot = groupSlot([c('red', 5), c('green', 5)])
    const result = placeCard(slot, wild())
    expect(result?.cards[0].color).toBe('wild')
    expect(result?.cards[1].number).toBe(5)
  })

  it('returns null for invalid placement', () => {
    const slot = groupSlot([c('red', 5)])
    expect(placeCard(slot, c('red', 6))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// canPlaceCard — runs
// ---------------------------------------------------------------------------

describe('canPlaceCard runs', () => {
  it('empty slot accepts any card', () => {
    expect(canPlaceCard(runSlot(), c('red', 5))).toBe(true)
    expect(canPlaceCard(runSlot(), wild())).toBe(true)
  })

  it('single-natural slot accepts consecutive card on right', () => {
    const slot = runSlot([c('red', 5)])
    expect(canPlaceCard(slot, c('red', 6))).toBe(true)
  })

  it('single-natural slot accepts consecutive card on left', () => {
    const slot = runSlot([c('red', 5)])
    expect(canPlaceCard(slot, c('red', 4))).toBe(true)
  })

  it('single-natural slot rejects non-consecutive card (gap too large)', () => {
    const slot = runSlot([c('red', 5)])
    // 7 = 5+2, need a wild to bridge; without wild in slot, tryLeft and tryRight
    // both produce a gap-of-2 without a wild → rejected.
    expect(canPlaceCard(slot, c('red', 7))).toBe(false)
  })

  it('single-natural slot rejects different-color card', () => {
    const slot = runSlot([c('red', 5)])
    expect(canPlaceCard(slot, c('green', 6))).toBe(false)
  })

  it('rejects a second wild', () => {
    const slot = runSlot([c('red', 5), wild()])
    expect(canPlaceCard(slot, wild('w2'))).toBe(false)
  })

  it('natural + wild slot accepts card that extends the range', () => {
    // [R5, wild] → wild = 6; adding R7 extends right
    const slot = runSlot([c('red', 5), wild()])
    expect(canPlaceCard(slot, c('red', 7))).toBe(true)
  })

  it('natural + wild slot accepts card that extends left past the wild', () => {
    // [wild, R5] → wild = 4; adding R3 extends left
    const slot = runSlot([wild(), c('red', 5)])
    expect(canPlaceCard(slot, c('red', 3))).toBe(true)
  })

  it('card 1 CAN be placed in wild-only slot (goes left, wild becomes 2)', () => {
    // tryRight=[wild,R1] → wild=0 invalid; tryLeft=[R1,wild] → wild=2 valid
    expect(canPlaceCard(runSlot([wild()]), c('red', 1))).toBe(true)
  })

  it('card 1 placed into wild slot goes left (wild becomes 2, not 0)', () => {
    const slot = runSlot([wild()])
    const result = placeCard(slot, c('red', 1), 'right')
    // sideHint=right is invalid ([wild, R1] → wild=0), so falls back to left: [R1, wild]
    expect(result).not.toBeNull()
    expect(result!.cards[0].number).toBe(1)
    expect(result!.cards[1].color).toBe('wild')
  })

  it('card 14 placed into wild slot goes right (wild becomes 13, not 15)', () => {
    const slot = runSlot([wild()])
    const result = placeCard(slot, c('red', 14), 'left')
    // sideHint=left means tryLeft=[R14, wild] → wild=15 → invalid, falls to right: [wild, R14]
    expect(result).not.toBeNull()
    expect(result!.cards[0].color).toBe('wild')
    expect(result!.cards[1].number).toBe(14)
  })

  it('cannot place a non-consecutive card even with a wild already in slot', () => {
    // [R3, wild, R5]: wild fills gap at 4. Adding R8 is not consecutive to R5+1=6
    const slot = runSlot([c('red', 3), wild(), c('red', 5)])
    expect(canPlaceCard(slot, c('red', 8))).toBe(false)
  })

  it('natural cannot go in the middle (only ends)', () => {
    // [R3, R5] can never be formed because R5 is not 3+1 from either end
    const slot = runSlot([c('red', 3)])
    expect(canPlaceCard(slot, c('red', 5))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// placeCard — runs with sideHint
// ---------------------------------------------------------------------------

describe('placeCard runs sideHint', () => {
  it('single card: goes right by default', () => {
    const slot = runSlot([c('red', 5)])
    const right = placeCard(slot, c('red', 6), 'right')
    const left = placeCard(slot, c('red', 4), 'left')
    expect(right?.cards).toEqual([c('red', 5), c('red', 6)])
    expect(left?.cards).toEqual([c('red', 4), c('red', 5)])
  })

  it('wild extends right by default', () => {
    const slot = runSlot([c('red', 5)])
    const result = placeCard(slot, wild())
    // [R5, wild] → wild at right = 6
    expect(result?.cards[0].number).toBe(5)
    expect(result?.cards[1].color).toBe('wild')
  })

  it('wild extends left when sideHint=left', () => {
    const slot = runSlot([c('red', 5)])
    const result = placeCard(slot, wild(), 'left')
    // [wild, R5] → wild at left = 4
    expect(result?.cards[0].color).toBe('wild')
    expect(result?.cards[1].number).toBe(5)
  })

  it('only-valid side wins over sideHint', () => {
    // [R3, wild, R5]: adding R6 can only go right
    const slot = runSlot([c('red', 3), wild(), c('red', 5)])
    const result = placeCard(slot, c('red', 6), 'left') // sideHint=left, but left is invalid
    expect(result?.cards[result.cards.length - 1].number).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// removeCard — groups
// ---------------------------------------------------------------------------

describe('removeCard groups', () => {
  it('removing a card from a group never cascades', () => {
    const slot = groupSlot([c('red', 5), c('green', 5), c('black', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red5')
    expect(updated.cards).toHaveLength(2)
    expect(spilled).toHaveLength(0)
  })

  it('removing the only card leaves empty slot, no cascade', () => {
    const slot = groupSlot([c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red5')
    expect(updated.cards).toHaveLength(0)
    expect(spilled).toHaveLength(0)
  })

  it('removing wild from group, naturals remain', () => {
    const slot = groupSlot([c('red', 7), wild()])
    const { slot: updated, spilled } = removeCard(slot, 'w')
    expect(updated.cards).toEqual([c('red', 7)])
    expect(spilled).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// removeCard — runs (cascade logic)
// ---------------------------------------------------------------------------

describe('removeCard runs', () => {
  it('removing the rightmost card — no cascade', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red5')
    expect(updated.cards).toHaveLength(2)
    expect(spilled).toHaveLength(0)
  })

  it('removing the leftmost card — no cascade', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red3')
    expect(updated.cards).toHaveLength(2)
    expect(spilled).toHaveLength(0)
  })

  it('removing a middle card cascades all remaining cards', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red4')
    expect(updated.cards).toHaveLength(0)
    expect(spilled).toHaveLength(2)
  })

  it('removing wild from [A, wild, B] cascades (gap left unfilled)', () => {
    const slot = runSlot([c('red', 3), wild(), c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'w')
    expect(updated.cards).toHaveLength(0)
    expect(spilled).toHaveLength(2)
  })

  it('removing wild from end [A, B, wild] does not cascade', () => {
    const slot = runSlot([c('red', 3), c('red', 4), wild()])
    const { slot: updated, spilled } = removeCard(slot, 'w')
    expect(updated.cards).toHaveLength(2)
    expect(spilled).toHaveLength(0)
  })

  it('removing card when only one card in slot — no cascade', () => {
    const slot = runSlot([c('red', 5)])
    const { slot: updated, spilled } = removeCard(slot, 'red5')
    expect(updated.cards).toHaveLength(0)
    expect(spilled).toHaveLength(0)
  })

  it('non-existent card id is a no-op', () => {
    const slot = runSlot([c('red', 5), c('red', 6)])
    const { slot: updated, spilled } = removeCard(slot, 'not-here')
    expect(updated.cards).toHaveLength(2)
    expect(spilled).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// swapWildEnd
// ---------------------------------------------------------------------------

describe('swapWildEnd', () => {
  it('moves wild from left end to right end', () => {
    // [wild, R4, R5, R6]: wild=3 at left → swap → [R4, R5, R6, wild]: wild=7
    const slot = runSlot([wild(), c('red', 4), c('red', 5), c('red', 6)])
    const result = swapWildEnd(slot)
    expect(result).not.toBeNull()
    expect(result!.cards[0].number).toBe(4)
    expect(result!.cards[result!.cards.length - 1].color).toBe('wild')
  })

  it('moves wild from right end to left end', () => {
    const slot = runSlot([c('red', 4), c('red', 5), c('red', 6), wild()])
    const result = swapWildEnd(slot)
    expect(result).not.toBeNull()
    expect(result!.cards[0].color).toBe('wild')
    expect(result!.cards[result!.cards.length - 1].number).toBe(6)
  })

  it('returns null when wild is in the middle', () => {
    const slot = runSlot([c('red', 3), wild(), c('red', 5)])
    expect(swapWildEnd(slot)).toBeNull()
  })

  it('returns null when no wild is present', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5)])
    expect(swapWildEnd(slot)).toBeNull()
  })

  it('returns null for a group slot', () => {
    const slot = groupSlot([c('red', 5), wild()])
    expect(swapWildEnd(slot)).toBeNull()
  })

  it('returns null when swap would produce an out-of-bounds wild (value 0)', () => {
    // [wild, R1, R2, R3]: wild=0 at left → swap to right would give wild=4 (valid)
    // Actually this swap IS valid (wild goes from representing 0 to representing 4).
    // But wait: [wild, R1, ...] with wild at left → wild would be R1-1 = 0 → isValidPartialRun should
    // reject this initial state already. Let's test swapping from [R1, R2, R3, wild] → [wild, R1, R2, R3].
    // [wild, R1, R2, R3]: wild at left = 0 → bounds check fails → invalid → returns null.
    const slot = runSlot([c('red', 1), c('red', 2), c('red', 3), wild()])
    const result = swapWildEnd(slot) // swap to [wild, R1, R2, R3] → wild=0 → invalid
    expect(result).toBeNull()
  })

  it('returns null when swap would produce out-of-bounds wild (value 15)', () => {
    // [wild, R12, R13, R14]: swap to [R12, R13, R14, wild] → wild=15 → invalid
    const slot = runSlot([wild(), c('red', 12), c('red', 13), c('red', 14)])
    const result = swapWildEnd(slot)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isSlotComplete & canSubmit
// ---------------------------------------------------------------------------

describe('isSlotComplete', () => {
  it('complete group (3 same-number cards)', () => {
    const slot = groupSlot([c('red', 5), c('green', 5), c('black', 5)])
    expect(isSlotComplete(slot)).toBe(true)
  })

  it('incomplete group (2 cards)', () => {
    const slot = groupSlot([c('red', 5), c('green', 5)])
    expect(isSlotComplete(slot)).toBe(false)
  })

  it('complete run (4 consecutive same-color)', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5), c('red', 6)])
    expect(isSlotComplete(slot)).toBe(true)
  })

  it('complete run with wild', () => {
    const slot = runSlot([c('red', 3), wild(), c('red', 5), c('red', 6)])
    expect(isSlotComplete(slot)).toBe(true)
  })

  it('incomplete run (3 cards)', () => {
    const slot = runSlot([c('red', 3), c('red', 4), c('red', 5)])
    expect(isSlotComplete(slot)).toBe(false)
  })
})

describe('canSubmit', () => {
  it('true when all slots complete', () => {
    const slots = [
      groupSlot([c('red', 5), c('green', 5), c('black', 5)]),
      runSlot([c('red', 3), c('red', 4), c('red', 5), c('red', 6)]),
    ]
    expect(canSubmit(slots)).toBe(true)
  })

  it('false when any slot is incomplete', () => {
    const slots = [
      groupSlot([c('red', 5), c('green', 5), c('black', 5)]),
      runSlot([c('red', 3), c('red', 4), c('red', 5)]),
    ]
    expect(canSubmit(slots)).toBe(false)
  })

  it('false for empty slot array', () => {
    expect(canSubmit([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// mergeVisibleHandOrder
// ---------------------------------------------------------------------------

describe('mergeVisibleHandOrder', () => {
  it('with no prep cards, returns the visible order', () => {
    expect(mergeVisibleHandOrder(['a', 'b', 'c'], ['c', 'a', 'b'], new Set())).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('keeps prep cards in their original indexes as holes', () => {
    // Full: A B C D E; B and D in prep; visible reordered E A C
    const merged = mergeVisibleHandOrder(
      ['A', 'B', 'C', 'D', 'E'],
      ['E', 'A', 'C'],
      new Set(['B', 'D']),
    )
    expect(merged).toEqual(['E', 'B', 'A', 'D', 'C'])
  })

  it('prep cards at the ends stay at the ends', () => {
    const merged = mergeVisibleHandOrder(
      ['A', 'B', 'C'],
      ['C', 'B'],
      new Set(['A']),
    )
    expect(merged).toEqual(['A', 'C', 'B'])
  })

  it('returns null when a visible id is missing', () => {
    expect(
      mergeVisibleHandOrder(['A', 'B', 'C'], ['A'], new Set(['B'])),
    ).toBeNull()
  })

  it('returns null when a prep id is included in the visible order', () => {
    expect(
      mergeVisibleHandOrder(['A', 'B', 'C'], ['A', 'B'], new Set(['B'])),
    ).toBeNull()
  })
})
