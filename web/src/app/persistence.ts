/**
 * Thin persistence layer over @capacitor/preferences.
 * On web, Preferences falls back to localStorage automatically.
 * All values are JSON-serialised; each record includes a schema version so
 * stale/incompatible saves are silently discarded rather than crashing.
 */

import { Preferences } from '@capacitor/preferences'
import { getAvatar, pickFreeAvatar } from '../avatars/catalog'
import type { BuyIntent, GameState } from '../game/state'
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
const KEY_ONLINE_PROFILE = 'mb:online-profile'
const KEY_ONLINE_RECONNECT = 'mb:online-reconnect'
const ONLINE_PROFILE_VERSION = 1
const ONLINE_RECONNECT_VERSION = 1

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

export interface OnlineProfile {
  displayName: string
  avatarId: string
}

interface StoredOnlineProfile {
  version: number
  displayName: string
  avatarId: string
}

/** Durable reconnect token so a second browser tab can take over the same seat. */
export interface OnlineReconnect {
  roomCode: string
  reconnectToken: string
  displayName: string
  avatarId: string
}

interface StoredOnlineReconnect {
  version: number
  roomCode: string
  reconnectToken: string
  displayName: string
  avatarId: string
}

function parseOnlineReconnect(raw: unknown): OnlineReconnect | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<StoredOnlineReconnect>
  if (o.version !== ONLINE_RECONNECT_VERSION) return null
  if (
    typeof o.roomCode !== 'string'
    || typeof o.reconnectToken !== 'string'
    || typeof o.displayName !== 'string'
    || typeof o.avatarId !== 'string'
  ) {
    return null
  }
  if (!o.roomCode || !o.reconnectToken || !o.displayName.trim() || !o.avatarId) {
    return null
  }
  return {
    roomCode: o.roomCode,
    reconnectToken: o.reconnectToken,
    displayName: o.displayName,
    avatarId: o.avatarId,
  }
}

// ---------------------------------------------------------------------------
// Validation guards
// ---------------------------------------------------------------------------

const VALID_WILD_FROM: WildMoveFrom[] = ['runs', 'runs-or-groups', 'nowhere']
const VALID_WILD_TO: WildMoveTo[] = ['any-meld', 'any-meld-or-hand', 'same-meld']

/** Accept BuyIntent[] or legacy number[] (first-caller order → increasing elapsedMs). */
function normalizeBuyIntents(raw: unknown): BuyIntent[] {
  if (!Array.isArray(raw)) return []
  const out: BuyIntent[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item === 'number' && Number.isInteger(item) && item >= 0) {
      out.push({ playerIndex: item, elapsedMs: i })
      continue
    }
    if (
      item
      && typeof item === 'object'
      && Number.isInteger((item as BuyIntent).playerIndex)
      && Number.isFinite((item as BuyIntent).elapsedMs)
      && (item as BuyIntent).elapsedMs >= 0
    ) {
      out.push({
        playerIndex: (item as BuyIntent).playerIndex,
        elapsedMs: (item as BuyIntent).elapsedMs,
      })
    }
  }
  return out
}

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

/**
 * Single-player only: seat 0 is always the human ("You"); every other seat is a bot.
 * Coerces kind + avatar so older prefs that allowed extra humans still load cleanly.
 */
