import { describe, expect, it } from 'vitest'
import { GHOST_CARD_H, GHOST_CARD_W, ghostLiftedOrigin } from './ghost-lift'

describe('ghostLiftedOrigin', () => {
  it('places the card fully above the pointer', () => {
    const origin = ghostLiftedOrigin(400, 700)
    expect(origin.x).toBe(400 - GHOST_CARD_W / 2)
    expect(origin.y + GHOST_CARD_H).toBeLessThan(700)
  })

  it('keeps the card inside the viewport', () => {
    const origin = ghostLiftedOrigin(10, 20, 390, 700)
    expect(origin.x).toBeGreaterThanOrEqual(8)
    expect(origin.y).toBeGreaterThanOrEqual(8)
  })
})
