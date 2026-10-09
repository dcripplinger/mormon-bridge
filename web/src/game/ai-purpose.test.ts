import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import {
  buildRunClusters,
  extractRunCluster,
  purposeAcquisitionValue,
  runEffectiveSize,
  scorePurposePlan,
} from './ai-purpose'
import { findBestGoDown } from './ai'
import { canBuyDiscard, type GameState, type PlayerState } from './state'
import { decideBuy } from './ai'

function card(id: string, color: Card['color'], number: number): Card {
  return { id, color, number }
}

function player(index: number, hand: Card[], extras: Partial<PlayerState> = {}): PlayerState {
  return {
    index,
    displayName: `Bot ${index}`,
    isAI: true,
    avatarId: `b0${index + 1}`,
    hand,
    hasGoneDown: false,
    cumulativeScore: 0,
    ...extras,
  }
}

describe('run clusters (core + wings)', () => {
  it('builds core G4-G5 with wings G2 and G7', () => {
    const cards = [
      card('a', 'green', 2),
      card('b', 'green', 4),
      card('c', 'green', 5),
      card('d', 'green', 7),
    ]
    const cluster = extractRunCluster(cards)
    expect(cluster).not.toBeNull()
    expect(cluster!.core.map((c) => c.number)).toEqual([4, 5])
    expect(cluster!.wings.map((c) => c.number).sort((a, b) => a - b)).toEqual([2, 7])
    expect(runEffectiveSize(cluster!)).toBe(3) // core + one wing
  })

  it('scores readiness 9/12 for that cluster as sole run primary', () => {
    const hand = [
      card('a', 'green', 2),
      card('b', 'green', 4),
      card('c', 'green', 5),
      card('d', 'green', 7),
      // filler so round-2-like isn't needed; round 2 is 1G+1R — use round 2
      card('e', 'red', 9),
      card('f', 'yellow', 9),
    ]
    const can = !!findBestGoDown(hand, 1)
    const scores = scorePurposePlan(hand, [], 1, false, can)
    // 1 group (9s pair = 4 pts) + 1 run (effective 3 = 9 pts) = 13 / (6+12=18)
    expect(scores.plan.primaryRuns.length).toBe(1)
    expect(runEffectiveSize(scores.plan.primaryRuns[0])).toBe(3)
    expect(scores.readiness).toBeGreaterThanOrEqual(9 + 4) // run 9 + group pair 4
    // Second wing adds versatility
    expect(scores.versatility).toBeGreaterThanOrEqual(3)
  })
})

describe('pair-flood readiness (round 1)', () => {
  const hand = [
    card('r8', 'red', 8),
    card('r12', 'red', 12),
    card('y3', 'yellow', 3),
    card('y6', 'yellow', 6),
    card('y8', 'yellow', 8),
    card('g3', 'green', 3),
    card('g5', 'green', 5),
    card('g7', 'green', 7),
    card('g13', 'green', 13),
    card('b5', 'black', 5),
    card('b7', 'black', 7),
  ]

  it('caps readiness at two primary pairs (8/12), not 1.0 from pair spam', () => {
    const scores = scorePurposePlan(hand, [], 0, false, false)
    expect(scores.plan.primaryGroups.length).toBe(2)
    expect(scores.readiness).toBe(8) // 2 pairs × 2 cards × 2 pts
    expect(scores.readinessNorm).toBeCloseTo(8 / 12, 5)
    expect(scores.readinessNorm).toBeLessThan(1)
  })

  it('does not buy a duplicate Y6 that only adds a backup pair', () => {
    const target = card('buy6', 'yellow', 6)
    const canBefore = !!findBestGoDown(hand, 0)
    const canAfter = !!findBestGoDown([...hand, target], 0)
    const acq = purposeAcquisitionValue(
      target,
      hand,
      [],
      0,
      false,
      canBefore,
      canAfter,
    )
    // No readiness gain; maybe small versatility — should stay under buy threshold 16
    expect(acq.readinessDelta).toBe(0)
    expect(acq.value).toBeLessThan(16)

    const state: GameState = {
      players: [
        player(0, [card('x', 'red', 1)]),
        player(1, hand),
        player(2, [card('y', 'red', 2)]),
      ],
      drawPile: [card('d1', 'black', 1), card('d2', 'black', 2)],
      discardPile: [target],
      tableMetlds: [],
      roundIndex: 0,
      currentPlayerIndex: 0,
      phase: 'buy-window',
      hasDrawnThisTurn: false,
      lastDiscarderIndex: 0,
      buyIntents: [],
      extendHistory: [],
      pendingWild: null,
      roundVictorIndex: null,
      meldIdCounter: 0,
      lastError: null,
    }
    expect(canBuyDiscard(state, 1)).toBe(true)
    expect(decideBuy(state, 1)).toBe(false)
  })
})

describe('buildRunClusters', () => {
  it('returns clusters from mixed colors', () => {
    const hand = [
      card('a', 'green', 2),
      card('b', 'green', 4),
      card('c', 'green', 5),
      card('d', 'red', 10),
      card('e', 'red', 11),
      card('f', 'red', 12),
    ]
    const clusters = buildRunClusters(hand)
    expect(clusters.length).toBeGreaterThanOrEqual(2)
  })
})
