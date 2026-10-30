export type Outcome = 'allowed' | 'held' | 'denied' | 'refused'
export type Kind = 'task' | 'thought' | 'call' | 'decision' | 'result' | 'untrusted' | 'done'

export type FeedItem = {
  seq: number
  at: string | number
  task_id: string
  kind: Kind
  text?: string
  note?: string
  scenario?: string
  profile?: string
  tool?: string
  arguments?: unknown
  arguments_sha256?: string
  outcome?: Outcome
  approval_id?: string
  receipt_id?: string
  rule?: string
  ok?: boolean
  summary?: string
  source?: string
  status?: string
}

export type State = {
  boot: 'starting' | 'ready' | 'degraded'
  ovara?: { gateway_ok?: boolean; proxy_ok?: boolean; pins?: 'pending' | 'approved' }
  paypal?: { sandbox?: boolean; token_ok?: boolean }
  models?: { agent?: string; drafter?: string }
  profile: 'strict' | 'observe'
}

export type Task = {
  id: string
  text: string
  status: 'queued' | 'running' | 'done' | 'stopped' | 'failed'
  started_at?: string | number | null
  ended_at?: string | number | null
  steps?: number
}

export type Untrusted = { source?: string; text?: string } | string

export type Approval = {
  id: string
  kind: 'tool_call' | 'tools'
  tool?: string
  arguments?: unknown
  arguments_sha256?: string
  asked_because?: string
  agent_reason?: string
  untrusted_context?: Untrusted | null
  receipt_id?: string
  waiting_s?: number
}

export type Receipt = {
  id: string
  at: string | number
  kind: 'mcp.tool_call' | 'mcp.tools' | 'http.request' | string
  resource: string
  outcome: string
  approval_id?: string
  signature_kind?: string
  chain_ok?: boolean
}

export type Integrity = { ok: boolean; count: number; public_key?: string }

export type Rule = {
  action_type: string
  resource: string
  effect: string
  description?: string
  origin?: 'default' | 'paypal' | 'remembered' | 'drafted' | string
}

export type Policy = { profile: 'strict' | 'observe'; rules: Rule[] }

export type Draft = { draft_id: string; english: string; rules: Rule[]; valid: boolean; problems?: string[] }

export type Scenario = 'shift' | 'refund' | 'poisoned'
export type ReplayData = {
  placeholder?: boolean
  note?: string
  scenarios: Partial<Record<string, { strict?: FeedItem[]; off?: FeedItem[] }>>
}
