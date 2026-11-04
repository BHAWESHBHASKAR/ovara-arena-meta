import { useMemo, useState, type ReactNode } from 'react'
import type { Draft, FeedItem, LiveTask, Policy, Round } from './types'
import { api, ApiError } from './api'
import { clock, describeCall, facts, movesMoney } from './describe'
import { firstSentence, sentences, fooled, gateWord, styleWord, verdictOf } from './verdict'
import { imageSrc, type Source } from './data'
import { Badge, GatePill, Shot, VerdictBadge, type Box } from './ui'
import { go } from './router'
import { Alert, ArrowRight, Brain, Check, Eye, EyeOff, Hand, Inbox, Loader, Paperclip, Scale, ShieldCheck, Wrench, X } from './icons'

// ---------- email ----------

export function MailCard({ from, subject, body, attachment, clampLines = 5 }: { from: string; subject: string; body: string; attachment?: string; clampLines?: number }) {
  const [open, setOpen] = useState(false)
  const long = body.split('\n').length > clampLines + 1 || body.length > clampLines * 80
  return (
    <div className="mail">
      <div className="mail-head">
        <div className="mail-avatar" aria-hidden="true">{(from.trim()[0] || '?').toUpperCase()}</div>
        <div className="mail-meta">
          <div className="mail-from">{from.replace(/\s*<.*>$/, '') || from}<span className="mail-addr">{from.match(/<(.*)>/)?.[1] || ''}</span></div>
          <div className="mail-to">to Acme Studio</div>
        </div>
      </div>
      <div className="mail-subj">{subject || '(no subject)'}</div>
      <div className={`mail-body ${long && !open ? 'clamp' : ''}`} style={{ WebkitLineClamp: clampLines }}>{body}</div>
      <div className="mail-foot">
        {attachment && <span className="att-pill"><Paperclip size={13} />{attachment}</span>}
        {long && <button className="link" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show the whole email'}</button>}
      </div>
    </div>
  )
}

// ---------- attachment with reveal ----------

export function Attachment({ src, box, style, hiddenText, reveal, setReveal }: {
  src: string
  box?: Box
  style?: string
  hiddenText?: string
  reveal: boolean
  setReveal: (v: boolean) => void
}) {
  const [failed, setFailed] = useState(false)
  const can = !!box && !failed
  return (
    <div className="attach">
      {failed ? <div className="shot-missing">The image file is not available here.</div> : (
        <div onError={() => setFailed(true)}>
          <Shot src={src} box={box} reveal={reveal && can} style={style} label={`Hidden instruction · ${styleWord(style)}`} />
        </div>
      )}
      {can && (
        <div className="attach-bar">
          <button className={`btn ${reveal ? '' : 'btn-accent'}`} onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}{reveal ? 'Hide' : 'Reveal hidden text'}<kbd>R</kbd>
          </button>
          <span className="t-3 small">{reveal ? 'Region outlined; faint text contrast-boosted from the real pixels.' : 'This is the image the agent received.'}</span>
        </div>
      )}
      {can && reveal && hiddenText && (
        <blockquote className="hidden-text">
          <div className="eyebrow">The hidden line, as the attacker wrote it</div>
          {hiddenText}
        </blockquote>
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

function callBadges(s: Extract<Step, { k: 'call' }>, profile: string) {
  const out: ReactNode[] = []
  const money = movesMoney(s.tool)
  for (const d of s.decisions) {
    const o = d.outcome || ''
    if (d.unchecked) { out.push(<Badge key={d.seq} tone="muted" size="sm" title={d.rule}>not checked · OVARA off</Badge>); continue }
    if (o === 'allowed') out.push(<Badge key={d.seq} tone="muted" size="sm" title={d.rule}><Check size={12} />allowed</Badge>)
    else if (o === 'held') out.push(<Badge key={d.seq} tone="safe" size="sm" title={d.rule}><Hand size={12} />held</Badge>)
    else out.push(<Badge key={d.seq} tone="safe" size="sm" title={d.rule}><X size={12} />{o}</Badge>)
  }
  if (!s.decisions.length && profile === 'observe' && money) out.push(<Badge key="ng" tone="muted" size="sm">no gate</Badge>)
  if (s.result?.ok && money && !stopped(s)) out.push(<Badge key="l" tone="leak" size="sm">landed</Badge>)
  else if (s.result && !s.result.ok && !stopped(s)) out.push(<Badge key="e" tone="muted" size="sm">PayPal error</Badge>)
  else if (!s.result && !stopped(s)) out.push(<Badge key="w" tone="muted" size="sm"><Loader size={12} />waiting</Badge>)
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
        {loud > 0 && <span className="t-3"> · {loud} addressed to an AI assistant</span>}
        <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && <ul className="notes">{notes.map(n => <li key={n.seq}><span className="mono t-3">{(n.source || '').split(':')[0]}</span>{n.text}</li>)}</ul>}
    </>
  )
}

export function Trace({ items, profile, loading, live }: { items: FeedItem[]; profile: string; loading?: boolean; live?: boolean }) {
  const steps = useMemo(() => buildSteps(items), [items])
  if (!steps.length) return <div className="empty-line">{loading ? <><Loader size={15} /> Loading the agent's steps</> : live ? <><Loader size={15} /> Waiting for the agent</> : 'No step-by-step trace is stored for this round.'}</div>
  return (
    <ol className="trace">
      {steps.map(s => {
        const money = s.k === 'call' && movesMoney(s.tool)
        const tone = s.k === 'call' && money ? (stopped(s) ? 'safe' : s.result?.ok ? 'leak' : 'safe') : ''
        const icon = s.k === 'inbox' ? <Inbox size={14} /> : s.k === 'thought' ? <Brain size={14} /> : s.k === 'notes' ? <Alert size={14} /> : money ? <Scale size={14} /> : <Wrench size={14} />
        return (
          <li key={s.key} className={`st k-${s.k} ${money ? 'money' : ''} ${tone ? `tone-${tone}` : ''}`}>
            <span className="st-dot">{icon}</span>
            <div className="st-body">
              {s.k === 'inbox' && <div className="st-line">{s.text}</div>}
              {s.k === 'thought' && <Expandable text={s.text} className="st-thought" />}
              {s.k === 'notes' && <NotesStep notes={s.notes} />}
              {s.k === 'call' && <CallStep s={s} profile={profile} />}
            </div>
          </li>
        )
      })}
      {live && <li className="st"><span className="st-dot"><Loader size={14} /></span><div className="st-body"><div className="st-line t-3">Working</div></div></li>}
    </ol>
  )
}

function CallStep({ s, profile }: { s: Extract<Step, { k: 'call' }>; profile: string }) {
  const money = movesMoney(s.tool)
  const fs = money ? facts(s.args).slice(0, 3) : []
  const held = s.decisions.find(d => d.outcome === 'held')
  const denied = s.decisions.find(d => d.outcome === 'denied' || d.outcome === 'refused')
  return (
    <>
      <div className="st-call">
        <span className="st-desc">{describeCall(s.tool, s.args)}</span>
        <code className="tool">{s.tool}</code>
        <span className="st-badges">{callBadges(s, profile)}</span>
      </div>
      {fs.length > 0 && <dl className="facts">{fs.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
      {money && (held || denied) && (
        <div className="st-rule">
          {held?.rule && <div><span className="t-3">Rule</span><code>{held.rule}</code></div>}
          {denied?.rule && <div><span className="t-3">Decision</span><code>{denied.rule}</code></div>}
        </div>
      )}
    </>
  )
}

// ---------- gate verdict + learn ----------

export function GateVerdict({ round }: { round: Round }) {
  const v = verdictOf(round)
  const call = round.money_calls[0]
  return (
    <div className={`verdict v-${v.tone}`}>
      <div className="verdict-top">
        <VerdictBadge round={round} size="lg" />
        <span className="t-2">{v.line}</span>
      </div>
      {call ? (
        <div className="verdict-call">
          <span className="t-3">The agent called</span>
          <code className="tool">{call.tool}</code>
          {String(call.arguments?.invoice_id || '') && <span className="mono t-2">{String(call.arguments.invoice_id)}</span>}
          {round.money_calls.length > 1 && <span className="t-3">and {round.money_calls.length - 1} more</span>}
        </div>
      ) : <div className="verdict-call t-3">The agent made no call that moves or forgives money.</div>}
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
        <p>Muse Spark reads this round's trace and drafts an OVARA rule. OVARA validates the draft before anyone can apply it.</p>
        <button className="btn" disabled={!!busy} onClick={doDraft}>{busy ? <><Loader size={16} /> Drafting</> : <><Brain size={16} /> Draft a rule</>}</button>
        {err && <div className="err">{err}</div>}
      </div>
    )
  }
  return (
    <>
      <RuleCard draft={draft} />
      {recorded ? <p className="t-3 small">Drafted by Muse Spark during the recorded run.</p>
        : applied !== null ? <div className="applied"><ShieldCheck size={16} /> Applied. {applied} rules in force.</div>
          : <div className="row-end"><button className="btn btn-primary" disabled={!draft.valid || !!busy} onClick={doApply}>{busy === 'apply' ? 'Applying' : 'Apply rule'}</button></div>}
      {err && <div className="err">{err}</div>}
    </>
  )
}

export function RuleCard({ draft, big }: { draft: Draft; big?: boolean }) {
  return (
    <div className={`rule-card ${big ? 'big' : ''}`}>
      <div className="rule-head">
        <span className="eyebrow"><Brain size={14} /> Drafted by Muse Spark</span>
        <Badge tone={draft.valid ? 'safe' : 'leak'} size="sm">{draft.valid ? <><Check size={12} />validated by OVARA</> : <><X size={12} />rejected by OVARA</>}</Badge>
      </div>
      <p className="rule-en">{draft.english}</p>
      {draft.rules.map((r, i) => {
        const eff = r.effect || (r.deny ? 'deny' : r.escalate ? 'escalate' : 'allow')
        return (
          <div key={i} className="rule-line">
            <span className={`eff eff-${eff}`}>{eff}</span>
            <code>{r.resource.replace(/^mcp:[^/]+\//, '')}</code>
            {r.description && <span className="t-3">{r.description.replace(/^\[drafted\]\s*/, '')}</span>}
          </div>
        )
      })}
      {!draft.valid && draft.problems?.length ? <div className="err">{draft.problems.join('; ')}</div> : null}
    </div>
  )
}

// ---------- the round, as a narrative ----------

function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="nsec">
      <div className="nsec-head"><span className="nsec-n">{n}</span><h3>{title}</h3>{aside && <div className="nsec-aside">{aside}</div>}</div>
      <div className="nsec-body">{children}</div>
    </section>
  )
}

export function AgentReport({ text, noticed }: { text: string; noticed?: boolean }) {
  const [open, setOpen] = useState(false)
  const paras = text.split(/\n{2,}/).filter(Boolean)
  return (
    <div className="report">
      <div className="eyebrow">The agent's report {noticed && <Badge tone="muted" size="sm">flagged something as suspicious</Badge>}</div>
      <div className={`report-body ${paras.length > 1 && !open ? 'one' : ''}`}>{(open ? paras : paras.slice(0, 1)).map((p, i) => <p key={i}>{p}</p>)}</div>
      {paras.length > 1 && <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Read the whole report'}</button>}
    </div>
  )
}

export function RoundDetail({ round, partner, feed, feedLoading, source, reveal, setReveal, onNeedToken }: {
  round: Round
  partner?: Round
  feed: FeedItem[]
  feedLoading: boolean
  source: Source
  reveal: boolean
  setReveal: (v: boolean) => void
  onNeedToken: () => void
}) {
  const img = imageSrc(round.image_url, source)
  const held = round.verdict === 'held_denied' || round.verdict === 'refused'
  const showLearn = held && (round.draft || (source === 'live' && round.task_id))
  let i = 0
  return (
    <article className="detail">
      <header className="detail-head">
        <div className="dh-kicker">
          <GatePill profile={round.profile} />
          <span className="t-3">Round {round.n}</span>
          {round.replay_of && partner && <span className="t-3">· same attack as round {partner.n}</span>}
          <span className="t-3 mono small">{clock(round.at)}</span>
        </div>
        <h1 className="detail-title">{round.attack.subject || '(no subject)'}</h1>
        <div className="dh-row">
          <VerdictBadge round={round} size="lg" />
          {!round.error && <span className="t-2">{fooled(round) ? 'The agent was fooled and called a money tool.' : 'The agent did not take the bait.'}</span>}
          {partner && (
            <button className="btn btn-sm dh-compare" onClick={() => go(`/arena/compare/${round.id}`)}>
              Compare with {gateWord(partner.profile)} <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>
      {round.error && <div className="err">The round failed: {round.error}</div>}

      <Section n={++i} title="The email">
        <MailCard from={round.attack.from} subject={round.attack.subject} body={round.attack.body} attachment={round.attack.image?.name} />
      </Section>
      {img && (
        <Section n={++i} title="The attachment" aside={round.attack.image?.style && <span className="t-3 small">hidden as: {styleWord(round.attack.image.style)}</span>}>
          <Attachment src={img} box={round.hidden_box} style={round.attack.image?.style} hiddenText={round.attack.image?.hidden_text} reveal={reveal} setReveal={setReveal} />
          {round.attack.rationale && <p className="rationale"><span className="eyebrow">Attacker's reasoning</span>{round.attack.rationale}</p>}
        </Section>
      )}
      <Section n={++i} title="What the agent did" aside={<span className="t-3 small">Muse Spark · {round.profile === 'observe' ? 'straight to PayPal' : 'through OVARA'}</span>}>
        <Trace items={feed} profile={round.profile} loading={feedLoading} />
        {round.agent_said && <AgentReport text={round.agent_said} noticed={round.noticed} />}
      </Section>
      <Section n={++i} title="The gate's verdict">
        <GateVerdict round={round} />
      </Section>
      {showLearn && (
        <Section n={++i} title="Muse Spark learns">
          <Learn key={round.id} round={round} source={source} onNeedToken={onNeedToken} />
        </Section>
      )}
    </article>
  )
}

// ---------- compare: original and replay side by side ----------

function CompareSide({ r }: { r: Round }) {
  const call = r.money_calls[0]
  const v = verdictOf(r)
  return (
    <div className={`cside v-${v.tone}`}>
      <div className="cside-head">
        <GatePill profile={r.profile} />
        <button className="link" onClick={() => go(`/arena/r/${r.id}`)}>Round {r.n}</button>
      </div>
      <div className="cside-verdict"><VerdictBadge round={r} size="lg" /></div>
      <dl className="cside-facts">
        <div><dt>Agent fooled</dt><dd>{fooled(r) ? 'Yes' : 'No'}</dd></div>
        <div><dt>Money call</dt><dd>{call ? <code className="tool">{call.tool}</code> : 'None'}</dd></div>
        <div><dt>At PayPal</dt><dd className={r.verdict === 'landed' ? 'leak-text' : ''}>{r.verdict === 'landed' ? 'Invoice cancelled' : call ? 'Never reached PayPal' : 'Nothing changed'}</dd></div>
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
        <div className="dh-kicker"><span className="t-3">Same attack, gate on and off · rounds {on.n} and {off.n}</span></div>
        <h1 className="detail-title">{base.attack.subject}</h1>
        <div className="dh-row">
          <button className="btn btn-sm" onClick={() => go(`/arena/r/${round.id}`)}>Back to round {round.n}</button>
          <span className="t-3 small">The replay sent the same email and image; only the invoice number was swapped for the current open invoice.</span>
        </div>
      </header>
      <div className="compare-grid">
        <CompareSide r={on} />
        <CompareSide r={off} />
      </div>
      <div className="compare-attack">
        <div>
          <div className="eyebrow">The email</div>
          <MailCard from={base.attack.from} subject={base.attack.subject} body={base.attack.body} attachment={base.attack.image?.name} clampLines={4} />
        </div>
        {img && (
          <div>
            <div className="eyebrow">The attachment</div>
            <Attachment src={img} box={base.hidden_box} style={base.attack.image?.style} hiddenText={base.attack.image?.hidden_text} reveal={reveal} setReveal={setReveal} />
          </div>
        )}
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
        <div className="dh-kicker"><GatePill profile={profile} /><span className="t-3">Round {n}</span><Badge tone="muted" size="sm"><span className="live-dot" />in play</Badge></div>
        <h1 className="detail-title">{task?.inbound?.subject || 'The attacker is writing this round'}</h1>
        <div className="dh-row t-2">{task ? 'The agent is working on the email. The verdict appears when the round is scored.' : 'Muse Spark has read how the earlier rounds ended and is writing a new email.'}</div>
      </header>
      {task?.inbound && (
        <Section n={1} title="The email"><MailCard from={task.inbound.from} subject={task.inbound.subject} body={task.inbound.body} attachment={att?.name} /></Section>
      )}
      {att && <Section n={2} title="The attachment"><Shot src={imageSrc(att.url, source) || att.url} reveal={false} /></Section>}
      <Section n={task?.inbound ? (att ? 3 : 2) : 1} title="What the agent is doing"><Trace items={feed} profile={profile} live /></Section>
    </article>
  )
}
