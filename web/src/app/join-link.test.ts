import { describe, expect, it } from 'vitest'
import {
  APP_JOIN_SCHEME,
  buildAppJoinUrl,
  buildWebJoinUrl,
  parseJoinCodeFromUrl,
} from './join-link'

describe('join-link', () => {
  it('builds a localhost web join URL with the room code', () => {
    const url = buildWebJoinUrl('ab12cd')
    expect(url).toContain('join=AB12CD')
    expect(url.startsWith('http://') || url.startsWith('https://')).toBe(true)
  })

  it('builds an app-scheme join URL', () => {
    expect(buildAppJoinUrl('xy9z8w')).toBe(`${APP_JOIN_SCHEME}://join/XY9Z8W`)
  })

  it('parses join codes from web query strings', () => {
    expect(parseJoinCodeFromUrl('http://localhost:5173/?join=ABCD12')).toBe('ABCD12')
    expect(parseJoinCodeFromUrl('http://localhost:5173/?join=ab-cd12&x=1')).toBe('ABCD12')
  })

  it('parses join codes from app scheme URLs', () => {
    expect(parseJoinCodeFromUrl('mormonbridge://join/ABCD12')).toBe('ABCD12')
    expect(parseJoinCodeFromUrl('mormonbridge://join/ab12cd')).toBe('AB12CD')
  })

  it('parses join codes from /join/ path URLs', () => {
    expect(parseJoinCodeFromUrl('http://localhost:5173/join/ABCD12')).toBe('ABCD12')
  })

  it('rejects short or missing codes', () => {
    expect(parseJoinCodeFromUrl('http://localhost:5173/?join=AB')).toBeNull()
    expect(parseJoinCodeFromUrl('http://localhost:5173/')).toBeNull()
  })
})
