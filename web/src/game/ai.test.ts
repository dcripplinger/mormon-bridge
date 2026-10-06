import { describe, it, expect } from 'vitest'
import type { Card } from './card'
import {
  decideBuy,
  decideDraw,
  decidePlay,
  findBestGoDown,
  findNearExtendIds,
  findTablePlayable,
  isNearExtendForRun,
  planExtensions,
  pickDiscardCard,
  evaluateHand,
  runAIStep,
} from './ai'
import type { GameState, Meld, PlayerState } from './state'
import {
  buyDiscard,
  canBuyDiscard,
  claimDiscardAsDraw,
  createGame,
  discard,
  drawFromDeck,
  extendMeld,
  goDown,
} from './state'

function card(id: string, color: Card['color'], number: number): Card {
  return { id, color, number }
}

function player(index: number, hand: Card[], extras: Partial<PlayerState> = {}): PlayerState {
  return {
    index,
    displayName: `P${index + 1}`,
    isAI: true,
    avatarId: `b${String((index % 8) + 1).padStart(2, '0')}`,
    hand,
    hasGoneDown: false,
    cumulativeScore: 0,
    ...extras,
  }
}

function stubState(opts: {
  hand: Card[]
  hasGoneDown?: boolean
  tableMetlds?: Meld[]
  roundIndex?: number
  phase?: GameState['phase']
  discardPile?: Card[]
  currentPlayerIndex?: number
  players?: PlayerState[]
  lastDiscarderIndex?: number | null
  hasDrawnThisTurn?: boolean
}): GameState {
  const {
    hand,
    hasGoneDown = false,
    tableMetlds = [],
    roundIndex = 0,
    phase = 'play-or-discard',
    discardPile = [card('disc1', 'black', 4)],
    currentPlayerIndex = 0,
    lastDiscarderIndex = null,
    hasDrawnThisTurn = true,
  } = opts

  const players = opts.players ?? [
    player(0, hand, { hasGoneDown }),
    player(1, [card('other1', 'red', 1)]),
    player(2, [card('other2', 'yellow', 2)]),
  ]

  return {
    players,
    drawPile: [
      card('deck1', 'green', 3),
      card('deck2', 'green', 4),
      card('deck3', 'green', 5),
    ],
    discardPile,
    tableMetlds,
    roundIndex,
    currentPlayerIndex,
    phase,
    hasDrawnThisTurn,
    lastDiscarderIndex,
    meldIdCounter: tableMetlds.length,
    lastError: null,
  }
}

const rng0 = () => 0

describe('findBestGoDown', () => {
  it('finds 2 groups for round 1', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      card('c', 'green', 5),
      card('d', 'red', 9),
      card('e', 'yellow', 9),
      card('f', 'black', 9),
      card('g', 'red', 1),
    ]
    const partition = findBestGoDown(hand, 0)
    expect(partition).not.toBeNull()
    expect(partition!).toHaveLength(2)
    const used = partition!.flat()
    expect(used).toHaveLength(6)
  })

  it('maximizes cards: includes 4th card in a group', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      card('c', 'green', 5),
      card('d', 'black', 5), // 4th of a kind
      card('e', 'red', 9),
      card('f', 'yellow', 9),
      card('g', 'black', 9),
    ]
    const partition = findBestGoDown(hand, 0)
    expect(partition).not.toBeNull()
    const sizes = partition!.map((m) => m.length).sort((a, b) => a - b)
    expect(sizes).toEqual([3, 4])
  })

  it('uses a wild to complete go-down', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      card('w', 'wild', 0),
      card('d', 'red', 9),
      card('e', 'yellow', 9),
      card('f', 'black', 9),
    ]
    const partition = findBestGoDown(hand, 0)
    expect(partition).not.toBeNull()
    expect(partition!.flat()).toContain('w')
  })

  it('returns null when hand cannot go down', () => {
    const hand = [
      card('a', 'red', 1),
      card('b', 'yellow', 2),
      card('c', 'green', 3),
    ]
    expect(findBestGoDown(hand, 0)).toBeNull()
  })

  it('finds group + run for round 2', () => {
    const hand = [
      card('a', 'red', 7),
      card('b', 'yellow', 7),
      card('c', 'green', 7),
      card('d', 'red', 2),
      card('e', 'red', 3),
      card('f', 'red', 4),
      card('g', 'red', 5),
      card('h', 'black', 1),
    ]
    const partition = findBestGoDown(hand, 1)
    expect(partition).not.toBeNull()
    expect(partition!).toHaveLength(2)
  })
})

