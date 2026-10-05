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
  /** Called when a fan is tapped — either zoom or extend depending on context. */
  onTap: (meldId: string) => void
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
}: PlayerSetsProps) {
  if (melds.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: direction,
        gap: 6,
        alignItems: direction === 'row' ? 'flex-end' : 'flex-start',
      }}
    >
      {melds.map((meld) => (
        <SetFan
          key={meld.id}
          cards={meld.cards}
          cardW={cardW}
          cardH={cardH}
          cardRadius={cardRadius}
          maxWidth={maxFanWidth}
          meldType={meld.type}
          selected={targetMeldId === meld.id}
          onTap={() => onTap(meld.id)}
        />
      ))}
    </div>
  )
}
