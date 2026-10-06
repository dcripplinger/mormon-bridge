import type { Card } from './card'
import { isWild, cardDisplayText } from './card'
import {
  ROUND_REQUIREMENTS,
  canExtendMeld,
  scoreCard,
} from './rules'
import type { Meld } from './state'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GROUP_MIN_CARDS = 3
export const RUN_MIN_CARDS = 4
export const GROUP_CARD_PTS = 2
export const RUN_CARD_PTS = 3
export const CONDITIONAL_OVERPLAY = 0.5

/** Acquire weights (pre-down). */
export const W_READINESS = 2.5
export const W_VERSATILITY = 0.75
export const W_OVERPLAY = 0.35
/** After go-down, overplay deltas matter more. */
export const W_OVERPLAY_DOWN = 8

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupCollection {
  type: 'group'
  number: number
  cards: Card[]
  wild: Card | null
}

export interface RunCluster {
  type: 'run'
  color: string
  core: Card[]
  wings: Card[]
  wild: Card | null
}

export type Collection = GroupCollection | RunCluster

export interface PurposePlan {
  primaryGroups: GroupCollection[]
  primaryRuns: RunCluster[]
  backupGroups: GroupCollection[]
  backupRuns: RunCluster[]
  throwaway: Card[]
  purposefulIds: Set<string>
  conditionalIds: Set<string>
  readiness: number
  readinessRequired: number
  versatility: number
  overplay: number
  readinessNorm: number
  canGoDown: boolean
  summary: string
}

export interface PurposeScores {
  readiness: number
  readinessRequired: number
  readinessNorm: number
  versatility: number
  overplay: number
  canGoDown: boolean
  plan: PurposePlan
}

// ---------------------------------------------------------------------------
// Table helpers (local to avoid circular imports with ai.ts)
// ---------------------------------------------------------------------------

function tablePlayableIds(hand: Card[], tableMelds: Meld[]): Set<string> {
  const ids = new Set<string>()
  for (const card of hand) {
    for (const meld of tableMelds) {
      if (canExtendMeld(meld.cards, card, meld.type)) {
        ids.add(card.id)
        break
      }
    }
  }
  return ids
}

