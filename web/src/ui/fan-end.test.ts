import { describe, expect, it } from 'vitest'
import { fanEndAtPoint } from './fan-end'

describe('fanEndAtPoint', () => {
  const rect = new DOMRect(100, 100, 80, 40)

  it('uses screen left and right when the set is upright', () => {
    expect(fanEndAtPoint(120, 120, rect, 0)).toBe('left')
    expect(fanEndAtPoint(170, 120, rect, 0)).toBe('right')
  })

  it('treats screen-up as the high end of a right-seat set', () => {
    expect(fanEndAtPoint(140, 110, rect, -90)).toBe('right')
    expect(fanEndAtPoint(140, 150, rect, -90)).toBe('left')
  })
})
