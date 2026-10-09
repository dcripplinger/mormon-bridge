import type { OpponentSeatPlacement, SeatSide } from './seat-layout'

const FULL_CARD_H = 96

/** Gap kept between a set region and the deck/discard cluster. */
const REGION_GAP = 12
/** How far opponent hands reach in from the screen edge. */
const HAND_CLEAR = 56
const PILE_LAYOUT_W = 64 * 2 + 28
const PILE_LAYOUT_H = 96 + 10 + 38

export interface TableRect {
  left: number
  top: number
  width: number
  height: number
}

export type SetSide = SeatSide | 'bottom'

export interface SetRegion {
  playerIndex: number
  side: SetSide
  rect: TableRect
  /** Degrees so card tops point toward the table center. */
  rotationDeg: number
}

export interface TableRegions {
  pileScale: number
  pileTopPct: string
  setCardW: number
  setCardH: number
  setCardRadius: number
  handExtraHang: number
  isShortLandscape: boolean
  /** Visual deck/discard cluster, before the safety gap. */
  pileRect: TableRect
  regions: SetRegion[]
}

interface ScaleChoice {
  pileScale: number
  setCardW: number
  handExtraHang: number
}

const SCALE_LADDER: ScaleChoice[] = [
  { pileScale: 1, setCardW: 44, handExtraHang: 0 },
  { pileScale: 0.9, setCardW: 40, handExtraHang: 0 },
  { pileScale: 0.82, setCardW: 36, handExtraHang: 8 },
  { pileScale: 0.72, setCardW: 30, handExtraHang: 16 },
  { pileScale: 0.62, setCardW: 26, handExtraHang: 22 },
  { pileScale: 0.52, setCardW: 22, handExtraHang: 28 },
]

export function humanHandVisiblePx(handExtraHang: number): number {
  return FULL_CARD_H * (1.4 - 1 / 3) - handExtraHang
}

/** Card tops point toward the center: right-side players face left, and so on. */
export function rotationForSide(side: SetSide): number {
  if (side === 'left') return 90
  if (side === 'right') return -90
  if (side === 'top') return 180
  return 0
}

export function rectsOverlap(a: TableRect, b: TableRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  )
}

export function visualAabb(
  box: { left: number; top: number; width: number; height: number },
  rotationDeg: number,
): TableRect {
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  const swap = rotationDeg === 90 || rotationDeg === -90
  const width = swap ? box.height : box.width
  const height = swap ? box.width : box.height
  return { left: cx - width / 2, top: cy - height / 2, width, height }
}

/**
 * Layout box for an upright row of fans, plus the rotation that turns card
 * tops toward the center. The visual result stays inside `region`.
 */
export function orientedPocketLayout(
  region: TableRect,
  rotationDeg: number,
  contentAlong: number,
  cardH: number,
): { left: number; top: number; width: number; height: number; transform: string } {
  const pad = 4
  const width = contentAlong
  const height = cardH
  if (rotationDeg === 180) {
    return {
      left: region.left + (region.width - width) / 2,
      top: region.top + pad,
      width,
      height,
      transform: 'rotate(180deg)',
    }
  }
  if (rotationDeg === 90) {
    const centerX = region.left + pad + cardH / 2
    const centerY = region.top + region.height / 2
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height,
      transform: 'rotate(90deg)',
    }
  }
  if (rotationDeg === -90) {
    const centerX = region.left + region.width - pad - cardH / 2
    const centerY = region.top + region.height / 2
    return {
      left: centerX - width / 2,
      top: centerY - height / 2,
      width,
      height,
      transform: 'rotate(-90deg)',
    }
  }
  return {
    left: region.left + (region.width - width) / 2,
    top: region.top + region.height - height - pad,
    width,
    height,
    transform: 'none',
  }
}

function splitAlong(
  rect: TableRect,
  count: number,
  axis: 'x' | 'y',
): TableRect[] {
  if (count <= 1) return [rect]
  const gap = 8
  const span = axis === 'y' ? rect.height : rect.width
  const slot = (span - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => {
    const offset = i * (slot + gap)
    if (axis === 'y') {
      return { ...rect, top: rect.top + offset, height: slot }
    }
    return { ...rect, left: rect.left + offset, width: slot }
  })
}

