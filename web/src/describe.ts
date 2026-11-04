// Plain-English lines for raw PayPal tool calls and OVARA records.

const MONEY_TOOLS = new Set([
  'create_refund', 'record_payment_for_invoice', 'record_refund_for_invoice', 'cancel_sent_invoice',
  'pay_order', 'capture_order', 'accept_dispute_claim', 'cancel_subscription', 'update_invoicing', 'delete_invoice',
])
export const movesMoney = (tool?: string) => !!tool && MONEY_TOOLS.has(tool)

export type Fact = { label: string; value: string; key: 'amount' | 'invoice' | 'payee' | 'ref' | 'other' }

function flatten(v: unknown, path: string[] = [], out: [string[], unknown][] = []): [string[], unknown][] {
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) v.forEach((x, i) => flatten(x, [...path, String(i)], out))
    else for (const [k, x] of Object.entries(v)) flatten(x, [...path, k], out)
  } else if (v !== undefined && v !== null && v !== '') out.push([path, v])
  return out
}

const humanKey = (k: string) => {
  const s = k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function parseArgs(args: unknown): unknown {
  if (typeof args === 'string') { try { return JSON.parse(args) } catch { return args } }
  return args
}

// Amount, invoice id and payee first; everything else after, in argument order.
export function facts(rawArgs: unknown): Fact[] {
  const args = parseArgs(rawArgs)
  const flat = flatten(args)
  const out: Fact[] = []
  const used = new Set<number>()
  const leaf = (p: string[]) => (p[p.length - 1] || '').toLowerCase()
  const joined = (p: string[]) => p.join('.').toLowerCase()

  flat.forEach(([p, v], i) => {
    if (used.has(i) || leaf(p) !== 'value' || !/amount|total|price/.test(joined(p))) return
    const cur = flat.findIndex(([q], j) => j !== i && leaf(q) === 'currency_code' && q.slice(0, -1).join('.') === p.slice(0, -1).join('.'))
    used.add(i); if (cur >= 0) used.add(cur)
    out.push({ key: 'amount', label: 'Amount', value: `${cur >= 0 ? String(flat[cur][1]) + ' ' : ''}${v}` })
  })
  flat.forEach(([p, v], i) => {
    if (used.has(i)) return
    if (/^(amount|total|refund_amount)$/.test(leaf(p))) { used.add(i); out.push({ key: 'amount', label: 'Amount', value: String(v) }) }
  })
  flat.forEach(([p, v], i) => {
    if (used.has(i)) return
    if (/invoice_id|invoice_number/.test(leaf(p)) || (leaf(p) === 'id' && p.length === 1)) { used.add(i); out.push({ key: 'invoice', label: leaf(p) === 'invoice_number' ? 'Invoice number' : 'Invoice id', value: String(v) }) }
  })
  flat.forEach(([p, v], i) => {
    if (used.has(i)) return
    const j = joined(p)
    if (typeof v !== 'boolean' && /payee|recipient|billing_info|email|paypal_account|account_id|merchant/.test(j)) {
      used.add(i)
      out.push({ key: 'payee', label: /email/.test(leaf(p)) ? (/payee/.test(j) ? 'Payee' : 'Email') : 'Payee', value: String(v) })
    }
  })
  flat.forEach(([p, v], i) => {
    if (used.has(i)) return
    if (/(capture|order|transaction|dispute|refund|subscription)_id$/.test(leaf(p))) { used.add(i); out.push({ key: 'ref', label: humanKey(leaf(p)), value: String(v) }) }
  })
  flat.forEach(([p, v], i) => {
    if (used.has(i)) return
    out.push({ key: 'other', label: humanKey(p.filter(s => !/^\d+$/.test(s)).slice(-2).join(' ')), value: String(v) })
  })
  return out
}

const pick = (fs: Fact[], key: Fact['key']) => fs.find(f => f.key === key)?.value

export function describeCall(tool = '', args?: unknown): string {
  const fs = facts(args)
  const amount = pick(fs, 'amount'), inv = pick(fs, 'invoice'), payee = pick(fs, 'payee'), ref = pick(fs, 'ref')
  const forAmt = amount ? ` for ${amount}` : ''
  switch (tool) {
    case 'list_invoices': return 'List invoices'
    case 'get_invoice': return `Read invoice ${inv || ''}`.trim()
    case 'search_invoicing': return 'Search invoices'
    case 'generate_invoice_number': return 'Get the next invoice number'
    case 'create_invoice': return `Draft an invoice${payee ? ` to ${payee}` : ''}${forAmt}`
    case 'send_invoice': return `Send invoice ${inv || ''}`.trim()
    case 'send_invoice_reminder': return `Remind the client about invoice ${inv || ''}`.trim()
    case 'record_payment_for_invoice': return `Mark invoice ${inv || ''} as paid${forAmt}`.replace('  ', ' ')
    case 'record_refund_for_invoice': return `Record a refund on invoice ${inv || ''}${forAmt}`.replace('  ', ' ')
    case 'create_refund': return `Refund ${amount || 'a payment'}${ref ? ` on ${ref}` : ''}${payee ? ` to ${payee}` : ''}`
    case 'cancel_sent_invoice': return `Cancel invoice ${inv || ''}`.trim()
    case 'update_invoicing': return `Change invoice ${inv || ''}`.trim()
    case 'delete_invoice': return `Delete invoice ${inv || ''}`.trim()
    case 'pay_order': return `Capture payment for order ${ref || ''}`.trim()
    case 'get_order': return `Read order ${ref || ''}`.trim()
    case 'list_transactions': return 'List transactions'
    case 'list_disputes': return 'List disputes'
    case 'get_dispute': return `Read dispute ${ref || ''}`.trim()
    case 'accept_dispute_claim': return `Accept dispute ${ref || ''}`.trim()
    case 'cancel_subscription': return `Cancel subscription ${ref || ''}`.trim()
  }
  const words = humanKey(tool || 'call a tool')
  return [words, inv || ref].filter(Boolean).join(' ')
}

export function describeResource(kind: string, resource: string): string {
  const tool = resource.match(/^mcp:[^/]+\/(.+)$/)?.[1]
  if (kind === 'mcp.tool_call' && tool) return describeCall(tool)
  if (kind === 'mcp.tools') return 'Pin the PayPal tool list'
  const http = resource.match(/^(GET|POST|PUT|PATCH|DELETE)\s+https?:\/\/([^/]+)(\/\S*)?/i)
  if (kind === 'http.request' && http) return `${http[1].toUpperCase() === 'GET' ? 'Read from' : 'Write to'} ${http[2]}`
  return humanKey(kind.replace(/\./g, ' '))
}

export const outcomeWord: Record<string, string> = {
  allowed: 'allowed', allow: 'allowed', approved: 'approved', held: 'held', escalate: 'held', pending: 'held',
  denied: 'denied', deny: 'denied', refused: 'refused', blocked: 'refused',
}

export const outcomeClass = (o?: string) => {
  const w = outcomeWord[String(o || '').toLowerCase()] || ''
  return w === 'allowed' || w === 'approved' ? 'ok' : w === 'held' ? 'held' : ''
}

export function clock(at?: string | number | null): string {
  if (at === undefined || at === null || at === '') return ''
  const d = new Date(typeof at === 'number' && at < 1e12 ? at * 1000 : at)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export const pretty = (v: unknown) => {
  const p = parseArgs(v)
  return typeof p === 'string' ? p : JSON.stringify(p, null, 2)
}

export const short = (s: string, n = 18) => (s.length > n ? `${s.slice(0, Math.ceil(n * 0.6))}...${s.slice(-Math.floor(n * 0.35))}` : s)
