import { useEffect, useState } from 'react'

// Hash routes, so a static build works anywhere:
//   #/                 overview (#/?play=1 or #/demo?autoplay=1 starts the guided demo)
//   #/how-it-works  #/results  #/about
//   #/rounds           explorer (#/rounds/r/<id>, #/rounds/compare/<id>, #/rounds/receipts, #/rounds/policy); #/arena is an alias
export type Route =
  | { page: 'landing'; anchor?: string; play?: boolean }
  | { page: 'how' }
  | { page: 'results' }
  | { page: 'about' }
  | { page: 'arena'; tab: 'rounds' | 'receipts' | 'policy'; round?: string; compare?: boolean }

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith('/')) return { page: 'landing', anchor: raw || undefined }
  const [path, query = ''] = raw.split('?')
  const q = new URLSearchParams(query)
  const play = q.get('play') === '1' || q.get('autoplay') === '1'
  const parts = path.split('/').filter(Boolean)
  switch (parts[0]) {
    case undefined: return { page: 'landing', play }
    case 'demo': case 'tour': return { page: 'landing', anchor: 'try', play }
    case 'how-it-works': return { page: 'how' }
    case 'results': return { page: 'results' }
    case 'about': return { page: 'about' }
    case 'rounds': case 'arena': {
      if (parts[1] === 'receipts' || parts[1] === 'policy') return { page: 'arena', tab: parts[1] }
      if (parts[1] === 'r' && parts[2]) return { page: 'arena', tab: 'rounds', round: decodeURIComponent(parts[2]) }
      if (parts[1] === 'compare' && parts[2]) return { page: 'arena', tab: 'rounds', round: decodeURIComponent(parts[2]), compare: true }
      return { page: 'arena', tab: 'rounds' }
    }
  }
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
  if (replace) {
    history.replaceState(null, '', h)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else location.hash = h
}

export const GITHUB_URL = 'https://github.com/BHAWESHBHASKAR/ovara-arena-meta'
