import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import type { ArenaData, Profile } from './types'
import { loadReplay, useLiveArena, useRunningTask, useTaskFeed, type Source } from './data'
import { Players, Scoreboard, Timeline, type Filter } from './Arena'
import { LiveStage, RoundStage } from './Stage'
import { PolicyView, ReceiptsView } from './Secondary'
import { Key, Loader, Play, Square, Swords, X } from './icons'

type View = 'arena' | 'receipts' | 'policy'

const EMPTY: ArenaData = {
  running: false, plan: null, models: {}, rounds: [],
  summary: {
    strict: { rounds: 0, agent_fooled: 0, landed: 0, held_denied: 0, refused: 0, ignored: 0, noticed: 0, with_image: 0 },
    observe: { rounds: 0, agent_fooled: 0, landed: 0, held_denied: 0, refused: 0, ignored: 0, noticed: 0, with_image: 0 },
  },
}

function TokenDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState(getToken())
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Operator token" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><Key size={16} /> Operator token <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <p className="dim">Starting a match, stopping it and drafting rules need the API token (sent as <code>Authorization: Bearer</code>). It is kept in this browser only.</p>
        <input className="input mono" type="password" autoFocus value={v} placeholder="API token" onChange={e => setV(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setToken(v); onClose() } }} />
        <div className="row-end">
          {getToken() && <button className="btn ghost" onClick={() => { setToken(''); onClose() }}>Forget</button>}
          <button className="btn primary" onClick={() => { setToken(v); onClose() }}>Save</button>
        </div>
      </div>
    </div>
  )
}

