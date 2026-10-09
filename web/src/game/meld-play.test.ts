import { describe, expect, it } from 'vitest'
import type { Card } from './card'
import { legalAddEnds, planMeldPlay, wildDestinations } from './meld-play'

const c = (id: string, color: Card['color'], number: number): Card => ({ id, color, number })
const wild = (id = 'w'): Card => c(id, 'wild', 0)

describe('planMeldPlay', () => {
  const run = [c('a', 'red', 5), c('b', 'red', 6), c('c', 'red', 7), c('d', 'red', 8)]

  it('adds a higher card on the right', () => {
    const plan = planMeldPlay(run, 'run', c('e', 'red', 9))
    expect(plan?.index).toBe(4)
    expect(plan?.side).toBe('right')
    expect(plan?.displacedWild).toBeNull()
  })

  it('adds a lower card on the left', () => {
    const plan = planMeldPlay(run, 'run', c('e', 'red', 4))
    expect(plan?.index).toBe(0)
    expect(plan?.cards[0].number).toBe(4)
  })

  it('replaces a wild sitting in a gap', () => {
    const gapped = [c('a', 'red', 3), wild(), c('b', 'red', 5), c('c', 'red', 6)]
    const plan = planMeldPlay(gapped, 'run', c('d', 'red', 4))
    expect(plan?.index).toBe(1)
    expect(plan?.displacedWild?.id).toBe('w')
    expect(plan?.cards.map((card) => card.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('replaces a wild standing on the high end', () => {
    const ended = [c('a', 'red', 5), c('b', 'red', 6), c('c', 'red', 7), wild()]
    const plan = planMeldPlay(ended, 'run', c('d', 'red', 8))
    expect(plan?.index).toBe(3)
    expect(plan?.displacedWild?.id).toBe('w')
  })

  it('extends past a wild instead of replacing when the rank differs', () => {
    const ended = [c('a', 'red', 5), c('b', 'red', 6), c('c', 'red', 7), wild()]
    const plan = planMeldPlay(ended, 'run', c('d', 'red', 9))
    expect(plan?.index).toBe(4)
    expect(plan?.displacedWild).toBeNull()
  })

  it('puts a wild on the left of a group', () => {
    const group = [c('a', 'red', 7), c('b', 'blue', 7), c('d', 'green', 7)]
    const plan = planMeldPlay(group, 'group', wild())
    expect(plan?.index).toBe(0)
    expect(plan?.cards[0].color).toBe('wild')
  })

  it('lets a wild choose either end of a run', () => {
    expect(legalAddEnds(run, 'run', wild())).toEqual(['left', 'right'])
    expect(planMeldPlay(run, 'run', wild(), 'left')?.index).toBe(0)
    expect(planMeldPlay(run, 'run', wild(), 'right')?.index).toBe(4)
  })
})

describe('wildDestinations', () => {
  it('limits a same-meld wild to the set it came from', () => {
    const melds = [
      { id: 'src', type: 'run' as const, cards: [c('a', 'red', 5), c('b', 'red', 6), c('c', 'red', 7), c('d', 'red', 8)] },
      { id: 'other', type: 'group' as const, cards: [c('g', 'blue', 3), c('h', 'green', 3), c('i', 'yellow', 3)] },
    ]
    const dests = wildDestinations(melds, wild(), { from: 'runs', to: 'same-meld' }, 'src')
    expect(dests.every((d) => d.meldId === 'src')).toBe(true)
    expect(dests).toHaveLength(2)
  })
})
