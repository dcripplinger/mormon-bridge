/** Matches `--card-w` / `--card-h` used by the hand drag ghost. */
export const GHOST_CARD_W = 64
export const GHOST_CARD_H = 96

const LIFT_GAP = 14
const EDGE = 8

/**
 * Top-left of the drag ghost so the card sits fully above the pointer,
 * centered on it horizontally.
 */
export function ghostLiftedOrigin(
  pointerX: number,
  pointerY: number,
  viewportW = 0,
  viewportH = 0,
): { x: number; y: number } {
  let x = pointerX - GHOST_CARD_W / 2
  let y = pointerY - GHOST_CARD_H - LIFT_GAP
  if (viewportW > 0) {
    x = Math.min(Math.max(EDGE, x), Math.max(EDGE, viewportW - GHOST_CARD_W - EDGE))
  }
  if (viewportH > 0) {
    y = Math.min(Math.max(EDGE, y), Math.max(EDGE, viewportH - GHOST_CARD_H - EDGE))
  }
  return { x, y }
}
