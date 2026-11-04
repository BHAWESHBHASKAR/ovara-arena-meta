const TOKEN_KEY = 'ovara-arena-token'
const OLD_KEY = 'ovara-pay-token'

// The deployment URL may carry the operator token as #token=...; keep it and drop it from the address bar.
function initToken(): string {
  try {
    const m = location.hash.match(/(?:^#|&)token=([^&]+)/)
    if (m) {
      localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]))
      history.replaceState(null, '', location.pathname + location.search)
    }
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(OLD_KEY) || ''
  } catch {
    return ''
  }
}
let token = initToken()

export const getToken = () => token
export function setToken(t: string) {
  token = t.trim()
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  status: number
  constructor(m: string, s: number) { super(m); this.status = s }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(path, { method, headers, cache: 'no-store', signal, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  let j: unknown = null
  try { j = t ? JSON.parse(t) : null } catch { j = null }
  if (!r.ok) {
    const o = j as { error?: unknown; message?: unknown } | null
    const m = (o && (o.error || o.message)) || t.trim().slice(0, 200) || `${r.status} ${r.statusText}`
    throw new ApiError(typeof m === 'string' ? m : JSON.stringify(m), r.status)
  }
  if (t && j === null) throw new ApiError('not JSON', r.status)
  return j as T
}
