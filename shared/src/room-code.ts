/** Uppercase letters + digits, omitting ambiguous 0/O/1/I for easier sharing. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Short unique room code. Knowing the code is how players join (rooms are unlisted). */
export function generateRoomCode(length = 6, rng: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(rng() * ALPHABET.length)]
  }
  return out
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}
