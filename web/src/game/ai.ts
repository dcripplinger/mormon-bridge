import type { Card } from './card'
import { isWild } from './card'
import { aiLog, formatCardShort, formatCards, formatHandShort } from './ai-log'
import {
  purposeAcquisitionValue,
  scorePurposePlan,
  type PurposePlan,
} from './ai-purpose'
import {
  ROUND_REQUIREMENTS,
  canExtendMeld,
  isValidGroup,
  isValidRun,
  scoreCard,
} from './rules'
import {
  DEFAULT_WILD_RULES,
  allowsWildDisplacement,
  planMeldPlay,
  wildDestinations,
  type WildRules,
} from './meld-play'
import type { GameState, Meld } from './state'
import {
  canBuyDiscard,
  claimDiscardAsDraw,
  declareBuy,
  discard,
  drawFromDeck,
  extendMeld,
  goDown,
  keepPendingWild,
  topDiscard,
} from './state'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Returns a float in [0, 1). Injectable for deterministic tests. */
export type Rng = () => number

export type PlayStep =
  | { type: 'goDown'; melds: string[][] }
  | { type: 'extend'; meldId: string; cardId: string; side?: 'left' | 'right' }
  | { type: 'keep-wild' }
  | { type: 'discard'; cardId: string }

export interface PlayPlan {
  steps: PlayStep[]
}

export type DrawChoice = 'claim' | 'deck'

export interface HandEval {
  /** Best go-down partition as card-id arrays, or null if none. */
  goDownMelds: string[][] | null
  /** Cards used in the best go-down partition (empty if none). */
  planCardIds: Set<string>
  /** Cards that can currently extend some table meld. */
  tablePlayableIds: Set<string>
  /** Cards one natural away from extending a table run. */
  nearExtendIds: Set<string>
  /** Normalized purpose readiness in [0, 1]. */
  goDownReadiness: number
  /** Cards with a primary/backup/conditional purpose. */
  usefulIds: Set<string>
  /** Full purpose plan (pre-down) or dump-focused plan (post-down). */
  purpose: PurposePlan
}

interface CandidateMeld {
  type: 'group' | 'run'
  cards: Card[]
  ids: Set<string>
}

// ---------------------------------------------------------------------------
// Meld candidates
// ---------------------------------------------------------------------------

function combinations<T>(items: T[], k: number): T[][] {
  if (k <= 0) return [[]]
  if (k > items.length) return []
  const out: T[][] = []
  const rec = (start: number, chosen: T[]) => {
    if (chosen.length === k) {
      out.push([...chosen])
      return
    }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i])
      rec(i + 1, chosen)
      chosen.pop()
    }
  }
  rec(0, [])
  return out
}

/** All valid group candidates (size >= 3), preferring larger sets first later. */
export function findGroupCandidates(hand: Card[]): CandidateMeld[] {
  const wilds = hand.filter(isWild)
  const byNumber = new Map<number, Card[]>()
  for (const c of hand) {
    if (isWild(c)) continue
    const list = byNumber.get(c.number) ?? []
    list.push(c)
    byNumber.set(c.number, list)
  }

  const results: CandidateMeld[] = []
  const seen = new Set<string>()

  const add = (cards: Card[]) => {
    if (!isValidGroup(cards)) return
    const key = cards
      .map((c) => c.id)
      .sort()
      .join('|')
    if (seen.has(key)) return
    seen.add(key)
    results.push({
      type: 'group',
      cards,
      ids: new Set(cards.map((c) => c.id)),
    })
  }

  for (const naturals of byNumber.values()) {
    // Cap combinatorial explosion: prefer larger subsets, limit count
    const maxCombosPerSize = 12
    for (let size = naturals.length; size >= 3; size--) {
      const combos = combinations(naturals, size)
      for (const subset of combos.slice(0, maxCombosPerSize)) {
        add(subset)
      }
    }
    if (wilds.length > 0 && naturals.length >= 2) {
      // One representative wild is enough — any wild is interchangeable for validity
      const wild = wilds[0]
      for (let size = naturals.length; size >= 2; size--) {
        const combos = combinations(naturals, size)
        for (const subset of combos.slice(0, maxCombosPerSize)) {
          add([...subset, wild])
        }
      }
    }
  }

  return results
}

