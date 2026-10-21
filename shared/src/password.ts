/** Hex-encode bytes. */
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Random salt as hex (16 bytes). */
export async function randomSaltHex(): Promise<string> {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toHex(bytes.buffer)
}

/** SHA-256(password + salt) as hex. Salt is hex string. */
export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}:${saltHex}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = await hashPassword(password, saltHex)
  if (actual.length !== expectedHash.length) return false
  let ok = 0
  for (let i = 0; i < actual.length; i++) {
    ok |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i)
  }
  return ok === 0
}
