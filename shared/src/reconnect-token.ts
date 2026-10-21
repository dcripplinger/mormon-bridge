function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Opaque reconnect token for rebinding a seat. */
export function generateReconnectToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return toHex(bytes.buffer)
}