/**
 * All valid run candidates (size >= 4) for one color, using at most one wild.
 * Picks at most one natural per number.
 */
export function findRunCandidates(hand: Card[]): CandidateMeld[] {
  const wilds = hand.filter(isWild)
  const byColor = new Map<string, Map<number, Card[]>>()
  for (const c of hand) {
    if (isWild(c)) continue
    const color = c.color
    let byNum = byColor.get(color)
    if (!byNum) {
      byNum = new Map()
      byColor.set(color, byNum)
    }
    const list = byNum.get(c.number) ?? []
    list.push(c)
    byNum.set(c.number, list)
  }

  const results: CandidateMeld[] = []
  const seen = new Set<string>()

  const add = (cards: Card[]) => {
    if (!isValidRun(cards)) return
    const key = cards
      .map((c) => c.id)
      .sort()
      .join('|')
    if (seen.has(key)) return
    seen.add(key)
    results.push({
      type: 'run',
      cards,
      ids: new Set(cards.map((c) => c.id)),
    })
  }

  for (const byNum of byColor.values()) {
    const numbers = [...byNum.keys()].sort((a, b) => a - b)
    if (numbers.length === 0) continue

    // Enumerate contiguous number spans of length >= 4 (in value space).
    // Also spans that need one wild to fill a single gap or act as an end.
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i; j < numbers.length; j++) {
        const spanNums = numbers.slice(i, j + 1)
        const lo = spanNums[0]
        const hi = spanNums[spanNums.length - 1]
        const spanLen = hi - lo + 1
        const missing = spanLen - spanNums.length

        // No wild: need contiguous naturals covering [lo,hi] with no gaps
        if (missing === 0 && spanLen >= 4) {
          // Choose one card per number; if duplicates, try each combo lightly
          const pools = spanNums.map((n) => byNum.get(n)!)
          for (const picks of pickOneFromEach(pools)) {
            add(picks)
          }
        }

        // One wild filling exactly one missing number inside [lo,hi]
        if (missing === 1 && spanLen >= 4 && wilds.length > 0) {
          const pools = spanNums.map((n) => byNum.get(n)!)
          for (const wild of wilds) {
            for (const picks of pickOneFromEach(pools)) {
              add([...picks, wild])
            }
          }
        }

        // Wild as low end: naturals cover [lo,hi] contiguous, wild is lo-1
        if (missing === 0 && spanLen >= 3 && lo > 1 && wilds.length > 0) {
          const pools = spanNums.map((n) => byNum.get(n)!)
          for (const wild of wilds) {
            for (const picks of pickOneFromEach(pools)) {
              add([...picks, wild])
            }
          }
        }

        // Wild as high end: same
        if (missing === 0 && spanLen >= 3 && hi < 14 && wilds.length > 0) {
          const pools = spanNums.map((n) => byNum.get(n)!)
          for (const wild of wilds) {
            for (const picks of pickOneFromEach(pools)) {
              add([...picks, wild])
            }
          }
        }
      }
    }
  }

  return results
}

/** Cartesian product picking one element from each pool (cap explosion). */
function pickOneFromEach(pools: Card[][]): Card[][] {
  if (pools.length === 0) return [[]]
  // Cap: if any pool is large, just take first of each
  if (pools.some((p) => p.length > 3) || pools.length > 8) {
    return [pools.map((p) => p[0])]
  }
  let acc: Card[][] = [[]]
  for (const pool of pools) {
    const next: Card[][] = []
    for (const prefix of acc) {
      for (const card of pool) {
        next.push([...prefix, card])
      }
    }
    acc = next
    if (acc.length > 64) {
      return acc.slice(0, 64)
    }
  }
  return acc
}

