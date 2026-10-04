/**
 * Thin persistence layer over @capacitor/preferences.
 * On web, Preferences falls back to localStorage automatically.
 * All values are JSON-serialised; each record includes a schema version so
 * stale/incompatible saves are silently discarded rather than crashing.
 */

import { Preferences } from '@capacitor/preferences'
import type { GameState } from '../game/state'
import type { GameSettings, SeatDraft, WildMoveFrom, WildMoveTo } from './types'

// ---------------------------------------------------------------------------
// Schema versions – bump whenever the stored shape changes incompatibly
// ---------------------------------------------------------------------------

const PREFS_VERSION = 1
const GAME_VERSION = 1

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const KEY_PREFS = 'mb:prefs'
const KEY_ACTIVE_GAME = 'mb:active-game'

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

interface StoredPrefs {
  version: number
  seats: SeatDraft[]
  settings: GameSettings
}

interface StoredActiveGame {
  version: number
  state: GameState
}

// ---------------------------------------------------------------------------
// Validation guards
// ---------------------------------------------------------------------------

const VALID_WILD_FROM: WildMoveFrom[] = ['runs', 'runs-or-groups', 'nowhere']
const VALID_WILD_TO: WildMoveTo[] = ['any-meld', 'any-meld-or-hand', 'same-meld']

function isValidSettings(s: unknown): s is GameSettings {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  return (
    VALID_WILD_FROM.includes(o.wildMoveFrom as WildMoveFrom) &&
    VALID_WILD_TO.includes(o.wildMoveTo as WildMoveTo)
  )
}

function isValidSeat(s: unknown): s is SeatDraft {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  return (
    (o.kind === 'human' || o.kind === 'bot') &&
    typeof o.avatarId === 'string' &&
    o.avatarId.length > 0
  )
}

// ---------------------------------------------------------------------------
// Prefs (seats + game settings)
// ---------------------------------------------------------------------------

/** Load previously saved seat config and game settings, or null if absent/invalid. */
export async function loadPrefs(): Promise<{
  seats: SeatDraft[]
  settings: GameSettings
} | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_PREFS })
    if (!value) return null
    const parsed: StoredPrefs = JSON.parse(value)
    if (parsed.version !== PREFS_VERSION) return null
    if (!Array.isArray(parsed.seats) || parsed.seats.length === 0) return null
    if (!parsed.seats.every(isValidSeat)) return null
    if (!isValidSettings(parsed.settings)) return null
    return { seats: parsed.seats, settings: parsed.settings }
  } catch {
    return null
  }
}

/** Persist seats and game settings. */
export async function savePrefs(seats: SeatDraft[], settings: GameSettings): Promise<void> {
  const payload: StoredPrefs = { version: PREFS_VERSION, seats, settings }
  await Preferences.set({ key: KEY_PREFS, value: JSON.stringify(payload) })
}

// ---------------------------------------------------------------------------
// Active game
// ---------------------------------------------------------------------------

/** Load an in-progress GameState, or null if absent/version-mismatch. */
export async function loadActiveGame(): Promise<GameState | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_ACTIVE_GAME })
    if (!value) return null
    const parsed: StoredActiveGame = JSON.parse(value)
    if (parsed.version !== GAME_VERSION) return null
    if (!parsed.state || !Array.isArray(parsed.state.players)) return null
    return parsed.state
  } catch {
    return null
  }
}

/** Persist the current GameState (fire-and-forget; errors are swallowed). */
export async function saveActiveGame(state: GameState): Promise<void> {
  const payload: StoredActiveGame = { version: GAME_VERSION, state }
  await Preferences.set({ key: KEY_ACTIVE_GAME, value: JSON.stringify(payload) })
}

/** Remove the active-game entry (call on Quit or when the game ends). */
export async function clearActiveGame(): Promise<void> {
  await Preferences.remove({ key: KEY_ACTIVE_GAME })
}
