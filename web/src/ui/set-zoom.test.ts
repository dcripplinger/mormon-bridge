import { describe, expect, it } from 'vitest'
import { poppedSetScale } from './SetZoomOverlay'

describe('poppedSetScale', () => {
  it('enlarges past a full-size card when the viewport allows', () => {
    const scale = poppedSetScale(120, 32, 0, 32, 1200, 800)
    expect(scale).toBeCloseTo(1.85 * 2)
  })

  it('uses the swapped visual size for a sideways fan', () => {
    const upright = poppedSetScale(200, 40, 0, 20, 240, 800)
    const sideways = poppedSetScale(200, 40, -90, 20, 240, 800)
    expect(sideways).toBeGreaterThan(upright)
  })
})
