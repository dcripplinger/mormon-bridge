import { useEffect, useState } from 'react'
import type { OpponentSeatPlacement } from './seat-layout'
import { computeTableRegions, type TableRegions } from './table-regions'

/** Full-size card dimensions (matches --card-w / --card-h CSS vars). */
export const FULL_CARD_W = 64
export const FULL_CARD_H = 96

export type { TableRegions }

/**
 * Viewport-driven layout for the piles and each player's set region.
 * Recomputed on resize and when the seat arrangement changes.
 */
export function useTableLayout(
  humanIndex: number,
  seats: OpponentSeatPlacement[],
): TableRegions {
  const [size, setSize] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 400,
    h: typeof window !== 'undefined' ? window.innerHeight : 700,
  }))

  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return computeTableRegions(size.w, size.h, humanIndex, seats)
}
