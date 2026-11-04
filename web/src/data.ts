import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { ArenaData, FeedItem, LiveTask } from './types'

const BASE = import.meta.env.BASE_URL

export type Source = 'live' | 'replay'

export async function loadReplay(): Promise<ArenaData | null> {
  try {
    const r = await fetch(`${BASE}arena-replay.json`, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as ArenaData
    return d && Array.isArray(d.rounds) ? d : null
  } catch {
    return null
  }
}

// Polls GET /api/arena: every 2 s while a match runs, every 5 s otherwise.
export function useLiveArena() {
  const [data, setData] = useState<ArenaData | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [nudge, setNudge] = useState(0)
  const running = !!data?.running
  useEffect(() => {
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      let next = 5000
      try {
        const d = await api<ArenaData>('GET', '/api/arena')
        if (stop) return
        if (!d || !Array.isArray(d.rounds)) throw new Error('bad shape')
        setData(d)
        setReachable(true)
        next = d.running ? 2000 : 5000
      } catch {
        if (stop) return
        setReachable(false)
        next = 10000
      }
      if (!stop) t = setTimeout(tick, next)
    }
    tick()
    return () => { stop = true; clearTimeout(t) }
  }, [nudge])
  return { data, reachable, running, refresh: () => setNudge(n => n + 1) }
}

// The arena task the agent is working on right now, from GET /api/tasks.
export function useRunningTask(enabled: boolean) {
  const [task, setTask] = useState<LiveTask | null>(null)
  useEffect(() => {
    if (!enabled) { setTask(null); return }
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const r = await api<LiveTask[] | { tasks: LiveTask[] }>('GET', '/api/tasks')
        const list = Array.isArray(r) ? r : r?.tasks || []
        const cur = list.filter(x => x.scenario === 'arena' && (x.status === 'running' || x.status === 'queued')).pop() || null
        if (!stop) setTask(prev => (prev?.id === cur?.id && prev?.status === cur?.status ? prev : cur))
      } catch { /* keep the last one */ }
      if (!stop) t = setTimeout(tick, 2000)
    }
    tick()
    return () => { stop = true; clearTimeout(t) }
  }, [enabled])
  return task
}

// The step-by-step feed of one task. Replay reads the embedded feeds; live
// reads /api/feed?task_id=..., and keeps long-polling while the task runs.
export function useTaskFeed(taskId: string | undefined, source: Source, embedded: Record<string, FeedItem[]> | undefined, follow: boolean) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(false)
  const cache = useRef(new Map<string, FeedItem[]>())
  useEffect(() => {
    if (!taskId) { setItems([]); return }
    if (source === 'replay') { setItems(embedded?.[taskId] || []); return }
    const cached = cache.current.get(taskId)
    if (cached && !follow) { setItems(cached); return }
    setItems(cached || [])
    const ctl = new AbortController()
    let since = cached?.length ? Math.max(...cached.map(i => i.seq)) : 0
    setLoading(!cached)
    ;(async () => {
      do {
        const timer = follow ? null : setTimeout(() => ctl.abort(), 6000)
        try {
          const r = await api<FeedItem[] | { items: FeedItem[] }>('GET', `/api/feed?task_id=${encodeURIComponent(taskId)}&since=${since}`, undefined, ctl.signal)
          const got = (Array.isArray(r) ? r : r?.items || []).filter(i => typeof i?.seq === 'number' && i.task_id === taskId)
          if (got.length) {
            since = Math.max(since, ...got.map(i => i.seq))
            const prev = cache.current.get(taskId) || []
            const seen = new Set(prev.map(p => p.seq))
            const merged = [...prev, ...got.filter(g => !seen.has(g.seq))].sort((a, b) => a.seq - b.seq)
            cache.current.set(taskId, merged)
            if (!ctl.signal.aborted) setItems(merged)
          }
        } catch {
          if (ctl.signal.aborted) break
          await new Promise(res => setTimeout(res, 2000))
        } finally {
          if (timer) clearTimeout(timer)
          setLoading(false)
        }
      } while (follow && !ctl.signal.aborted)
    })()
    return () => ctl.abort()
  }, [taskId, source, embedded, follow])
  return { items, loading }
}

// Resolves an image URL for the current source. In a static replay the API's
// /api/attachments/<id> is not there; the file can sit in public/arena-img/<id>.png.
export function imageSrc(url: string | null | undefined, source: Source): string | null {
  if (!url) return null
  if (source === 'replay') {
    const m = url.match(/^\/api\/attachments\/([\w-]+)$/)
    if (m) return `${BASE}arena-img/${m[1]}.png`
    if (!/^(https?:|data:|\/)/.test(url)) return `${BASE}${url}`
  }
  return url
}