describe('near-extend and table playable', () => {
  const runMeld: Meld = {
    id: 'm1',
    ownerIndex: 1,
    type: 'run',
    cards: [
      card('r5', 'red', 5),
      card('r6', 'red', 6),
      card('r7', 'red', 7),
      card('r8', 'red', 8),
    ],
  }

  it('detects immediately playable end cards', () => {
    const hand = [card('r9', 'red', 9), card('r4', 'red', 4)]
    const map = findTablePlayable(hand, [runMeld])
    expect(map.has('r9')).toBe(true)
    expect(map.has('r4')).toBe(true)
  })

  it('detects near-extend two away from ends', () => {
    const hand = [card('r10', 'red', 10), card('r3', 'red', 3), card('r9', 'red', 9)]
    expect(isNearExtendForRun(hand[0], runMeld)).toBe(true)
    expect(isNearExtendForRun(hand[1], runMeld)).toBe(true)
    expect(isNearExtendForRun(hand[2], runMeld)).toBe(false) // playable, not near
    const ids = findNearExtendIds(hand, [runMeld])
    expect(ids.has('r10')).toBe(true)
    expect(ids.has('r3')).toBe(true)
    expect(ids.has('r9')).toBe(false)
  })
})

describe('planExtensions', () => {
  it('unlocks a second card after the first extend on a run', () => {
    const runMeld: Meld = {
      id: 'm1',
      ownerIndex: 0,
      type: 'run',
      cards: [
        card('r5', 'red', 5),
        card('r6', 'red', 6),
        card('r7', 'red', 7),
        card('r8', 'red', 8),
      ],
    }
    const hand = [card('r9', 'red', 9), card('r10', 'red', 10)]
    const steps = planExtensions(hand, [runMeld])
    expect(steps).toHaveLength(2)
    expect(steps[0].cardId).toBe('r9')
    expect(steps[1].cardId).toBe('r10')
  })
})

describe('discard ranking', () => {
  it('prefers dead 10-pt card over useful 5-pt card', () => {
    const hand = [
      card('keep', 'red', 5),
      card('keep2', 'yellow', 5),
      card('dead', 'black', 12), // 10 pts, useless
      card('low', 'green', 3), // 5 pts, also fairly useless alone
    ]
    // Round 1 needs 2 groups — 5s are a near-group
    const eval_ = evaluateHand(hand, [], 0, false)
    expect(eval_.usefulIds.has('keep')).toBe(true)
    const picked = pickDiscardCard(hand, eval_, rng0)
    expect(picked.id).toBe('dead')
  })

  it('avoids discarding table-playable when a dead card exists', () => {
    const runMeld: Meld = {
      id: 'm1',
      ownerIndex: 1,
      type: 'run',
      cards: [
        card('r5', 'red', 5),
        card('r6', 'red', 6),
        card('r7', 'red', 7),
        card('r8', 'red', 8),
      ],
    }
    const hand = [
      card('r9', 'red', 9),
      card('dead', 'black', 12),
    ]
    const eval_ = evaluateHand(hand, [runMeld], 0, false)
    const picked = pickDiscardCard(hand, eval_, rng0)
    expect(picked.id).toBe('dead')
  })
})

