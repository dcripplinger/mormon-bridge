import { describe, expect, it } from 'vitest'
import { placeOpponents } from './seat-layout'

describe('placeOpponents', () => {
  it('seats 3 players left then right clockwise from human', () => {
    const seats = placeOpponents(3, 0, false)
    expect(seats.map((s) => [s.playerIndex, s.side])).toEqual([
      [1, 'left'],
      [2, 'right'],
    ])
  })

  it('seats 4 players left, top, right', () => {
    const seats = placeOpponents(4, 0, true)
    expect(seats.map((s) => [s.playerIndex, s.side])).toEqual([
      [1, 'left'],
      [2, 'top'],
      [3, 'right'],
    ])
  })

  it('seats 5 landscape with two at top', () => {
    const seats = placeOpponents(5, 0, false)
    expect(seats.map((s) => [s.playerIndex, s.side])).toEqual([
      [1, 'left'],
      [2, 'top'],
      [3, 'top'],
      [4, 'right'],
    ])
  })

  it('seats 5 portrait with two per side and no top', () => {
    const seats = placeOpponents(5, 0, true)
    expect(seats.map((s) => [s.playerIndex, s.side])).toEqual([
      [1, 'left'],
      [2, 'left'],
      [3, 'right'],
      [4, 'right'],
    ])
    expect(seats.every((s) => s.side !== 'top')).toBe(true)
  })

  it('rotates around a non-zero human index', () => {
    // Human is player 2 of 4 → clockwise: 3, 0, 1
    const seats = placeOpponents(4, 2, false)
    expect(seats.map((s) => [s.playerIndex, s.side])).toEqual([
      [3, 'left'],
      [0, 'top'],
      [1, 'right'],
    ])
  })
})
