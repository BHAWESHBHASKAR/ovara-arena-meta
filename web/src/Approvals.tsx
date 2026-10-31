import { useState } from 'react'
import type { Approval } from './types'
import { describeCall, facts, pretty } from './describe'

export type DecideFn = (id: string, action: 'approve' | 'remember' | 'deny') => Promise<void>

const waited = (s?: number) => (s === undefined ? '' : s < 60 ? `waiting ${Math.round(s)} s` : `waiting ${Math.floor(s / 60)} min ${Math.round(s % 60)} s`)

function untrustedOf(u: Approval['untrusted_context']): { source?: string; text: string } | null {
  if (!u) return null
  if (typeof u === 'string') return u.trim() ? { text: u } : null
  return u.text ? { source: u.source, text: u.text } : null
}

function Card({ a, decide }: { a: Approval; decide: DecideFn }) {
  const [busy, setBusy] = useState<string | null>(null)
  const go = (action: 'approve' | 'remember' | 'deny') => { setBusy(action); decide(a.id, action).finally(() => setBusy(null)) }
  const fs = a.kind === 'tool_call' ? facts(a.arguments) : []
  const shown = fs.slice(0, 8)
  const ut = untrustedOf(a.untrusted_context)
  const title = a.kind === 'tools' ? 'Approve the PayPal tool list' : describeCall(a.tool, a.arguments)

  return (
    <article className="approval">
      <header className="ap-head">
        <div>
          <div className="ap-title">{title}</div>
          <div className="ap-sub">
            {a.kind === 'tools' ? 'OVARA pins every tool description before the agent may use them' : <>Held before it reached PayPal &middot; <code>{a.tool}</code></>}
          </div>
        </div>
        <span className="ap-wait mono">{waited(a.waiting_s)}</span>
      </header>

      {shown.length > 0 && (
        <table className="ap-args">
          <tbody>
            {shown.map((f, i) => (
              <tr key={i} className={f.key === 'amount' || f.key === 'invoice' || f.key === 'payee' ? 'key' : ''}>
                <th>{f.label}</th>
                <td className="mono">{f.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {a.asked_because && <div className="ap-block"><div className="ap-label">Why OVARA asked</div><p>{a.asked_because}</p></div>}

      <div className="ap-block">
        <div className="ap-label">The agent's reason</div>
        <p>{a.agent_reason || <span className="dim">The agent gave no reason before this call.</span>}</p>
      </div>

      {ut && (
        <div className="ap-block">
          <div className="ap-label">What the agent read just before{ut.source ? `, from ${ut.source}` : ''}</div>
          <blockquote className="ap-untrusted">{ut.text}</blockquote>
          <p className="ap-note">This text came from PayPal data, not from you.</p>
        </div>
      )}

      {(a.arguments !== undefined || a.arguments_sha256 || a.receipt_id) && (
        <details className="ap-raw">
          <summary>Raw arguments and ids</summary>
          {a.arguments !== undefined && <pre>{pretty(a.arguments)}</pre>}
          {a.arguments_sha256 && <div className="raw-head">Arguments hash <code>{a.arguments_sha256}</code></div>}
          <div className="raw-head">Approval <code>{a.id}</code></div>
          {a.receipt_id && <div className="raw-head">Receipt <code>{a.receipt_id}</code></div>}
        </details>
      )}

      <div className="ap-actions">
        <button className="btn primary" disabled={!!busy} onClick={() => go('approve')}>{busy === 'approve' ? 'Approving' : 'Approve'}</button>
        <button className="btn" disabled={!!busy} onClick={() => go('remember')}>{busy === 'remember' ? 'Approving' : 'Approve and remember'}</button>
        <button className="btn" disabled={!!busy} onClick={() => go('deny')}>{busy === 'deny' ? 'Denying' : 'Deny'}</button>
      </div>
      <p className="ap-note">Remember allows this exact tool from now on, never a wildcard.</p>
    </article>
  )
}

export function Approvals({ items, decide, reachable }: { items: Approval[]; decide: DecideFn; reachable: boolean }) {
  if (!items.length) return <p className="empty">{reachable ? 'Nothing is waiting for you. Calls that move money stop here first.' : 'The approvals list is not available right now. It comes back once the API and the OVARA gateway answer again.'}</p>
  return <div className="approvals">{items.map(a => <Card key={a.id} a={a} decide={decide} />)}</div>
}