describe('decidePlay', () => {
  it('goes down then discards leftover', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      card('c', 'green', 5),
      card('d', 'red', 9),
      card('e', 'yellow', 9),
      card('f', 'black', 9),
      card('g', 'red', 1),
    ]
    const state = stubState({ hand, roundIndex: 0 })
    const plan = decidePlay(state, rng0)
    expect(plan.steps[0].type).toBe('goDown')
    expect(plan.steps[plan.steps.length - 1].type).toBe('discard')
    if (plan.steps[0].type === 'goDown') {
      expect(plan.steps[0].melds.flat()).toHaveLength(6)
    }
  })

  it('extends iteratively after already down', () => {
    const runMeld: Meld = {
      id: 'm1',
      ownerIndex: 0,
      type: 'run',
      cards: [
        card('r5', 'red', 5),
        card('r6', 'red', 6),
        card('r7', 'red', 7),
        card('r8', 'red', 8),
      ],
    }
    const hand = [card('r9', 'red', 9), card('r10', 'red', 10), card('dead', 'black', 12)]
    const state = stubState({ hand, hasGoneDown: true, tableMetlds: [runMeld] })
    const plan = decidePlay(state, rng0)
    const extends_ = plan.steps.filter((s) => s.type === 'extend')
    expect(extends_).toHaveLength(2)
    expect(plan.steps[plan.steps.length - 1]).toEqual({
      type: 'discard',
      cardId: 'dead',
    })
  })
})

describe('decideBuy', () => {
  it('returns false when not eligible', () => {
    const state = stubState({
      hand: [card('a', 'red', 1)],
      phase: 'buy-window',
      currentPlayerIndex: 0,
      hasDrawnThisTurn: false,
    })
    // Current player cannot buy
    expect(decideBuy(state, 0)).toBe(false)
  })

  it('buys a card that completes a group', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      // need third 5
      card('d', 'red', 9),
      card('e', 'yellow', 9),
      card('f', 'black', 9),
    ]
    const state = stubState({
      hand,
      phase: 'buy-window',
      currentPlayerIndex: 1,
      discardPile: [card('buy5', 'green', 5)],
      lastDiscarderIndex: 1,
      hasDrawnThisTurn: false,
      players: [
        player(0, hand),
        player(1, [card('x', 'red', 1)], { isAI: true }),
        player(2, [card('y', 'yellow', 2)], { isAI: true }),
      ],
    })
    // Player 0 is eligible (not current, not discarder)
    expect(canBuyDiscard(state, 0)).toBe(true)
    expect(decideBuy(state, 0)).toBe(true)
  })

  it('skips a useless card with a bloated hand', () => {
    const hand = Array.from({ length: 16 }, (_, i) =>
      card(`h${i}`, (['red', 'yellow', 'green', 'black'] as const)[i % 4], (i % 14) + 1),
    )
    const state = stubState({
      hand,
      phase: 'buy-window',
      currentPlayerIndex: 1,
      discardPile: [card('junk', 'red', 11)],
      lastDiscarderIndex: 1,
      hasDrawnThisTurn: false,
      players: [
        player(0, hand),
        player(1, [card('x', 'red', 1)]),
        player(2, [card('y', 'yellow', 2)]),
      ],
    })
    expect(decideBuy(state, 0)).toBe(false)
  })
})

