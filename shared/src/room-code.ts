const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Short human-shareable room code (no ambiguous 0/O/1/I). */
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
