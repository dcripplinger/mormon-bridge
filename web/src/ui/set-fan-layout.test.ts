import { describe, expect, it } from 'vitest'
import { CORNER_REVEAL_RATIO, fanSteps, gapNeedsReveal } from './SetFan'

const reveal = Math.round(40 * CORNER_REVEAL_RATIO)

describe('fanSteps', () => {
  it('opens the first gap of a run so the low number stays visible', () => {
    const cards = [
      { color: 'red' },
      { color: 'red' },
      { color: 'red' },
      { color: 'red' },
    ]
    const steps = fanSteps(cards, 40, 70)
    expect(gapNeedsReveal(cards, 0)).toBe(true)
    expect(steps[0]).toBeGreaterThanOrEqual(reveal)
    expect(steps[1]).toBeLessThan(steps[0])
  })

  it('opens the gap before a wild at the right end', () => {
    const cards = [
      { color: 'red' },
      { color: 'red' },
      { color: 'red' },
      { color: 'wild' },
    ]
    const steps = fanSteps(cards, 40, 80)
    expect(steps[steps.length - 1]).toBeGreaterThanOrEqual(reveal)
  })

  it('opens the gap after a wild in the middle', () => {
    const cards = [
      { color: 'red' },
      { color: 'wild' },
      { color: 'red' },
      { color: 'red' },
    ]
    const steps = fanSteps(cards, 40, 90)
    expect(steps[1]).toBeGreaterThanOrEqual(reveal)
  })
})
