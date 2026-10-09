import { forwardRef, type RefObject } from 'react'
import type { Card } from '../game/card'
import CardView from './CardView'

interface SetFanProps {
  cards: Card[]
  /** Pixel width for each card in this fan. */
  cardW: number
  /** Pixel height for each card in this fan. */
  cardH: number
  /** Border-radius for each card. */
  cardRadius: number
  /**
   * Preferred max width for the fan container.
   * The step between cards is computed so the fan fits within this width;
   * if it can't (too many cards at MIN_STEP), the fan grows wider.
   */
  maxWidth: number
  /** Highlight the fan as an extend target. */
  selected?: boolean
  /** Called when the fan is tapped. */
  onTap?: () => void
  meldType?: 'group' | 'run'
  meldId?: string
  /** Which end of the fan the dragged card would join. */
  activeEnd?: 'left' | 'right' | null
  /** Card flying in — keep its slot, but don't paint it yet. */
  hiddenCardId?: string | null
  cardRefFor?: (cardId: string) => RefObject<HTMLDivElement | null>
}

/**
 * Maximum step as a fraction of cardW.
 * Cards always overlap by at least (1 − MAX_STEP_RATIO) × cardW.
 * At 0.65 that's ≥35% overlap regardless of fan width.
 */
const MAX_STEP_RATIO = 0.65
/** Share of card width kept visible so a corner index or W can be read. */
export const CORNER_REVEAL_RATIO = 0.36

export function gapNeedsReveal(cards: { color: string }[], gapIndex: number): boolean {
  const card = cards[gapIndex]
  const next = cards[gapIndex + 1]
  if (!card || !next) return false
  if (gapIndex === 0) return true
  if (card.color === 'wild') return true
  if (gapIndex === cards.length - 2 && next.color === 'wild') return true
  return false
}

/** Per-gap offsets. Reveal gaps stay wide enough for a corner; other gaps stay tighter. */
export function fanSteps(
  cards: { color: string }[],
  cardW: number,
  maxWidth: number,
): number[] {
  const gaps = Math.max(0, cards.length - 1)
  if (gaps === 0) return []
  const revealPx = Math.max(1, Math.round(cardW * CORNER_REVEAL_RATIO))
  const maxStep = Math.max(revealPx, Math.round(cardW * MAX_STEP_RATIO))
  const steps = Array.from({ length: gaps }, (_, i) =>
    gapNeedsReveal(cards, i) ? revealPx : 1,
  )
  let extra = Math.max(0, maxWidth - cardW - steps.reduce((sum, step) => sum + step, 0))
  let guard = 0
  while (extra > 0 && guard < 6) {
    guard += 1
    const room = steps.map((step) => Math.max(0, maxStep - step))
    const open = room.filter((n) => n > 0).length
    if (open === 0) break
    const share = Math.max(1, Math.floor(extra / open))
    let spent = 0
    for (let i = 0; i < steps.length && spent < extra; i++) {
      const give = Math.min(room[i], share, extra - spent)
      steps[i] += give
      spent += give
    }
    if (spent === 0) break
    extra -= spent
  }
  return steps
}

/** Width of a fan. Pass `cards` when corner gaps must be reserved. */
export function fanWidthFor(
  cardW: number,
  count: number,
  maxWidth: number,
  cards?: { color: string }[],
): number {
  const limit = Math.max(1, maxWidth)
  if (count <= 1) return Math.min(cardW, limit)
  if (cards && cards.length === count) {
    const steps = fanSteps(cards, cardW, limit)
    return cardW + steps.reduce((sum, step) => sum + step, 0)
  }
  const maxStep = Math.round(cardW * MAX_STEP_RATIO)
  const base = Math.min(cardW, limit)
  const fitStep = (limit - base) / (count - 1)
  const step = Math.min(maxStep, Math.max(1, fitStep))
  return Math.min(limit, base + (count - 1) * step)
}

export function fanStep(cardW: number, count: number, maxWidth: number): number {
  if (count <= 1) return 0
  const fanWidth = fanWidthFor(cardW, count, maxWidth)
  const maxStep = Math.round(cardW * MAX_STEP_RATIO)
  return Math.min(maxStep, Math.max(1, (fanWidth - cardW) / (count - 1)))
}

const SetFan = forwardRef<HTMLDivElement, SetFanProps>(function SetFan({
  cards,
  cardW,
  cardH,
  cardRadius,
  maxWidth,
  selected,
  onTap,
  meldType,
  meldId,
  activeEnd,
  hiddenCardId,
  cardRefFor,
}, ref) {
  const count = cards.length
  if (count === 0) return null

  const steps = fanSteps(cards, cardW, maxWidth)
  const fanWidth = count <= 1
    ? Math.min(cardW, Math.max(1, maxWidth))
    : cardW + steps.reduce((sum, step) => sum + step, 0)
  const offsets: number[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    offsets.push(cursor)
    cursor += steps[i] ?? 0
  }

  return (
    <div
      ref={ref}
      data-meld-fan
      data-meld-id={meldId}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap ? 0 : undefined}
      aria-label={
        meldType === 'group'
          ? `Group set, ${count} cards`
          : `Run set, ${count} cards`
      }
      onClick={onTap}
      onKeyDown={
        onTap
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onTap()
              }
            }
          : undefined
      }
      style={{
        position: 'relative',
        width: fanWidth,
        height: cardH,
        flexShrink: 0,
        cursor: onTap ? 'pointer' : 'default',
        borderRadius: cardRadius + 2,
        outline: selected ? '2px solid var(--accent)' : 'none',
        outlineOffset: 2,
        boxShadow: selected
          ? '0 0 0 3px var(--accent), 0 0 16px rgba(232, 164, 34, 0.75)'
          : 'none',
      }}
    >
      {activeEnd && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '48%',
            left: activeEnd === 'left' ? 0 : undefined,
            right: activeEnd === 'right' ? 0 : undefined,
            background: 'rgba(232, 164, 34, 0.38)',
            borderRadius: cardRadius,
            pointerEvents: 'none',
            zIndex: 30,
          }}
        />
      )}
      {cards.map((card, i) => (
        <div
          key={card.id}
          ref={cardRefFor?.(card.id)}
          data-meld-card-id={card.id}
          style={{
            position: 'absolute',
            left: offsets[i],
            top: 0,
            width: cardW,
            height: cardH,
            zIndex: i + 1,
            visibility: hiddenCardId === card.id ? 'hidden' : 'visible',
            filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.45))',
          }}
        >
          <CardView
            card={card}
            style={{ width: cardW, height: cardH, borderRadius: cardRadius }}
          />
        </div>
      ))}
    </div>
  )
})

export default SetFan
