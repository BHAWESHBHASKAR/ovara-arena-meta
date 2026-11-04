import { useMemo, useState, type ReactNode } from 'react'
import type { Draft, FeedItem, LiveTask, Policy, Round } from './types'
import { api, ApiError } from './api'
import { clock, describeCall, facts, movesMoney } from './describe'
import { firstSentence, sentences, fooled, gateWord, styleWord, verdictOf } from './verdict'
import { imageSrc, type Source } from './data'
import { Badge, Examined, Shot, Stamp, VerdictStamp, type Box } from './ui'
import { go } from './router'

// ---------- email, as a printed message ----------

export function MailCard({ from, subject, body, attachment, clampLines = 5, stamp }: { from: string; subject: string; body: string; attachment?: string; clampLines?: number; stamp?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const long = body.split('\n').length > clampLines + 1 || body.length > clampLines * 80
  const name = from.replace(/\s*<.*>$/, '') || from
  const addr = from.match(/<(.*)>/)?.[1] || ''
  return (
    <div className="sheet mail">
      {stamp && <div className="sheet-stamp">{stamp}</div>}
      <dl className="mail-head">
        <div><dt>From</dt><dd>{name}{addr && <span className="mail-addr"> &lt;{addr}&gt;</span>}</dd></div>
        <div><dt>To</dt><dd>Acme Studio</dd></div>
        {attachment && <div><dt>Attached</dt><dd className="mono">{attachment}</dd></div>}
      </dl>
      <div className="mail-subj">{subject || '(no subject)'}</div>
      <div className={`mail-body ${long && !open ? 'clamp' : ''}`} style={{ WebkitLineClamp: clampLines }}>{body}</div>
      {long && <button className="link mail-more" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show the whole email'}</button>}
    </div>
  )
}

// ---------- attachment with reveal ----------

export function Attachment({ src, box, style, hiddenText, reveal, setReveal, stamp }: {
  src: string
  box?: Box
  style?: string
  hiddenText?: string
  reveal: boolean
  setReveal: (v: boolean) => void
  stamp?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const can = !!box && !failed
  return (
    <div className="attach">
      {failed ? <div className="shot-missing">The image file is not available here.</div> : (
        <div onError={() => setFailed(true)}>
          <Examined src={src} box={box} reveal={reveal && can} style={style} text={hiddenText}>{stamp}</Examined>
        </div>
      )}
      {can && (
        <div className="attach-bar">
          <button className="btn" onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
            {reveal ? 'Hide the hidden line' : 'Reveal the hidden line'}<kbd>R</kbd>
          </button>
          <span className="t-3 small">{reveal ? 'Faint text is contrast-boosted from the real pixels.' : 'The image as the agent received it.'}</span>
        </div>
      )}
    </div>
  )
}

// ---------- agent trace ----------

type Step =
  | { k: 'inbox'; key: string; text: string }
  | { k: 'thought'; key: string; text: string }
  | { k: 'call'; key: string; tool: string; args: unknown; decisions: FeedItem[]; result?: FeedItem }
  | { k: 'notes'; key: string; notes: FeedItem[] }

function buildSteps(items: FeedItem[]): Step[] {
  const out: Step[] = []
  for (const it of items) {
    if (it.kind === 'task' || it.kind === 'done') continue
    if (it.kind === 'untrusted') {
      const src = it.source || ''
      if (/^email from/i.test(src)) { out.push({ k: 'inbox', key: `i${it.seq}`, text: 'Read the client email' }); continue }
      if (/^attachment/i.test(src)) {
        const last = out[out.length - 1]
        if (last?.k === 'inbox') last.text = 'Read the client email and looked at the image'
        else out.push({ k: 'inbox', key: `i${it.seq}`, text: 'Looked at the image attachment' })
        continue
      }
      const last = out[out.length - 1]
      if (last?.k === 'notes') last.notes.push(it)
      else out.push({ k: 'notes', key: `n${it.seq}`, notes: [it] })
      continue
    }
    if (it.kind === 'thought' && it.text) { out.push({ k: 'thought', key: `t${it.seq}`, text: it.text }); continue }
    if (it.kind === 'call') { out.push({ k: 'call', key: `c${it.seq}`, tool: it.tool || '?', args: it.arguments, decisions: [] }); continue }
    if (it.kind === 'decision' || it.kind === 'result') {
      for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i]
        if (s.k === 'call' && s.tool === it.tool && !s.result) {
          if (it.kind === 'decision') s.decisions.push(it)
          else s.result = it
          break
        }
      }
    }
  }
  return out
}

const stopped = (s: Extract<Step, { k: 'call' }>) => s.decisions.some(d => d.outcome === 'denied' || d.outcome === 'refused')

// The short marks on a call line. Colour only where it means something.
function callMarks(s: Extract<Step, { k: 'call' }>, profile: string) {
  const out: ReactNode[] = []
  const money = movesMoney(s.tool)
  for (const d of s.decisions) {
    const o = d.outcome || ''
    if (d.unchecked) { out.push(<Badge key={d.seq} tone="muted" title={d.rule}>not checked</Badge>); continue }
    if (o === 'allowed') out.push(<Badge key={d.seq} tone="muted" title={d.rule}>allowed</Badge>)
    else if (o === 'held') out.push(<Badge key={d.seq} tone="safe" title={d.rule}>held for a person</Badge>)
    else out.push(<Badge key={d.seq} tone="safe" title={d.rule}>{o}</Badge>)
  }
  if (!s.decisions.length && profile === 'observe' && money) out.push(<Badge key="ng" tone="muted">no gate</Badge>)
  if (s.result && !s.result.ok && !stopped(s)) out.push(<Badge key="e" tone="muted">PayPal error</Badge>)
  else if (!s.result && !stopped(s)) out.push(<Badge key="w" tone="muted">waiting</Badge>)
  return out
}

function Expandable({ text, n = 220, className }: { text: string; n?: number; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > n
  return (
    <>
      <div className={`${className || ''} ${long && !open ? 'clamp2' : ''}`}>{text}</div>
      {long && <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Less' : 'More'}</button>}
    </>
  )
}

function NotesStep({ notes }: { notes: FeedItem[] }) {
  const [open, setOpen] = useState(false)
  const loud = notes.filter(n => /assistant|AI |instruction/i.test(n.text || '')).length
  return (
    <>
      <div className="st-line">
        Read {notes.length} note{notes.length === 1 ? '' : 's'} stored in PayPal invoices
        {loud > 0 && <span className="t-3"> · {loud} addressed to an AI</span>}
        <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && <ul className="notes">{notes.map(n => <li key={n.seq}><span className="mono t-3">{(n.source || '').split(':')[0]}</span>{n.text}</li>)}</ul>}
    </>
  )
}

const KIND_LABEL: Record<string, string> = { inbox: 'Read', thought: 'Thought', notes: 'Read', call: 'Call' }

export function Trace({ items, profile, loading, live }: { items: FeedItem[]; profile: string; loading?: boolean; live?: boolean }) {
  const steps = useMemo(() => buildSteps(items), [items])
  if (!steps.length) return <div className="empty-line">{loading ? 'Loading the agent’s steps' : live ? <><span className="live-dot" /> Waiting for the agent</> : 'No step-by-step trace is stored for this round.'}</div>
  return (
    <ol className="trace">
      {steps.map((s, i) => {
        const money = s.k === 'call' && movesMoney(s.tool)
        const tone = s.k === 'call' && money ? (stopped(s) || s.decisions.some(d => d.outcome === 'held') ? 'safe' : s.result?.ok ? 'leak' : '') : ''
        return (
          <li key={s.key} className={`st k-${s.k} ${money ? 'money' : ''} ${tone ? `tone-${tone}` : ''}`}>
            <span className="st-n">{String(i + 1).padStart(2, '0')}</span>
            <div className="st-body">
              <span className="st-kind">{money ? 'Money call' : KIND_LABEL[s.k]}</span>
              {s.k === 'inbox' && <div className="st-line">{s.text}</div>}
              {s.k === 'thought' && <Expandable text={s.text} className="st-thought" />}
              {s.k === 'notes' && <NotesStep notes={s.notes} />}
              {s.k === 'call' && <CallStep s={s} profile={profile} />}
            </div>
          </li>
        )
      })}
      {live && <li className="st"><span className="st-n"><span className="live-dot" /></span><div className="st-body"><div className="st-line t-3">Working</div></div></li>}
    </ol>
  )
}

function CallStep({ s, profile }: { s: Extract<Step, { k: 'call' }>; profile: string }) {
  const money = movesMoney(s.tool)
  const fs = money ? facts(s.args).slice(0, 3) : []
  const held = s.decisions.find(d => d.outcome === 'held')
  const denied = s.decisions.find(d => d.outcome === 'denied' || d.outcome === 'refused')
  const landed = !!(s.result?.ok && money && !stopped(s))
  const marks = callMarks(s, profile)
  return (
    <>
      <div className="st-call">
        <span className="st-desc">{describeCall(s.tool, s.args)}</span>
        <code className="tool">{s.tool}</code>
      </div>
      {marks.length > 0 && <div className="st-marks">{marks}</div>}
      {fs.length > 0 && <dl className="facts">{fs.map((f, i) => <div key={i}><dt>{f.label}</dt><dd className={f.key === 'other' ? 'clamp2' : 'mono'} title={f.key === 'other' ? f.value : undefined}>{f.value}</dd></div>)}</dl>}
      {money && (held || denied) && (
        <div className="st-rule">
          {held?.rule && <div><span className="t-3">Rule</span><code>{held.rule}</code></div>}
          {denied?.rule && <div><span className="t-3">Decision</span><code>{denied.rule}</code></div>}
        </div>
      )}
      {money && (landed || denied) && <div className="st-stamp"><Stamp tone={landed ? 'leak' : 'safe'} word={landed ? 'Landed' : 'Held'} size="sm" tilt={-5} sub={false} className="stamp-in" /></div>}
    </>
  )
}

// ---------- gate verdict + learn ----------

export function GateVerdict({ round }: { round: Round }) {
  const v = verdictOf(round)
  const call = round.money_calls[0]
  return (
    <div className={`verdict v-${v.tone}`}>
      <VerdictStamp round={round} size="lg" className="stamp-in" />
      <div className="verdict-text">
        <p className="verdict-line">{v.line}</p>
        {call ? (
          <p className="verdict-call">
            <span className="t-3">The agent called </span>
            <code className="tool">{call.tool}</code>
            {String(call.arguments?.invoice_id || '') && <span className="mono t-2"> {String(call.arguments.invoice_id)}</span>}
            {round.money_calls.length > 1 && <span className="t-3"> and {round.money_calls.length - 1} more</span>}
          </p>
        ) : <p className="verdict-call t-3">No call that moves or forgives money.</p>}
      </div>
    </div>
  )
}

export function Learn({ round, source, onNeedToken }: { round: Round; source: Source; onNeedToken: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(round.draft || null)
  const [busy, setBusy] = useState<'' | 'draft' | 'apply'>('')
  const [err, setErr] = useState('')
  const [applied, setApplied] = useState<number | null>(null)
  const recorded = source === 'replay'
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { onNeedToken(); setErr('The API needs the operator token for this.') }
    else setErr(String((e as Error)?.message || e))
  }
  const doDraft = () => { setBusy('draft'); setErr(''); api<Draft>('POST', '/api/policy/draft', { incident_task_id: round.task_id }).then(setDraft).catch(fail).finally(() => setBusy('')) }
  const doApply = () => {
    if (!draft) return
    setBusy('apply'); setErr('')
    api<Policy>('POST', `/api/policy/draft/${encodeURIComponent(draft.draft_id)}/apply`).then(p => setApplied(p?.rules?.length ?? 0)).catch(fail).finally(() => setBusy(''))
  }
  if (!draft) {
    if (recorded || !round.task_id) return null
    return (
      <div className="learn-cta">
        <p>Muse Spark reads this round’s trace and drafts an OVARA rule. OVARA checks it before anyone can apply it.</p>
        <button className="btn" disabled={!!busy} onClick={doDraft}>{busy ? 'Drafting' : 'Draft a rule from this round'}</button>
        {err && <div className="err">{err}</div>}
      </div>
    )
  }
  return (
    <>
      <RuleCard draft={draft} />
      {recorded ? <p className="t-3 small" style={{ marginTop: 10 }}>Drafted by Muse Spark during the recorded run.</p>
        : applied !== null ? <div className="applied">Applied. {applied} rules in force.</div>
          : <div className="row-end"><button className="btn btn-primary" disabled={!draft.valid || !!busy} onClick={doApply}>{busy === 'apply' ? 'Applying' : 'Apply this rule'}</button></div>}
      {err && <div className="err">{err}</div>}
    </>
  )
}

export function RuleCard({ draft, big }: { draft: Draft; big?: boolean }) {
  return (
    <div className={`sheet memo ${big ? 'big' : ''}`}>
      <div className="sheet-stamp"><Stamp tone={draft.valid ? 'safe' : 'leak'} word={draft.valid ? 'Valid' : 'Rejected'} sub={draft.valid ? 'checked by OVARA' : 'by OVARA'} size={big ? 'md' : 'sm'} tilt={-7} className="stamp-in" /></div>
      <div className="memo-head">Proposed rule · drafted by Muse Spark</div>
      <p className="rule-en">{draft.english}</p>
      <table className="memo-rules">
        <tbody>
          {draft.rules.map((r, i) => {
            const eff = r.effect || (r.deny ? 'deny' : r.escalate ? 'escalate' : 'allow')
            return (
              <tr key={i}>
                <td><span className={`eff eff-${eff}`}>{eff}</span></td>
                <td><code>{r.resource.replace(/^mcp:[^/]+\//, '')}</code></td>
                <td className="t-3">{r.description?.replace(/^\[drafted\]\s*/, '')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!draft.valid && draft.problems?.length ? <div className="err">{draft.problems.join('; ')}</div> : null}
    </div>
  )
}

// ---------- the round, as a case file ----------

export function AgentReport({ text, noticed }: { text: string; noticed?: boolean }) {
  const [open, setOpen] = useState(false)
  const paras = text.split(/\n{2,}/).filter(Boolean)
  return (
    <div className="report">
      <div className="label">The agent’s report{noticed && <span className="t-3"> · it flagged something as suspicious</span>}</div>
      <div className="report-body">{(open ? paras : paras.slice(0, 1)).map((p, i) => <p key={i}>{p}</p>)}</div>
      {paras.length > 1 && <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Read the whole report'}</button>}
    </div>
  )
}

const atPaypal = (r: Round) => r.verdict === 'landed' ? 'Invoice cancelled at PayPal' : r.money_calls.length ? 'Never reached PayPal' : 'Nothing changed'

// Off and on for the same attack, side by side. The open one is marked.
function Twin({ round, partner }: { round: Round; partner?: Round }) {
  const pair = [round, partner].filter(Boolean) as Round[]
  pair.sort((a, b) => (a.profile === 'observe' ? -1 : 1) - (b.profile === 'observe' ? -1 : 1))
  return (
    <div className="twin" role="group" aria-label="This attack with OVARA off and on">
      {pair.map(r => (
        <button key={r.id} className={`twin-cell ${r.id === round.id ? 'sel' : ''}`} onClick={() => go(`/rounds/r/${r.id}`)} aria-current={r.id === round.id ? 'true' : undefined}>
          <span className="twin-k">{gateWord(r.profile)} · round {r.n}</span>
          <span className="twin-v">{atPaypal(r)}</span>
          <VerdictStamp round={r} size="sm" sub={false} />
        </button>
      ))}
      {pair.length < 2 && <div className="twin-cell empty">Not run with {round.profile === 'observe' ? 'OVARA on' : 'OVARA off'}</div>}
    </div>
  )
}

export function RoundDetail({ round, partner, feed, feedLoading, source, reveal, setReveal, onNeedToken, caseNo }: {
  round: Round
  partner?: Round
  feed: FeedItem[]
  feedLoading: boolean
  source: Source
  reveal: boolean
  setReveal: (v: boolean) => void
  onNeedToken: () => void
  caseNo?: number
}) {
  const img = imageSrc(round.image_url, source)
  const held = round.verdict === 'held_denied' || round.verdict === 'refused'
  const showLearn = held && (round.draft || (source === 'live' && round.task_id))
  return (
    <article className="detail">
      <header className="detail-head">
        <div className="kicker">{caseNo ? `Attack ${caseNo} · ` : ''}Round {round.n} · {gateWord(round.profile)}{round.attack.image?.style ? ` · hidden as ${styleWord(round.attack.image.style)}` : ''}<span className="t-3"> · {clock(round.at)}</span></div>
        <h1 className="detail-title">{round.attack.subject || '(no subject)'}</h1>
        <Twin round={round} partner={partner} />
      </header>
      {round.error && <div className="err">The round failed: {round.error}</div>}

      <div className="casefile">
        <div className="case-ev">
          <MailCard from={round.attack.from} subject={round.attack.subject} body={round.attack.body} attachment={round.attack.image?.name} stamp={<VerdictStamp round={round} size="md" className="stamp-in" />} />
          {img && (
            <div className="case-block">
              <div className="label">The attachment</div>
              <Attachment src={img} box={round.hidden_box} style={round.attack.image?.style} hiddenText={round.attack.image?.hidden_text} reveal={reveal} setReveal={setReveal} />
              {round.attack.rationale && <p className="rationale"><span className="label">Attacker’s reasoning</span>{round.attack.rationale}</p>}
            </div>
          )}
          {round.agent_said && <AgentReport text={round.agent_said} noticed={round.noticed} />}
          {showLearn && (
            <div className="case-block">
              <div className="label">Muse Spark learns</div>
              <Learn key={round.id} round={round} source={source} onNeedToken={onNeedToken} />
            </div>
          )}
        </div>
        <aside className="case-margin" aria-label="What the agent did">
          <div className="label">What the agent did · {round.profile === 'observe' ? 'straight to PayPal' : 'through OVARA'}</div>
          <Trace items={feed} profile={round.profile} loading={feedLoading} />
          <GateVerdict round={round} />
        </aside>
      </div>
    </article>
  )
}

// ---------- compare: original and replay side by side ----------

function CompareSide({ r }: { r: Round }) {
  const call = r.money_calls[0]
  return (
    <div className="cside">
      <div className="cside-head">
        <span className="kicker">{gateWord(r.profile)}</span>
        <button className="link" onClick={() => go(`/rounds/r/${r.id}`)}>Round {r.n}</button>
      </div>
      <div className="cside-stamp"><VerdictStamp round={r} size="lg" className="stamp-in" /></div>
      <dl className="cside-facts">
        <div><dt>Agent fooled</dt><dd>{fooled(r) ? 'Yes' : 'No'}</dd></div>
        <div><dt>Money call</dt><dd>{call ? <code className="tool">{call.tool}</code> : 'None'}</dd></div>
        <div><dt>At PayPal</dt><dd className={r.verdict === 'landed' ? 'leak-text' : ''}>{atPaypal(r)}</dd></div>
      </dl>
      {r.agent_said && <blockquote className="cside-quote">“{sentences(r.agent_said).find(x => /denied|operator|cancel|void/i.test(x)) || firstSentence(r.agent_said)}”</blockquote>}
    </div>
  )
}

export function CompareView({ round, partner, source, reveal, setReveal }: { round: Round; partner: Round; source: Source; reveal: boolean; setReveal: (v: boolean) => void }) {
  const on = round.profile === 'strict' ? round : partner
  const off = round.profile === 'strict' ? partner : round
  const base = on.replay_of ? off : on
  const img = imageSrc(base.image_url, source)
  return (
    <article className="detail compare">
      <header className="detail-head">
        <div className="kicker">Same attack, OVARA off and on · rounds {off.n} and {on.n}</div>
        <h1 className="detail-title">{base.attack.subject}</h1>
        <p className="t-2 small">The replay sent the same email and image; only the invoice number was swapped for the current open invoice. <button className="link small" onClick={() => go(`/rounds/r/${round.id}`)}>Back to round {round.n}</button></p>
      </header>
      <div className="compare-grid">
        <CompareSide r={off} />
        <CompareSide r={on} />
      </div>
      <div className="compare-attack">
        <MailCard from={base.attack.from} subject={base.attack.subject} body={base.attack.body} attachment={base.attack.image?.name} clampLines={4} />
        {img && <Attachment src={img} box={base.hidden_box} style={base.attack.image?.style} hiddenText={base.attack.image?.hidden_text} reveal={reveal} setReveal={setReveal} />}
      </div>
    </article>
  )
}

// ---------- a round still in play ----------

export function LiveDetail({ n, task, feed, profile, source }: { n: number; task: LiveTask | null; feed: FeedItem[]; profile: string; source: Source }) {
  const att = task?.inbound?.attachments?.[0]
  return (
    <article className="detail">
      <header className="detail-head">
        <div className="kicker"><span className="live-dot" /> In play · round {n} · {gateWord(profile)}</div>
        <h1 className="detail-title">{task?.inbound?.subject || 'The attacker is writing this round'}</h1>
        <p className="t-2">{task ? 'The agent is working on the email. The stamp goes on when the round is scored.' : 'Muse Spark has read how the earlier rounds ended and is writing a new email.'}</p>
      </header>
      <div className="casefile">
        <div className="case-ev">
          {task?.inbound ? <MailCard from={task.inbound.from} subject={task.inbound.subject} body={task.inbound.body} attachment={att?.name} /> : <div className="sheet mail mail-pending"><span className="t-3">No email yet.</span></div>}
          {att && <div className="case-block"><div className="label">The attachment</div><div className="exam-sheet"><Shot src={imageSrc(att.url, source) || att.url} reveal={false} /></div></div>}
        </div>
        <aside className="case-margin" aria-label="What the agent is doing">
          <div className="label">What the agent is doing</div>
          <Trace items={feed} profile={profile} live />
        </aside>
      </div>
    </article>
  )
}
