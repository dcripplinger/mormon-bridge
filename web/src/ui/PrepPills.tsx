import { useEffect, useState, type CSSProperties } from 'react'
import type { SetRegion, SetSide } from './table-regions'

interface PrepPillsProps {
  regions: SetRegion[]
  ready: boolean[]
  leaderIndex: number
  showReady: boolean
  showLeader: boolean
  humanIndex: number
  onToggleReady: () => void
}

/** Side seats read along the edge. Top and the human stay upright. */
function pillRotation(side: SetSide): number {
  if (side === 'left') return 90
  if (side === 'right') return -90
  return 0
}

/** Grow a little on large screens; tight pockets still clamp this down. */
function readabilityScale(minViewport: number): number {
  if (minViewport <= 800) return 1
  const t = Math.min(1, (minViewport - 800) / 600)
  return 1 + t * 0.5
}

function pillScale(region: SetRegion, stack: number, desired: number): number {
  const sideways = region.side === 'left' || region.side === 'right'
  const along = sideways ? region.rect.height : region.rect.width
  const cross = sideways ? region.rect.width : region.rect.height
  const stackPx = stack * 22 + Math.max(0, stack - 1) * 4
  const fit = Math.min((cross - 8) / stackPx, (along - 8) / 96)
  return Math.min(desired, Math.max(0.7, fit))
}

/** Sit on the outer edge of the pocket, toward that player's hand. */
function edgePlacement(side: SetSide): CSSProperties {
  if (side === 'left') {
    return { left: 6, top: '50%', transform: 'translateY(-50%)' }
  }
  if (side === 'right') {
    return { right: 6, top: '50%', transform: 'translateY(-50%)' }
  }
  if (side === 'top') {
    return { top: 6, left: '50%', transform: 'translateX(-50%)' }
  }
  return { bottom: 6, left: '50%', transform: 'translateX(-50%)' }
}

function useMinViewport(): number {
  const [minSide, setMinSide] = useState(() =>
    typeof window === 'undefined' ? 800 : Math.min(window.innerWidth, window.innerHeight),
  )
  useEffect(() => {
    const update = () => setMinSide(Math.min(window.innerWidth, window.innerHeight))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return minSide
}

export default function PrepPills({
  regions,
  ready,
  leaderIndex,
  showReady,
  showLeader,
  humanIndex,
  onToggleReady,
}: PrepPillsProps) {
  const desired = readabilityScale(useMinViewport())
  if (!showReady && !showLeader) return null

  return (
    <>
      {regions.map((region) => {
        const isLeader = region.playerIndex === leaderIndex
        const isReady = ready[region.playerIndex] === true
        const interactive = showReady && region.playerIndex === humanIndex
        const pills: Array<'ready' | 'first'> = []
        if (showReady) pills.push('ready')
        if (showLeader && isLeader) pills.push('first')
        if (pills.length === 0) return null
        const scale = pillScale(region, pills.length, desired)
        return (
          <div
            key={region.playerIndex}
            style={{
              position: 'absolute',
              left: region.rect.left,
              top: region.rect.top,
              width: region.rect.width,
              height: region.rect.height,
              pointerEvents: 'none',
              zIndex: 4,
            }}
          >
            <div
              style={{
                position: 'absolute',
                ...edgePlacement(region.side),
              }}
            >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                transform: `rotate(${pillRotation(region.side)}deg) scale(${scale})`,
              }}
            >
              {pills.map((kind) =>
                kind === 'ready' ? (
                  <ReadyPill
                    key="ready"
                    checked={isReady}
                    interactive={interactive}
                    onToggle={onToggleReady}
                  />
                ) : (
                  <span key="first" className="prep-pill">
                    1st player
                  </span>
                ),
              )}
            </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

function ReadyPill({
  checked,
  interactive,
  onToggle,
}: {
  checked: boolean
  interactive: boolean
  onToggle: () => void
}) {
  const mark = (
    <>
      <span className={checked ? 'prep-pill__box prep-pill__box--on' : 'prep-pill__box'} aria-hidden />
      Ready
    </>
  )
  if (!interactive) {
    return <span className="prep-pill">{mark}</span>
  }
  return (
    <button
      type="button"
      className="prep-pill prep-pill--button"
      aria-pressed={checked}
      onClick={onToggle}
    >
      {mark}
    </button>
  )
}
