import { describe, expect, it } from 'vitest'
import type { Card } from './card'
import { arrangeRun, isPositionedRun, wildRepresentedRank } from './wild-rank'

const c = (id: string, number: number): Card => ({ id, color: 'black', number })
const wild = (id = 'w'): Card => ({ id, color: 'wild', number: 0 })

describe('arrangeRun', () => {
  it('seats a wild in the missing rank', () => {
    const ordered = arrangeRun([c('a', 1), c('b', 2), c('d', 4), wild()])
    expect(ordered.map((card) => card.id)).toEqual(['a', 'b', 'w', 'd'])
    expect(wildRepresentedRank(ordered)).toBe(3)
    expect(isPositionedRun(ordered)).toBe(true)
  })

  it('keeps a wild on the high end when the naturals are contiguous', () => {
    const ordered = arrangeRun([c('a', 5), c('b', 6), c('d', 7), wild()])
    expect(ordered.map((card) => card.id)).toEqual(['a', 'b', 'd', 'w'])
    expect(wildRepresentedRank(ordered)).toBe(8)
  })

  it('keeps a wild on the low end when it was declared there', () => {
    const ordered = arrangeRun([wild(), c('b', 2), c('d', 4), c('a', 3)])
    expect(ordered.map((card) => card.id)).toEqual(['w', 'b', 'a', 'd'])
    expect(wildRepresentedRank(ordered)).toBe(1)
  })

  it('does not treat an end wild as the card inside a gap', () => {
    const misplaced = [c('a', 1), c('b', 2), c('d', 4), wild()]
    expect(wildRepresentedRank(misplaced)).toBeNull()
    expect(isPositionedRun(misplaced)).toBe(false)
  })
})
