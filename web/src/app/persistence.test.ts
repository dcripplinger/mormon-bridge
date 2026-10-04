/**
 * Tests for the persistence module.
 * @capacitor/preferences is mocked to use a plain in-memory map so these
 * tests run in Node/Vitest without Capacitor or localStorage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @capacitor/preferences with a simple in-memory store
// ---------------------------------------------------------------------------

const store = new Map<string, string>()

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }) =>
      Promise.resolve({ value: store.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }) => {
      store.set(key, value)
      return Promise.resolve()
    },
    remove: ({ key }: { key: string }) => {
      store.delete(key)
      return Promise.resolve()
    },
  },
}))

// Import AFTER mock is set up
import {
  clearActiveGame,
  loadActiveGame,
  loadPrefs,
  saveActiveGame,
  savePrefs,
} from './persistence'
import type { GameState } from '../game/state'
import type { GameSettings, SeatDraft } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultSeats: SeatDraft[] = [
  { kind: 'human', avatarId: 'avatar-1' },
  { kind: 'bot', avatarId: 'avatar-2' },
  { kind: 'bot', avatarId: 'avatar-3' },
]

const defaultSettings: GameSettings = {
  wildMoveFrom: 'runs',
  wildMoveTo: 'any-meld',
}

/** Minimal valid GameState for testing — just enough fields that persistence validates. */
function stubGameState(): GameState {
  return {
    players: [
      {
        index: 0,
        displayName: 'You',
        isAI: false,
        avatarId: 'avatar-1',
        hand: [],
        hasGoneDown: false,
        cumulativeScore: 0,
      },
    ],
    drawPile: [],
    discardPile: [],
    tableMetlds: [],
    roundIndex: 0,
    currentPlayerIndex: 0,
    phase: 'draw',
    hasDrawnThisTurn: false,
    lastDiscarderIndex: null,
    meldIdCounter: 0,
    lastError: null,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  store.clear()
})

describe('prefs', () => {
  it('returns null when nothing is stored', async () => {
    expect(await loadPrefs()).toBeNull()
  })

  it('round-trips seats and settings', async () => {
    await savePrefs(defaultSeats, defaultSettings)
    const loaded = await loadPrefs()
    expect(loaded).not.toBeNull()
    expect(loaded?.seats).toEqual(defaultSeats)
    expect(loaded?.settings).toEqual(defaultSettings)
  })

  it('rejects a mismatched schema version', async () => {
    store.set('mb:prefs', JSON.stringify({ version: 999, seats: defaultSeats, settings: defaultSettings }))
    expect(await loadPrefs()).toBeNull()
  })

  it('rejects an empty seats array', async () => {
    store.set('mb:prefs', JSON.stringify({ version: 1, seats: [], settings: defaultSettings }))
    expect(await loadPrefs()).toBeNull()
  })

  it('rejects a seat with an unknown kind', async () => {
    const badSeats = [{ kind: 'alien', avatarId: 'x' }]
    store.set('mb:prefs', JSON.stringify({ version: 1, seats: badSeats, settings: defaultSettings }))
    expect(await loadPrefs()).toBeNull()
  })

  it('rejects invalid settings values', async () => {
    const badSettings = { wildMoveFrom: 'anywhere', wildMoveTo: 'any-meld' }
    store.set('mb:prefs', JSON.stringify({ version: 1, seats: defaultSeats, settings: badSettings }))
    expect(await loadPrefs()).toBeNull()
  })

  it('rejects corrupted JSON', async () => {
    store.set('mb:prefs', 'not-json')
    expect(await loadPrefs()).toBeNull()
  })

  it('stores all valid WildMoveFrom values', async () => {
    for (const from of ['runs', 'runs-or-groups', 'nowhere'] as const) {
      await savePrefs(defaultSeats, { wildMoveFrom: from, wildMoveTo: 'any-meld' })
      const loaded = await loadPrefs()
      expect(loaded?.settings.wildMoveFrom).toBe(from)
    }
  })
})

describe('active game', () => {
  it('returns null when nothing is stored', async () => {
    expect(await loadActiveGame()).toBeNull()
  })

  it('round-trips a GameState', async () => {
    const gs = stubGameState()
    await saveActiveGame(gs)
    const loaded = await loadActiveGame()
    expect(loaded).not.toBeNull()
    expect(loaded?.roundIndex).toBe(gs.roundIndex)
    expect(loaded?.players[0].displayName).toBe('You')
  })

  it('rejects a mismatched schema version', async () => {
    store.set('mb:active-game', JSON.stringify({ version: 999, state: stubGameState() }))
    expect(await loadActiveGame()).toBeNull()
  })

  it('rejects a state without a players array', async () => {
    store.set('mb:active-game', JSON.stringify({ version: 1, state: { roundIndex: 0 } }))
    expect(await loadActiveGame()).toBeNull()
  })

  it('rejects corrupted JSON', async () => {
    store.set('mb:active-game', '{{bad')
    expect(await loadActiveGame()).toBeNull()
  })

  it('clearActiveGame removes the stored entry', async () => {
    await saveActiveGame(stubGameState())
    await clearActiveGame()
    expect(await loadActiveGame()).toBeNull()
  })

  it('clearActiveGame is a no-op when nothing is stored', async () => {
    await expect(clearActiveGame()).resolves.toBeUndefined()
  })
})
