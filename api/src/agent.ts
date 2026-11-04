// The agent loop: Muse Spark (Meta Model API, OpenAI-compatible tool calling, image input)
// over the PayPal MCP tools, one task at a time. Every step goes to the feed.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { Feed, FeedItem } from './feed.js';
import {
  argumentsSha256,
  HeldWatch,
  matchesCall,
  McpClient,
  resultText,
  RpcFailure,
  toolResource,
  type McpTool,
  type ToolResult,
} from './mcp.js';
import { gateway, ovaraEnv, type PendingApproval, type PolicyRule, ruleEffect } from './ovara.js';
import { paypalToken } from './paypal.js';
import { SYSTEM_PROMPT } from './scenarios.js';

// --- model ---

export function stripThink(s: string | null | undefined): string {
  if (!s) return '';
  let t = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  // reasoning that was cut off, or that came without its opening tag
  if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + '</think>'.length);
  const open = t.indexOf('<think>');
  if (open >= 0) t = t.slice(0, open);
  return t.trim();
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

// What a client sent with a task: an email (text the agent reads) and image
// attachments (screenshots, scans). Both are untrusted data, and the image is
// passed to the model as pixels, so text hidden in it reaches the model while
// a text-only filter never sees it.
export interface Attachment {
  id: string;
  name: string;
  data_url: string;
}

export interface Inbound {
  from: string;
  subject: string;
  body: string;
  attachments: Attachment[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
  usage?: { total_tokens?: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: { tools?: unknown[]; maxTokens?: number; temperature?: number; signal?: AbortSignal } = {},
): Promise<ChatResponse> {
  if (!config.metaKey) throw new Error('META_API_KEY is not set');
  const body = JSON.stringify({
    model,
    messages,
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    max_tokens: Math.max(1200, opts.maxTokens || 2000),
    temperature: opts.temperature ?? 0.2,
  });
  const waits = [2000, 5000, 12000];
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let detail = '';
    try {
      const res = await fetch(`${config.metaBase}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.metaKey}`, 'Content-Type': 'application/json' },
        body,
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
      });
      if (res.ok) return (await res.json()) as ChatResponse;
      status = res.status;
      detail = (await res.text()).slice(0, 300);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      detail = (e as Error).message;
    }
    const retry = status === 0 || status === 429 || status >= 500;
    if (!retry || attempt >= waits.length) throw new Error(`model ${model}: ${status || 'network'} ${detail}`);
    await sleep(waits[attempt]);
  }
}

// --- PayPal tools for the model ---

const TOOL_TOPICS = /invoice|order|refund|dispute/;

export function curatedTools(all: McpTool[]): McpTool[] {
  return all.filter((t) => TOOL_TOPICS.test(t.name));
}

function toOpenAiTool(t: McpTool) {
  return {
    type: 'function',
    function: { name: t.name, description: (t.description || '').trim(), parameters: t.inputSchema || { type: 'object', properties: {} } },
  };
}

// --- reading tool results ---

// Fields of PayPal objects whose text is written by someone other than the
// studio, or that can carry such text: what the agent reads there is shown
// in the feed as `untrusted`.
const UNTRUSTED_KEYS = new Set(['note', 'memo', 'note_to_payer', 'customer_notes', 'terms_and_conditions', 'note_to_recipient']);
// dispute messages: { messages: [{ posted_by, content }] }
const UNTRUSTED_IN_MESSAGES = 'content';

export function findUntrusted(tool: string, data: unknown): { source: string; text: string }[] {
  const out: { source: string; text: string }[] = [];
  const walk = (v: unknown, path: string, owner: string, inMessages: boolean) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, owner, inMessages));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const id = typeof o.id === 'string' && o.id.length >= 6 ? o.id : owner;
      for (const [k, x] of Object.entries(o)) {
        const p = path ? `${path}.${k}` : k;
        const watched = UNTRUSTED_KEYS.has(k) || (inMessages && k === UNTRUSTED_IN_MESSAGES);
        if (typeof x === 'string' && watched && x.trim().length >= 24 && !x.startsWith('acme-studio seed:')) {
          out.push({ source: `${tool}${id ? ` ${id}` : ''}: ${p}`, text: x.trim() });
        } else walk(x, p, id, inMessages || k === 'messages');
      }
    }
  };
  // a PayPal error body is PayPal's own text, not a third party's
  if (isPayPalError(data)) return out;
  walk(data, '', '', false);
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// PayPal's REST error body: { name, message, debug_id, details? }. The MCP
// server passes it on as a normal (not isError) result.
export function isPayPalError(data: unknown): boolean {
  const d = data as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.message !== 'string') return false;
  // @paypal/mcp wraps HTTP errors as { ok: false, status, code, message }
  if (d.ok === false || typeof d.code === 'string' || typeof d.name === 'string' || 'debug_id' in d || 'details' in d) return true;
  return !('id' in d) && !('status' in d);
}