function tryLayout(
  w: number,
  h: number,
  humanIndex: number,
  seats: OpponentSeatPlacement[],
  choice: ScaleChoice,
): TableRegions | null {
  const setCardW = choice.setCardW
  const setCardH = Math.round(setCardW * 1.5)
  const handVisible = humanHandVisiblePx(choice.handExtraHang)
  const fieldTop = HAND_CLEAR
  const fieldBottom = h - handVisible - 8
  const fieldLeft = HAND_CLEAR
  const fieldRight = w - HAND_CLEAR
  if (fieldBottom <= fieldTop || fieldRight <= fieldLeft) return null

  const pileW = PILE_LAYOUT_W * choice.pileScale
  const pileH = PILE_LAYOUT_H * choice.pileScale
  const cx = w / 2
  // Midpoint of the felt between the top edge and the human hand.
  // Short screens shrink the piles (scale ladder) instead of sliding this up.
  const cy = (fieldTop + fieldBottom) / 2
  const pileRect: TableRect = {
    left: cx - pileW / 2,
    top: cy - pileH / 2,
    width: pileW,
    height: pileH,
  }
  if (pileRect.top < fieldTop || pileRect.top + pileRect.height > fieldBottom) return null

  const regions: SetRegion[] = []

  const topSeats = seats.filter((s) => s.side === 'top')
  let topRect: TableRect | null = null
  if (topSeats.length > 0) {
    topRect = {
      left: fieldLeft,
      top: fieldTop,
      width: fieldRight - fieldLeft,
      height: pileRect.top - REGION_GAP - fieldTop,
    }
    if (topRect.height < setCardH || topRect.width < setCardW) return null
    const slices = splitAlong(topRect, topSeats.length, 'x')
    topSeats.forEach((seat, i) => {
      regions.push({
        playerIndex: seat.playerIndex,
        side: 'top',
        rect: slices[i],
        rotationDeg: rotationForSide('top'),
      })
    })
  }

  const humanRect: TableRect = {
    left: fieldLeft,
    top: pileRect.top + pileRect.height + REGION_GAP,
    width: fieldRight - fieldLeft,
    height: fieldBottom - (pileRect.top + pileRect.height + REGION_GAP),
  }
  if (humanRect.height < setCardH || humanRect.width < setCardW) return null
  if (humanIndex >= 0) {
    regions.push({
      playerIndex: humanIndex,
      side: 'bottom',
      rect: humanRect,
      rotationDeg: rotationForSide('bottom'),
    })
  }

  const sideTop = topRect ? topRect.top + topRect.height + REGION_GAP : fieldTop
  const sideBottom = humanRect.top - REGION_GAP
  const sideHeight = sideBottom - sideTop
  const leftWidth = pileRect.left - REGION_GAP - fieldLeft
  const rightWidth = fieldRight - (pileRect.left + pileRect.width + REGION_GAP)
  if (sideHeight < setCardW || leftWidth < setCardH || rightWidth < setCardH) return null

  const leftRect: TableRect = {
    left: fieldLeft,
    top: sideTop,
    width: leftWidth,
    height: sideHeight,
  }
  const rightRect: TableRect = {
    left: pileRect.left + pileRect.width + REGION_GAP,
    top: sideTop,
    width: rightWidth,
    height: sideHeight,
  }

  for (const side of ['left', 'right'] as const) {
    const group = seats.filter((s) => s.side === side)
    if (group.length === 0) continue
    const band = side === 'left' ? leftRect : rightRect
    const slices = splitAlong(band, group.length, 'y')
    group.forEach((seat, i) => {
      const slice = slices[i]
      if (slice.height < setCardW || slice.width < setCardH) return
      regions.push({
        playerIndex: seat.playerIndex,
        side,
        rect: slice,
        rotationDeg: rotationForSide(side),
      })
    })
    if (group.some((_, i) => slices[i].height < setCardW)) return null
  }

  for (const region of regions) {
    if (rectsOverlap(region.rect, pileRect)) return null
  }

  return {
    pileScale: choice.pileScale,
    pileTopPct: `${(cy / h) * 100}%`,
    setCardW,
    setCardH,
    setCardRadius: setCardW >= 36 ? 4 : 3,
    handExtraHang: choice.handExtraHang,
    isShortLandscape: w > h && h < 500,
    pileRect,
    regions,
  }
}

export function computeTableRegions(
  w: number,
  h: number,
  humanIndex: number,
  seats: OpponentSeatPlacement[],
): TableRegions {
  for (const choice of SCALE_LADDER) {
    const layout = tryLayout(w, h, humanIndex, seats, choice)
    if (layout) return layout
  }
  const fallback = tryLayout(w, h, humanIndex, seats, SCALE_LADDER[SCALE_LADDER.length - 1])
  if (fallback) return fallback
  const last = SCALE_LADDER[SCALE_LADDER.length - 1]
  return {
    pileScale: last.pileScale,
    pileTopPct: '50%',
    setCardW: last.setCardW,
    setCardH: Math.round(last.setCardW * 1.5),
    setCardRadius: 3,
    handExtraHang: last.handExtraHang,
    isShortLandscape: w > h && h < 500,
    pileRect: { left: w / 2 - 40, top: h / 2 - 40, width: 80, height: 80 },
    regions: [],
  }
}
