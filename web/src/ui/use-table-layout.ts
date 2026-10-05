import { useEffect, useState } from 'react'

/** Full-size card dimensions (matches --card-w / --card-h CSS vars). */
export const FULL_CARD_W = 64
export const FULL_CARD_H = 96

/**
 * Viewport-driven layout values for the game table.
 * Recomputed on every resize so all callers stay in sync.
 */
export interface TableLayout {
  /** Scale factor to apply to the center pile cluster (via CSS transform). */
  pileScale: number
  /** Set-card pixel width used by SetFan / PlayerSets. */
  setCardW: number
  /** Set-card pixel height used by SetFan / PlayerSets. */
  setCardH: number
  /** Border-radius for set cards. */
  setCardRadius: number
  /**
   * Extra pixels the human hand hangs further off the bottom edge.
   * Added on top of the standard 1/3-card hang so room is freed for the
   * human set strip on short landscape screens.
   */
  handExtraHang: number
  /**
   * Top position (as a percentage string) for the center pile cluster.
   * Raised in short landscape to clear the human set strip.
   */
  pileTopPct: string
  /** True when we are in a short landscape mode. */
  isShortLandscape: boolean
}

function computeLayout(w: number, h: number): TableLayout {
  const landscape = w > h

  if (landscape && h < 380) {
    return {
      pileScale: 0.72,
      setCardW: 30,
      setCardH: 45,
      setCardRadius: 3,
      handExtraHang: 16,
      pileTopPct: '35%',
      isShortLandscape: true,
    }
  }

  if (landscape && h < 500) {
    return {
      pileScale: 0.82,
      setCardW: 36,
      setCardH: 54,
      setCardRadius: 4,
      handExtraHang: 8,
      pileTopPct: '38%',
      isShortLandscape: true,
    }
  }

  return {
    pileScale: 1.0,
    setCardW: 44,
    setCardH: 66,
    setCardRadius: 4,
    handExtraHang: 0,
    pileTopPct: '42%',
    isShortLandscape: false,
  }
}

export function useTableLayout(): TableLayout {
  const [layout, setLayout] = useState<TableLayout>(() =>
    typeof window !== 'undefined'
      ? computeLayout(window.innerWidth, window.innerHeight)
      : computeLayout(400, 700),
  )

  useEffect(() => {
    const update = () => setLayout(computeLayout(window.innerWidth, window.innerHeight))
    // Fire once immediately in case a resize happened before mounting.
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return layout
}
