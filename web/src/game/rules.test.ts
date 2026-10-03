import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import { isValidGroup, isValidRun, scoreHand, ROUND_REQUIREMENTS } from './rules'

// Helpers to build test cards quickly
const c = (color: Card['color'], number: number, id = `${color}_${number}`): Card => ({
  id,
  color,
  number,
})
const wild = (id = 'wild_0'): Card => ({ id, color: 'wild', number: 0 })

// ---------------------------------------------------------------------------
// isValidGroup
// ---------------------------------------------------------------------------
describe('isValidGroup', () => {
  it('accepts 3 cards of the same number', () => {
    expect(isValidGroup([c('red', 5), c('green', 5), c('black', 5)])).toBe(true)
  })

  it('accepts 5 cards of the same number', () => {
    expect(
      isValidGroup([c('red', 5), c('green', 5), c('black', 5), c('yellow', 5), c('red', 5, 'r5b')]),
    ).toBe(true)
  })

  it('accepts a group with 1 wild', () => {
    expect(isValidGroup([c('red', 7), c('green', 7), wild()])).toBe(true)
  })

  it('rejects 2 cards only', () => {
    expect(isValidGroup([c('red', 5), c('green', 5)])).toBe(false)
  })

  it('rejects mixed numbers', () => {
    expect(isValidGroup([c('red', 5), c('green', 5), c('black', 6)])).toBe(false)
  })

  it('rejects 2 wilds', () => {
    expect(isValidGroup([c('red', 5), wild('w1'), wild('w2')])).toBe(false)
  })

  it('rejects all wilds', () => {
    expect(isValidGroup([wild('w1'), wild('w2'), wild('w3')])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidRun
// ---------------------------------------------------------------------------
describe('isValidRun', () => {
  it('accepts 4 consecutive same-color cards', () => {
    expect(isValidRun([c('red', 3), c('red', 4), c('red', 5), c('red', 6)])).toBe(true)
  })

  it('accepts 6 consecutive same-color cards', () => {
    expect(
      isValidRun([
        c('green', 1),
        c('green', 2),
        c('green', 3),
        c('green', 4),
        c('green', 5),
        c('green', 6),
      ]),
    ).toBe(true)
  })

  it('accepts a run with 1 wild filling a gap', () => {
    // 3, 4, 6 — wild fills the 5
    expect(isValidRun([c('red', 3), c('red', 4), c('red', 6), wild()])).toBe(true)
  })

  it('rejects 3 cards only', () => {
    expect(isValidRun([c('red', 3), c('red', 4), c('red', 5)])).toBe(false)
  })

  it('rejects mixed colors', () => {
    expect(
      isValidRun([c('red', 3), c('red', 4), c('green', 5), c('red', 6)]),
    ).toBe(false)
  })

  it('rejects non-consecutive gap too large', () => {
    // 3, 4, 7 — gap of 3 cannot be covered by 1 wild
    expect(isValidRun([c('red', 3), c('red', 4), c('red', 7), wild()])).toBe(false)
  })

  it('rejects 2 wilds', () => {
    expect(isValidRun([c('red', 3), c('red', 4), wild('w1'), wild('w2')])).toBe(false)
  })

  it('accepts run where wild is at the start (numbers imply gap at front)', () => {
    // 2, 3, 4 with wild could extend below 2 → but the gap check only looks at non-wild numbers
    // Here: 2, 3, 4 have 0 gaps → wild is extra at border; valid because 0 gaps + 1 wild
    expect(isValidRun([c('red', 2), c('red', 3), c('red', 4), wild()])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// scoreHand
// ---------------------------------------------------------------------------
describe('scoreHand', () => {
  it('scores 1-8 as 5 points each', () => {
    expect(scoreHand([c('red', 1), c('red', 8)])).toBe(10)
  })

  it('scores 9-14 as 10 points each', () => {
    expect(scoreHand([c('red', 9), c('red', 14)])).toBe(20)
  })

  it('scores wild as 20 points', () => {
    expect(scoreHand([wild()])).toBe(20)
  })

  it('scores a mixed hand correctly', () => {
    // 3 low + 2 high + 1 wild = 15 + 20 + 20 = 55
    expect(
      scoreHand([c('red', 3), c('green', 5), c('black', 7), c('red', 9), c('red', 14), wild()]),
    ).toBe(55)
  })

  it('returns 0 for empty hand', () => {
    expect(scoreHand([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Round requirements sanity check
// ---------------------------------------------------------------------------
describe('ROUND_REQUIREMENTS', () => {
  it('has 7 rounds', () => {
    expect(ROUND_REQUIREMENTS.length).toBe(7)
  })

  it('round 1 is 2 groups', () => {
    expect(ROUND_REQUIREMENTS[0]).toEqual({ groups: 2, runs: 0 })
  })

  it('round 7 is 3 runs', () => {
    expect(ROUND_REQUIREMENTS[6]).toEqual({ groups: 0, runs: 3 })
  })
})
