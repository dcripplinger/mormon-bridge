import { describe, expect, it } from 'vitest'
import { placeOpponents } from './seat-layout'
import {
  computeTableRegions,
  humanHandVisiblePx,
  orientedPocketLayout,
  rectsOverlap,
  rotationForSide,
  visualAabb,
} from './table-regions'

describe('rotationForSide', () => {
  it('turns card tops toward the center', () => {
    expect(rotationForSide('bottom')).toBe(0)
    expect(rotationForSide('top')).toBe(180)
    expect(rotationForSide('left')).toBe(90)
    expect(rotationForSide('right')).toBe(-90)
  })
})

describe('computeTableRegions', () => {
  it('keeps every set region off the deck and discard', () => {
    const seats = placeOpponents(4, 0, false)
    const layout = computeTableRegions(1024, 768, 0, seats)
    expect(layout.regions.length).toBe(4)
    for (const region of layout.regions) {
      expect(rectsOverlap(region.rect, layout.pileRect)).toBe(false)
    }
  })

  it('shrinks cards and the piles on a short landscape screen', () => {
    const seats = placeOpponents(4, 0, false)
    const wide = computeTableRegions(1280, 800, 0, seats)
    const short = computeTableRegions(800, 360, 0, seats)
    expect(short.setCardW).toBeLessThan(wide.setCardW)
    expect(short.pileScale).toBeLessThan(wide.pileScale)
    for (const region of short.regions) {
      expect(rectsOverlap(region.rect, short.pileRect)).toBe(false)
    }
  })

  it('keeps the piles at the middle of the felt on a phone', () => {
    const portrait = placeOpponents(4, 0, true)
    const layout = computeTableRegions(390, 844, 0, portrait)
    const mid = layout.pileRect.top + layout.pileRect.height / 2
    const fieldTop = 56
    const fieldBottom = 844 - humanHandVisiblePx(layout.handExtraHang) - 8
    expect(mid).toBeCloseTo((fieldTop + fieldBottom) / 2, 0)

    const landscape = placeOpponents(4, 0, false)
    const wide = computeTableRegions(800, 360, 0, landscape)
    const wideMid = wide.pileRect.top + wide.pileRect.height / 2
    const wideBottom = 360 - humanHandVisiblePx(wide.handExtraHang) - 8
    expect(wideMid).toBeCloseTo((fieldTop + wideBottom) / 2, 0)
    const top = wide.regions.find((r) => r.side === 'top')
    const bottom = wide.regions.find((r) => r.side === 'bottom')
    expect(top && bottom && top.rect.height).toBeGreaterThan(0)
    expect(bottom && top && Math.abs(top.rect.height - bottom.rect.height)).toBeLessThan(30)
  })

  it('fits a portrait phone without covering the piles', () => {
    const seats = placeOpponents(3, 0, true)
    const layout = computeTableRegions(390, 844, 0, seats)
    const right = layout.regions.find((r) => r.side === 'right')
    expect(right?.rotationDeg).toBe(-90)
    for (const region of layout.regions) {
      expect(rectsOverlap(region.rect, layout.pileRect)).toBe(false)
    }
  })

  it('lets portrait side sets run past the piles, with corners on top and bottom', () => {
    const seats = placeOpponents(4, 0, true)
    const layout = computeTableRegions(390, 844, 0, seats)
    const left = layout.regions.find((r) => r.side === 'left')
    const right = layout.regions.find((r) => r.side === 'right')
    const top = layout.regions.find((r) => r.side === 'top')
    const bottom = layout.regions.find((r) => r.side === 'bottom')
    expect(left && right && top && bottom).toBeTruthy()
    if (!left || !right || !top || !bottom) return

    expect(left.rect.height).toBeGreaterThan(layout.pileRect.height * 2)
    expect(left.rect.top).toBeLessThan(layout.pileRect.top)
    expect(left.rect.top + left.rect.height).toBeGreaterThan(layout.pileRect.top + layout.pileRect.height)
    expect(top.rect.left).toBeLessThan(layout.pileRect.left)
    expect(top.rect.left + top.rect.width).toBeGreaterThan(layout.pileRect.left + layout.pileRect.width)
    expect(top.rect.left).toBe(bottom.rect.left)
    expect(top.rect.width).toBe(bottom.rect.width)
    expect(rectsOverlap(left.rect, top.rect)).toBe(false)
    expect(rectsOverlap(left.rect, bottom.rect)).toBe(false)
    expect(rectsOverlap(left.rect, right.rect)).toBe(false)
  })

  it('gives landscape corners to the side seats and lets top extend past the piles', () => {
    const seats = placeOpponents(4, 0, false)
    const layout = computeTableRegions(1280, 800, 0, seats)
    const left = layout.regions.find((r) => r.side === 'left')
    const top = layout.regions.find((r) => r.side === 'top')
    const bottom = layout.regions.find((r) => r.side === 'bottom')
    expect(left && top && bottom).toBeTruthy()
    if (!left || !top || !bottom) return

    expect(left.rect.top).toBeLessThanOrEqual(top.rect.top)
    expect(left.rect.height).toBeGreaterThan(layout.pileRect.height)
    expect(left.rect.left + left.rect.width).toBeLessThanOrEqual(top.rect.left)
    expect(top.rect.width).toBeGreaterThan(layout.pileRect.width)
    expect(top.rect.left).toBeLessThan(layout.pileRect.left)
    expect(rectsOverlap(left.rect, top.rect)).toBe(false)
    expect(rectsOverlap(left.rect, bottom.rect)).toBe(false)
  })

  it('splits two portrait side seats evenly along the middle ring', () => {
    const seats = placeOpponents(5, 0, true)
    const layout = computeTableRegions(390, 844, 0, seats)
    const lefts = layout.regions.filter((r) => r.side === 'left')
    expect(lefts).toHaveLength(2)
    expect(Math.abs(lefts[0].rect.height - lefts[1].rect.height)).toBeLessThan(2)
    expect(rectsOverlap(lefts[0].rect, lefts[1].rect)).toBe(false)
    const upper = lefts[0].rect.top < lefts[1].rect.top ? lefts[0] : lefts[1]
    expect(upper.rect.top).toBeLessThan(layout.pileRect.top)
  })
})

describe('orientedPocketLayout', () => {
  it('places a right-side set inside its region with tops facing left', () => {
    const region = { left: 280, top: 80, width: 70, height: 220 }
    const box = orientedPocketLayout(region, -90, 160, 40)
    const visual = visualAabb(box, -90)
    expect(box.transform).toBe('rotate(-90deg)')
    expect(visual.left).toBeGreaterThanOrEqual(region.left - 0.5)
    expect(visual.left + visual.width).toBeLessThanOrEqual(region.left + region.width + 0.5)
    expect(visual.top).toBeGreaterThanOrEqual(region.top - 0.5)
    expect(visual.top + visual.height).toBeLessThanOrEqual(region.top + region.height + 0.5)
    expect(visual.left + visual.width).toBeCloseTo(region.left + region.width - 4, 0)
  })
})
