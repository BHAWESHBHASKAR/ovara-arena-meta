// A stdio MCP client (newline-delimited JSON-RPC 2.0) and the "is it held?"
// check: a call that has not answered in 1.5 s is looked up among the
// gateway's pending approvals by its arguments' SHA-256.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import type { Gateway, PendingApproval } from './ovara.js';

// --- arguments_sha256, the way OVARA computes it (proxy/internal/mcp/sniff.go):
// decode, re-encode with Go's encoding/json (sorted keys, no HTML escaping,
// numbers as written), SHA-256 of the bytes.

function goString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x0c) out += '\\f';
    else if (c < 0x20) out += '\\u00' + c.toString(16).padStart(2, '0');
    else if (c === 0x2028 || c === 0x2029) out += '\\u' + c.toString(16);
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else out += '�';
    } else if (c >= 0xdc00 && c <= 0xdfff) out += '�';
    else out += s[i];
  }
  return out + '"';
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return goString(v);
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map((x) => canonicalJson(x === undefined ? null : x)).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort(byteOrder);
    return '{' + keys.map((k) => goString(k) + ':' + canonicalJson((v as Record<string, unknown>)[k])).join(',') + '}';
  }
  return 'null';
}

export function argumentsSha256(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args), 'utf8').digest('hex');
}

// --- JSON-RPC over a child's stdio ---

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface RpcError {
  code: number;
  message: string;
  data?: { approval_id?: string; reasons?: string[]; [k: string]: unknown };
}

export class RpcFailure extends Error {
  constructor(public readonly rpc: RpcError) {
    super(rpc.message);
  }
}

export interface ToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
  [k: string]: unknown;
}

type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

// A child's stderr can echo a request header or a token; nothing of that
// goes into an error message.
export function redactSecrets(s: string): string {
  return s.replace(/Bearer\s+\S+/g, '[redacted]').replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]');
}

export class McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private buf = '';
  private nextId = 0;
  private waiting = new Map<number, Waiter>();
  private stderrTail: string[] = [];
  private exited = false;
  tools: McpTool[] = [];

  constructor(
    readonly label: string,
    private readonly argv: string[],
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  get running(): boolean {
    return !!this.child && !this.exited;
  }

  get lastStderr(): string {
    return redactSecrets(this.stderrTail.join('\n'));
  }

  async start(): Promise<void> {
    const [cmd, ...args] = this.argv;
    const child = spawn(cmd, args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => this.onData(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => {
      for (const line of d.split('\n')) {
        if (!line.trim() || line.includes('UNDICI-EHPA') || line.includes('--trace-warnings')) continue;
        this.stderrTail.push(line);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
        // OVARA's own lines say what was paused or refused; worth a log line
        if (line.startsWith('[ovara]')) console.log(`mcp ${this.label}: ${line}`);
      }
    });
    child.on('exit', (code) => {
      this.exited = true;
      for (const [, w] of this.waiting) {
        clearTimeout(w.timer);
        w.reject(new Error(`MCP server ${this.label} exited (${code}): ${redactSecrets(this.stderrTail.slice(-3).join(' | '))}`));
      }
      this.waiting.clear();
    });
    child.on('error', (e) => {
      this.exited = true;
      console.error(`mcp ${this.label}: ${e.message}`);
    });
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'ovara-pay', version: '0.1.0' },
    }, 90000);
    this.notify('notifications/initialized');
  }

  private onData(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let m: { id?: number; result?: unknown; error?: RpcError };
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof m.id !== 'number') continue;
      const w = this.waiting.get(m.id);
      if (!w) continue;
      this.waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.error) w.reject(new RpcFailure(m.error));
      else w.resolve(m.result);
    }
  }

  private notify(method: string, params?: unknown): void {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  request<T>(method: string, params: unknown, timeoutMs: number, onId?: (id: number) => void): Promise<T> {
    if (!this.child || this.exited) return Promise.reject(new Error(`MCP server ${this.label} is not running`));
    const id = ++this.nextId;
    onId?.(id);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  // Cancelling a request tells the child; the wrapper's held approval (if the
  // watch learned one) stays open at the gateway, so the caller closes it
  // with `watch.held`. The rejection carries `cancelled` so it can tell.
  cancel(id: number, reason: string): void {
    this.notify('notifications/cancelled', { requestId: id, reason });
    const w = this.waiting.get(id);
    if (w) {
      this.waiting.delete(id);
      clearTimeout(w.timer);
      w.reject(Object.assign(new Error(`cancelled: ${reason}`), { cancelled: true }));
    }
  }

  async listTools(timeoutMs = 150000): Promise<McpTool[]> {
    const r = await this.request<{ tools: McpTool[] }>('tools/list', {}, timeoutMs);
    this.tools = r.tools || [];
    return this.tools;
  }

  // One tools/call. While it has not answered, `watch` (if given) is asked
  // after heldAfterMs whether OVARA is holding it; `signal` cancels it.
  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { signal?: AbortSignal; watch?: HeldWatch } = {},
  ): Promise<ToolResult> {
    let reqId = 0;
    const p = this.request<ToolResult>('tools/call', { name, arguments: args }, 170000, (id) => (reqId = id));
    const stopWatch = opts.watch ? opts.watch.start() : () => {};
    const onAbort = () => this.cancel(reqId, 'stopped by the operator');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await p;
    } finally {
      stopWatch();
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  stop(): void {
    try {
      this.child?.stdin.end();
      this.child?.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

// The wrapper puts a held call to the gateway as an approval for resource
// mcp:stdio:<server>/<tool> with context.arguments_sha256. Polling
// GET /v1/approval/pending finds it; the first match is reported once.
export class HeldWatch {
  // the approval this watch found, kept so a stopped task can deny it
  held?: PendingApproval;

  constructor(
    private readonly gw: Gateway,
    private readonly resource: string,
    private readonly sha: string,
    private readonly onHeld: (a: PendingApproval) => void,
    private readonly afterMs = config.heldAfterMs,
    private readonly everyMs = 1000,
  ) {}

  start(): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const since = Date.now() - 5000;
    const tick = async () => {
      if (stopped) return;
      try {
        const found = (await this.gw.pending())
          .filter((a) => matchesCall(a, this.resource, this.sha))
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        // an approval left open by an earlier identical call also counts: the
        // gateway merges identical questions, so this call waits on it too
        const hit = found.find((a) => Date.parse(a.created_at) >= since) || found[0];
        if (hit && !stopped) {
          stopped = true;
          this.held = hit;
          this.onHeld(hit);
          return;
        }
      } catch {
        /* gateway hiccup: try again */
      }
      if (!stopped) timer = setTimeout(tick, this.everyMs);
    };
    timer = setTimeout(tick, this.afterMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

export function matchesCall(a: PendingApproval, resource: string, sha: string): boolean {
  return a.action_type === 'mcp.tool_call' && a.resource === resource && a.context?.arguments_sha256 === sha;
}

export function toolResource(server: string, tool: string): string {
  return `mcp:stdio:${server}/${tool}`;
}

export function resultText(r: ToolResult): string {
  return (r.content || []).map((c) => (c.type === 'text' ? c.text || '' : `[${c.type}]`)).join('\n');
}
