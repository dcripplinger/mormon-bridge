import type { SeatSide } from './seat-layout'

export const NAME_BUBBLE_MS = 2000
export const BUY_BUBBLE_MIN_MS = 2000
export const BUY_BUBBLE_TEXT = 'Buy it!'
export const OUT_BUBBLE_TEXT = "I'm out!"

export type SpeechBubbleKind = 'name' | 'buy' | 'out'
/** Which table edge the avatar sits on. 'bottom' is the human seat. */
export type SpeechBubbleSide = SeatSide | 'bottom'

export interface SpeechBubbleModel {
  id: number
  playerIndex: number
  text: string
  shownAt: number
  kind: SpeechBubbleKind
}

/**
 * How long a buy bubble should keep showing.
 * Returns null while the buy is unresolved. Once resolved, the bubble stays
 * until both the resolution and a minimum on-screen time have passed.
 */
export function buyBubbleRemainingMs(
  shownAt: number,
  resolvedAt: number | null,
  now: number,
  minMs: number = BUY_BUBBLE_MIN_MS,
): number | null {
  if (resolvedAt === null) return null
  const dismissAt = Math.max(shownAt + minMs, resolvedAt)
  return Math.max(0, dismissAt - now)
}

interface SpeechBubbleLayerProps {
  bubbles: SpeechBubbleModel[]
  anchors: Record<number, { x: number; y: number }>
  sideFor: (playerIndex: number) => SpeechBubbleSide
}

export function SpeechBubbleLayer({ bubbles, anchors, sideFor }: SpeechBubbleLayerProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        pointerEvents: 'none',
      }}
    >
      {bubbles.map((bubble) => {
        const anchor = anchors[bubble.playerIndex]
        if (!anchor) return null
        return (
          <div
            key={bubble.id}
            style={{
              position: 'absolute',
              left: anchor.x,
              top: anchor.y,
              width: 0,
              height: 0,
              zIndex: bubble.id,
            }}
          >
            <div className={`speech-bubble speech-bubble--${sideFor(bubble.playerIndex)}`}>
              {bubble.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
