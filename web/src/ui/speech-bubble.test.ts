import { describe, expect, it } from 'vitest'
import { buyBubbleRemainingMs } from './speech-bubble'

describe('buyBubbleRemainingMs', () => {
  it('stays up while the buy is unresolved', () => {
    expect(buyBubbleRemainingMs(1_000, null, 5_000)).toBeNull()
  })

  it('waits out the minimum after an early resolution', () => {
    expect(buyBubbleRemainingMs(1_000, 1_200, 1_200)).toBe(1_800)
  })

  it('hides as soon as a slow resolution finishes', () => {
    expect(buyBubbleRemainingMs(1_000, 4_000, 4_000)).toBe(0)
  })

  it('counts down independently from each bubble’s own appearance', () => {
    const resolvedAt = 3_000
    expect(buyBubbleRemainingMs(0, resolvedAt, resolvedAt)).toBe(0)
    expect(buyBubbleRemainingMs(1_500, resolvedAt, resolvedAt)).toBe(500)
  })
})
