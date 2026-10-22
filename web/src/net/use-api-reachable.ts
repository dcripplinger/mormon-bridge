import { useCallback, useEffect, useRef, useState } from 'react'
import { checkApiReachable, defaultApiBase } from './room-client'

export type ApiReachability = 'checking' | 'available' | 'unavailable'

const RECHECK_MS = 15_000

/**
 * Tracks whether the multiplayer API is reachable.
 * Rechecks on focus, online/offline, and on a slow interval.
 */
export function useApiReachable(apiBase = defaultApiBase()): {
  status: ApiReachability
  recheck: () => void
} {
  const [status, setStatus] = useState<ApiReachability>('checking')
  const generationRef = useRef(0)

  const runCheck = useCallback(() => {
    const generation = ++generationRef.current
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('unavailable')
      return
    }
    setStatus((prev) => (prev === 'available' ? prev : 'checking'))
    void checkApiReachable(apiBase).then((ok) => {
      if (generation !== generationRef.current) return
      setStatus(ok ? 'available' : 'unavailable')
    })
  }, [apiBase])

  useEffect(() => {
    runCheck()
    const onFocus = () => runCheck()
    const onOnline = () => runCheck()
    const onOffline = () => {
      generationRef.current += 1
      setStatus('unavailable')
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const interval = window.setInterval(runCheck, RECHECK_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(interval)
    }
  }, [runCheck])

  return { status, recheck: runCheck }
}