function Controls({ data, onRun, onStop, busy }: { data: ArenaData; onRun: (n: number, p: Profile) => void; onStop: () => void; busy: boolean }) {
  const [n, setN] = useState(3)
  const [p, setP] = useState<Profile>('strict')
  const plan = data.plan
  if (data.running && plan) {
    const pct = Math.min(100, (plan.done / Math.max(1, plan.rounds)) * 100)
    return (
      <div className="controls running">
        <div className="run-state">
          <div className="run-line"><span className="live-dot" /> Match running · round {Math.min(plan.done + 1, plan.rounds)} of {plan.rounds} · OVARA {plan.profile === 'observe' ? 'off' : 'on'}</div>
          <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        </div>
        <button className="btn" disabled={busy} onClick={onStop}><Square size={13} /> Stop after this round</button>
      </div>
    )
  }
  return (
    <div className="controls">
      <label className="ctl-n">
        <span className="dim">Rounds</span>
        <input type="number" min={1} max={20} value={n} onChange={e => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
      </label>
      <div className="seg" role="group" aria-label="Gate">
        <button className={p === 'strict' ? 'on on-green' : ''} onClick={() => setP('strict')}>OVARA on</button>
        <button className={p === 'observe' ? 'on on-red' : ''} onClick={() => setP('observe')}>OVARA off</button>
      </div>
      <button className="btn primary" disabled={busy} onClick={() => onRun(n, p)}>{busy ? <Loader size={14} /> : <Play size={13} />} Start match</button>
    </div>
  )
}

export default function App() {
  const live = useLiveArena()
  const [replay, setReplay] = useState<ArenaData | null>(null)
  const [replayTried, setReplayTried] = useState(false)
  const [pref, setPref] = useState<'auto' | Source>('auto')
  const [view, setView] = useState<View>('arena')
  const [selected, setSelected] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const [reveal, setReveal] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [tokenOpen, setTokenOpen] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { loadReplay().then(d => { setReplay(d); setReplayTried(true) }) }, [])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t) }, [notice])

  const liveUsable = live.reachable === true && !!live.data
  // Default: the recorded run, unless a live match is going (or there is no recording).
  const liveRunning = liveUsable && !!live.data!.running
  const source: Source = pref !== 'auto' ? (pref === 'live' && !liveUsable && replay ? 'replay' : pref === 'replay' && !replay ? 'live' : pref)
    : liveRunning ? 'live' : replay ? 'replay' : 'live'
  const data: ArenaData = (source === 'live' ? live.data : replay) || EMPTY

  const runningTask = useRunningTask(source === 'live' && !!data.running)
  const liveRound = source === 'live' && data.running
    ? { n: data.rounds.length + 1, label: runningTask?.inbound?.subject || 'Attacker is writing', profile: data.plan?.profile || runningTask?.profile || 'strict' }
    : null

  const ordered = useMemo(() => [...data.rounds].sort((a, b) => b.n - a.n), [data.rounds])
  const visible = useMemo(() => ordered.filter(r => filter === 'all' || r.profile === filter), [ordered, filter])
  const navIds = useMemo(() => [...(liveRound ? ['live'] : []), ...visible.map(r => r.id)], [liveRound, visible])

  // Follow mode: the newest round, or the live one once its email exists.
  const newestId = ordered[0]?.id || null
  const lastNewest = useRef<string | null>(null)
  useEffect(() => {
    if (!follow) return
    if (liveRound && runningTask?.inbound) setSelected('live')
    else if (newestId && (selected === 'live' || selected === null || lastNewest.current !== newestId)) setSelected(newestId)
    lastNewest.current = newestId
  }, [follow, liveRound, runningTask?.inbound, newestId, selected])
  useEffect(() => { if (selected === 'live' && !liveRound) setSelected(newestId) }, [selected, liveRound, newestId])
  useEffect(() => { setReveal(false) }, [selected])

  const round = selected && selected !== 'live' ? data.rounds.find(r => r.id === selected) || null : null
  const taskId = selected === 'live' ? runningTask?.id : round?.task_id
  const { items: feed, loading: feedLoading } = useTaskFeed(taskId, source, data.feeds, selected === 'live')

  const pick = useCallback((id: string) => { setSelected(id); setFollow(id === 'live' || id === navIds[0]) }, [navIds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (tokenOpen || view !== 'arena' || t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'r' || e.key === 'R') { setReveal(v => !v); e.preventDefault() }
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k') {
        const i = navIds.indexOf(selected || '')
        const d = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1
        const next = navIds[Math.max(0, Math.min(navIds.length - 1, (i < 0 ? 0 : i + d)))]
        if (next) { pick(next); e.preventDefault() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navIds, selected, pick, tokenOpen, view])

  const writeFail = (what: string) => (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setTokenOpen(true); setNotice({ text: `${what}: the API needs the operator token.`, bad: true }) }
    else setNotice({ text: `${what}: ${(e as Error)?.message || e}`, bad: true })
  }
  const run = (n: number, p: Profile) => {
    setBusy(true)
    api('POST', '/api/arena/run', { rounds: n, profile: p })
      .then(() => { setNotice({ text: `Match started: ${n} round${n === 1 ? '' : 's'}, OVARA ${p === 'observe' ? 'off' : 'on'}.` }); setFollow(true); setPref('live'); live.refresh() })
      .catch(writeFail('Could not start'))
      .finally(() => setBusy(false))
  }
  const stop = () => {
    setBusy(true)
    api('POST', '/api/arena/stop').then(() => { setNotice({ text: 'The match stops after the current round.' }); live.refresh() }).catch(writeFail('Could not stop')).finally(() => setBusy(false))
  }

  const recordedAt = data.recorded_at ? new Date(data.recorded_at) : null
  const both = liveUsable && !!replay

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark"><Swords size={16} /></span>
          <span className="wordmark">OVARA <span>Arena</span></span>
          <span className="tagline">Muse Spark attacks. OVARA holds. Muse Spark learns.</span>
        </div>
        <nav className="tabs" aria-label="Views">
          {(['arena', 'receipts', 'policy'] as View[]).map(v => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v === 'arena' ? 'Arena' : v === 'receipts' ? 'Receipts' : 'Policy'}</button>
          ))}
        </nav>
        <div className="top-right">
          {both && (
            <div className="seg seg-sm" role="group" aria-label="Data source">
              <button className={source === 'live' ? 'on' : ''} onClick={() => setPref('live')}>Live</button>
              <button className={source === 'replay' ? 'on' : ''} onClick={() => setPref('replay')}>Recorded</button>
            </div>
          )}
          <span className={`src src-${source === 'live' ? (live.reachable ? 'live' : 'down') : data.placeholder ? 'ph' : 'rec'}`}>
            <span className="dot" />
            {source === 'live' ? (live.reachable === false ? 'API unreachable' : live.reachable ? 'Live · PayPal sandbox' : 'Connecting') : data.placeholder ? 'Placeholder data' : 'Recorded run'}
          </span>
          {source === 'live' && <button className="icon-btn" title={getToken() ? 'Operator token set' : 'Set operator token'} onClick={() => setTokenOpen(true)}><Key size={15} /></button>}
        </div>
      </header>

      {source === 'replay' && (
        <div className={`banner ${data.placeholder ? 'ph' : ''}`}>
          {data.placeholder
            ? <><b>Placeholder data.</b> These rounds and numbers only show the layout; they are not from a real run.</>
            : <><b>Recorded run,</b> played back from a file. Nothing on this page is calling PayPal.{recordedAt && !isNaN(recordedAt.getTime()) ? ` Recorded ${recordedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</>}
        </div>
      )}

      {view === 'arena' ? (
        <main className="arena">
          <div className="band">
            <Players models={data.models} />
            {source === 'live' && (liveUsable ? <Controls data={data} onRun={run} onStop={stop} busy={busy} /> : <div className="controls-ph dim small">{live.reachable === false ? 'The live API is not reachable.' : 'Connecting to the API'}</div>)}
          </div>
          <Scoreboard data={data} />
          <div className="field">
            <Timeline rounds={data.rounds} selected={selected} onSelect={pick} live={liveRound} filter={filter} setFilter={setFilter} />
            <div className="stage-wrap">
              {selected === 'live' && liveRound ? (
                <LiveStage key="live" n={liveRound.n} task={runningTask} feed={feed} profile={liveRound.profile} source={source} />
              ) : round ? (
                <RoundStage key={round.id} round={round} feed={feed} feedLoading={feedLoading} source={source} reveal={reveal} setReveal={setReveal} onNeedToken={() => setTokenOpen(true)} />
              ) : (
                <div className="stage-empty">
                  {source === 'replay' && !replayTried ? <><Loader size={16} /> Loading</> : liveRound ? <><Loader size={16} /> Round {liveRound.n} is starting. The attacker is writing its email.</> : 'No rounds yet. Start a match: Muse Spark writes an attack, the agent handles it, and the gate decides.'}
                </div>
              )}
            </div>
          </div>
        </main>
      ) : view === 'receipts' ? (
        <main className="secondary"><ReceiptsView source={source} replay={replay} /></main>
      ) : (
        <main className="secondary"><PolicyView source={source} replay={replay} /></main>
      )}

      {tokenOpen && <TokenDialog onClose={() => setTokenOpen(false)} />}
      {notice && <div className={`notice ${notice.bad ? 'bad' : ''}`} role="status">{notice.text}</div>}
    </div>
  )
}
