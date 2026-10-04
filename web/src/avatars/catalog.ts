import h01 from '../assets/avatars/human/h01.svg'
import h02 from '../assets/avatars/human/h02.svg'
import h03 from '../assets/avatars/human/h03.svg'
import h04 from '../assets/avatars/human/h04.svg'
import h05 from '../assets/avatars/human/h05.svg'
import h06 from '../assets/avatars/human/h06.svg'
import h07 from '../assets/avatars/human/h07.svg'
import h08 from '../assets/avatars/human/h08.svg'
import h09 from '../assets/avatars/human/h09.svg'
import h10 from '../assets/avatars/human/h10.svg'
import h11 from '../assets/avatars/human/h11.svg'
import h12 from '../assets/avatars/human/h12.svg'
import b01 from '../assets/avatars/bot/b01.svg'
import b02 from '../assets/avatars/bot/b02.svg'
import b03 from '../assets/avatars/bot/b03.svg'
import b04 from '../assets/avatars/bot/b04.svg'
import b05 from '../assets/avatars/bot/b05.svg'
import b06 from '../assets/avatars/bot/b06.svg'
import b07 from '../assets/avatars/bot/b07.svg'
import b08 from '../assets/avatars/bot/b08.svg'

export type AvatarKind = 'human' | 'bot'

export interface AvatarDef {
  id: string
  kind: AvatarKind
  label: string
  src: string
}

/** Curated toned-down Avataaars (DiceBear / Pablo Stanley).
 * Ordered male, male, female, female, repeating. */
export const HUMAN_AVATARS: AvatarDef[] = [
  { id: 'h01', kind: 'human', label: 'Short dark', src: h01 },
  { id: 'h06', kind: 'human', label: 'Side part beard', src: h06 },
  { id: 'h02', kind: 'human', label: 'Bob', src: h02 },
  { id: 'h03', kind: 'human', label: 'Straight auburn', src: h03 },
  { id: 'h04', kind: 'human', label: 'Short curly', src: h04 },
  { id: 'h05', kind: 'human', label: 'Silver beard', src: h05 },
  { id: 'h07', kind: 'human', label: 'Bun', src: h07 },
  { id: 'h09', kind: 'human', label: 'Blonde', src: h09 },
  { id: 'h08', kind: 'human', label: 'Waved', src: h08 },
  { id: 'h12', kind: 'human', label: 'Full beard', src: h12 },
  { id: 'h10', kind: 'human', label: 'Curly dark', src: h10 },
  { id: 'h11', kind: 'human', label: 'Long dark', src: h11 },
]

/** Curated Bottts (DiceBear / Pablo Stanley). */
export const BOT_AVATARS: AvatarDef[] = [
  { id: 'b01', kind: 'bot', label: 'Green antenna', src: b01 },
  { id: 'b02', kind: 'bot', label: 'Blue robocop', src: b02 },
  { id: 'b03', kind: 'bot', label: 'Orange radar', src: b03 },
  { id: 'b04', kind: 'bot', label: 'Purple glow', src: b04 },
  { id: 'b05', kind: 'bot', label: 'Red horns', src: b05 },
  { id: 'b06', kind: 'bot', label: 'Teal pyramid', src: b06 },
  { id: 'b07', kind: 'bot', label: 'Olive cables', src: b07 },
  { id: 'b08', kind: 'bot', label: 'Slate bulb', src: b08 },
]

const BY_ID = new Map<string, AvatarDef>(
  [...HUMAN_AVATARS, ...BOT_AVATARS].map((a) => [a.id, a]),
)

export function getAvatar(id: string): AvatarDef | undefined {
  return BY_ID.get(id)
}

export function avatarsForKind(kind: AvatarKind): AvatarDef[] {
  return kind === 'human' ? HUMAN_AVATARS : BOT_AVATARS
}

/** First unused avatar of the given kind; falls back to the first in the list. */
export function pickFreeAvatar(kind: AvatarKind, takenIds: Iterable<string>): string {
  const taken = new Set(takenIds)
  const pool = avatarsForKind(kind)
  return pool.find((a) => !taken.has(a.id))?.id ?? pool[0].id
}
