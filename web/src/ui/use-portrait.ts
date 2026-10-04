import { useEffect, useState } from 'react'

/** True when the viewport is taller than it is wide. */
export function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const onChange = () => setPortrait(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return portrait
}
