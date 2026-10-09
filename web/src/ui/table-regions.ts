import type { OpponentSeatPlacement, SeatSide } from './seat-layout'

const FULL_CARD_H = 96

/** Gap kept between a set region and the deck/discard cluster. */
const REGION_GAP = 12
/** How far opponent hands reach in from the screen edge. */
const HAND_CLEAR = 56
/**
 * Depth of the corner strip reserved for the players on the shorter screen edges.
 * One row of set cards, plus a little room so the fan pad stays inside the strip.
 */
const CORNER_ROW_PAD = 8
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

function fitsFan(
  rect: TableRect,
  along: 'x' | 'y',
  setCardW: number,
  setCardH: number,
): boolean {
  const alongSize = along === 'x' ? rect.width : rect.height
  const crossSize = along === 'x' ? rect.height : rect.width
  return alongSize >= setCardW && crossSize >= setCardH
}

/**
 * Players on one edge share that edge's set area.
 * `along` is the axis their fans spread on.
 */
function pushEdgeSlices(
  regions: SetRegion[],
  seats: OpponentSeatPlacement[],
  band: TableRect,
  along: 'x' | 'y',
  side: SetSide,
  setCardW: number,
  setCardH: number,
): boolean {
  if (seats.length === 0) return true
  if (!fitsFan(band, along, setCardW, setCardH)) return false
  const slices = splitAlong(band, seats.length, along)
  for (let i = 0; i < seats.length; i++) {
    const slice = slices[i]
    if (!fitsFan(slice, along, setCardW, setCardH)) return false
    regions.push({
      playerIndex: seats[i].playerIndex,
      side,
      rect: slice,
      rotationDeg: rotationForSide(side),
    })
  }
  return true
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

  // Middle ring: felt between the outer hand clearance and the pile (plus gap).
  // Player areas partition that ring. They are not a grid locked to the pile edges.
  // Corners belong to whoever sits on the shorter screen edges — top and bottom in
  // portrait, left and right in landscape — as a full-length strip one set-row deep.
  // The other seats fill the remaining length of their side, so a portrait side seat
  // runs past the pile instead of stopping at its top and bottom.
  const outer: TableRect = {
    left: fieldLeft,
    top: fieldTop,
    width: fieldRight - fieldLeft,
    height: fieldBottom - fieldTop,
  }
  const hole: TableRect = {
    left: pileRect.left - REGION_GAP,
    top: pileRect.top - REGION_GAP,
    width: pileRect.width + REGION_GAP * 2,
    height: pileRect.height + REGION_GAP * 2,
  }
  if (
    hole.left < outer.left ||
    hole.top < outer.top ||
    hole.left + hole.width > outer.left + outer.width ||
    hole.top + hole.height > outer.top + outer.height
  ) {
    return null
  }

  const cornerDepth = setCardH + CORNER_ROW_PAD
  const claimedDepth = (gutter: number, claimed: boolean) =>
    claimed ? Math.min(gutter, cornerDepth) : 0

  const topSeats = seats.filter((s) => s.side === 'top')
  const leftSeats = seats.filter((s) => s.side === 'left')
  const rightSeats = seats.filter((s) => s.side === 'right')
  const cornersOnHorizontalEdges = w <= h

  if (cornersOnHorizontalEdges) {
    const topGutter = hole.top - outer.top
    const bottomGutter = outer.top + outer.height - (hole.top + hole.height)
    const topDepth = claimedDepth(topGutter, topSeats.length > 0)
    const bottomDepth = claimedDepth(bottomGutter, humanIndex >= 0)
    if (topSeats.length > 0 && topDepth < setCardH) return null
    if (humanIndex >= 0 && bottomDepth < setCardH) return null

    if (topSeats.length > 0) {
      const topBand: TableRect = {
        left: outer.left,
        top: outer.top,
        width: outer.width,
        height: topDepth,
      }
      if (!pushEdgeSlices(regions, topSeats, topBand, 'x', 'top', setCardW, setCardH)) return null
    }

    if (humanIndex >= 0) {
      const bottomBand: TableRect = {
        left: outer.left,
        top: outer.top + outer.height - bottomDepth,
        width: outer.width,
        height: bottomDepth,
      }
      if (!fitsFan(bottomBand, 'x', setCardW, setCardH)) return null
      regions.push({
        playerIndex: humanIndex,
        side: 'bottom',
        rect: bottomBand,
        rotationDeg: rotationForSide('bottom'),
      })
    }

    const sideBandTop = outer.top + topDepth
    const sideBandHeight = outer.height - topDepth - bottomDepth
    const leftBand: TableRect = {
      left: outer.left,
      top: sideBandTop,
      width: hole.left - outer.left,
      height: sideBandHeight,
    }
    const rightBand: TableRect = {
      left: hole.left + hole.width,
      top: sideBandTop,
      width: outer.left + outer.width - (hole.left + hole.width),
      height: sideBandHeight,
    }
    if (!pushEdgeSlices(regions, leftSeats, leftBand, 'y', 'left', setCardW, setCardH)) return null
    if (!pushEdgeSlices(regions, rightSeats, rightBand, 'y', 'right', setCardW, setCardH)) return null
  } else {
    const leftGutter = hole.left - outer.left
    const rightGutter = outer.left + outer.width - (hole.left + hole.width)
    const leftDepth = claimedDepth(leftGutter, leftSeats.length > 0)
    const rightDepth = claimedDepth(rightGutter, rightSeats.length > 0)
    if (leftSeats.length > 0 && leftDepth < setCardH) return null
    if (rightSeats.length > 0 && rightDepth < setCardH) return null

    const leftBand: TableRect = {
      left: outer.left,
      top: outer.top,
      width: leftDepth,
      height: outer.height,
    }
    const rightBand: TableRect = {
      left: outer.left + outer.width - rightDepth,
      top: outer.top,
      width: rightDepth,
      height: outer.height,
    }
    if (!pushEdgeSlices(regions, leftSeats, leftBand, 'y', 'left', setCardW, setCardH)) return null
    if (!pushEdgeSlices(regions, rightSeats, rightBand, 'y', 'right', setCardW, setCardH)) return null

    const edgeLeft = outer.left + leftDepth
    const edgeWidth = outer.width - leftDepth - rightDepth
    if (topSeats.length > 0) {
      const topBand: TableRect = {
        left: edgeLeft,
        top: outer.top,
        width: edgeWidth,
        height: hole.top - outer.top,
      }
      if (!pushEdgeSlices(regions, topSeats, topBand, 'x', 'top', setCardW, setCardH)) return null
    }
    if (humanIndex >= 0) {
      const bottomGutter = outer.top + outer.height - (hole.top + hole.height)
      const bottomBand: TableRect = {
        left: edgeLeft,
        top: hole.top + hole.height,
        width: edgeWidth,
        height: bottomGutter,
      }
      if (!fitsFan(bottomBand, 'x', setCardW, setCardH)) return null
      regions.push({
        playerIndex: humanIndex,
        side: 'bottom',
        rect: bottomBand,
        rotationDeg: rotationForSide('bottom'),
      })
    }
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
