export type Profile = 'strict' | 'observe'
export type Verdict = 'ignored' | 'held_denied' | 'refused' | 'landed' | 'failed'
export type CallOutcome = 'held_denied' | 'refused' | 'landed' | 'failed' | 'unknown'
export type HiddenStyle = 'faint_footer' | 'tiny_print' | 'near_white' | 'sticky_note' | 'stamp' | 'visible'

export type Summary = {
  rounds: number
  agent_fooled: number
  landed: number
  held_denied: number
  refused: number
  ignored: number
  noticed: number
  with_image: number
}

export type Attack = {
  from: string
  subject: string
  body: string
  image?: { name: string; title: string; lines: string[]; hidden_text: string; style: HiddenStyle | string }
  rationale: string
}

export type Round = {
  id: string
  n: number
  profile: Profile
  at: string
  attack: Attack
  image_url: string | null
  hidden_box?: [number, number, number, number]
  task_id?: string
  money_calls: { tool: string; arguments: Record<string, unknown>; outcome: CallOutcome | string }[]
  verdict: Verdict
  agent_said: string
  noticed: boolean
  replay_of?: string
  error?: string
  draft?: Draft
}

export type ArenaData = {
  placeholder?: boolean
  note?: string
  recorded_at?: string
  running: boolean
  plan: { rounds: number; profile: Profile; done: number } | null
  models: { attacker?: string; agent?: string; drafter?: string }
  summary: { strict: Summary; observe: Summary }
  rounds: Round[]
  feeds?: Record<string, FeedItem[]>
  receipts?: Receipt[]
  integrity?: Integrity
  policy?: Policy
}

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
  outcome?: string
  approval_id?: string
  receipt_id?: string
  rule?: string
  ok?: boolean
  summary?: string
  source?: string
  status?: string
  image?: string
}

export type LiveTask = {
  id: string
  text: string
  status: 'queued' | 'running' | 'done' | 'stopped' | 'failed'
  scenario?: string
  profile?: Profile
  started_at?: string | number | null
  inbound?: { from: string; subject: string; body: string; attachments: { id: string; name: string; url: string }[] }
}

export type Receipt = {
  id: string
  at: string | number
  kind: string
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
  origin?: string
}

export type Policy = { profile: Profile; rules: Rule[] }

export type VerifyResult = { ok: boolean; count: number; detail?: string }

export type DraftRule = { action_type: string; resource: string; effect?: string; deny?: boolean; escalate?: boolean; description?: string }
export type Draft = { draft_id: string; english: string; rules: DraftRule[]; valid: boolean; problems?: string[] }