function nearExtendIds(hand: Card[], tableMelds: Meld[]): Set<string> {
  const ids = new Set<string>()
  for (const card of hand) {
    if (isWild(card)) continue
    for (const meld of tableMelds) {
      if (meld.type !== 'run') continue
      if (canExtendMeld(meld.cards, card, 'run')) continue
      const naturals = meld.cards.filter((c) => !isWild(c))
      if (naturals.length === 0) continue
      if (!naturals.every((c) => c.color === card.color)) continue
      const nums = naturals.map((c) => c.number).sort((a, b) => a - b)
      const min = nums[0]
      const max = nums[nums.length - 1]
      if (card.number === min - 2 || card.number === max + 2) {
        ids.add(card.id)
        break
      }
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// Group collections
// ---------------------------------------------------------------------------

export function buildGroupCollections(hand: Card[]): GroupCollection[] {
  const byNumber = new Map<number, Card[]>()
  for (const c of hand) {
    if (isWild(c)) continue
    const list = byNumber.get(c.number) ?? []
    list.push(c)
    byNumber.set(c.number, list)
  }
  const out: GroupCollection[] = []
  for (const [number, cards] of byNumber) {
    out.push({ type: 'group', number, cards: [...cards], wild: null })
  }
  out.sort((a, b) => b.cards.length - a.cards.length || a.number - b.number)
  return out
}

function groupNaturalCount(g: GroupCollection): number {
  return g.cards.length + (g.wild ? 1 : 0)
}

function groupReadinessPts(g: GroupCollection): number {
  return Math.min(GROUP_MIN_CARDS, groupNaturalCount(g)) * GROUP_CARD_PTS
}

function groupVersatilityPts(g: GroupCollection): number {
  return groupReadinessPts(g)
}

function groupOverplayCards(g: GroupCollection): number {
  return Math.max(0, groupNaturalCount(g) - GROUP_MIN_CARDS)
}

function formatGroup(g: GroupCollection): string {
  const parts = g.cards.map((c) => cardDisplayText(c))
  if (g.wild) parts.push('WILD')
  return `${g.number}s[${parts.join(' ')}]`
}

// ---------------------------------------------------------------------------
// Run clusters (core + wings)
// ---------------------------------------------------------------------------

/**
 * From same-color naturals, extract one cluster: longest consecutive core,
 * plus wings at coreMin-2 / coreMax+2.
 */
export function extractRunCluster(colorCards: Card[]): RunCluster | null {
  if (colorCards.length === 0) return null
  const color = colorCards[0].color
  const byNum = new Map<number, Card>()
  for (const c of colorCards) {
    if (!byNum.has(c.number)) byNum.set(c.number, c)
  }
  const nums = [...byNum.keys()].sort((a, b) => a - b)
  if (nums.length === 0) return null

  let bestLo = 0
  let bestHi = 0
  let lo = 0
  for (let i = 1; i <= nums.length; i++) {
    if (i < nums.length && nums[i] === nums[i - 1] + 1) continue
    if (i - 1 - lo > bestHi - bestLo) {
      bestLo = lo
      bestHi = i - 1
    }
    lo = i
  }

  const coreNums = nums.slice(bestLo, bestHi + 1)
  const coreSet = new Set(coreNums)
  const core = coreNums.map((n) => byNum.get(n)!)
  const coreMin = coreNums[0]
  const coreMax = coreNums[coreNums.length - 1]

  const wings: Card[] = []
  const lowWing = byNum.get(coreMin - 2)
  const highWing = byNum.get(coreMax + 2)
  if (lowWing && !coreSet.has(lowWing.number)) wings.push(lowWing)
  if (highWing && !coreSet.has(highWing.number)) wings.push(highWing)

  return { type: 'run', color, core, wings, wild: null }
}

export function buildRunClustersForColor(colorCards: Card[]): RunCluster[] {
  const remaining = [...colorCards]
  const clusters: RunCluster[] = []
  while (remaining.length > 0) {
    const cluster = extractRunCluster(remaining)
    if (!cluster) break
    if (cluster.core.length < 2 && cluster.wings.length === 0) break
    if (cluster.core.length === 1 && cluster.wings.length === 0) break

    clusters.push(cluster)
    const usedNums = new Set([
      ...cluster.core.map((c) => c.number),
      ...cluster.wings.map((c) => c.number),
    ])
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (usedNums.has(remaining[i].number)) remaining.splice(i, 1)
    }
  }
  return clusters
}

export function buildRunClusters(hand: Card[]): RunCluster[] {
  const byColor = new Map<string, Card[]>()
  for (const c of hand) {
    if (isWild(c)) continue
    const list = byColor.get(c.color) ?? []
    list.push(c)
    byColor.set(c.color, list)
  }
  const out: RunCluster[] = []
  for (const cards of byColor.values()) {
    out.push(...buildRunClustersForColor(cards))
  }
  out.sort((a, b) => runEffectiveSize(b) - runEffectiveSize(a))
  return out
}

/** Best path size toward a run: core, or core+one wing. */
export function runEffectiveSize(r: RunCluster): number {
  const coreLen = r.core.length + (r.wild && r.wings.length === 0 ? 1 : 0)
  if (r.wings.length > 0) return coreLen + 1
  return coreLen
}

function runReadinessPts(r: RunCluster): number {
  return Math.min(RUN_MIN_CARDS, runEffectiveSize(r)) * RUN_CARD_PTS
}

function runVersatilityPts(r: RunCluster): number {
  return runReadinessPts(r)
}

function runExtraWingVersatility(r: RunCluster): number {
  return Math.max(0, r.wings.length - 1) * RUN_CARD_PTS
}

function runHardOverplayCards(r: RunCluster): number {
  const coreCount = r.core.length + (r.wild ? 1 : 0)
  return Math.max(0, coreCount - RUN_MIN_CARDS)
}

function runConditionalWingCount(r: RunCluster): number {
  return Math.max(0, r.wings.length - 1)
}

function formatRun(r: RunCluster): string {
  const core = r.core.map((c) => cardDisplayText(c)).join(' ')
  const wings =
    r.wings.length > 0
      ? ` wings:${r.wings.map((c) => cardDisplayText(c)).join(',')}`
      : ''
  const wild = r.wild ? ' +WILD' : ''
  return `${r.color}[${core}${wings}${wild}]`
}

function collectionIds(c: Collection): Set<string> {
  const ids = new Set<string>()
  if (c.type === 'group') {
    for (const card of c.cards) ids.add(card.id)
    if (c.wild) ids.add(c.wild.id)
  } else {
    for (const card of c.core) ids.add(card.id)
    for (const card of c.wings) ids.add(card.id)
    if (c.wild) ids.add(c.wild.id)
  }
  return ids
}

function overlapsIds(a: Set<string>, b: Set<string>): boolean {
  for (const id of a) {
    if (b.has(id)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Assignment search
// ---------------------------------------------------------------------------

export function requiredReadinessTotal(roundIndex: number): number {
  const req = ROUND_REQUIREMENTS[roundIndex]
  return (
    req.groups * GROUP_MIN_CARDS * GROUP_CARD_PTS +
    req.runs * RUN_MIN_CARDS * RUN_CARD_PTS
  )
}

function cloneGroup(g: GroupCollection): GroupCollection {
  return { type: 'group', number: g.number, cards: [...g.cards], wild: g.wild }
}

function cloneRun(r: RunCluster): RunCluster {
  return {
    type: 'run',
    color: r.color,
    core: [...r.core],
    wings: [...r.wings],
    wild: r.wild,
  }
}

interface Assignment {
  primaryGroups: GroupCollection[]
  primaryRuns: RunCluster[]
  backupGroups: GroupCollection[]
  backupRuns: RunCluster[]
  usedIds: Set<string>
}

function scoreAssignmentKey(
  a: Assignment,
  roundIndex: number,
): [number, number, number] {
  const req = ROUND_REQUIREMENTS[roundIndex]
  let readiness = 0
  for (const g of a.primaryGroups) readiness += groupReadinessPts(g)
  for (const r of a.primaryRuns) readiness += runReadinessPts(r)

  let versatility = 0
  for (const g of a.backupGroups) versatility += groupVersatilityPts(g)
  for (const r of a.backupRuns) versatility += runVersatilityPts(r)
  for (const r of a.primaryRuns) versatility += runExtraWingVersatility(r)

  const slotFill =
    a.primaryGroups.length / Math.max(1, req.groups) +
    a.primaryRuns.length / Math.max(1, req.runs)

  return [readiness, versatility + slotFill * 0.01, a.usedIds.size]
}

function betterKey(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] > b[0]
  if (a[1] !== b[1]) return a[1] > b[1]
  return a[2] > b[2]
}

function chooseIndexes(n: number, k: number): number[][] {
  if (k <= 0) return [[]]
  if (k > n) return []
  const arr = Array.from({ length: n }, (_, i) => i)
  const out: number[][] = []
  const rec = (start: number, picked: number[]) => {
    if (picked.length === k) {
      out.push([...picked])
      return
    }
    for (let i = start; i < arr.length; i++) {
      picked.push(arr[i])
      rec(i + 1, picked)
      picked.pop()
    }
  }
  rec(0, [])
  return out
}

export function assignPurposes(hand: Card[], roundIndex: number): Assignment {
  const req = ROUND_REQUIREMENTS[roundIndex]
  const groups = buildGroupCollections(hand)
  const runs = buildRunClusters(hand)
  const wilds = hand.filter(isWild)

  let best: Assignment = {
    primaryGroups: [],
    primaryRuns: [],
    backupGroups: [],
    backupRuns: [],
    usedIds: new Set(),
  }
  let bestKey: [number, number, number] = [-1, -1, -1]

  const topGroups = groups.slice(0, Math.min(8, groups.length))
  const topRuns = runs.slice(0, Math.min(6, runs.length))

  const pgCombos: number[][] = []
  if (req.groups === 0) {
    pgCombos.push([])
  } else {
    const k = Math.min(req.groups, topGroups.length)
    pgCombos.push(...chooseIndexes(topGroups.length, k))
    if (k > 0 && topGroups.length > 0 && k !== Math.min(req.groups - 1, topGroups.length)) {
      // also allow under-fill
      for (let u = 0; u < k; u++) {
        pgCombos.push(...chooseIndexes(topGroups.length, u))
      }
    }
  }

  const prCombos: number[][] = []
  if (req.runs === 0) {
    prCombos.push([])
  } else {
    const k = Math.min(req.runs, topRuns.length)
    prCombos.push(...chooseIndexes(topRuns.length, k))
    for (let u = 0; u < k; u++) {
      prCombos.push(...chooseIndexes(topRuns.length, u))
    }
  }

  // Dedupe combos
  const uniq = (combos: number[][]) => {
    const seen = new Set<string>()
    return combos.filter((c) => {
      const key = c.slice().sort((a, b) => a - b).join(',')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  for (const pgIdx of uniq(pgCombos)) {
    for (const prIdx of uniq(prCombos)) {
      const used = new Set<string>()
      const primaryGroups: GroupCollection[] = []
      const primaryRuns: RunCluster[] = []
      let conflict = false

      for (const gi of pgIdx) {
        const g = cloneGroup(topGroups[gi])
        const ids = collectionIds(g)
        if (overlapsIds(ids, used)) {
          conflict = true
          break
        }
        for (const id of ids) used.add(id)
        primaryGroups.push(g)
      }
      if (conflict) continue

      for (const ri of prIdx) {
        const r = cloneRun(topRuns[ri])
        const ids = collectionIds(r)
        if (overlapsIds(ids, used)) {
          conflict = true
          break
        }
        for (const id of ids) used.add(id)
        primaryRuns.push(r)
      }
      if (conflict) continue

      const backupGroups: GroupCollection[] = []
      const backupRuns: RunCluster[] = []
      for (const g of groups) {
        if (backupGroups.length >= req.groups) break
        const ids = collectionIds(g)
        if (overlapsIds(ids, used)) continue
        if (g.cards.length < 2) continue
        for (const id of ids) used.add(id)
        backupGroups.push(cloneGroup(g))
      }
      for (const r of runs) {
        if (backupRuns.length >= req.runs) break
        const ids = collectionIds(r)
        if (overlapsIds(ids, used)) continue
        for (const id of ids) used.add(id)
        backupRuns.push(cloneRun(r))
      }

      const freeWilds = wilds.filter((w) => !used.has(w.id))
      for (const w of freeWilds) {
        let attached = false
        for (const g of primaryGroups) {
          if (g.wild) continue
          if (groupNaturalCount(g) >= GROUP_MIN_CARDS) continue
          g.wild = w
          used.add(w.id)
          attached = true
          break
        }
        if (attached) continue
        for (const r of primaryRuns) {
          if (r.wild) continue
          if (runEffectiveSize(r) >= RUN_MIN_CARDS) continue
          r.wild = w
          used.add(w.id)
          break
        }
      }

      const assignment: Assignment = {
        primaryGroups,
        primaryRuns,
        backupGroups,
        backupRuns,
        usedIds: new Set(used),
      }
      const key = scoreAssignmentKey(assignment, roundIndex)
      if (betterKey(key, bestKey)) {
        bestKey = key
        best = assignment
      }
    }
  }

  return best
}

// ---------------------------------------------------------------------------
// Score a plan
// ---------------------------------------------------------------------------

function leftoverDenom(handSize: number, roundIndex: number): number {
  const req = ROUND_REQUIREMENTS[roundIndex]
  const minDown = req.groups * GROUP_MIN_CARDS + req.runs * RUN_MIN_CARDS
  return Math.max(1, handSize - minDown)
}

/**
 * @param canGoDown - from findBestGoDown in ai.ts (avoids circular import)
 */
export function scorePurposePlan(
  hand: Card[],
  tableMelds: Meld[],
  roundIndex: number,
  hasGoneDown: boolean,
  canGoDown: boolean = false,
): PurposeScores {
  const readinessRequired = requiredReadinessTotal(roundIndex)

  if (hasGoneDown) {
    const playable = tablePlayableIds(hand, tableMelds)
    const near = nearExtendIds(hand, tableMelds)
    const denom = Math.max(1, hand.length)
    let overplay = 0
    const conditionalIds = new Set<string>()
    for (const c of hand) {
      if (playable.has(c.id)) overplay += 1 / denom
      else if (near.has(c.id)) {
        overplay += CONDITIONAL_OVERPLAY / denom
        conditionalIds.add(c.id)
      }
    }
    const plan: PurposePlan = {
      primaryGroups: [],
      primaryRuns: [],
      backupGroups: [],
      backupRuns: [],
      throwaway: hand.filter((c) => !playable.has(c.id) && !near.has(c.id)),
      purposefulIds: new Set([...playable, ...near]),
      conditionalIds,
      readiness: readinessRequired,
      readinessRequired,
      versatility: 0,
      overplay,
      readinessNorm: 1,
      canGoDown: false,
      summary: `down; overplay=${overplay.toFixed(2)} playable=${playable.size} near=${near.size}`,
    }
    return {
      readiness: readinessRequired,
      readinessRequired,
      readinessNorm: 1,
      versatility: 0,
      overplay,
      canGoDown: false,
      plan,
    }
  }

  const assignment = assignPurposes(hand, roundIndex)
  let readiness = 0
  for (const g of assignment.primaryGroups) readiness += groupReadinessPts(g)
  for (const r of assignment.primaryRuns) readiness += runReadinessPts(r)
  if (canGoDown) readiness = readinessRequired

  let versatility = 0
  for (const g of assignment.backupGroups) versatility += groupVersatilityPts(g)
  for (const r of assignment.backupRuns) versatility += runVersatilityPts(r)
  for (const r of assignment.primaryRuns) versatility += runExtraWingVersatility(r)

  const denom = leftoverDenom(hand.length, roundIndex)
  const playable = tablePlayableIds(hand, tableMelds)
  const near = nearExtendIds(hand, tableMelds)
  const conditionalIds = new Set<string>()
  let overplay = 0

  for (const g of assignment.primaryGroups) {
    overplay += groupOverplayCards(g) / denom
  }
  for (const r of assignment.primaryRuns) {
    overplay += runHardOverplayCards(r) / denom
    overplay += (runConditionalWingCount(r) * CONDITIONAL_OVERPLAY) / denom
    if (r.wings.length > 1) {
      for (const w of r.wings.slice(1)) conditionalIds.add(w.id)
    }
  }

  const primaryIds = new Set<string>()
  for (const g of assignment.primaryGroups) {
    for (const id of collectionIds(g)) primaryIds.add(id)
  }
  for (const r of assignment.primaryRuns) {
    for (const id of collectionIds(r)) primaryIds.add(id)
  }

  for (const c of hand) {
    if (playable.has(c.id) && !primaryIds.has(c.id)) {
      overplay += 1 / denom
    } else if (near.has(c.id) && !primaryIds.has(c.id)) {
      overplay += CONDITIONAL_OVERPLAY / denom
      conditionalIds.add(c.id)
    }
  }

  const purposefulIds = new Set<string>(assignment.usedIds)
  const throwaway = hand.filter((c) => !purposefulIds.has(c.id))
  const readinessNorm =
    readinessRequired === 0 ? 1 : Math.min(1, readiness / readinessRequired)

  const plan: PurposePlan = {
    primaryGroups: assignment.primaryGroups,
    primaryRuns: assignment.primaryRuns,
    backupGroups: assignment.backupGroups,
    backupRuns: assignment.backupRuns,
    throwaway,
    purposefulIds,
    conditionalIds,
    readiness,
    readinessRequired,
    versatility,
    overplay,
    readinessNorm,
    canGoDown,
    summary: [
      `primaryG:[${assignment.primaryGroups.map(formatGroup).join('; ')}]`,
      `primaryR:[${assignment.primaryRuns.map(formatRun).join('; ')}]`,
      `backupG:[${assignment.backupGroups.map(formatGroup).join('; ')}]`,
      `backupR:[${assignment.backupRuns.map(formatRun).join('; ')}]`,
      `R=${readiness}/${readinessRequired} V=${versatility} O=${overplay.toFixed(2)}`,
    ].join(' '),
  }

  return {
    readiness,
    readinessRequired,
    readinessNorm,
    versatility,
    overplay,
    canGoDown,
    plan,
  }
}

export interface PurposeAcquisition {
  value: number
  completesGoDown: boolean
  readinessBefore: number
  readinessAfter: number
  readinessDelta: number
  versatilityDelta: number
  overplayDelta: number
  before: PurposeScores
  after: PurposeScores
}

export function purposeAcquisitionValue(
  card: Card,
  hand: Card[],
  tableMelds: Meld[],
  roundIndex: number,
  hasGoneDown: boolean,
  canGoDownBefore: boolean,
  canGoDownAfter: boolean,
): PurposeAcquisition {
  const before = scorePurposePlan(
    hand,
    tableMelds,
    roundIndex,
    hasGoneDown,
    canGoDownBefore,
  )
  const after = scorePurposePlan(
    [...hand, card],
    tableMelds,
    roundIndex,
    hasGoneDown,
    canGoDownAfter,
  )

  const completesGoDown = !canGoDownBefore && canGoDownAfter
  const readinessDelta = after.readiness - before.readiness
  const versatilityDelta = after.versatility - before.versatility
  const overplayDelta = after.overplay - before.overplay

  let value = 0
  if (hasGoneDown) {
    value += overplayDelta * W_OVERPLAY_DOWN
    const withCard = [...hand, card]
    if (tablePlayableIds(withCard, tableMelds).has(card.id)) value += 25
    else if (nearExtendIds(withCard, tableMelds).has(card.id)) value += 12
  } else {
    if (completesGoDown) value += 100
    value += readinessDelta * W_READINESS
    value += versatilityDelta * W_VERSATILITY
    value += overplayDelta * W_OVERPLAY
  }
  value -= scoreCard(card) * 0.15

  return {
    value,
    completesGoDown,
    readinessBefore: before.readiness,
    readinessAfter: after.readiness,
    readinessDelta,
    versatilityDelta,
    overplayDelta,
    before,
    after,
  }
}
