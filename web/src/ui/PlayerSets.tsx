import type { RefObject } from 'react'
import type { Meld } from '../game/state'
import SetFan from './SetFan'

interface PlayerSetsProps {
  melds: Meld[]
  /**
   * Layout direction for the fans.
   * - 'row': fans side-by-side (human strip, top opponents)
   * - 'column': fans stacked vertically (left/right opponent bands)
   */
  direction: 'row' | 'column'
  /** Set-card pixel width. */
  cardW: number
  /** Set-card pixel height. */
  cardH: number
  /** Set-card border-radius. */
  cardRadius: number
  /**
   * Max width per fan (along the fan's own horizontal axis).
   * Constrained to the available inward band for the seat side.
   */
  maxFanWidth: number
  /**
   * The meld ID currently selected as an extend target.
   * Renders a gold outline on that fan.
   */
  targetMeldId?: string | null
  /** Called when a fan is tapped (zoom). */
  onTap: (meldId: string) => void
  /** Landing target for a card flying onto this meld. */
  fanRefFor?: (meldId: string) => RefObject<HTMLDivElement | null>
  /** End of the hovered fan the dragged card would join. */
  activeEnd?: 'left' | 'right' | null
  hiddenCardId?: string | null
  cardRefFor?: (cardId: string) => RefObject<HTMLDivElement | null>
}

export default function PlayerSets({
  melds,
  direction,
  cardW,
  cardH,
  cardRadius,
  maxFanWidth,
  targetMeldId,
  onTap,
  fanRefFor,
  activeEnd,
  hiddenCardId,
  cardRefFor,
}: PlayerSetsProps) {
  if (melds.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: direction,
        gap: 6,
        alignItems: direction === 'row' ? 'flex-end' : 'flex-start',
        pointerEvents: 'auto',
      }}
    >
      {melds.map((meld) => (
        <SetFan
          key={meld.id}
          ref={fanRefFor?.(meld.id)}
          cards={meld.cards}
          cardW={cardW}
          cardH={cardH}
          cardRadius={cardRadius}
          maxWidth={maxFanWidth}
          meldType={meld.type}
          meldId={meld.id}
          selected={targetMeldId === meld.id}
          activeEnd={targetMeldId === meld.id ? activeEnd : null}
          hiddenCardId={hiddenCardId}
          cardRefFor={cardRefFor}
          onTap={() => onTap(meld.id)}
        />
      ))}
    </div>
  )
}
