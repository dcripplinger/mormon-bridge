import type { Card } from './card'
import { cardDisplayText, compareCards } from './card'

/**
 * AI decision logs are on only when both:
 * - Vite is in DEV mode (`import.meta.env.DEV`)
 * - `VITE_AI_DEBUG=1` is set at startup (e.g. `npm run dev:ai`)
 */
export function isAiDebugEnabled(): boolean {
  return (
    import.meta.env.DEV === true &&
    (import.meta.env.VITE_AI_DEBUG === '1' ||
      import.meta.env.VITE_AI_DEBUG === 'true')
  )
}

/** Shorthand like R9 / Y5 / WILD (no id). */
export function formatCardShort(card: Card): string {
  return cardDisplayText(card)
}

/** Hand shorthand in ascending sort order, e.g. "B1 G5 R9 R12 Y5 WILD". */
export function formatHandShort(cards: Card[]): string {
  return [...cards]
    .sort(compareCards)
    .map(formatCardShort)
    .join(' ')
}

export function formatCard(card: Card): string {
  return `${formatCardShort(card)}(${card.id})`
}

export function formatCards(cards: Card[]): string {
  return cards.map(formatCard).join(', ')
}

export interface AiLogArgs {
  playerLabel: string
  decision: string
  reason: string
  /** Current hand at decision time (will be sorted ascending for display). */
  hand: Card[]
  /** Card being considered for this action (buy/claim/extend/discard/etc.). */
  target?: Card
  details?: Record<string, unknown>
}

/** Console logger for bot decisions. No-op when the debug gate is off. */
export function aiLog(args: AiLogArgs): void {
  if (!isAiDebugEnabled()) return
  const { playerLabel, decision, reason, hand, target, details } = args
  const handText = formatHandShort(hand)
  const targetText = target ? formatCardShort(target) : '—'

  const lines = [
    `[AI] ${playerLabel} → ${decision}`,
    `  hand:   ${handText || '(empty)'}`,
    `  target: ${targetText}`,
    `  reason: ${reason}`,
  ]

  if (details !== undefined) {
    console.log(`${lines.join('\n')}\n  details:`, details)
  } else {
    console.log(lines.join('\n'))
  }
}
