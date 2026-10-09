import type { MeldEnd } from '../game/meld-play'
import { fanSteps } from './SetFan'

/** Which end of an upright fan the pointer is over, undoing the set's rotation. */
export function fanEndAtPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  rotationDeg: number,
): MeldEnd {
  const dx = clientX - (rect.left + rect.width / 2)
  const dy = clientY - (rect.top + rect.height / 2)
  const rad = (rotationDeg * Math.PI) / 180
  const localX = Math.cos(rad) * dx + Math.sin(rad) * dy
  return localX < 0 ? 'left' : 'right'
}

/** Screen center of a card slot after the fan grows, assuming the fan stays centered. */
export function predictedSlotCenter(
  fan: HTMLElement,
  index: number,
  cards: { color: string }[],
  cardW: number,
  maxWidth: number,
  rotationDeg: number,
): { x: number; y: number } {
  const rect = fan.getBoundingClientRect()
  const steps = fanSteps(cards, cardW, maxWidth)
  const width = cardW + steps.reduce((sum, step) => sum + step, 0)
  let localLeft = 0
  for (let i = 0; i < index; i++) localLeft += steps[i] ?? 0
  const localX = localLeft + cardW / 2 - width / 2
  const rad = (rotationDeg * Math.PI) / 180
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return {
    x: cx + localX * Math.cos(rad),
    y: cy + localX * Math.sin(rad),
  }
}