describe('decideDraw', () => {
  it('claims when discard completes go-down', () => {
    const hand = [
      card('a', 'red', 5),
      card('b', 'yellow', 5),
      card('d', 'red', 9),
      card('e', 'yellow', 9),
      card('f', 'black', 9),
    ]
    const state = stubState({
      hand,
      phase: 'buy-window',
      discardPile: [card('c', 'green', 5)],
      hasDrawnThisTurn: false,
    })
    expect(decideDraw(state)).toBe('claim')
  })

  it('prefers deck when discard is only later-playable and far from go-down', () => {
    const runMeld: Meld = {
      id: 'm1',
      ownerIndex: 1,
      type: 'run',
      cards: [
        card('r5', 'red', 5),
        card('r6', 'red', 6),
        card('r7', 'red', 7),
        card('r8', 'red', 8),
      ],
    }
    const hand = [
      card('a', 'yellow', 1),
      card('b', 'green', 3),
      card('c', 'black', 11),
    ]
    const state = stubState({
      hand,
      tableMetlds: [runMeld],
      phase: 'buy-window',
      discardPile: [card('r9', 'red', 9)],
      hasDrawnThisTurn: false,
    })
    expect(decideDraw(state)).toBe('deck')
  })
})

describe('smoke: all-AI game progresses', () => {
  it('someone goes down within a bounded number of decisions', () => {
    let state = createGame([
      { displayName: 'Bot1', isAI: true, avatarId: 'b01' },
      { displayName: 'Bot2', isAI: true, avatarId: 'b02' },
      { displayName: 'Bot3', isAI: true, avatarId: 'b03' },
    ])

    let decisions = 0
    const maxDecisions = 400
    let sawGoDown = false

    while (
      state.phase !== 'game-end' &&
      decisions < maxDecisions
    ) {
      if (state.phase === 'round-end') break

      if (state.phase === 'buy-window' || state.phase === 'draw') {
        let bought = false
        for (const p of state.players) {
          if (decideBuy(state, p.index)) {
            state = buyDiscard(state, p.index)
            bought = true
            break
          }
        }
        if (!bought) {
          const choice = decideDraw(state)
          state = choice === 'claim' ? claimDiscardAsDraw(state) : drawFromDeck(state)
        }
        decisions++
        continue
      }

      if (state.phase === 'play-or-discard') {
        const beforeDown = state.players.map((p) => p.hasGoneDown)
        const plan = decidePlay(state, rng0)
        for (const step of plan.steps) {
          if (state.phase !== 'play-or-discard') break
          if (step.type === 'goDown') {
            state = goDown(state, step.melds)
          } else if (step.type === 'extend') {
            state = extendMeld(state, step.meldId, step.cardId)
          } else if (step.type === 'discard') {
            state = discard(state, step.cardId)
          }
          if (state.lastError) {
            throw new Error(`AI move failed: ${state.lastError} step=${JSON.stringify(step)}`)
          }
        }
        if (state.players.some((p, i) => p.hasGoneDown && !beforeDown[i])) {
          sawGoDown = true
        }
        if (state.roundIndex > 0) {
          sawGoDown = true
        }
        decisions++
        continue
      }

      break
    }

    expect(sawGoDown).toBe(true)
  })

  it('runAIStep drives an all-AI game through at least one full round', () => {
    let state = createGame([
      { displayName: 'Bot1', isAI: true, avatarId: 'b01' },
      { displayName: 'Bot2', isAI: true, avatarId: 'b02' },
      { displayName: 'Bot3', isAI: true, avatarId: 'b03' },
      { displayName: 'Bot4', isAI: true, avatarId: 'b04' },
    ])

    let steps = 0
    while (state.roundIndex === 0 && state.phase !== 'game-end' && steps < 800) {
      const beforeRound = state.roundIndex
      const beforePhase = state.phase
      const beforePlayer = state.currentPlayerIndex
      const beforeHandLens = state.players.map((p) => p.hand.length)
      state = runAIStep(state)
      const unchanged =
        state.roundIndex === beforeRound &&
        state.phase === beforePhase &&
        state.currentPlayerIndex === beforePlayer &&
        state.players.every((p, i) => p.hand.length === beforeHandLens[i])
      if (unchanged || state.lastError) {
        if (state.phase === 'buy-window' || state.phase === 'draw') {
          state = drawFromDeck(state)
        } else {
          break
        }
      }
      steps++
    }

    expect(state.roundIndex > 0 || state.phase === 'game-end').toBe(true)
  })
})
