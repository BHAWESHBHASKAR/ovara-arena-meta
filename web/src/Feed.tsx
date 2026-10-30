import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { FeedItem } from './types'
import { clock, describeCall, movesMoney, outcomeClass, outcomeWord, pretty } from './describe'

type Line = {
  key: string
  at: string
  label: string
  text: ReactNode
  right?: string
  tone?: '' | 'ok' | 'held' | 'leak' | 'dim'
  rowTone?: '' | 'held' | 'leak' | 'untrusted' | 'task'
  raw?: ReactNode
  title?: string
}

const isOff = (it: FeedItem) => it.profile === 'observe' || /ovara off/i.test(it.note || '')

function toLines(items: FeedItem[], forceOff: boolean): Line[] {
  const off = new Set<string>()
  for (const it of items) if (it.kind === 'task' && isOff(it)) off.add(it.task_id)
  const offFor = (it: FeedItem) => forceOff || off.has(it.task_id)

  return items.map((it, i): Line => {
    const key = `${it.task_id}:${it.seq}:${i}`
    const at = clock(it.at)
    switch (it.kind) {
      case 'task':
        return {
          key, at, label: 'task', rowTone: 'task',
          text: <><span className="strong">{it.text || 'New task'}</span>{it.note && <span className="dim"> &nbsp;{it.note}</span>}</>,
          right: offFor(it) ? 'OVARA off' : undefined, tone: 'dim',
        }
      case 'thought':
        return { key, at, label: 'agent', text: <span className="thought">{it.text}</span>, title: it.text, raw: (it.text || '').length > 120 ? <p className="raw-text">{it.text}</p> : undefined }
      case 'call': {
        const money = movesMoney(it.tool)
        return {
          key, at, label: 'call',
          text: <>{describeCall(it.tool, it.arguments)}</>,
          right: offFor(it) && money ? 'not checked' : undefined, tone: 'dim',
          raw: <>
            <div className="raw-head">Tool <code>{it.tool}</code></div>
            <pre>{pretty(it.arguments ?? {})}</pre>
            {it.arguments_sha256 && <div className="raw-head">Arguments hash <code>{it.arguments_sha256}</code></div>}
          </>,
        }
      }
      case 'decision': {
        const w = outcomeWord[String(it.outcome || '').toLowerCase()] || String(it.outcome || '')
        const sentence = w === 'held' ? 'Held for a person to decide'
          : w === 'allowed' ? 'Allowed by policy'
          : w === 'approved' ? 'Approved by the operator'
          : w === 'denied' ? 'Denied by the operator'
          : w === 'refused' ? 'Refused by a rule' : `OVARA: ${w}`
        return {
          key, at, label: 'OVARA', rowTone: w === 'held' ? 'held' : '',
          text: <>{sentence}{it.tool && <span className="dim">, {describeCall(it.tool)}</span>}{it.rule && <span className="dim"> &middot; {it.rule}</span>}</>,
          right: w, tone: outcomeClass(w) as Line['tone'],
          raw: (it.approval_id || it.receipt_id || it.rule) ? <>
            {it.tool && <div className="raw-head">Tool <code>{it.tool}</code></div>}
            {it.approval_id && <div className="raw-head">Approval <code>{it.approval_id}</code></div>}
            {it.receipt_id && <div className="raw-head">Receipt <code>{it.receipt_id}</code></div>}
            {it.rule && <div className="raw-head">Rule <code>{it.rule}</code></div>}
          </> : undefined,
        }
      }
      case 'result': {
        const leak = offFor(it) && movesMoney(it.tool) && it.ok !== false
        const stopped = it.ok === false && /denied|refused/i.test(it.summary || '')
        return {
          key, at, label: 'PayPal', rowTone: leak ? 'leak' : '',
          text: leak
            ? <><span className="strong">Went through with OVARA off.</span> {it.summary}</>
            : stopped ? <>Never reached PayPal. <span className="dim">{it.summary}</span></>
            : <>{it.ok === false ? 'Failed: ' : ''}{it.summary || (it.ok === false ? 'no answer' : 'answered')}</>,
          right: leak ? 'went through' : stopped ? 'not sent' : it.ok === false ? 'failed' : 'answered', tone: leak ? 'leak' : 'dim',
          title: it.summary,
          raw: it.tool ? <div className="raw-head">Tool <code>{it.tool}</code></div> : undefined,
        }
      }
      case 'untrusted':
        return {
          key, at, label: 'read', rowTone: 'untrusted',
          text: <><q>{it.text}</q>{it.source && <span className="dim"> &nbsp;from {it.source}</span>}</>,
          title: it.text, right: 'untrusted', tone: 'dim',
          raw: <p className="raw-text">{it.text}</p>,
        }
      case 'done':
        return { key, at, label: 'done', text: it.text || it.summary || 'Task finished', right: it.status, tone: 'dim', title: it.text || it.summary }
      default:
        return { key, at, label: String(it.kind), text: it.text || it.summary || '' }
    }
  })
}

function Row({ l }: { l: Line }) {
  const cells = <>
    <span className="f-time mono">{l.at}</span>
    <span className="f-kind">{l.label}</span>
    <span className="f-text" title={l.title}>{l.text}</span>
    <span className={`f-out ${l.tone || ''}`}>{l.right}</span>
  </>
  const cls = `f-row ${l.rowTone ? 'r-' + l.rowTone : ''}`
  if (!l.raw) return <div className={cls}><div className="f-line">{cells}</div></div>
  return (
    <details className={cls}>
      <summary className="f-line">{cells}</summary>
      <div className="f-raw">{l.raw}</div>
    </details>
  )
}

export function Feed({ items, forceOff, empty }: { items: FeedItem[]; forceOff?: boolean; empty: ReactNode }) {
  const lines = useMemo(() => toLines(items, !!forceOff), [items, forceOff])
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }
    el.addEventListener('scroll', on)
    return () => el.removeEventListener('scroll', on)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <div className="feed" ref={ref}>
      {lines.length ? lines.map(l => <Row key={l.key} l={l} />) : <p className="empty">{empty}</p>}
    </div>
  )
}
