import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Card } from '../game/card'
import AvatarView from './AvatarView'
import CardView from './CardView'
import {
  seatEdgeLeftPercent,
  seatEdgeTopPercent,
  type OpponentSeatPlacement,
  type SeatSide,
} from './seat-layout'

const BACK_CARD: Card = { id: 'opponent-back', color: 'wild', number: 0 }

/** Keep avatars inset so the active shimmer isn't clipped by the screen edge. */
export const SEAT_EDGE_INSET_PX = 10
/** Default seat avatar size (non-crowded opponent / human). */
export const SEAT_AVATAR_SIZE = 32
/** Slightly smaller when multiple opponents share an edge. */
const CROWDED_AVATAR_SIZE = 28

/** Slightly smaller than the main hand; shrink further when a side is crowded. */
const BASE_SCALE = 0.7
const CROWDED_SCALE = 0.58
const CARD_W = 64
const CARD_H = 96
/**
 * Max distance between consecutive card origins (= minimum overlap).
 * With few cards, spacing stops here; with more, cards pack tighter.
 */
const MAX_STEP_PX = 14
/** Hard cap so multiple edge seats still fit on a phone. */
const ABS_MAX_FAN_PX = 128
const EDGE_INSET_PX = SEAT_EDGE_INSET_PX

interface OpponentSeatProps {
  placement: OpponentSeatPlacement
  displayName: string
  avatarId: string
  cardCount: number
  isCurrent: boolean
  handAnchorRef?: React.RefObject<HTMLDivElement | null>
}

export default function OpponentSeat({
  placement,
  displayName,
  avatarId,
  cardCount,
  isCurrent,
  handAnchorRef,
}: OpponentSeatProps) {
  const { side, sideCount } = placement
  const viewport = useViewportSize()
  const scale = sideCount > 1 ? CROWDED_SCALE : BASE_SCALE
  const cardW = CARD_W * scale
  const cardH = CARD_H * scale
  const count = Math.max(0, cardCount)
  const [nameVisible, setNameVisible] = useState(false)
  const nameHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (nameHideTimerRef.current !== null) clearTimeout(nameHideTimerRef.current)
    }
  }, [])

  const revealName = () => {
    setNameVisible(true)
    if (nameHideTimerRef.current !== null) clearTimeout(nameHideTimerRef.current)
    nameHideTimerRef.current = setTimeout(() => {
      setNameVisible(false)
      nameHideTimerRef.current = null
    }, 2000)
  }

  const maxFan = maxFanAlongEdge(side, sideCount, viewport.w, viewport.h, cardW)
  // Max step = loosest spacing (current look with few cards). Extra cards only tighten.
  const maxStep = MAX_STEP_PX * scale
  const step =
    count <= 1
      ? 0
      : Math.min(maxStep, Math.max(1, (maxFan - cardW) / (count - 1)))
  const fanSpan = count <= 1 ? cardW : cardW + (count - 1) * step

  const rotate = handRotation(side)
  // Reserve the full along-edge capacity so avatar position stays fixed as
  // cards are added/removed. Actual fan packs toward the avatar inside it.
  const reservedFan = maxFan
  const layoutW = side === 'top' ? reservedFan : cardH
  const layoutH = side === 'top' ? cardH : reservedFan
  const avatarSize = sideCount > 1 ? CROWDED_AVATAR_SIZE : SEAT_AVATAR_SIZE

  // Center of the fan box, placed against the avatar-ward edge of the reserve.
  const fanCenterAlong = fanSpan / 2
  const fanBoxStyle: CSSProperties =
    side === 'top'
      ? {
          // Avatar is to the left of the hand — pack toward the left.
          left: fanCenterAlong,
          top: '50%',
          transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
        }
      : {
          // Avatar is above the hand — pack toward the top.
          left: '50%',
          top: fanCenterAlong,
          transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
        }

  return (
    <div
      style={{
        ...positionStyle(placement),
        position: 'absolute',
        zIndex: isCurrent ? 3 : 2,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: labelFlexDirection(side),
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          pointerEvents: 'auto',
          lineHeight: 0,
        }}
      >
        <button
          type="button"
          aria-label={displayName}
          onClick={revealName}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            lineHeight: 0,
            borderRadius: '50%',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            outline: 'none',
            boxShadow: 'none',
            appearance: 'none',
          }}
        >
          <AvatarView
            avatarId={avatarId}
            size={avatarSize}
            alt=""
            active={isCurrent}
          />
        </button>
        {nameVisible && (
          <div
            style={{
              position: 'absolute',
              ...(side === 'top'
                ? {
                    top: '100%',
                    left: '50%',
                    marginTop: '6px',
                    transform: 'translateX(-50%)',
                  }
                : side === 'right'
                  ? {
                      top: '50%',
                      right: '100%',
                      marginRight: '6px',
                      transform: 'translateY(-50%)',
                    }
                  : {
                      top: '50%',
                      left: '100%',
                      marginLeft: '6px',
                      transform: 'translateY(-50%)',
                    }),
              fontSize: sideCount > 1 ? '0.75rem' : '0.85rem',
              fontWeight: isCurrent ? 700 : 500,
              color: isCurrent ? 'var(--accent)' : 'var(--text)',
              textShadow: '0 1px 3px rgba(0,0,0,0.75)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              lineHeight: 1.2,
            }}
          >
            {displayName}
          </div>
        )}
      </div>

      {/* Outer box uses post-rotation bounds so flex/hang math stay axis-aligned. */}
      <div
        ref={handAnchorRef}
        aria-label={`${displayName} hand, ${count} cards`}
        style={{
          ...handHangStyle(side, layoutW, cardH),
          position: 'relative',
          width: layoutW,
          height: layoutH,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: fanSpan,
            height: cardH,
            ...fanBoxStyle,
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: i * step,
                top: 0,
                width: cardW,
                height: cardH,
                zIndex: i,
              }}
            >
              <CardView
                card={BACK_CARD}
                faceDown
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Max span of the single-row fan along the table edge. */
function maxFanAlongEdge(
  side: SeatSide,
  sideCount: number,
  vw: number,
  vh: number,
  cardW: number,
): number {
  // Share the edge among seats on that side; leave margin for names / chrome.
  if (side === 'top') {
    const share = sideCount > 1 ? 0.26 : 0.34
    return Math.max(cardW, Math.min(ABS_MAX_FAN_PX, vw * share))
  }
  const share = sideCount > 1 ? 0.2 : 0.26
  return Math.max(cardW, Math.min(ABS_MAX_FAN_PX, vh * share))
}

