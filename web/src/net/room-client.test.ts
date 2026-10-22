import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiUnreachableError,
  checkApiReachable,
  createRoom,
} from './room-client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('checkApiReachable', () => {
  it('returns true when /api/health reports ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    )
    await expect(checkApiReachable('')).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns false when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(checkApiReachable('https://example.test')).resolves.toBe(false)
  })

  it('returns false on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false }),
      }),
    )
    await expect(checkApiReachable('')).resolves.toBe(false)
  })
})

describe('createRoom', () => {
  it('throws ApiUnreachableError when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(createRoom('', 3)).rejects.toBeInstanceOf(ApiUnreachableError)
  })

  it('throws ApiUnreachableError on 502 with non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      }),
    )
    await expect(createRoom('', 3)).rejects.toBeInstanceOf(ApiUnreachableError)
  })

  it('surfaces application errors from 4xx JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid table size' }),
      }),
    )
    await expect(createRoom('', 3)).rejects.toThrow('Invalid table size')
  })
})
