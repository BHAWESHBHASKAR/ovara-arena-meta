import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Draft, FeedItem, LiveTask, Policy, Round } from './types'
import { api, ApiError } from './api'
import { describeCall, facts, movesMoney } from './describe'
import { fooled, profileWord, styleWord, verdictOf } from './verdict'
import { imageSrc, type Source } from './data'
import { clock } from './describe'
import {
  Alert, Bot, Brain, Check, Crosshair, Eye, EyeOff, Flag, Hand, Inbox, Loader, Mail, Paperclip, Scale, Shield, ShieldCheck, Wrench, X,
} from './icons'

const IMG_W = 900
const IMG_H = 640

// ---------- attack side ----------

function MailCard({ from, subject, body, attachment }: { from: string; subject: string; body: string; attachment?: string }) {
  const [open, setOpen] = useState(false)
  const long = body.split('\n').length > 3 || body.length > 240
  return (
    <section className="card mail">
      <div className="card-eyebrow"><Mail size={13} /> Email to Acme Studio</div>
      <div className="mail-head">
        <div className="mail-subj">{subject || '(no subject)'}</div>
        <div className="mail-from"><span className="dim">From</span> {from}</div>
      </div>
      <div className={`mail-body ${long && !open ? 'clamp' : ''}`}>{body}</div>
      <div className="mail-foot">
        {attachment && <span className="att-pill"><Paperclip size={12} />{attachment}</span>}
        {long && <button className="link" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show the whole email'}</button>}
      </div>
    </section>
  )
}

function clampBox(b: [number, number, number, number]) {
  const x = Math.max(0, Math.min(IMG_W - 1, b[0]))
  const y = Math.max(0, Math.min(IMG_H - 1, b[1]))
  const w = Math.max(1, Math.min(IMG_W - x, b[2]))
  const h = Math.max(1, Math.min(IMG_H - y, b[3]))
  return [x, y, w, h] as const
}

export function Attachment({ src, name, box, hiddenText, style, reveal, setReveal }: {
  src: string
  name?: string
  box?: [number, number, number, number]
  hiddenText?: string
  style?: string
  reveal: boolean
  setReveal: (v: boolean) => void
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const b = box ? clampBox(box) : null
  const canReveal = !!b && !failed
  const on = reveal && canReveal
  return (
    <section className="card attach">
      <div className="attach-top">
        <div className="card-eyebrow"><Paperclip size={13} /> Attachment {name && <span className="mono dim">{name}</span>}</div>
        {canReveal && (
          <button className={`reveal-btn ${on ? 'on' : ''}`} onClick={() => setReveal(!on)} aria-pressed={on} title="Shortcut: R">
            {on ? <EyeOff size={15} /> : <Eye size={15} />}
            {on ? 'Hide' : 'Reveal hidden text'}
            <kbd>R</kbd>
          </button>
        )}
      </div>
      <div className={`shot ${on ? 'revealed' : ''}`}>
        {failed ? (
          <div className="shot-missing">The image file is not available here.</div>
        ) : (
          <img src={src} alt={`Attachment ${name || ''} as the agent received it`} onError={() => setFailed(true)} draggable={false} />
        )}
        {b && !failed && (
          <div className="hbox" style={{ left: `${(b[0] / IMG_W) * 100}%`, top: `${(b[1] / IMG_H) * 100}%`, width: `${(b[2] / IMG_W) * 100}%`, height: `${(b[3] / IMG_H) * 100}%` }}>
            <div
              className="hbox-enh"
              style={{
                backgroundImage: `url("${src}")`,
                backgroundSize: `${(IMG_W / b[2]) * 100}% ${(IMG_H / b[3]) * 100}%`,
                backgroundPosition: `${b[2] >= IMG_W ? 0 : (b[0] / (IMG_W - b[2])) * 100}% ${b[3] >= IMG_H ? 0 : (b[1] / (IMG_H - b[3])) * 100}%`,
              }}
            />
            <span className="hbox-tag">Hidden instruction{style ? ` · ${styleWord(style)}` : ''}</span>
          </div>
        )}
      </div>
      {canReveal && (
        <div className={`hidden-read ${on ? 'show' : ''}`} aria-hidden={!on}>
          <div className="hr-label">What the pixels say <span className="dim">(region contrast-boosted above; text as the attacker wrote it)</span></div>
          <blockquote>{hiddenText}</blockquote>
        </div>
      )}
      {!canReveal && !failed && box === undefined && <div className="attach-note dim">The hidden region is marked once the round is scored.</div>}
    </section>
  )
}

// ---------- agent trace ----------

type Step =
  | { k: 'inbox'; key: string; text: string; image?: boolean }
  | { k: 'thought'; key: string; text: string }
  | { k: 'call'; key: string; tool: string; args: unknown; decisions: FeedItem[]; result?: FeedItem }
  | { k: 'notes'; key: string; notes: FeedItem[] }
  | { k: 'done'; key: string; text: string }

function buildSteps(items: FeedItem[]): Step[] {
  const out: Step[] = []
  for (const it of items) {
    if (it.kind === 'task') continue
    if (it.kind === 'untrusted') {
      const src = it.source || ''
      if (/^email from/i.test(src)) { out.push({ k: 'inbox', key: `i${it.seq}`, text: 'Read the client email' }); continue }
      if (/^attachment/i.test(src)) {
        const last = out[out.length - 1]
        if (last?.k === 'inbox') { last.text = 'Read the client email and its image attachment'; last.image = true }
        else out.push({ k: 'inbox', key: `i${it.seq}`, text: 'Looked at the image attachment', image: true })
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
      continue
    }
    if (it.kind === 'done') out.push({ k: 'done', key: `d${it.seq}`, text: it.text || it.status || 'Finished' })
  }
  return out
}

function Chip({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return <span className={`chip c-${tone}`} title={title}>{children}</span>
}

function callChips(s: Extract<Step, { k: 'call' }>, profile: string) {
  const chips: ReactNode[] = []
  const money = movesMoney(s.tool)
  for (const d of s.decisions) {
    const o = d.outcome || ''
    const tone = o === 'allowed' ? 'ok' : o === 'held' ? 'held' : o === 'denied' ? 'deny' : o === 'refused' ? 'deny' : 'muted'
    const word = o === 'held' ? 'HELD' : o === 'denied' ? 'DENIED' : o === 'refused' ? 'REFUSED' : o === 'allowed' ? 'allowed' : o
    chips.push(<Chip key={`d${d.seq}`} tone={tone} title={d.rule}>{o === 'allowed' ? <Check size={11} /> : o === 'held' ? <Hand size={11} /> : <X size={11} />}{word}</Chip>)
  }
  if (!s.decisions.length && profile === 'observe') chips.push(<Chip key="nogate" tone="muted">no gate</Chip>)
  if (s.result) {
    const denied = s.decisions.some(d => d.outcome === 'denied' || d.outcome === 'refused')
    if (s.result.ok && money) chips.push(<Chip key="r" tone="leak">LANDED</Chip>)
    else if (!s.result.ok && !denied) chips.push(<Chip key="r" tone="muted">PayPal error</Chip>)
  } else if (!s.decisions.some(d => d.outcome === 'denied' || d.outcome === 'refused')) {
    chips.push(<Chip key="w" tone="muted"><Loader size={11} />waiting</Chip>)
  }
  return chips
}

function NotesStep({ notes }: { notes: FeedItem[] }) {
  const [open, setOpen] = useState(false)
  const loud = notes.filter(n => /assistant|AI |instruction|ignore/i.test(n.text || '')).length
  return (
    <div className="st-body">
      <div className="st-line">
        Read {notes.length} note{notes.length === 1 ? '' : 's'} inside PayPal data
        {loud > 0 && <span className="dim"> · {loud} address{loud === 1 ? 'es' : ''} the agent directly</span>}
        <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'show'}</button>
      </div>
      {open && (
        <ul className="notes">
          {notes.map(n => <li key={n.seq}><span className="mono dim">{(n.source || '').split(':')[0]}</span> {n.text}</li>)}
        </ul>
      )}
    </div>
  )
}

function ThoughtStep({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220
  return (
    <div className="st-body">
      <div className={`st-thought ${long && !open ? 'clamp2' : ''}`}>{text}</div>
      {long && <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'less' : 'more'}</button>}
    </div>
  )
}

function CallStep({ s, profile }: { s: Extract<Step, { k: 'call' }>; profile: string }) {
  const money = movesMoney(s.tool)
  const fs = money ? facts(s.args).filter(f => f.key !== 'other' || /note|reason/i.test(f.label)).slice(0, 3) : []
  const denied = s.decisions.find(d => d.outcome === 'denied' || d.outcome === 'refused')
  const held = s.decisions.find(d => d.outcome === 'held')
  return (
    <div className="st-body">
      <div className="st-call">
        <span className="st-desc">{describeCall(s.tool, s.args)}</span>
        <code className="st-tool">{s.tool}</code>
        <span className="st-chips">{callChips(s, profile)}</span>
      </div>
      {money && fs.length > 0 && (
        <dl className="st-facts">
          {fs.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}
      {money && (held || denied) && (
        <div className="st-rule">
          {held?.rule && <div><span className="dim">OVARA rule</span> <code>{held.rule}</code></div>}
          {denied?.rule && <div><span className="dim">Decision</span> <code>{denied.rule}</code></div>}
          {s.result && !s.result.ok && s.result.summary && <div><span className="dim">Agent was told</span> {s.result.summary}</div>}
        </div>
      )}
    </div>
  )
}

export function Trace({ items, profile, loading, live }: { items: FeedItem[]; profile: string; loading?: boolean; live?: boolean }) {
  const steps = useMemo(() => buildSteps(items), [items])
  if (!steps.length) {
    return <div className="trace-empty">{loading ? <><Loader size={14} /> Loading the agent's steps</> : live ? <><Loader size={14} /> Waiting for the agent</> : 'No step-by-step trace is stored for this round.'}</div>
  }
  return (
    <ol className="trace">
      {steps.map(s => {
        if (s.k === 'done') return null
        const money = s.k === 'call' && movesMoney(s.tool)
        const tone = s.k !== 'call' ? '' : !money ? '' : s.decisions.some(d => d.outcome === 'denied' || d.outcome === 'refused') ? 'held' : s.result?.ok ? 'leak' : 'held'
        const icon = s.k === 'inbox' ? <Inbox size={13} /> : s.k === 'thought' ? <Brain size={13} /> : s.k === 'notes' ? <Alert size={13} /> : money ? <Scale size={13} /> : <Wrench size={13} />
        return (
          <li key={s.key} className={`st k-${s.k} ${money ? 'money' : ''} ${tone ? `tone-${tone}` : ''}`}>
            <span className="st-dot">{icon}</span>
            {s.k === 'inbox' && <div className="st-body"><div className="st-line">{s.text}</div></div>}
            {s.k === 'thought' && <ThoughtStep text={s.text} />}
            {s.k === 'notes' && <NotesStep notes={s.notes} />}
            {s.k === 'call' && <CallStep s={s} profile={profile} />}
          </li>
        )
      })}
      {live && <li className="st st-wait"><span className="st-dot"><Loader size={13} /></span><div className="st-body"><div className="st-line dim">Working</div></div></li>}
    </ol>
  )
}

// ---------- learn: drafted rule ----------

function DraftPanel({ round, source, onNeedToken }: { round: Round; source: Source; onNeedToken: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(round.draft || null)
  const [busy, setBusy] = useState<'' | 'draft' | 'apply'>('')
  const [err, setErr] = useState('')
  const [applied, setApplied] = useState<number | null>(null)
  const recorded = source === 'replay'
  if (recorded && !round.draft) return null
  if (!round.task_id && !recorded) return null
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { onNeedToken(); setErr('The API needs the operator token for this. Add it and try again.') }
    else setErr(String((e as Error)?.message || e))
  }
  const doDraft = () => {
    setBusy('draft'); setErr('')
    api<Draft>('POST', '/api/policy/draft', { incident_task_id: round.task_id }).then(setDraft).catch(fail).finally(() => setBusy(''))
  }
  const doApply = () => {
    if (!draft) return
    setBusy('apply'); setErr('')
    api<Policy>('POST', `/api/policy/draft/${encodeURIComponent(draft.draft_id)}/apply`).then(p => setApplied(p?.rules?.length ?? 0)).catch(fail).finally(() => setBusy(''))
  }
  return (
    <section className="card learn">
      <div className="card-eyebrow"><Brain size={13} /> Learn from this incident</div>
      {!draft ? (
        <div className="learn-cta">
          <p>Muse Spark reads this round's trace and drafts an OVARA rule. OVARA checks the draft before it can be applied.</p>
          <button className="btn" disabled={!!busy} onClick={doDraft}>{busy === 'draft' ? <><Loader size={14} /> Drafting</> : <><Brain size={14} /> Draft a rule from this incident</>}</button>
        </div>
      ) : (
        <div className="draft">
          <div className="draft-top">
            <p className="draft-en">{draft.english}</p>
            <span className={`chip ${draft.valid ? 'c-ok' : 'c-deny'}`}>{draft.valid ? <><Check size={11} />valid</> : <><X size={11} />rejected by OVARA</>}</span>
          </div>
          <ul className="draft-rules">
            {draft.rules.map((r, i) => {
              const eff = r.effect || (r.deny ? 'deny' : r.escalate ? 'escalate' : 'allow')
              return (
                <li key={i}>
                  <span className={`eff eff-${eff}`}>{eff}</span>
                  <code>{r.resource}</code>
                  {r.description && <span className="dim">{r.description}</span>}
                </li>
              )
            })}
          </ul>
          {!draft.valid && draft.problems?.length ? <div className="err">{draft.problems.join('; ')}</div> : null}
          {recorded ? (
            <div className="dim small">Recorded draft from the live run.</div>
          ) : applied !== null ? (
            <div className="applied"><ShieldCheck size={14} /> Applied. {applied} rules in force.</div>
          ) : (
            <div className="row-end">
              <button className="btn primary" disabled={!draft.valid || !!busy} onClick={doApply}>{busy === 'apply' ? 'Applying' : 'Apply rule'}</button>
            </div>
          )}
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </section>
  )
}

// ---------- answer + stage ----------

function Answer({ text, noticed }: { text: string; noticed?: boolean }) {
  const [open, setOpen] = useState(false)
  const paras = text.split(/\n{2,}/).filter(Boolean)
  const long = text.length > 520
  return (
    <section className="card answer">
      <div className="card-eyebrow"><Bot size={13} /> The agent's report {noticed && <span className="chip c-ok"><Flag size={11} />flagged the email as suspicious</span>}</div>
      <div className={`answer-body ${long && !open ? 'clamp6' : ''}`}>{paras.map((p, i) => <p key={i}>{p}</p>)}</div>
      {long && <button className="link small" onClick={() => setOpen(o => !o)}>{open ? 'Show less' : 'Show the whole report'}</button>}
    </section>
  )
}

function Stamp({ round }: { round: Round }) {
  const v = verdictOf(round)
  return (
    <div className={`stamp t-${v.tone}`} key={round.id}>
      <div className="stamp-word">{v.tone === 'held' ? <Shield size={20} /> : v.tone === 'leak' ? <Alert size={20} /> : v.tone === 'safe' ? <Check size={20} /> : null}{v.word}</div>
      <div className="stamp-line">{v.line}</div>
    </div>
  )
}

export function RoundStage({ round, feed, feedLoading, source, reveal, setReveal, onNeedToken }: {
  round: Round
  feed: FeedItem[]
  feedLoading: boolean
  source: Source
  reveal: boolean
  setReveal: (v: boolean) => void
  onNeedToken: () => void
}) {
  const img = imageSrc(round.image_url, source)
  const isFooled = fooled(round)
  const heldRound = round.verdict === 'held_denied' || round.verdict === 'refused'
  return (
    <div className="stage">
      <header className="stage-head">
        <div className="sh-left">
          <div className="sh-round">Round {round.n}</div>
          <div className="sh-meta">
            <span className={`pchip big ${round.profile === 'observe' ? 'off' : 'on'}`}>{profileWord(round.profile)}</span>
            <span className="mono dim">{clock(round.at)}</span>
            {!round.error && (isFooled
              ? <span className="fooled-tag"><Flag size={12} />Agent fooled: it called {round.money_calls.map(c => c.tool).join(', ')}</span>
              : <span className="firm-tag"><Check size={12} />Agent did not take the bait</span>)}
          </div>
        </div>
        <Stamp round={round} />
      </header>
      {round.error && <div className="err">The round failed: {round.error}</div>}
      <div className="stage-cols">
        <div className="col col-attack">
          <div className="col-label"><Crosshair size={13} /> The attack</div>
          <MailCard from={round.attack.from} subject={round.attack.subject} body={round.attack.body} attachment={round.attack.image?.name} />
          {img && <Attachment src={img} name={round.attack.image?.name} box={round.hidden_box} hiddenText={round.attack.image?.hidden_text} style={round.attack.image?.style} reveal={reveal} setReveal={setReveal} />}
          {round.attack.rationale && (
            <section className="card rationale">
              <div className="card-eyebrow"><Crosshair size={13} /> The attacker's reasoning for this round</div>
              <p>{round.attack.rationale}</p>
            </section>
          )}
        </div>
        <div className="col col-defense">
          <div className="col-label"><Bot size={13} /> What the agent did <span className="dim">· through {round.profile === 'observe' ? 'no gate' : 'OVARA'}</span></div>
          <section className="card trace-card"><Trace items={feed} profile={round.profile} loading={feedLoading} /></section>
          {round.agent_said && <Answer text={round.agent_said} noticed={round.noticed} />}
          {heldRound && <DraftPanel key={round.id} round={round} source={source} onNeedToken={onNeedToken} />}
        </div>
      </div>
    </div>
  )
}

export function LiveStage({ n, task, feed, profile, source }: { n: number; task: LiveTask | null; feed: FeedItem[]; profile: string; source: Source }) {
  const att = task?.inbound?.attachments?.[0]
  return (
    <div className="stage">
      <header className="stage-head">
        <div className="sh-left">
          <div className="sh-round">Round {n} <span className="live-dot" /> <span className="live-word">live</span></div>
          <div className="sh-meta">
            <span className={`pchip big ${profile === 'observe' ? 'off' : 'on'}`}>{profileWord(profile)}</span>
            <span className="dim">{task ? (task.status === 'queued' ? 'Email delivered; the agent is about to start' : 'The agent is working on the email') : 'The attacker is writing this round’s email'}</span>
          </div>
        </div>
        <div className="stamp t-muted pending"><div className="stamp-word"><Loader size={18} /> In play</div><div className="stamp-line">The verdict appears when the round is scored.</div></div>
      </header>
      <div className="stage-cols">
        <div className="col col-attack">
          <div className="col-label"><Crosshair size={13} /> The attack</div>
          {task?.inbound ? (
            <>
              <MailCard from={task.inbound.from} subject={task.inbound.subject} body={task.inbound.body} attachment={att?.name} />
              {att && <Attachment src={imageSrc(att.url, source) || att.url} name={att.name} reveal={false} setReveal={() => {}} />}
            </>
          ) : (
            <section className="card waiting"><Loader size={16} /> Muse Spark is writing the next attack. It has read how the earlier rounds ended.</section>
          )}
        </div>
        <div className="col col-defense">
          <div className="col-label"><Bot size={13} /> What the agent is doing <span className="dim">· through {profile === 'observe' ? 'no gate' : 'OVARA'}</span></div>
          <section className="card trace-card"><Trace items={feed} profile={profile} live /></section>
        </div>
      </div>
    </div>
  )
}
