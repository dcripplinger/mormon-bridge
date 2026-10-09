/**
 * Shared application-level types used by both the menu and persistence layers.
 * Keeping them here avoids circular imports between MenuScreen and persistence.
 */

import type { AvatarKind } from '../avatars/catalog'

/** A seat configuration as edited on the menu screen. */
export interface SeatDraft {
  kind: AvatarKind
  avatarId: string
}

/** Where a played wild may be taken from. */
export type WildMoveFrom = 'runs' | 'runs-or-groups' | 'nowhere'

/**
 * Where a moved wild may be placed.
 * The "same meld" option label shortens to "Same run" when WildMoveFrom is
 * "runs", so a wild can be moved to a group to protect it.
 */
export type WildMoveTo = 'any-meld' | 'any-meld-or-hand' | 'same-meld'

export interface GameSettings {
  wildMoveFrom: WildMoveFrom
  wildMoveTo: WildMoveTo
}
