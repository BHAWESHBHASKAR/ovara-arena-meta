import { useEffect, useState } from 'react'
import type { ArenaData, Integrity, Policy, Receipt, VerifyResult } from './types'
import { api } from './api'
import { clock, describeResource, outcomeClass, outcomeWord, short } from './describe'
import { Check, Loader, Receipt as ReceiptIcon, ShieldCheck, X } from './icons'
import type { Source } from './data'

export function ReceiptsView({ source, replay }: { source: Source; replay: ArenaData | null }) {
  const [rows, setRows] = useState<Receipt[]>(source === 'replay' ? replay?.receipts || [] : [])
  const [integrity, setIntegrity] = useState<Integrity | null>(source === 'replay' ? replay?.integrity || null : null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(source === 'live')
  const [res, setRes] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (source !== 'live') { setRows(replay?.receipts || []); setIntegrity(replay?.integrity || null); return }
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = () => api<Receipt[] | { receipts: Receipt[]; integrity?: Integrity }>('GET', '/api/receipts?n=200')
      .then(r => {
        if (stop) return
        if (Array.isArray(r)) setRows(r)
        else { setRows(r?.receipts || []); if (r?.integrity) setIntegrity(r.integrity) }
        setErr('')
      })
      .catch(e => !stop && setErr(String(e?.message || e)))
      .finally(() => { if (!stop) { setLoading(false); t = setTimeout(tick, 6000) } })
    tick()
    return () => { stop = true; clearTimeout(t) }
  }, [source, replay])

  const verify = () => {
    setBusy(true); setErr('')
    api<VerifyResult>('POST', '/api/receipts/verify').then(setRes).catch(e => setErr(String(e?.message || e))).finally(() => setBusy(false))
  }
  const pk = integrity?.public_key || ''

  return (
    <div className="sec">
      <div className="sec-head">
        <div>
          <h2><ReceiptIcon size={18} /> Receipts</h2>
          <p className="dim">Every OVARA decision is a signed receipt. The proxy log is a hash chain: each entry commits to the one before, so an edited or removed entry breaks the chain.</p>
        </div>
        <div className="verify">
          {source === 'live' ? (
            <button className="btn primary" disabled={busy} onClick={verify}>{busy ? <><Loader size={14} /> Verifying</> : <><ShieldCheck size={14} /> Verify chain</>}</button>
          ) : <span className="dim small">Verify runs against the live API.</span>}
        </div>
      </div>
      {res && (
        <div className={`verify-res ${res.ok ? 'ok' : 'bad'}`}>
          {res.ok ? <Check size={16} /> : <X size={16} />}
          <span><b>{res.ok ? 'Receipts check out.' : 'Receipts do not check out.'}</b> {res.count} receipt{res.count === 1 ? '' : 's'}: gateway decision receipts signature-checked, proxy log hash chain verified as a whole.{res.detail && <span className="dim"> {res.detail}</span>}</span>
        </div>
      )}
      {integrity && !res && (
        <div className={`verify-res ${integrity.ok ? 'ok' : 'bad'}`}>
          {integrity.ok ? <Check size={16} /> : <X size={16} />}
          <span>Last check: {integrity.ok ? 'intact' : 'not intact'}, {integrity.count} receipts. <span className="dim">Public key <code title={pk}>{pk ? short(pk, 32) : 'not reported'}</code></span></span>
        </div>
      )}
      {err && <div className="err">Could not reach the receipts: {err}</div>}
      {loading && <div className="dim"><Loader size={14} /> Loading</div>}
      {!loading && !rows.length && <p className="dim">{source === 'replay' ? 'This recorded run does not include receipts. They are served by the live API.' : 'No receipts yet.'}</p>}
      {rows.length > 0 && (
        <table className="rtable">
          <thead><tr><th>Time</th><th>Decision</th><th>What</th><th>Resource</th><th>Signature</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const w = outcomeWord[String(r.outcome).toLowerCase()] || r.outcome
              const cls = outcomeClass(w)
              return (
                <tr key={r.id || i}>
                  <td className="mono dim">{clock(r.at)}</td>
                  <td><span className={`chip ${cls === 'ok' ? 'c-ok' : cls === 'held' ? 'c-held' : w === 'denied' || w === 'refused' ? 'c-deny' : 'c-muted'}`}>{w}</span></td>
                  <td>{describeResource(r.kind, r.resource)}</td>
                  <td className="mono dim ellipsis" title={r.resource}>{r.resource}</td>
                  <td className="mono dim">{r.signature_kind || ''}{r.chain_ok === false ? ' · chain broken' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function PolicyView({ source, replay }: { source: Source; replay: ArenaData | null }) {
  const [policy, setPolicy] = useState<Policy | null>(source === 'replay' ? replay?.policy || null : null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (source !== 'live') { setPolicy(replay?.policy || null); return }
    api<Policy>('GET', '/api/policy').then(setPolicy).catch(e => setErr(String(e?.message || e)))
  }, [source, replay])
  const rules = policy?.rules || []
  return (
    <div className="sec">
      <div className="sec-head">
        <div>
          <h2><ShieldCheck size={18} /> Policy</h2>
          <p className="dim">The rules OVARA enforces between the agent and PayPal. Rules match a tool by name. Reads are allowed; calls that move money or cancel a receivable wait for a person.</p>
        </div>
        {policy && <span className={`pchip big ${policy.profile === 'observe' ? 'off' : 'on'}`}>{policy.profile === 'observe' ? 'OVARA off' : 'OVARA on'}</span>}
      </div>
      {err && <div className="err">Could not load the policy: {err}</div>}
      {!policy && !err && <p className="dim">{source === 'replay' ? 'This recorded run does not include the policy. It is served by the live API.' : 'Loading'}</p>}
      {rules.length > 0 && (
        <table className="rtable">
          <thead><tr><th>Effect</th><th>Applies to</th><th>Why</th><th>Origin</th></tr></thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i}>
                <td><span className={`eff eff-${r.effect}`}>{r.effect}</span></td>
                <td className="mono">{r.action_type === 'mcp.tool_call' ? r.resource.replace(/^mcp:[^/]+\//, '') : r.resource}<div className="dim small">{r.action_type}</div></td>
                <td>{r.description}</td>
                <td className="dim">{r.origin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