export function findAllCandidates(hand: Card[]): CandidateMeld[] {
  return [...findGroupCandidates(hand), ...findRunCandidates(hand)]
}

// ---------------------------------------------------------------------------
// Go-down partition search
// ---------------------------------------------------------------------------

/**
 * Find a go-down partition that uses as many cards as possible.
 * Returns melds as card-id arrays (group/run order matching requirements
 * is validated by goDown via type detection).
 */
export function findBestGoDown(hand: Card[], roundIndex: number): string[][] | null {
  const req = ROUND_REQUIREMENTS[roundIndex]
  if (!req) return null

  const groups = findGroupCandidates(hand)
  const runs = findRunCandidates(hand)

  // Larger melds first so search finds high-card partitions early
  groups.sort((a, b) => b.cards.length - a.cards.length)
  runs.sort((a, b) => b.cards.length - a.cards.length)

  let best: CandidateMeld[] | null = null
  let bestCards = -1
  let nodes = 0
  const NODE_BUDGET = 8000

  const search = (
    needG: number,
    needR: number,
    used: Set<string>,
    chosen: CandidateMeld[],
  ) => {
    if (nodes++ > NODE_BUDGET) return
    if (needG === 0 && needR === 0) {
      const total = chosen.reduce((s, m) => s + m.cards.length, 0)
      if (total > bestCards) {
        bestCards = total
        best = [...chosen]
        // Perfect: used as many cards as possible for this requirement count
        if (bestCards >= hand.length) nodes = NODE_BUDGET + 1
      }
      return
    }

    if (needG > 0) {
      for (const g of groups) {
        if (nodes > NODE_BUDGET) return
        if (overlaps(g.ids, used)) continue
        const nextUsed = new Set(used)
        for (const id of g.ids) nextUsed.add(id)
        chosen.push(g)
        search(needG - 1, needR, nextUsed, chosen)
        chosen.pop()
      }
    }

    if (needR > 0) {
      for (const r of runs) {
        if (nodes > NODE_BUDGET) return
        if (overlaps(r.ids, used)) continue
        const nextUsed = new Set(used)
        for (const id of r.ids) nextUsed.add(id)
        chosen.push(r)
        search(needG, needR - 1, nextUsed, chosen)
        chosen.pop()
      }
    }
  }

  search(req.groups, req.runs, new Set(), [])

  if (!best) return null
  return best.map((m) => m.cards.map((c) => c.id))
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const id of a) {
    if (b.has(id)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Table / near-extend helpers
// ---------------------------------------------------------------------------

export function findTablePlayable(
  hand: Card[],
  tableMelds: Meld[],
): Map<string, string> {
  /** cardId → meldId (first match) */
  const map = new Map<string, string>()
  for (const card of hand) {
    for (const meld of tableMelds) {
      if (canExtendMeld(meld.cards, card, meld.type)) {
        map.set(card.id, meld.id)
        break
      }
    }
  }
  return map
}

/**
 * A natural is "near-extend" for a run if it sits exactly two away from an end
 * (same color), so one intermediate card would make it playable.
 */
export function isNearExtendForRun(card: Card, meld: Meld): boolean {
  if (meld.type !== 'run') return false
  if (isWild(card)) return false
  if (canExtendMeld(meld.cards, card, 'run')) return false

  const naturals = meld.cards.filter((c) => !isWild(c))
  if (naturals.length === 0) return false
  if (!naturals.every((c) => c.color === card.color)) return false

  const nums = naturals.map((c) => c.number).sort((a, b) => a - b)
  const min = nums[0]
  const max = nums[nums.length - 1]

  return card.number === min - 2 || card.number === max + 2
}

export function findNearExtendIds(hand: Card[], tableMelds: Meld[]): Set<string> {
  const ids = new Set<string>()
  for (const card of hand) {
    for (const meld of tableMelds) {
      if (isNearExtendForRun(card, meld)) {
        ids.add(card.id)
        break
      }
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// Partial progress / hand evaluation (purpose-based)
// ---------------------------------------------------------------------------

export function evaluateHand(
  hand: Card[],
  tableMelds: Meld[],
  roundIndex: number,
  hasGoneDown: boolean,
): HandEval {
  const goDownMelds = hasGoneDown ? null : findBestGoDown(hand, roundIndex)
  const planCardIds = new Set<string>()
  if (goDownMelds) {
    for (const meld of goDownMelds) {
      for (const id of meld) planCardIds.add(id)
    }
  }

  const tablePlayable = findTablePlayable(hand, tableMelds)
  const tablePlayableIds = new Set(tablePlayable.keys())
  const nearExtendIds = findNearExtendIds(hand, tableMelds)

  const purposeScores = scorePurposePlan(
    hand,
    tableMelds,
    roundIndex,
    hasGoneDown,
    !!goDownMelds,
  )
  const purpose = purposeScores.plan

  const usefulIds = new Set<string>([
    ...planCardIds,
    ...tablePlayableIds,
    ...nearExtendIds,
    ...purpose.purposefulIds,
    ...purpose.conditionalIds,
  ])

  return {
    goDownMelds,
    planCardIds,
    tablePlayableIds,
    nearExtendIds,
    goDownReadiness: purposeScores.readinessNorm,
    usefulIds,
    purpose,
  }
}

// ---------------------------------------------------------------------------
// Discard ranking
// ---------------------------------------------------------------------------

/**
 * Rank a card for discard: higher = more willing to discard.
 * Prefer throwaway / non-purpose cards, then not table-playable, then high points.
 */
export function discardScore(
  card: Card,
  eval_: HandEval,
  rng: Rng,
): number {
  let score = 0
  const isThrowaway = eval_.purpose.throwaway.some((c) => c.id === card.id)
  const isConditional = eval_.purpose.conditionalIds.has(card.id)
  if (isThrowaway) score += 1000
  if (!eval_.usefulIds.has(card.id) && !eval_.planCardIds.has(card.id)) {
    score += 400
  }
  if (!isConditional) score += 80
  if (!eval_.tablePlayableIds.has(card.id)) score += 200
  if (!eval_.nearExtendIds.has(card.id)) score += 50
  if (!eval_.planCardIds.has(card.id)) score += 30
  score += scoreCard(card)
  score += rng() * 3
  return score
}

export function pickDiscardCard(
  hand: Card[],
  eval_: HandEval,
  rng: Rng = Math.random,
): Card {
  let best = hand[0]
  let bestScore = -Infinity
  for (const card of hand) {
    const s = discardScore(card, eval_, rng)
    if (s > bestScore) {
      bestScore = s
      best = card
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Iterative extend planning
// ---------------------------------------------------------------------------

export function planExtensions(
  hand: Card[],
  tableMelds: Meld[],
  rules: WildRules = DEFAULT_WILD_RULES,
): { type: 'extend'; meldId: string; cardId: string; side?: 'left' | 'right' }[] {
  const steps: { type: 'extend'; meldId: string; cardId: string; side?: 'left' | 'right' }[] = []
  let remaining = [...hand]
  let melds: Meld[] = tableMelds.map((m) => ({
    ...m,
    cards: [...m.cards],
  }))

  let progressed = true
  while (progressed) {
    progressed = false
    outer: for (const card of remaining) {
      for (const meld of melds) {
        const allowDisplace = allowsWildDisplacement(rules, meld.type)
        const plan = planMeldPlay(meld.cards, meld.type, card, undefined, allowDisplace)
        if (!plan) continue
        if (plan.displacedWild) {
          const nextMelds = melds.map((m) =>
            m.id === meld.id ? { ...m, cards: plan.cards } : m,
          )
          const home = wildDestinations(nextMelds, plan.displacedWild, rules, meld.id)[0]
          const handOk = rules.to === 'any-meld-or-hand'
          if (!home && !handOk) continue
        }
        steps.push({ type: 'extend', meldId: meld.id, cardId: card.id, side: plan.side })
        meld.cards = plan.cards
        remaining = remaining.filter((c) => c.id !== card.id)
        if (plan.displacedWild) {
          const nextMelds = melds.map((m) => ({ ...m, cards: [...m.cards] }))
          const home = wildDestinations(nextMelds, plan.displacedWild, rules, meld.id)[0]
          if (home) {
            const dest = melds.find((m) => m.id === home.meldId)
            if (dest) {
              const placed = planMeldPlay(dest.cards, dest.type, plan.displacedWild, home.side, false)
              if (placed) {
                steps.push({
                  type: 'extend',
                  meldId: home.meldId,
                  cardId: plan.displacedWild.id,
                  side: home.side,
                })
                dest.cards = placed.cards
              }
            }
          }
        }
        progressed = true
        break outer
      }
    }
  }
  return steps
}

// ---------------------------------------------------------------------------
// Public decisions
// ---------------------------------------------------------------------------

export function decidePlay(
  state: GameState,
  rng: Rng = Math.random,
  rules: WildRules = DEFAULT_WILD_RULES,
): PlayPlan {
  if (state.pendingWild) {
    const home = wildDestinations(
      state.tableMetlds,
      state.pendingWild,
      rules,
      state.extendHistory[state.extendHistory.length - 1]?.meldId ?? '',
    )[0]
    if (home) {
      return {
        steps: [{
          type: 'extend',
          meldId: home.meldId,
          cardId: state.pendingWild.id,
          side: home.side,
        }],
      }
    }
    if (rules.to === 'any-meld-or-hand') return { steps: [{ type: 'keep-wild' }] }
    return { steps: [] }
  }

  const player = state.players[state.currentPlayerIndex]
  const label = `${player.displayName}#${player.index}`
  const steps: PlayStep[] = []

  let hand = [...player.hand]
  let tableMelds: Meld[] = state.tableMetlds.map((m) => ({
    ...m,
    cards: [...m.cards],
  }))
  let hasGoneDown = player.hasGoneDown

  if (!hasGoneDown) {
    const partition = findBestGoDown(hand, state.roundIndex)
    if (partition) {
      steps.push({ type: 'goDown', melds: partition })
      const used = new Set(partition.flat())
      let counter = state.meldIdCounter
      const meldSummaries: string[] = []
      for (const ids of partition) {
        const cards = ids.map((id) => hand.find((c) => c.id === id)!)
        const type: 'group' | 'run' = isValidGroup(cards) ? 'group' : 'run'
        meldSummaries.push(`${type}[${formatCards(cards)}]`)
        tableMelds.push({
          id: `meld_${counter++}`,
          ownerIndex: state.currentPlayerIndex,
          type,
          cards,
        })
      }
      hand = hand.filter((c) => !used.has(c.id))
      hasGoneDown = true
      aiLog({
        playerLabel: label,
        decision: 'goDown',
        reason: `Can fulfill round ${state.roundIndex + 1} with ${partition.length} meld(s), maximizing ${used.size} cards`,
        hand: player.hand,
        details: {
          melds: meldSummaries,
          leftover: formatHandShort(hand),
          purpose: evaluateHand(player.hand, state.tableMetlds, state.roundIndex, false)
            .purpose.summary,
        },
      })
    } else {
      const purpose = evaluateHand(
        hand,
        state.tableMetlds,
        state.roundIndex,
        false,
      ).purpose
      aiLog({
        playerLabel: label,
        decision: 'skipGoDown',
        reason: `No legal partition for round ${state.roundIndex + 1}`,
        hand,
        details: { handSize: hand.length, purpose: purpose.summary },
      })
    }
  }

  if (hasGoneDown && hand.length > 0) {
    const ext = planExtensions(hand, tableMelds, rules)
    for (const step of ext) {
      steps.push(step)
      const card = hand.find((c) => c.id === step.cardId)
      if (!card) continue
      const handBefore = hand
      hand = hand.filter((c) => c.id !== step.cardId)
      const meld = tableMelds.find((m) => m.id === step.meldId)!
      aiLog({
        playerLabel: label,
        decision: 'extend',
        reason: `Play ${formatCardShort(card)} onto ${meld.type} ${meld.id}`,
        hand: handBefore,
        target: card,
        details: {
          meldCards: formatCards(meld.cards),
          afterSize: meld.cards.length + 1,
        },
      })
      meld.cards = [...meld.cards, card]
    }
    if (ext.length === 0) {
      aiLog({
        playerLabel: label,
        decision: 'skipExtend',
        reason: 'No legal extends on table melds',
        hand,
        details: { handSize: hand.length, tableMelds: tableMelds.length },
      })
    }
  }

  if (hand.length > 0) {
    const eval_ = evaluateHand(hand, tableMelds, state.roundIndex, hasGoneDown)
    const card = pickDiscardCard(hand, eval_, rng)
    steps.push({ type: 'discard', cardId: card.id })

    const reasons: string[] = []
    if (!eval_.usefulIds.has(card.id) && !eval_.planCardIds.has(card.id)) {
      reasons.push('dead to plan')
    }
    if (!eval_.tablePlayableIds.has(card.id)) reasons.push('not table-playable')
    else reasons.push('WARNING table-playable')
    if (!eval_.nearExtendIds.has(card.id)) reasons.push('not near-extend')
    else reasons.push('WARNING near-extend')
    reasons.push(`${scoreCard(card)} pts`)

    aiLog({
      playerLabel: label,
      decision: 'discard',
      reason: `Discard ${formatCardShort(card)} (${reasons.join('; ')})`,
      hand,
      target: card,
      details: {
        useful: [...eval_.usefulIds],
        tablePlayable: [...eval_.tablePlayableIds],
        nearExtend: [...eval_.nearExtendIds],
        remainingHand: formatHandShort(hand.filter((c) => c.id !== card.id)),
      },
    })
  }

  return { steps }
}

interface AcquisitionBreakdown {
  value: number
  completesGoDown: boolean
  readinessBefore: number
  readinessAfter: number
  readinessDelta: number
  versatilityDelta: number
  overplayDelta: number
  purposeSummaryBefore: string
  purposeSummaryAfter: string
}

function cardAcquisitionBreakdown(
  card: Card,
  hand: Card[],
  tableMelds: Meld[],
  roundIndex: number,
  hasGoneDown: boolean,
): AcquisitionBreakdown {
  const canBefore =
    !hasGoneDown && !!findBestGoDown(hand, roundIndex)
  const canAfter =
    !hasGoneDown && !!findBestGoDown([...hand, card], roundIndex)
  const acq = purposeAcquisitionValue(
    card,
    hand,
    tableMelds,
    roundIndex,
    hasGoneDown,
    canBefore,
    canAfter,
  )
  return {
    value: acq.value,
    completesGoDown: acq.completesGoDown,
    readinessBefore: acq.readinessBefore,
    readinessAfter: acq.readinessAfter,
    readinessDelta: acq.readinessDelta,
    versatilityDelta: acq.versatilityDelta,
    overplayDelta: acq.overplayDelta,
    purposeSummaryBefore: acq.before.plan.summary,
    purposeSummaryAfter: acq.after.plan.summary,
  }
}

const PENALTY_COST = 10
const HAND_BLOAT_SOFT = 14
/** Base buy threshold — pair-only versatility bumps should not clear this. */
const BUY_THRESHOLD_BASE = 16
/** Claim if readiness gains at least one group-card unit (2 pts). */
const MIN_CLAIM_READINESS_DELTA = 2

export function decideBuy(state: GameState, buyerIndex: number): boolean {
  if (!canBuyDiscard(state, buyerIndex)) return false
  const top = topDiscard(state)
  if (!top) return false

  const player = state.players[buyerIndex]
  if (!player.isAI) return false

  const label = `${player.displayName}#${player.index}`
  const breakdown = cardAcquisitionBreakdown(
    top,
    player.hand,
    state.tableMetlds,
    state.roundIndex,
    player.hasGoneDown,
  )

  let threshold = BUY_THRESHOLD_BASE
  let thresholdNote = `base ${threshold} (penalty~${PENALTY_COST})`
  if (player.hand.length >= HAND_BLOAT_SOFT) {
    const bloat = (player.hand.length - HAND_BLOAT_SOFT + 1) * 3
    threshold += bloat
    thresholdNote = `bloated hand ${player.hand.length} → threshold ${threshold}`
  }
  if (player.hasGoneDown) {
    threshold = PENALTY_COST + 2
    thresholdNote = `already down → threshold ${threshold}`
  }

  const buy = breakdown.value >= threshold
  const whyParts: string[] = []
  if (breakdown.completesGoDown) whyParts.push('completes go-down')
  if (breakdown.readinessDelta > 0) {
    whyParts.push(
      `readiness ${breakdown.readinessBefore}→${breakdown.readinessAfter}`,
    )
  }
  if (breakdown.versatilityDelta > 0) {
    whyParts.push(`versatility +${breakdown.versatilityDelta}`)
  }
  if (breakdown.overplayDelta > 0.01) {
    whyParts.push(`overplay +${breakdown.overplayDelta.toFixed(2)}`)
  }
  if (whyParts.length === 0) whyParts.push('low purpose gain')

  aiLog({
    playerLabel: label,
    decision: buy ? 'buy' : 'skipBuy',
    reason: `${buy ? 'Buy' : 'Skip'} ${formatCardShort(top)}: acquire ${breakdown.value.toFixed(1)} vs ${thresholdNote}; ${whyParts.join(', ')}`,
    hand: player.hand,
    target: top,
    details: {
      acquireValue: Number(breakdown.value.toFixed(2)),
      threshold,
      handSize: player.hand.length,
      hasGoneDown: player.hasGoneDown,
      purposeBefore: breakdown.purposeSummaryBefore,
      purposeAfter: breakdown.purposeSummaryAfter,
      readinessDelta: breakdown.readinessDelta,
      versatilityDelta: breakdown.versatilityDelta,
      overplayDelta: Number(breakdown.overplayDelta.toFixed(3)),
      completesGoDown: breakdown.completesGoDown,
    },
  })

  return buy
}

export function decideDraw(state: GameState): DrawChoice {
  const top = topDiscard(state)
  const player = state.players[state.currentPlayerIndex]
  const label = `${player.displayName}#${player.index}`

  if (!top) {
    aiLog({
      playerLabel: label,
      decision: 'drawDeck',
      reason: 'No discard to claim',
      hand: player.hand,
    })
    return 'deck'
  }

  const breakdown = cardAcquisitionBreakdown(
    top,
    player.hand,
    state.tableMetlds,
    state.roundIndex,
    player.hasGoneDown,
  )

  const evalAfter = evaluateHand(
    [...player.hand, top],
    state.tableMetlds,
    state.roundIndex,
    player.hasGoneDown,
  )

  let choice: DrawChoice = 'deck'
  let reason = `Discard ${formatCardShort(top)} not useful enough (acquire ${breakdown.value.toFixed(1)}); draw deck`

  if (breakdown.completesGoDown) {
    choice = 'claim'
    reason = `Claim ${formatCardShort(top)}: completes go-down`
  } else if (!player.hasGoneDown && breakdown.readinessDelta >= MIN_CLAIM_READINESS_DELTA) {
    choice = 'claim'
    reason = `Claim ${formatCardShort(top)}: readiness ${breakdown.readinessBefore}→${breakdown.readinessAfter}`
  } else if (player.hasGoneDown || breakdown.completesGoDown || evalAfter.goDownMelds) {
    if (evalAfter.tablePlayableIds.has(top.id)) {
      choice = 'claim'
      reason = `Claim ${formatCardShort(top)}: already/about to be down and table-playable`
    } else if (breakdown.value >= 12) {
      choice = 'claim'
      reason = `Claim ${formatCardShort(top)}: down/near-down and acquire ${breakdown.value.toFixed(1)} >= 12`
    }
  }

  if (choice === 'deck') {
    const onlyLater =
      !player.hasGoneDown &&
      !evalAfter.goDownMelds &&
      breakdown.readinessDelta <= 0 &&
      (evalAfter.tablePlayableIds.has(top.id) || evalAfter.nearExtendIds.has(top.id)) &&
      breakdown.readinessAfter < breakdown.readinessBefore + 1 &&
      evalAfter.purpose.readinessNorm < 0.7

    if (onlyLater) {
      reason = `Skip claim of ${formatCardShort(top)}: only later-dump value while readiness still low; hunt deck`
    } else if (breakdown.value >= 14) {
      choice = 'claim'
      reason = `Claim ${formatCardShort(top)}: general acquire ${breakdown.value.toFixed(1)} >= 14`
    }
  }

  aiLog({
    playerLabel: label,
    decision: choice === 'claim' ? 'claimDiscard' : 'drawDeck',
    reason,
    hand: player.hand,
    target: top,
    details: {
      acquireValue: Number(breakdown.value.toFixed(2)),
      readinessDelta: breakdown.readinessDelta,
      versatilityDelta: breakdown.versatilityDelta,
      overplayDelta: Number(breakdown.overplayDelta.toFixed(3)),
      purposeBefore: breakdown.purposeSummaryBefore,
      purposeAfter: breakdown.purposeSummaryAfter,
      hasGoneDown: player.hasGoneDown,
    },
  })

  return choice
}

// ---------------------------------------------------------------------------
// Timing helpers (ms)
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Skewed buy delay: sometimes quick, sometimes slow. */
export function sampleBuyDelayMs(rng: Rng = Math.random): number {
  const r = rng()
  if (r < 0.3) return Math.round(lerp(400, 900, rng()))
  if (r < 0.8) return Math.round(lerp(1000, 2200, rng()))
  return Math.round(lerp(2200, 3500, rng()))
}

/** How long current AI waits before claim/draw (lets buys land). */
export function sampleDrawWindowMs(rng: Rng = Math.random): number {
  return Math.round(lerp(2500, 3500, rng()))
}

/** Short think pause before play actions. */
export function sampleThinkDelayMs(rng: Rng = Math.random): number {
  return Math.round(lerp(400, 800, rng()))
}

/**
 * Applies one AI decision burst for the current situation:
 * - buy-window: every willing AI calls buy, then the current AI claims or draws
 * - play-or-discard: full decidePlay plan (go down, extends, discard)
 */
export function runAIStep(state: GameState): GameState {
  if (state.phase === 'buy-window') {
    let s = state
    for (const p of s.players) {
      if (!p.isAI) continue
      if (decideBuy(s, p.index)) {
        s = declareBuy(s, p.index)
      }
    }
    const current = s.players[s.currentPlayerIndex]
    if (current.isAI) {
      return decideDraw(s) === 'claim'
        ? claimDiscardAsDraw(s)
        : drawFromDeck(s)
    }
    return s
  }

  if (state.phase === 'draw') {
    const current = state.players[state.currentPlayerIndex]
    if (!current.isAI) return state
    return drawFromDeck(state)
  }

  if (state.phase === 'play-or-discard') {
    const current = state.players[state.currentPlayerIndex]
    if (!current.isAI) return state
    const plan = decidePlay(state)
    let s = state
    for (const step of plan.steps) {
      if (s.phase !== 'play-or-discard') break
      if (step.type === 'goDown') s = goDown(s, step.melds)
      else if (step.type === 'extend') s = extendMeld(s, step.meldId, step.cardId, step.side)
      else if (step.type === 'keep-wild') s = keepPendingWild(s)
      else if (step.type === 'discard') s = discard(s, step.cardId)
      if (s.lastError) break
    }
    return s
  }

  return state
}