function useViewportSize(): { w: number; h: number } {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 400,
    h: typeof window !== 'undefined' ? window.innerHeight : 700,
  }))

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return size
}

/** Degrees to turn an upright hand so card tops face the table center. */
function handRotation(side: SeatSide): number {
  if (side === 'left') return 90
  if (side === 'right') return -90
  return 180
}

function positionStyle(placement: OpponentSeatPlacement): CSSProperties {
  const { side } = placement
  if (side === 'top') {
    return {
      left: `${seatEdgeLeftPercent(placement)}%`,
      top: EDGE_INSET_PX,
      transform: 'translate(-50%, 0)',
    }
  }
  if (side === 'left') {
    return {
      left: EDGE_INSET_PX,
      top: `${seatEdgeTopPercent(placement)}%`,
      transform: 'translate(0, -50%)',
    }
  }
  return {
    right: EDGE_INSET_PX,
    top: `${seatEdgeTopPercent(placement)}%`,
    transform: 'translate(0, -50%)',
  }
}

function labelFlexDirection(side: SeatSide): CSSProperties['flexDirection'] {
  // Side seats: label above the hand (screen-up). Top seats: label left of the hand.
  // Keeps names off the inward table edge so melds have room later.
  if (side === 'top') return 'row'
  return 'column'
}

/**
 * Hang the outer portion of the hand off-screen. `reach` is how far the cards
 * extend toward the table center (card height after rotation).
 */
function handHangStyle(
  side: SeatSide,
  layoutW: number,
  reach: number,
): CSSProperties {
  if (side === 'top') {
    return {
      // Match side seats: about half the card height stays on-screen.
      marginTop: -(reach * 0.5),
    }
  }
  if (side === 'left') {
    return {
      // Bottoms hang off the left; tops point right toward center.
      marginLeft: -(layoutW * 0.5),
    }
  }
  return {
    marginRight: -(layoutW * 0.5),
  }
}
