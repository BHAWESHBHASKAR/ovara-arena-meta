import { useEffect, useMemo, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import type { ArenaData, Profile, Round } from './types'
import { useLiveArena, useRunningTask, useTaskFeed, type Source } from './data'
import { go, type Route } from './router'
import { Logo, VerdictStamp } from './ui'
import { CompareView, LiveDetail, RoundDetail } from './Round'
import { PolicyView, ReceiptsView } from './Secondary'
import { INVOICE_USD, groupsOf, partnerOf, styleWord, usd, verdictOf } from './verdict'


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
        <div className="modal-head">Operator token <button className="link small" onClick={onClose}>Close</button></div>
        <p>Starting or stopping a match and drafting rules need the API token (sent as <code>Authorization: Bearer</code>). It stays in this browser.</p>
        <input className="input mono" type="password" autoFocus value={v} placeholder="API token" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
        <div className="row-end">
          {getToken() && <button className="btn ghost" onClick={() => { setToken(''); onClose() }}>Forget</button>}
          <button className="btn btn-primary" onClick={save}>Save token</button>
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
        <div className="label">Live match · round {Math.min(plan.done + 1, plan.rounds)} of {plan.rounds} · OVARA {plan.profile === 'observe' ? 'off' : 'on'}</div>
        <div className="progress"><span style={{ transform: `scaleX(${plan.done / Math.max(1, plan.rounds)})` }} /></div>
        <button className="btn btn-sm" disabled={busy} onClick={onStop}>Stop after this round</button>
      </div>
    )
  }
  return (
    <div className="controls">
      <div className="label">Run a live match</div>
      <div className="controls-row">
        <label>Rounds <input type="number" min={1} max={20} value={n} onChange={e => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
        <div className="seg seg-sm" role="group" aria-label="Gate">
          <button className={p === 'strict' ? 'on' : ''} onClick={() => setP('strict')}>OVARA on</button>
          <button className={p === 'observe' ? 'on' : ''} onClick={() => setP('observe')}>OVARA off</button>
        </div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onRun(n, p)}>{busy ? 'Starting' : 'Start the match'}</button>
      </div>
    </div>
  )
}