export function normalizeSeats(seats: SeatDraft[]): SeatDraft[] {
  const result: SeatDraft[] = []
  for (let i = 0; i < seats.length; i++) {
    const kind = i === 0 ? 'human' : 'bot'
    const taken = result.map((s) => s.avatarId)
    const current = seats[i]
    const avatar = getAvatar(current.avatarId)
    const avatarOk =
      avatar?.kind === kind && !taken.includes(current.avatarId)
    result.push({
      kind,
      avatarId: avatarOk ? current.avatarId : pickFreeAvatar(kind, taken),
    })
  }
  return result
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
    return { seats: normalizeSeats(parsed.seats), settings: parsed.settings }
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
    // Single-player: only seat 0 is human; coerce older multi-human saves.
    const players = parsed.state.players.map((p, i) => ({
      ...p,
      isAI: i !== 0,
      roundScores: Array.isArray(p.roundScores) ? p.roundScores : [],
    }))
    const ready = Array.isArray(parsed.state.ready) ? parsed.state.ready : []
    const storedLeader = parsed.state.roundLeaderIndex
    const roundLeaderIndex =
      Number.isInteger(storedLeader) && storedLeader >= 0 && storedLeader < players.length
        ? storedLeader
        : 0
    return {
      ...parsed.state,
      players,
      roundLeaderIndex,
      ready: players.map((_, i) => ready[i] === true),
      buyIntents: normalizeBuyIntents(parsed.state.buyIntents),
      extendHistory: Array.isArray(parsed.state.extendHistory) ? parsed.state.extendHistory : [],
      pendingWild: parsed.state.pendingWild ?? null,
      roundVictorIndex: parsed.state.roundVictorIndex ?? null,
    }
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

// ---------------------------------------------------------------------------
// Online profile (display name + avatar for multiplayer)
// ---------------------------------------------------------------------------

/** Load the last online display name / avatar, or null if absent/invalid. */
export async function loadOnlineProfile(): Promise<OnlineProfile | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_ONLINE_PROFILE })
    if (!value) return null
    const parsed: StoredOnlineProfile = JSON.parse(value)
    if (parsed.version !== ONLINE_PROFILE_VERSION) return null
    if (typeof parsed.displayName !== 'string' || !parsed.displayName.trim()) return null
    if (typeof parsed.avatarId !== 'string' || !parsed.avatarId) return null
    const avatar = getAvatar(parsed.avatarId)
    if (!avatar || avatar.kind !== 'human') return null
    return {
      displayName: parsed.displayName.trim(),
      avatarId: parsed.avatarId,
    }
  } catch {
    return null
  }
}

/** Persist the online display name and avatar chosen for create/join. */
export async function saveOnlineProfile(profile: OnlineProfile): Promise<void> {
  const payload: StoredOnlineProfile = {
    version: ONLINE_PROFILE_VERSION,
    displayName: profile.displayName.trim(),
    avatarId: profile.avatarId,
  }
  if (!payload.displayName) return
  await Preferences.set({ key: KEY_ONLINE_PROFILE, value: JSON.stringify(payload) })
}

// ---------------------------------------------------------------------------
// Online reconnect (shared across tabs — production seat takeover)
// ---------------------------------------------------------------------------

/** Load the durable reconnect blob, or null if absent/invalid. */
export async function loadOnlineReconnect(): Promise<OnlineReconnect | null> {
  try {
    const { value } = await Preferences.get({ key: KEY_ONLINE_RECONNECT })
    if (!value) return null
    return parseOnlineReconnect(JSON.parse(value))
  } catch {
    return null
  }
}

/** Persist reconnect so refresh / another tab can reclaim the seat. */
export async function saveOnlineReconnect(data: OnlineReconnect): Promise<void> {
  const payload: StoredOnlineReconnect = {
    version: ONLINE_RECONNECT_VERSION,
    roomCode: data.roomCode,
    reconnectToken: data.reconnectToken,
    displayName: data.displayName,
    avatarId: data.avatarId,
  }
  if (
    !payload.roomCode
    || !payload.reconnectToken
    || !payload.displayName.trim()
    || !payload.avatarId
  ) {
    return
  }
  await Preferences.set({ key: KEY_ONLINE_RECONNECT, value: JSON.stringify(payload) })
}

/** Drop the durable reconnect entry (leave / room closed / non-takeover kick). */
export async function clearOnlineReconnect(): Promise<void> {
  await Preferences.remove({ key: KEY_ONLINE_RECONNECT })
}
