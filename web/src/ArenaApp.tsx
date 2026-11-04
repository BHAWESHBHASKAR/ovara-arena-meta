import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import type { ArenaData, Profile, Round } from './types'
import { useLiveArena, useRunningTask, useTaskFeed, type Source } from './data'
import { go, type Route } from './router'
import { Logo } from './ui'
import { CompareView, LiveDetail, RoundDetail } from './Round'
import { PolicyView, ReceiptsView } from './Secondary'
import { INVOICE_USD, pairsOf, partnerOf, styleWord, usd, verdictOf } from './verdict'
import { Key, Loader, Play, Square, X } from './icons'

const EMPTY: ArenaData = {
  running: false, plan: null, models: {}, rounds: [],
  summary: {
    strict: { rounds: 0, agent_fooled: 0, landed: 0, held_denied: 0, refused: 0, ignored: 0, noticed: 0, with_image: 0 },
    observe: { rounds: 0, agent_fooled: 0, landed: 0, held_denied: 0, refused: 0, ignored: 0, noticed: 0, with_image: 0 },
  },
}

function TokenDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState(getToken())
  const save = () => { setToken(v); onClose() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Operator token" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><Key size={18} /> Operator token <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <p>Starting or stopping a match and drafting rules need the API token (sent as <code>Authorization: Bearer</code>). It stays in this browser.</p>
        <input className="input mono" type="password" autoFocus value={v} placeholder="API token" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
        <div className="row-end">
          {getToken() && <button className="btn ghost" onClick={() => { setToken(''); onClose() }}>Forget</button>}
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

function Controls({ data, onRun, onStop, busy }: { data: ArenaData; onRun: (n: number, p: Profile) => void; onStop: () => void; busy: boolean }) {
  const [n, setN] = useState(3)
  const [p, setP] = useState<Profile>('strict')
  if (data.running && data.plan) {
    const plan = data.plan
    return (
      <div className="controls">
        <div><span className="live-dot" /> Round {Math.min(plan.done + 1, plan.rounds)} of {plan.rounds} · OVARA {plan.profile === 'observe' ? 'off' : 'on'}</div>
        <div className="progress"><span style={{ width: `${(plan.done / Math.max(1, plan.rounds)) * 100}%` }} /></div>
        <button className="btn btn-sm" disabled={busy} onClick={onStop}><Square size={13} /> Stop after this round</button>
      </div>
    )
  }
  return (
    <div className="controls">
      <div className="strong">Run a live match</div>
      <label>Rounds <input type="number" min={1} max={20} value={n} onChange={e => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
      <div className="seg seg-sm" role="group" aria-label="Gate">
        <button className={p === 'strict' ? 'on' : ''} onClick={() => setP('strict')}>OVARA on</button>
        <button className={p === 'observe' ? 'on' : ''} onClick={() => setP('observe')}>OVARA off</button>
      </div>
      <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onRun(n, p)}>{busy ? <Loader size={14} /> : <Play size={13} />} Start</button>
    </div>
  )
}

function RoundButton({ r, sel }: { r?: Round; sel: boolean }) {
  if (!r) return <span className="rb empty" />
  const v = verdictOf(r)
  return (
    <button className={`rb ${sel ? 'sel' : ''}`} onClick={() => go(`/arena/r/${r.id}`)} aria-label={`Round ${r.n}, ${v.word}`} aria-current={sel ? 'true' : undefined}>
      <i className={`dot ${v.tone === 'safe' ? 'safe' : v.tone === 'leak' ? 'leak' : ''}`} />
      <b>{v.short}</b>
      <span>R{r.n}</span>
    </button>
  )
}

export default function ArenaApp({ route, replay }: { route: Extract<Route, { page: 'arena' }>; replay: ArenaData | null }) {
  const live = useLiveArena()
  const [pref, setPref] = useState<'auto' | Source>('auto')
  const [reveal, setReveal] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t) }, [notice])

  const liveUsable = live.reachable === true && !!live.data
  const liveRunning = liveUsable && !!live.data!.running
  const source: Source = pref === 'live' && liveUsable ? 'live' : pref === 'replay' && replay ? 'replay' : liveRunning ? 'live' : replay ? 'replay' : 'live'
  const data: ArenaData = (source === 'live' ? live.data : replay) || EMPTY

  const runningTask = useRunningTask(source === 'live' && !!data.running)
  const liveN = source === 'live' && data.running ? data.rounds.length + 1 : 0
  const pairs = useMemo(() => pairsOf(data.rounds), [data.rounds])
  const order = useMemo(() => [...(liveN ? ['live'] : []), ...pairs.flatMap(p => [p.a, p.b].filter(Boolean).map(r => r!.id))], [pairs, liveN])

  const selId = route.round || null
  useEffect(() => {
    if (route.tab !== 'rounds' || selId) return
    const first = liveN ? 'live' : pairs[0]?.a.id
    if (first) go(`/arena/r/${first}`, true)
  }, [route.tab, selId, liveN, pairs])
  useEffect(() => { setReveal(false) }, [selId, route.compare])

  const round = selId && selId !== 'live' ? data.rounds.find(r => r.id === selId) : undefined
  const partner = round ? partnerOf(data.rounds, round) : undefined
  const taskId = selId === 'live' ? runningTask?.id : round?.task_id
  const { items: feed, loading } = useTaskFeed(taskId, source, data.feeds, selId === 'live')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tokenOpen || route.tab !== 'rounds' || (e.target as HTMLElement).closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'r' || e.key === 'R') { setReveal(v => !v); e.preventDefault() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        const i = order.indexOf(selId || '')
        const next = order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))]
        if (next) { go(`/arena/r/${next}`); e.preventDefault() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, selId, tokenOpen, route.tab])

  const writeFail = (what: string) => (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { setTokenOpen(true); setNotice({ text: `${what}: the API needs the operator token.`, bad: true }) }
    else setNotice({ text: `${what}: ${(e as Error)?.message || e}`, bad: true })
  }
  const run = (n: number, p: Profile) => {
    setBusy(true)
    api('POST', '/api/arena/run', { rounds: n, profile: p })
      .then(() => { setNotice({ text: `Match started: ${n} round${n === 1 ? '' : 's'}, OVARA ${p === 'observe' ? 'off' : 'on'}.` }); setPref('live'); live.refresh(); go('/arena/r/live') })
      .catch(writeFail('Could not start')).finally(() => setBusy(false))
  }
  const stop = () => {
    setBusy(true)
    api('POST', '/api/arena/stop').then(() => { setNotice({ text: 'The match stops after the current round.' }); live.refresh() }).catch(writeFail('Could not stop')).finally(() => setBusy(false))
  }

  const s = data.summary
  const recorded = data.recorded_at ? new Date(data.recorded_at) : null

  return (
    <div className="app">
      <header className="app-top">
        <a className="brand" href="#/"><Logo /> OVARA Arena</a>
        <nav className="app-tabs" aria-label="Views">
          <a href="#/arena" className={route.tab === 'rounds' ? 'on' : ''}>Rounds</a>
          <a href="#/arena/receipts" className={route.tab === 'receipts' ? 'on' : ''}>Receipts</a>
          <a href="#/arena/policy" className={route.tab === 'policy' ? 'on' : ''}>Policy</a>
        </nav>
        <div className="app-right">
          {liveUsable && replay && (
            <div className="seg seg-sm" role="group" aria-label="Data source">
              <button className={source === 'replay' ? 'on' : ''} onClick={() => setPref('replay')}>Recorded</button>
              <button className={source === 'live' ? 'on' : ''} onClick={() => setPref('live')}>Live</button>
            </div>
          )}
          <span className={`src ${source === 'live' ? (live.reachable ? 'src-live' : 'src-down') : ''}`}>
            <i className="dot" />
            {source === 'live' ? (live.reachable === false ? 'API unreachable' : 'Live · PayPal sandbox') : `Recorded run${recorded && !isNaN(recorded.getTime()) ? ` · ${recorded.toLocaleDateString([], { dateStyle: 'medium' })}` : ''}`}
          </span>
          {liveUsable && <button className="icon-btn" title={getToken() ? 'Operator token set' : 'Set operator token'} onClick={() => setTokenOpen(true)}><Key size={16} /></button>}
          <a className="btn btn-sm" href="#/">About</a>
        </div>
      </header>

      <div className="score-strip">
        <span className="ss-side"><span className="gate-pill on"><span className="gp-dot" />OVARA on</span>
          <span><span className="ss-num">{s.strict.rounds}</span>rounds</span>
          <span><span className="ss-num">{s.strict.agent_fooled}</span>fooled</span>
          <span><span className="ss-num safe">{s.strict.held_denied + s.strict.refused}</span>held</span>
          <span><span className="ss-num">{s.strict.landed}</span>landed</span>
        </span>
        <span className="ss-side"><span className="gate-pill off"><span className="gp-dot" />OVARA off</span>
          <span><span className="ss-num">{s.observe.rounds}</span>rounds</span>
          <span><span className="ss-num">{s.observe.agent_fooled}</span>fooled</span>
          <span><span className={`ss-num ${s.observe.landed ? 'leak' : ''}`}>{s.observe.landed}</span>landed</span>
          <span><span className={`ss-num ${s.observe.landed ? 'leak' : ''}`}>{usd(s.observe.landed * INVOICE_USD)}</span>cancelled</span>
        </span>
        {source === 'replay' && <span className="ss-note">Played back from the recording. Nothing here calls PayPal.</span>}
      </div>

      {route.tab === 'rounds' ? (
        <div className="app-body">
          <aside className="side" aria-label="Rounds">
            <div className="side-cols"><span>Attack</span><span>OVARA on</span><span>OVARA off</span></div>
            {liveN > 0 && (
              <div className={`pair ${selId === 'live' ? 'sel' : ''}`}>
                <div className="pair-subj"><b>{runningTask?.inbound?.subject || 'Attacker is writing'}</b><span><Loader size={12} /> round {liveN} in play</span></div>
                <button className={`rb ${selId === 'live' ? 'sel' : ''}`} style={{ gridColumn: data.plan?.profile === 'observe' ? 3 : 2 }} onClick={() => go('/arena/r/live')}><span className="live-dot" /><b>Live</b></button>
              </div>
            )}
            {pairs.map((p, i) => {
              const on = p.a.profile === 'strict' ? p.a : p.b
              const off = p.a.profile === 'observe' ? p.a : p.b
              const sel = selId === p.a.id || selId === p.b?.id
              return (
                <div key={p.key} className={`pair ${sel ? 'sel' : ''}`}>
                  <div className="pair-subj"><b title={p.a.attack.subject}>{p.a.attack.subject || '(no subject)'}</b><span>Attack {i + 1} · {p.a.attack.image ? styleWord(p.a.attack.image.style) : 'no image'}</span></div>
                  <RoundButton r={on} sel={!!on && selId === on.id} />
                  <RoundButton r={off} sel={!!off && selId === off.id} />
                </div>
              )
            })}
            {!pairs.length && !liveN && <p className="side-group">{source === 'live' && live.reachable === null ? 'Loading' : 'No rounds yet.'}</p>}
            <div className="side-foot">
              <span className="t-3 small">↑ ↓ to move between rounds, R to reveal.</span>
              {source === 'live' && liveUsable && <Controls data={data} onRun={run} onStop={stop} busy={busy} />}
            </div>
          </aside>
          <main className="main">
            {selId === 'live' && liveN ? (
              <LiveDetail n={liveN} task={runningTask} feed={feed} profile={data.plan?.profile || 'strict'} source={source} />
            ) : round && route.compare && partner ? (
              <CompareView key={`c${round.id}`} round={round} partner={partner} source={source} reveal={reveal} setReveal={setReveal} />
            ) : round ? (
              <RoundDetail key={round.id} round={round} partner={partner} feed={feed} feedLoading={loading} source={source} reveal={reveal} setReveal={setReveal} onNeedToken={() => setTokenOpen(true)} />
            ) : (
              <div className="empty-main">{selId ? 'That round is not in this data.' : 'No rounds yet.'}</div>
            )}
          </main>
        </div>
      ) : (
        <main className="main">{route.tab === 'receipts' ? <ReceiptsView source={source} replay={replay} /> : <PolicyView source={source} replay={replay} />}</main>
      )}

      {tokenOpen && <TokenDialog onClose={() => setTokenOpen(false)} />}
      {notice && <div className={`notice ${notice.bad ? 'bad' : ''}`} role="status">{notice.text}</div>}
    </div>
  )
}
