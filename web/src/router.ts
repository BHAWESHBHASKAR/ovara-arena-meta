import { useEffect, useState } from 'react'

// Hash routes, so a static build works anywhere:
//   #/            landing
//   #/arena       app (#/arena/r/<roundId>, #/arena/compare/<roundId>, #/arena/receipts, #/arena/policy)
//   #/tour        guided walkthrough (#/tour/<step>)
export type Route =
  | { page: 'landing'; anchor?: string }
  | { page: 'arena'; tab: 'rounds' | 'receipts' | 'policy'; round?: string; compare?: boolean }
  | { page: 'tour'; step: number }

export function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (!h.startsWith('/')) return { page: 'landing', anchor: h || undefined }
  const parts = h.split('/').filter(Boolean)
  if (parts[0] === 'arena') {
    if (parts[1] === 'receipts' || parts[1] === 'policy') return { page: 'arena', tab: parts[1] }
    if (parts[1] === 'r' && parts[2]) return { page: 'arena', tab: 'rounds', round: decodeURIComponent(parts[2]) }
    if (parts[1] === 'compare' && parts[2]) return { page: 'arena', tab: 'rounds', round: decodeURIComponent(parts[2]), compare: true }
    return { page: 'arena', tab: 'rounds' }
  }
  if (parts[0] === 'tour') return { page: 'tour', step: Math.max(0, Number(parts[1]) - 1 || 0) }
  return { page: 'landing' }
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => setR(parse(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

export const go = (path: string, replace = false) => {
  const h = `#${path}`
  if (location.hash === h) return
  if (replace) history.replaceState(null, '', h)
  else location.hash = h
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export const GITHUB_URL = '#github'