function StampCell({ r, sel, count = 1 }: { r?: Round; sel: boolean; count?: number }) {
  if (!r) return <span className="lcell-stamp empty">not run</span>
  const v = verdictOf(r)
  return (
    <button className={`lcell-stamp ${sel ? 'sel' : ''}`} onClick={e => { e.stopPropagation(); go(`/rounds/r/${r.id}`) }} aria-label={`Round ${r.n}, OVARA ${r.profile === 'observe' ? 'off' : 'on'}: ${v.word}`} aria-current={sel ? 'true' : undefined}>
      <VerdictStamp round={r} size="xs" sub={false} />
      <span className="lcell-r">R{r.n}{count > 1 ? ` +${count - 1}` : ''}</span>
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
  // Once a live run has been seen (or Live was picked), stay on Live; Recorded is only the first-load default.
  const [stickyLive, setStickyLive] = useState(false)
  useEffect(() => { if (liveRunning) setStickyLive(true) }, [liveRunning])
  const source: Source = pref === 'replay' && replay ? 'replay'
    : (pref === 'live' || stickyLive) && (liveUsable || live.data) ? 'live'
    : liveRunning ? 'live' : replay ? 'replay' : 'live'
  const data: ArenaData = (source === 'live' ? live.data : replay) || EMPTY

  const runningTask = useRunningTask(source === 'live' && !!data.running)
  const liveN = source === 'live' && data.running ? data.rounds.length + 1 : 0
  const groups = useMemo(() => groupsOf(data.rounds), [data.rounds])
  const order = useMemo(() => [...(liveN ? ['live'] : []), ...groups.flatMap(g => [...g.on, ...g.off].sort((a, b) => a.n - b.n).map(r => r.id))], [groups, liveN])

  const selId = route.round || null
  useEffect(() => {
    if (route.tab !== 'rounds' || selId) return
    // open on the most telling case: the first attack that landed with OVARA off
    const landed = groups.find(g => g.off.some(r => r.verdict === 'landed'))?.off.find(r => r.verdict === 'landed')
    const first = liveN ? 'live' : landed?.id || groups[0]?.root.id
    if (first) go(`/rounds/r/${first}`, true)
  }, [route.tab, selId, liveN, groups])
  useEffect(() => { setReveal(false) }, [selId, route.compare])
  useEffect(() => {
    document.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' })
    document.getElementById('case')?.scrollTo({ top: 0 })
  }, [selId])

  // When the live round is scored, keep showing it: switch to the round that ran that task.
  const [liveTaskId, setLiveTaskId] = useState<string | null>(null)
  useEffect(() => { if (runningTask?.id) setLiveTaskId(runningTask.id) }, [runningTask?.id])
  useEffect(() => {
    if (selId !== 'live' || liveN) return
    const done = (liveTaskId && data.rounds.find(r => r.task_id === liveTaskId)) || [...data.rounds].sort((a, b) => b.n - a.n)[0]
    if (done) go(`/rounds/r/${done.id}`, true)
  }, [selId, liveN, liveTaskId, data.rounds])

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
        if (next) { go(`/rounds/r/${next}`); e.preventDefault() }
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
      .then(() => { setNotice({ text: `Match started: ${n} round${n === 1 ? '' : 's'}, OVARA ${p === 'observe' ? 'off' : 'on'}.` }); setPref('live'); live.refresh(); go('/rounds/r/live') })
      .catch(writeFail('Could not start')).finally(() => setBusy(false))
  }
  const stop = () => {
    setBusy(true)
    api('POST', '/api/arena/stop').then(() => { setNotice({ text: 'The match stops after the current round.' }); live.refresh() }).catch(writeFail('Could not stop')).finally(() => setBusy(false))
  }

  const s = data.summary
  const recorded = data.recorded_at ? new Date(data.recorded_at) : null
  const caseNo = round ? groups.findIndex(g => g.on.includes(round) || g.off.includes(round)) + 1 : 0

  return (
    <div className="app">
      <header className="app-top">
        <a className="brand" href="#/"><Logo /> OVARA Arena</a>
        <nav className="app-tabs" aria-label="Views">
          <a href="#/rounds" className={route.tab === 'rounds' ? 'on' : ''} aria-current={route.tab === 'rounds' ? 'page' : undefined}>Ledger</a>
          <a href="#/rounds/receipts" className={route.tab === 'receipts' ? 'on' : ''} aria-current={route.tab === 'receipts' ? 'page' : undefined}>Receipts</a>
          <a href="#/rounds/policy" className={route.tab === 'policy' ? 'on' : ''} aria-current={route.tab === 'policy' ? 'page' : undefined}>Policy</a>
        </nav>
        <div className="app-right">
          {liveUsable && replay && (
            <div className="seg seg-sm" role="group" aria-label="Data source">
              <button className={source === 'replay' ? 'on' : ''} onClick={() => setPref('replay')}>Recorded</button>
              <button className={source === 'live' ? 'on' : ''} onClick={() => setPref('live')}>Live</button>
            </div>
          )}
          <span className={`src ${source === 'live' ? (live.reachable ? 'src-live' : 'src-down') : ''}`}>
            {source === 'live' ? (live.reachable === false ? 'API unreachable' : 'Live · PayPal sandbox') : `Recorded run${recorded && !isNaN(recorded.getTime()) ? ` · ${recorded.toLocaleDateString([], { dateStyle: 'medium' })}` : ''}`}
          </span>
          {liveUsable && <button className="link small" title={getToken() ? 'Operator token set' : 'Set operator token'} onClick={() => setTokenOpen(true)}>Token</button>}
          <a className="link small" href="#/">Overview</a>
        </div>
      </header>

      {route.tab === 'rounds' ? (
        <div className="app-body">
          <aside className="ledger-pane" aria-label="Rounds">
            <div className="ledger-head">
              <h1>The ledger</h1>
              <p className="t-2">Each attack, sent with OVARA off and on.{source === 'replay' ? ' Played back from the recording.' : ''}</p>
            </div>
            <div className="ledger" role="table" aria-label="Attacks with OVARA off and on">
              <div className="lrow lhead" role="row"><span>#</span><span>Hidden as</span><span>Email subject</span><span>OVARA off</span><span>OVARA on</span></div>
              {liveN > 0 && (
                <div className={`lrow lrow-live ${selId === 'live' ? 'sel' : ''}`} role="row" onClick={() => go('/rounds/r/live')}>
                  <span className="lnum"><span className="live-dot" /></span>
                  <span className="lhow">in play</span>
                  <button className="lsubj" onClick={() => go('/rounds/r/live')} aria-current={selId === 'live' ? 'true' : undefined}>{runningTask?.inbound?.subject || 'The attacker is writing'}<span className="lsub">Round {liveN} · OVARA {data.plan?.profile === 'observe' ? 'off' : 'on'}</span></button>
                  <span className="lplay" style={{ gridColumn: data.plan?.profile === 'observe' ? 4 : 5 }}><i /></span>
                  <span className="lrule" aria-hidden="true" />
                </div>
              )}
              {groups.map((g, i) => {
                const on = g.on[g.on.length - 1]
                const off = g.off[g.off.length - 1]
                const runs = [...g.on, ...g.off].sort((a, b) => a.n - b.n)
                const sel = runs.some(r => r.id === selId)
                const selOn = g.on.find(r => r.id === selId)
                const selOff = g.off.find(r => r.id === selId)
                const open = () => go(`/rounds/r/${(off || on).id}`)
                return (
                  <div key={g.key} className={`lrow ${sel ? 'sel' : ''}`} role="row" onClick={open}>
                    <span className="lnum">{i + 1}</span>
                    <span className="lhow">{g.root.attack.image ? styleWord(g.root.attack.image.style) : 'no image'}</span>
                    <button className="lsubj" onClick={e => { e.stopPropagation(); open() }} title={g.root.attack.subject} aria-current={sel ? 'true' : undefined}>{g.root.attack.subject || '(no subject)'}</button>
                    <StampCell r={selOff || off} sel={!!(selOff || (off && selId === off.id))} count={g.off.length} />
                    <StampCell r={selOn || on} sel={!!(selOn || (on && selId === on.id))} count={g.on.length} />
                    {runs.length > 2 && sel && (
                      <div className="lruns">
                        All runs: {runs.map(r => <button key={r.id} className={`run-chip ${r.id === selId ? 'on' : ''}`} onClick={e => { e.stopPropagation(); go(`/rounds/r/${r.id}`) }} title={`Round ${r.n}, OVARA ${r.profile === 'observe' ? 'off' : 'on'}: ${verdictOf(r).word}`}>R{r.n} {r.profile === 'observe' ? 'off' : 'on'}</button>)}
                      </div>
                    )}
                  </div>
                )
              })}
              {groups.length > 0 && (
                <div className="lrow ltotal" role="row">
                  <span />
                  <span className="lhow">Total</span>
                  <span className="lsubj-t">Invoices cancelled at PayPal</span>
                  <span className={`ltot ${s.observe.landed ? 'leak' : ''}`}>{s.observe.landed}<small>{usd(s.observe.landed * INVOICE_USD)}</small></span>
                  <span className={`ltot ${s.strict.landed ? 'leak' : ''}`}>{s.strict.landed}<small>{usd(s.strict.landed * INVOICE_USD)}</small></span>
                </div>
              )}
              {!groups.length && !liveN && <p className="ledger-empty">{source === 'live' && live.reachable === null ? 'Loading' : 'No rounds yet.'}</p>}
            </div>
            <div className="ledger-foot">
              <span className="t-3 small"><kbd>↑</kbd> <kbd>↓</kbd> move between rounds · <kbd>R</kbd> reveal the hidden line</span>
              {source === 'live' && liveUsable && <Controls data={data} onRun={run} onStop={stop} busy={busy} />}
            </div>
          </aside>
          <main className="main" id="case">
            {selId === 'live' && liveN ? (
              <LiveDetail n={liveN} task={runningTask} feed={feed} profile={data.plan?.profile || 'strict'} source={source} />
            ) : round && route.compare && partner ? (
              <CompareView key={`c${round.id}`} round={round} partner={partner} source={source} reveal={reveal} setReveal={setReveal} />
            ) : round ? (
              <RoundDetail key={round.id} round={round} partner={partner} feed={feed} feedLoading={loading} source={source} reveal={reveal} setReveal={setReveal} onNeedToken={() => setTokenOpen(true)} caseNo={caseNo} />
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
