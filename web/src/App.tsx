import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, sleep } from './api'
import type { Approval, Draft, FeedItem, Integrity, Policy, Receipt, ReplayData, Scenario, State, Task } from './types'
import { Feed } from './Feed'
import { Approvals, type DecideFn } from './Approvals'
import { PolicyPanel, Queue, Receipts, SCENARIOS, type VerifyResult } from './Panels'

type Mode = 'strict' | 'off'
const LOADED_AT = Date.now()
const SHORT: Record<string, string> = { poisoned: 'Poisoned note', duplicate: 'Duplicate', shift: 'Shift' }

function usePoll(fn: () => Promise<unknown>, ms: number, deps: unknown[] = []) {
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout>
    const tick = () => fn().catch(() => {}).finally(() => { if (!stop) t = setTimeout(tick, ms) })
    tick()
    return () => { stop = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

const hasItems = (d: ReplayData | null) => !!d && Object.values(d.scenarios || {}).some(s => (s?.strict?.length || 0) + (s?.off?.length || 0) > 0)

async function loadReplay(): Promise<ReplayData | null> {
  try {
    const d = await api<ReplayData>('GET', '/api/replay')
    if (hasItems(d)) return d
  } catch { /* fall back to the bundled file */ }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}replay.json`, { cache: 'no-store' })
    const d = (await r.json()) as ReplayData
    return hasItems(d) ? d : null
  } catch {
    return null
  }
}

const atMs = (at: string | number) => (typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : new Date(at).getTime())

function Panel({ title, right, className, children }: { title: React.ReactNode; right?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`panel ${className || ''}`}>
      <header className="panel-head"><h2>{title}</h2>{right && <div className="panel-right">{right}</div>}</header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [live, setLive] = useState<FeedItem[]>([])
  const [view, setView] = useState<'replay' | 'live'>('replay')
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)

  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [replayTried, setReplayTried] = useState(false)
  const [rScenario, setRScenario] = useState<string>('poisoned')
  const [rMode, setRMode] = useState<Mode>('strict')
  const [rIdx, setRIdx] = useState(0)
  const [rRun, setRRun] = useState(0)

  const say = useCallback((text: string, bad = false) => setNotice({ text, bad }), [])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t) }, [notice])

  useEffect(() => {
    loadReplay().then(d => {
      setReplay(d)
      setReplayTried(true)
      if (d && !d.scenarios.poisoned) setRScenario(Object.keys(d.scenarios)[0] || 'poisoned')
    })
  }, [])

  const rModes = (['strict', 'off'] as Mode[]).filter(m => (replay?.scenarios[rScenario]?.[m]?.length || 0) > 0)
  useEffect(() => { if (rModes.length && !rModes.includes(rMode)) setRMode(rModes[0]) }, [rModes, rMode])
  const rItems = replay?.scenarios[rScenario]?.[rMode] || []
  useEffect(() => { setRIdx(0) }, [rScenario, rMode, rRun])
  useEffect(() => {
    if (view !== 'replay' || rIdx >= rItems.length) return
    const prev = rItems[rIdx - 1], cur = rItems[rIdx]
    const gap = prev ? atMs(cur.at) - atMs(prev.at) : 0
    const delay = rIdx === 0 ? 250 : Math.min(1400, Math.max(260, isNaN(gap) ? 600 : gap))
    const t = setTimeout(() => setRIdx(i => i + 1), delay)
    return () => clearTimeout(t)
  }, [view, rIdx, rItems])

  usePoll(() => api<State>('GET', '/api/state').then(s => { setState(s); setReachable(true) }).catch(e => { setReachable(false); throw e }), 5000)
  usePoll(() => api<Task[] | { tasks: Task[] }>('GET', '/api/tasks').then(t => setTasks(Array.isArray(t) ? t : t?.tasks || [])), 2000)
  usePoll(() => api<Approval[] | { approvals: Approval[] }>('GET', '/api/approvals').then(a => setApprovals(Array.isArray(a) ? a : a?.approvals || [])), 1500)

  const loadReceipts = useCallback(() => api<Receipt[] | { receipts: Receipt[]; integrity?: Integrity }>('GET', '/api/receipts?n=100').then(r => {
    if (Array.isArray(r)) { setReceipts(r); return }
    setReceipts(r?.receipts || [])
    if (r?.integrity) setIntegrity(r.integrity)
  }), [])
  usePoll(loadReceipts, 6000, [loadReceipts])

  const loadPolicy = useCallback(() => api<Policy>('GET', '/api/policy').then(setPolicy), [])
  usePoll(loadPolicy, 15000, [loadPolicy])

  // Live feed: long-poll. New activity after the page loaded takes the feed over from the replay.
  useEffect(() => {
    const ctl = new AbortController()
    let since = 0
    ;(async () => {
      while (!ctl.signal.aborted) {
        const t0 = Date.now()
        try {
          const r = await api<FeedItem[] | { items: FeedItem[] }>('GET', `/api/feed?since=${since}`, undefined, ctl.signal)
          const items = (Array.isArray(r) ? r : r?.items || []).filter(i => typeof i?.seq === 'number')
          if (items.length) {
            since = Math.max(since, ...items.map(i => i.seq))
            setLive(prev => {
              const seen = new Set(prev.map(p => p.seq))
              return [...prev, ...items.filter(i => !seen.has(i.seq))].sort((a, b) => a.seq - b.seq).slice(-600)
            })
            if (items.some(i => { const t = atMs(i.at); return isNaN(t) || t >= LOADED_AT - 2000 })) setView('live')
          }
          if (Date.now() - t0 < 800) await sleep(800)
        } catch {
          if (ctl.signal.aborted) return
          await sleep(3000)
        }
      }
    })()
    return () => ctl.abort()
  }, [])
  useEffect(() => { loadReceipts().catch(() => {}) }, [live.length, loadReceipts])

  const profile: State['profile'] = state?.profile || policy?.profile || 'strict'
  const setProfile = (p: State['profile']) => {
    if (p === profile || profileBusy) return
    setProfileBusy(true)
    api('POST', '/api/policy/profile', { profile: p })
      .then(() => { setState(s => (s ? { ...s, profile: p } : s)); setPolicy(x => (x ? { ...x, profile: p } : x)); say(p === 'strict' ? 'OVARA is on. Calls go through OVARA.' : 'OVARA is off. The next task talks to PayPal directly.') })
      .catch(e => say(`Could not switch: ${e.message}`, true))
      .finally(() => setProfileBusy(false))
  }

  const run = useCallback((body: { text: string } | { scenario: Scenario }) =>
    api('POST', '/api/tasks', body).then(() => { setView('live'); say('Task queued.') }).catch(e => { say(`Could not start: ${e.message}`, true); throw e }), [say])
  const stop = (id: string) => api('POST', `/api/tasks/${encodeURIComponent(id)}/stop`).then(() => say('Stopping the task.')).catch(e => say(`Could not stop: ${e.message}`, true))

  const decide: DecideFn = (id, action) => {
    const path = `/api/approvals/${encodeURIComponent(id)}/${action === 'deny' ? 'deny' : 'approve'}`
    const body = action === 'deny' ? {} : { remember: action === 'remember' }
    return api('POST', path, body).then(() => {
      setApprovals(a => a.filter(x => x.id !== id))
      say(action === 'deny' ? 'Denied. The agent is told the operator refused.' : action === 'remember' ? 'Approved. This exact tool is now allowed.' : 'Approved once.')
      loadReceipts().catch(() => {})
      if (action === 'remember') loadPolicy().catch(() => {})
    }).catch(e => say(`Could not ${action === 'deny' ? 'deny' : 'approve'}: ${e.message}`, true))
  }

  const verify = () => api<VerifyResult>('POST', '/api/receipts/verify')

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => (atMs(b.started_at || 0) || 0) - (atMs(a.started_at || 0) || 0)), [tasks])
  const lastTaskId = sortedTasks[0]?.id || [...live].reverse().find(i => i.kind === 'task')?.task_id || null

  const onDraft = () => api<Draft>('POST', '/api/policy/draft', { incident_task_id: lastTaskId }).then(setDraft)
  const onApply = () => {
    if (!draft) return Promise.resolve()
    return api<Policy>('POST', `/api/policy/draft/${encodeURIComponent(draft.draft_id)}/apply`).then(p => {
      if (p && Array.isArray(p.rules)) setPolicy(p); else loadPolicy().catch(() => {})
      setDraft(null)
      say('Rule applied. Run the same scenario again to see it.')
    })
  }

  const status = reachable === false ? { word: 'API unreachable', cls: 'down' }
    : !state ? { word: 'Connecting', cls: 'wait' }
    : state.boot === 'ready' ? { word: 'Ready', cls: 'up' }
    : state.boot === 'degraded' ? { word: 'Degraded', cls: 'down' } : { word: 'Starting', cls: 'wait' }
  const statusTitle = state ? [
    `gateway ${state.ovara?.gateway_ok ? 'ok' : 'down'}`, `proxy ${state.ovara?.proxy_ok ? 'ok' : 'down'}`,
    `tool pins ${state.ovara?.pins || 'unknown'}`, `PayPal sandbox token ${state.paypal?.token_ok ? 'ok' : 'missing'}`,
    state.models?.agent ? `agent ${state.models.agent}` : '', state.models?.drafter ? `drafter ${state.models.drafter}` : '',
  ].filter(Boolean).join('\n') : ''

  const scenarioMeta = SCENARIOS.find(s => s.id === rScenario)
  const replayDone = rIdx >= rItems.length && rItems.length > 0
  const ORDER = ['poisoned', 'duplicate', 'shift']
  const replayScenarios = replay ? Object.keys(replay.scenarios)
    .filter(k => (replay.scenarios[k]?.strict?.length || 0) + (replay.scenarios[k]?.off?.length || 0) > 0)
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)) : []
  const recordedAt = replay?.recorded_at ? new Date(replay.recorded_at) : null
  const feedItems = view === 'replay' ? rItems.slice(0, rIdx) : live

  const feedRight = (
    <div className="seg-small">
      <button className={view === 'replay' ? 'on' : ''} onClick={() => { setView('replay'); setRRun(n => n + 1) }} disabled={!replay}>Recorded</button>
      <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>Live</button>
    </div>
  )

  return (
    <div className="app">
      <header className="top">
        <div className="top-inner">
          <div className="brand"><span className="wordmark">OVARA</span><span className="dim">for PayPal agents</span></div>
          <div className="switch-wrap">
            <div className="switch" role="group" aria-label="OVARA on or off">
              <span className="switch-label">OVARA</span>
              <button className={profile === 'strict' ? 'on' : ''} aria-pressed={profile === 'strict'} disabled={profileBusy} onClick={() => setProfile('strict')}>on</button>
              <button className={profile === 'observe' ? 'on' : ''} aria-pressed={profile === 'observe'} disabled={profileBusy} onClick={() => setProfile('observe')}>off</button>
            </div>
            <div className="switch-note">off: the agent talks to PayPal directly, nothing is held or receipted</div>
          </div>
          <div className={`status ${status.cls}`} title={statusTitle}><span className="dot" />{status.word}</div>
        </div>
      </header>

      <main className="grid">
        <Panel title="Live feed" className="a-feed" right={feedRight}>
          {view === 'replay' && (
            <div className="replay-bar">
              <div className="replay-text">
                {replay?.placeholder
                  ? <><span className="strong">Placeholder, not a recording.</span> <span className="dim">Sample lines that show the layout. A real run replaces them.</span></>
                  : <><span className="strong">Recorded run</span> <span className="dim">of the {scenarioMeta?.title.toLowerCase() || rScenario} scenario, OVARA {rMode === 'strict' ? 'on' : 'off'}. Played back, nothing is calling PayPal.{recordedAt && !isNaN(recordedAt.getTime()) ? ` Recorded ${recordedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</span></>}
              </div>
              <div className="replay-actions">
                {replayScenarios.length > 1 && (
                  <div className="seg-small" role="group" aria-label="Recorded scenario">
                    {replayScenarios.map(k => <button key={k} className={rScenario === k ? 'on' : ''} onClick={() => setRScenario(k)}>{SHORT[k] || k}</button>)}
                  </div>
                )}
                {rModes.length > 1 && (
                  <div className="seg-small">
                    <button className={rMode === 'strict' ? 'on' : ''} onClick={() => setRMode('strict')}>OVARA on</button>
                    <button className={rMode === 'off' ? 'on' : ''} onClick={() => setRMode('off')}>OVARA off</button>
                  </div>
                )}
                <button className="btn ghost" onClick={() => setRRun(n => n + 1)}>{replayDone ? 'Play again' : 'Restart'}</button>
                <button className="btn primary" disabled={reachable === false} onClick={() => run({ scenario: (rScenario as Scenario) }).catch(() => {})}>Run it live</button>
              </div>
            </div>
          )}
          <Feed items={feedItems} forceOff={view === 'replay' && rMode === 'off'}
            empty={view === 'replay'
              ? (replayTried ? 'No recorded run is available. Switch to Live or start a task.' : 'Loading the recorded run.')
              : 'Nothing has happened yet. Start a task or a scenario; every call, OVARA’s decision on it and PayPal’s answer appear here, one line each.'} />
        </Panel>

        <Panel title={<>Approvals{approvals.length ? <span className="count held">{approvals.length} waiting</span> : null}</>} className="a-approvals">
          <Approvals items={approvals} decide={decide} reachable={reachable !== false} />
        </Panel>

        <Panel title="Queue" className="a-queue">
          <Queue tasks={sortedTasks} onRun={run} onStop={stop} disabled={reachable === false} />
        </Panel>

        <Panel title={<>Receipts{receipts.length ? <span className="count">{receipts.length}</span> : null}</>} className="a-receipts">
          <Receipts receipts={receipts} integrity={integrity} verify={verify} />
        </Panel>

        <Panel title="Policy" className="a-policy" right={<span className="dim small">profile <code>{profile}</code></span>}>
          <PolicyPanel policy={policy} lastTaskId={lastTaskId} draft={draft} onDraft={onDraft} onApply={onApply} />
        </Panel>
      </main>

      {notice && <div className={`notice ${notice.bad ? 'bad' : ''}`} role="status">{notice.text}</div>}
    </div>
  )
}