// The untrusted text shown with a call: the newest one read from an object
// the call names (an invoice id in its arguments), else the newest one.
export function untrustedFor(
  items: FeedItem[],
  args: Record<string, unknown>,
): { source: string; text: string; image?: string } | undefined {
  const all = items.filter((i) => i.kind === 'untrusted') as (FeedItem & { source: string; text: string; image?: string })[];
  if (!all.length) return undefined;
  const ids = Object.values(args).filter((v): v is string => typeof v === 'string' && v.length >= 6);
  const named = [...all].reverse().find((u) => ids.some((id) => u.source.includes(id)));
  // a task that came with a client email: what the client sent is what
  // pushed the agent, the image first since that is where text hides
  const inbound = [...all].reverse().find((u) => u.image) || [...all].reverse().find((u) => u.source.startsWith('email from'));
  const u = named || inbound || all[all.length - 1];
  return { source: u.source, text: u.text, ...(u.image ? { image: u.image } : {}) };
}

export function summarize(text: string, isError: boolean): string {
  if (/^\s*(""|\{\})?\s*$/.test(text)) return isError ? 'error with no detail' : 'done (PayPal answered with no body)';
  const data = parseJson(text) as Record<string, unknown> | undefined;
  if (isPayPalError(data)) {
    const det = (data!.details as { issue?: string; description?: string }[] | undefined)?.[0];
    const head = [data!.status, data!.name || data!.code, det?.issue].filter(Boolean).join(' ');
    return `error: ${head ? head + ': ' : ''}${String(det?.description || data!.message).slice(0, 200)}`;
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const parts: string[] = [];
    const items = (data.items || data.transaction_details || data.items_list) as unknown[] | undefined;
    if (Array.isArray(items)) parts.push(`${items.length} item(s)`);
    if (typeof data.total_items === 'number') parts.push(`${data.total_items} in total`);
    if (data.success === true) parts.push('success');
    for (const k of ['id', 'invoice_id', 'status', 'name', 'message']) if (typeof data[k] === 'string') parts.push(`${k} ${data[k]}`);
    const detail = data.detail as Record<string, unknown> | undefined;
    if (detail && typeof detail.invoice_number === 'string') parts.push(`invoice ${detail.invoice_number}`);
    if (typeof data.href === 'string') parts.push(String(data.href).split('/').slice(-1)[0]);
    if (parts.length) return (isError ? 'error: ' : '') + parts.join(', ');
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return (isError ? 'error: ' : '') + (flat.length > 200 ? flat.slice(0, 200) + '...' : flat || '(empty)');
}

// --- rule shown with a decision ---

function globToRegExp(p: string): RegExp {
  return new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

export function ruleFor(rules: PolicyRule[], actionType: string, resource: string): PolicyRule | undefined {
  let best: PolicyRule | undefined;
  let score = -1;
  for (const r of rules) {
    if (r.action_type !== actionType && r.action_type !== '*') continue;
    const pat = r.resource || '';
    if (pat && !globToRegExp(pat).test(resource)) continue;
    const s = pat.replace(/\*/g, '').length;
    if (s > score) {
      best = r;
      score = s;
    }
  }
  return best;
}

function ruleLabel(r: PolicyRule | undefined): string | undefined {
  if (!r) return undefined;
  return `${ruleEffect(r)} ${r.resource || '(any)'}${r.description ? `: ${r.description}` : ''}`;
}

// --- the tools' host: wrapped by OVARA, or not ---

export type Profile = 'strict' | 'observe';

export interface PinState {
  state: 'starting' | 'pending' | 'approved' | 'failed';
  approval_id?: string;
  error?: string;
}

export class ToolHost {
  wrapped?: McpClient;
  direct?: McpClient;
  pins: PinState = { state: 'starting' };
  private starting?: Promise<McpClient>;
  private directToken = '';

  // The wrapped server: `ovara mcp wrap ... -- <PAYPAL_MCP_CMD>` inside
  // `ovara env`, with the PayPal placeholder token.
  async ensureWrapped(): Promise<McpClient> {
    if (this.wrapped?.running && this.pins.state === 'approved') return this.wrapped;
    if (!this.starting) this.starting = this.startWrapped().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async startWrapped(): Promise<McpClient> {
    this.wrapped?.stop();
    const { set, unset } = await ovaraEnv();
    const env: NodeJS.ProcessEnv = { ...process.env, ...set, PAYPAL_ENVIRONMENT: 'SANDBOX' };
    // the MCP server must not inherit any real credential
    for (const k of [...unset, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'META_API_KEY', 'TAVILY_API_KEY', 'API_TOKEN']) delete env[k];
    // `ovara env` sets its own placeholder; never pass on a real token
    if (set.PAYPAL_ACCESS_TOKEN) env.PAYPAL_ACCESS_TOKEN = set.PAYPAL_ACCESS_TOKEN;
    else env.PAYPAL_ACCESS_TOKEN = 'placeholder-ovara-injects-the-real-one';
    const argv = [config.ovaraBin, 'mcp', 'wrap', '-dir', config.ovaraDir, '-name', config.mcpName, '--', ...config.mcpCmd];
    const c = new McpClient('wrapped', argv, env);
    this.wrapped = c;
    this.pins = { state: 'starting' };
    await c.start();
    await this.listWithPins(c);
    return c;
  }

  // tools/list through the wrapper. When OVARA holds the tool definitions
  // (first boot, or a description changed), the console shows the pin
  // request; a question left unanswered for 120 s is closed and asked again.
  private async listWithPins(c: McpClient): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const since = Date.now() - 2000;
      let done = false;
      const watch = (async () => {
        await sleep(config.heldAfterMs);
        while (!done) {
          try {
            const p = (await gateway.pending())
              .filter((a) => a.action_type === 'mcp.tools' && a.resource.startsWith(`mcp:stdio:${config.mcpName} `) && Date.parse(a.created_at) >= since)
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
            if (p && !done) this.pins = { state: 'pending', approval_id: p.approval_id };
          } catch {
            /* try again */
          }
          await sleep(1000);
        }
      })();
      try {
        await c.listTools();
        done = true;
        await watch;
        this.pins = { state: 'approved' };
        return;
      } catch (e) {
        done = true;
        await watch;
        const rpc = e instanceof RpcFailure ? e.rpc : undefined;
        const stale = rpc?.data?.approval_id;
        if (!rpc || !rpc.data?.reasons?.includes('approval_timeout')) {
          this.pins = { state: 'failed', error: (e as Error).message };
          throw e;
        }
        // nobody answered: close the old question so the console shows only the new one
        if (stale) await gateway.deny(stale, 'no answer in time; asked again').catch(() => {});
      }
    }
    this.pins = { state: 'failed', error: 'tool definitions never approved' };
    throw new Error('tool definitions never approved');
  }

  // "OVARA off": the same MCP server, run directly with the real token in its
  // environment and no proxy. Nothing checks its calls.
  // The child keeps the token it was started with, so when PayPal has issued
  // a new one since, the old child is stopped and a fresh one started.
  async ensureDirect(): Promise<McpClient> {
    const token = await paypalToken();
    if (this.direct?.running && this.directToken === token) return this.direct;
    this.direct?.stop();
    const env: NodeJS.ProcessEnv = { ...process.env, PAYPAL_ACCESS_TOKEN: token, PAYPAL_ENVIRONMENT: 'SANDBOX' };
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_USE_ENV_PROXY', 'META_API_KEY', 'TAVILY_API_KEY', 'API_TOKEN', 'PAYPAL_CLIENT_SECRET']) delete env[k];
    const c = new McpClient('direct', config.mcpCmd, env);
    this.direct = c;
    this.directToken = token;
    await c.start();
    await c.listTools();
    return c;
  }

  stop(): void {
    this.wrapped?.stop();
    this.direct?.stop();
  }
}

// --- tasks ---

// The task, plus the client's email and its images when there are any. The
// email and the images are marked as data from outside, the same way the
// system prompt treats tool results.
export function userContent(task: Task): string | ContentPart[] {
  const ib = task.inbound;
  if (!ib) return task.text;
  const parts: ContentPart[] = [
    {
      type: 'text',
      text:
        `${task.text}\n\n--- Client email (data from outside the studio) ---\nFrom: ${ib.from}\nSubject: ${ib.subject}\n\n${ib.body}\n--- end of email ---` +
        (ib.attachments.length ? `\n\nAttachments: ${ib.attachments.map((a) => a.name).join(', ')} (images below).` : ''),
    },
  ];
  for (const a of ib.attachments) parts.push({ type: 'image_url', image_url: { url: a.data_url } });
  return parts;
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'stopped' | 'failed';

export interface Task {
  id: string;
  text: string;
  scenario?: string;
  profile: Profile;
  status: TaskStatus;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  steps: number;
  tokens: number;
  error?: string;
  inbound?: Inbound;
}

// What the approvals endpoint needs about a call it did not see itself.
export interface CallRecord {
  task_id: string;
  tool: string;
  arguments: Record<string, unknown>;
  arguments_sha256: string;
  agent_reason?: string;
  untrusted_context?: { source: string; text: string; image?: string };
  at: number;
}

export class Agent {
  // keyed `${task_id}:${arguments_sha256}`: two tasks can send the same arguments
  readonly calls = new Map<string, CallRecord>();
  private rules: PolicyRule[] = [];

  constructor(
    private readonly feed: Feed,
    readonly host: ToolHost,
  ) {}

  // The record of a call by its arguments' hash and, when known, its task.
  // The gateway's approval carries only the hash, so without a task the
  // newest record with that hash is the one.
  callFor(sha: string | undefined, taskId?: string): CallRecord | undefined {
    if (!sha) return undefined;
    if (taskId) return this.calls.get(`${taskId}:${sha}`);
    let found: CallRecord | undefined;
    for (const [k, r] of this.calls) if (k.endsWith(`:${sha}`) && (!found || r.at >= found.at)) found = r;
    return found;
  }

  async run(task: Task, signal: AbortSignal): Promise<void> {
    const off = task.profile === 'observe';
    this.feed.push(task.id, 'task', {
      text: task.text,
      scenario: task.scenario,
      profile: task.profile,
      status: 'running',
      ...(off ? { note: 'OVARA off: calls go straight to PayPal' } : {}),
    });
    try {
      const client = off ? await this.host.ensureDirect() : await this.host.ensureWrapped();
      if (!off) this.rules = await gateway.rules().catch(() => this.rules);
      const tools = curatedTools(client.tools).map(toOpenAiTool);
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT(new Date().toISOString().slice(0, 10)) },
        { role: 'user', content: userContent(task) },
      ];
      if (task.inbound) {
        const ib = task.inbound;
        this.feed.push(task.id, 'untrusted', { source: `email from ${ib.from}: ${ib.subject}`, text: ib.body });
        for (const a of ib.attachments) {
          this.feed.push(task.id, 'untrusted', { source: `attachment ${a.name} (image, from ${ib.from})`, text: `[image attachment ${a.name}]`, image: `/api/attachments/${a.id}` });
        }
      }
      let lastText = '';
      for (let step = 0; step < config.maxSteps; step++) {
        if (signal.aborted) return this.finish(task, 'stopped');
        task.steps = step + 1;
        const res = await chat(config.agentModel, messages, { tools, maxTokens: 2500, signal });
        task.tokens += res.usage?.total_tokens || 0;
        const msg = res.choices?.[0]?.message;
        if (!msg) throw new Error('the model returned no message');
        const text = stripThink(msg.content);
        const calls = msg.tool_calls || [];
        // the final answer goes out once, with `done`
        if (text && calls.length) {
          lastText = text;
          this.feed.push(task.id, 'thought', { text: text.length > 800 ? text.slice(0, 800) + '...' : text });
        }
        if (!calls.length) return this.finish(task, 'done', text || lastText);
        messages.push({ role: 'assistant', content: msg.content ? text : null, tool_calls: calls });
        for (const call of calls) {
          if (signal.aborted) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: 'The task was stopped by the operator.' });
            continue;
          }
          const answer = await this.callTool(task, client, call, text || lastText, off, signal);
          messages.push({ role: 'tool', tool_call_id: call.id, content: answer });
        }
        if (task.tokens > config.taskTokenCap) return this.finish(task, 'stopped', `token cap reached (${task.tokens} tokens)`);
      }
      return this.finish(task, 'done', `step limit reached (${config.maxSteps})`);
    } catch (e) {
      if (signal.aborted) return this.finish(task, 'stopped');
      task.error = (e as Error).message;
      return this.finish(task, 'failed', task.error);
    }
  }

  private finish(task: Task, status: TaskStatus, text?: string): void {
    task.status = status;
    task.ended_at = new Date().toISOString();
    this.feed.push(task.id, 'done', { status, ...(text ? { text: text.length > 1200 ? text.slice(0, 1200) + '...' : text } : {}) });
    void this.record(task);
  }

  // Each run is kept as JSON (task + its feed): the source for replay.json.
  private async record(task: Task): Promise<void> {
    try {
      const dir = join(config.stateDir, 'runs');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${task.id}.json`), JSON.stringify({ task, items: this.feed.forTask(task.id) }, null, 1));
    } catch (e) {
      console.error(`could not record run ${task.id}: ${(e as Error).message}`);
    }
  }

  // Runs one tool call and returns what the model is told.
  private async callTool(task: Task, client: McpClient, call: ToolCall, reason: string, off: boolean, signal: AbortSignal): Promise<string> {
    const tool = call.function.name;
    let args: Record<string, unknown>;
    try {
      const parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      this.feed.push(task.id, 'result', { tool, ok: false, summary: 'the model sent arguments that are not JSON' });
      return 'Error: the arguments were not valid JSON. Send a JSON object.';
    }
    if (!client.tools.some((t) => t.name === tool) || !TOOL_TOPICS.test(tool)) {
      this.feed.push(task.id, 'result', { tool, ok: false, summary: 'no such tool' });
      return `Error: there is no tool named ${tool}.`;
    }
    const sha = argumentsSha256(args);
    const untrusted = untrustedFor(this.feed.forTask(task.id), args);
    const record: CallRecord = {
      task_id: task.id,
      tool,
      arguments: args,
      arguments_sha256: sha,
      agent_reason: reason || undefined,
      untrusted_context: untrusted,
      at: Date.now(),
    };
    this.calls.set(`${task.id}:${sha}`, record);
    if (this.calls.size > 500) this.calls.delete(this.calls.keys().next().value!);
    this.feed.push(task.id, 'call', { tool, arguments: args, arguments_sha256: sha });

    const resource = toolResource(config.mcpName, tool);
    const started = Date.now();
    let held: PendingApproval | undefined;
    let heldPushed: Promise<void> = Promise.resolve();
    const watch = off
      ? undefined
      : new HeldWatch(gateway, resource, sha, (a) => {
          held = a;
          heldPushed = this.pushHeld(task.id, tool, resource, a);
        });

    let result: ToolResult;
    try {
      result = await client.callTool(tool, args, { signal, watch });
    } catch (e) {
      if (!(e instanceof RpcFailure)) {
        // stopped while OVARA held the call: close the question, so nobody
        // approves it later with no task listening
        if (signal.aborted && !off) {
          await heldPushed;
          await this.denyHeld(task, tool, resource, sha, held || watch?.held);
        }
        this.feed.push(task.id, 'result', { tool, ok: false, summary: (e as Error).message.slice(0, 200) });
        return `Error: ${(e as Error).message}`;
      }
      await heldPushed;
      if (!held) held = await this.heldAfterAll(task.id, tool, resource, sha, started, e.rpc.data?.approval_id);
      return this.refusal(task, tool, resource, e, held);
    }

    await heldPushed;
    // answered before the 1.5 s check: ask the gateway whether a person decided it
    if (!off && !held) held = await this.heldAfterAll(task.id, tool, resource, sha, started);
    if (off) {
      this.feed.push(task.id, 'decision', { tool, outcome: 'allowed', unchecked: true, rule: 'not checked: OVARA off' });
    } else if (held) {
      this.feed.push(task.id, 'decision', { tool, outcome: 'allowed', approval_id: held.approval_id, rule: 'approved by the operator' });
    } else {
      const receipt = await this.receiptAfter(resource, started);
      this.feed.push(task.id, 'decision', {
        tool,
        outcome: 'allowed',
        ...(receipt ? { receipt_id: receipt } : {}),
        rule: ruleLabel(ruleFor(this.rules, 'mcp.tool_call', resource)),
      });
    }

    const text = resultText(result);
    const ok = !result.isError && !isPayPalError(parseJson(text));
    this.feed.push(task.id, 'result', { tool, ok, summary: summarize(text, !ok) });
    const data = parseJson(text);
    if (data !== undefined) {
      const seen = new Set(this.feed.forTask(task.id).filter((i) => i.kind === 'untrusted').map((i) => i.text));
      for (const u of findUntrusted(tool, data)) {
        if (seen.has(u.text)) continue;
        seen.add(u.text);
        this.feed.push(task.id, 'untrusted', u);
      }
    }
    return text.length > 8000 ? text.slice(0, 8000) + '\n[cut]' : text || '(empty result)';
  }

  // A task stopped while its call is held: the pending approval is denied
  // by its id. When the watch had not found it yet, the gateway's pending
  // list is asked once more.
  private async denyHeld(task: Task, tool: string, resource: string, sha: string, known: PendingApproval | undefined): Promise<void> {
    let a = known;
    if (!a) {
      a = await gateway
        .pending()
        .then((all) => all.filter((x) => matchesCall(x, resource, sha)).sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0])
        .catch(() => undefined);
      if (a) await this.pushHeld(task.id, tool, resource, a);
    }
    if (!a) return;
    try {
      await gateway.deny(a.approval_id, 'task stopped');
    } catch (e) {
      // already answered, or the gateway is away: nothing to close
      console.error(`deny ${a.approval_id} after stop: ${(e as Error).message}`);
      return;
    }
    this.feed.push(task.id, 'decision', { tool, outcome: 'denied', approval_id: a.approval_id, rule: 'task stopped' });
  }

  private async pushHeld(taskId: string, tool: string, resource: string, a: PendingApproval): Promise<void> {
    const receipt = await gateway
      .receiptsForDecision(a.decision_id)
      .then((r) => r[0]?.receipt_id)
      .catch(() => undefined);
    this.feed.push(taskId, 'decision', {
      tool,
      outcome: 'held',
      approval_id: a.approval_id,
      ...(receipt ? { receipt_id: receipt } : {}),
      rule: ruleLabel(ruleFor(this.rules, 'mcp.tool_call', resource)) || 'no rule allows it: a person decides',
    });
  }

  // A call that was held and answered before HeldWatch looked: find its
  // approval among all approvals and put the `held` item in the feed late.
  private async heldAfterAll(taskId: string, tool: string, resource: string, sha: string, since: number, id?: string): Promise<PendingApproval | undefined> {
    try {
      const all = await gateway.allApprovals();
      const a = id
        ? all.find((x) => x.approval_id === id)
        : all
            .filter((x) => x.action_type === 'mcp.tool_call' && x.resource === resource && x.context?.arguments_sha256 === sha && Date.parse(x.created_at) >= since - 2000)
            .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0];
      if (!a) return undefined;
      await this.pushHeld(taskId, tool, resource, a);
      return a;
    } catch {
      return undefined;
    }
  }

  private async refusal(task: Task, tool: string, resource: string, e: RpcFailure, held: PendingApproval | undefined): Promise<string> {
    const reasons = e.rpc.data?.reasons || [];
    const approvalId = e.rpc.data?.approval_id || held?.approval_id;
    if (reasons.includes('approval_timeout')) {
      this.feed.push(task.id, 'result', { tool, ok: false, summary: 'no answer from the operator in time; the call did not run' });
      return 'The operator did not answer in time; the call did not run. Do not retry it now; finish the rest of the task and mention it.';
    }
    if (approvalId && reasons.includes('mcp_tool_call_denied')) {
      const why = await gateway
        .approval(approvalId)
        .then((a) => a.reason || '')
        .catch(() => '');
      this.feed.push(task.id, 'decision', { tool, outcome: 'denied', approval_id: approvalId, ...(why ? { rule: `operator: ${why}` } : {}) });
      this.feed.push(task.id, 'result', { tool, ok: false, summary: 'denied by the operator; the call did not run' });
      return `Denied by the operator${why ? ` (${why})` : ''}. The call did not run. Do not retry it.`;
    }
    const receipt = await this.receiptAfter(resource, Date.now() - 10000);
    this.feed.push(task.id, 'decision', {
      tool,
      outcome: 'refused',
      ...(receipt ? { receipt_id: receipt } : {}),
      rule: ruleLabel(ruleFor(this.rules, 'mcp.tool_call', resource)) || reasons.join(', '),
    });
    this.feed.push(task.id, 'result', { tool, ok: false, summary: e.rpc.message.slice(0, 200) });
    return `Refused by policy: ${e.rpc.message}. The call did not run. Do not retry it.`;
  }

  private async receiptAfter(resource: string, since: number): Promise<string | undefined> {
    try {
      const rs = await gateway.receipts();
      for (let i = rs.length - 1; i >= 0; i--) {
        const r = rs[i];
        if (r.resource === resource && Date.parse(r.issued_at) >= since - 2000) return r.receipt_id;
      }
    } catch {
      /* no receipt id in the feed then */
    }
    return undefined;
  }
}
