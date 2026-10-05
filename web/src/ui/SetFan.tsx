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
}

/**
 * Minimum pixels between consecutive card left-edges (ensures end-card readability).
 * The FIRST card always shows its full left face; the LAST card always shows its
 * full right face.  Middle cards get at least MIN_STEP_PX of left face exposed.
 */
const MIN_STEP_PX = 10

/**
 * Maximum step as a fraction of cardW.
 * Cards always overlap by at least (1 − MAX_STEP_RATIO) × cardW.
 * At 0.65 that's ≥35% overlap regardless of fan width.
 */
const MAX_STEP_RATIO = 0.65

export default function SetFan({
  cards,
  cardW,
  cardH,
  cardRadius,
  maxWidth,
  selected,
  onTap,
  meldType,
}: SetFanProps) {
  const count = cards.length
  if (count === 0) return null

  // Compute step: distribute evenly within maxWidth, clamped to [MIN_STEP_PX, maxStep].
  const maxStep = Math.round(cardW * MAX_STEP_RATIO)
  const step =
    count <= 1
      ? 0
      : Math.min(maxStep, Math.max(MIN_STEP_PX, (maxWidth - cardW) / (count - 1)))

  // Fan total width — may exceed maxWidth if count is high.
  const fanWidth = count <= 1 ? cardW : cardW + (count - 1) * step

  return (
    <div
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
      }}
    >
      {cards.map((card, i) => (
        <div
          key={card.id}
          style={{
            position: 'absolute',
            left: i * step,
            top: 0,
            width: cardW,
            height: cardH,
            zIndex: i + 1,
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
}
