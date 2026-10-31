// The OVARA side: the gateway's REST API (operator token), the two receipt
// files, the policy file, and the `ovara` CLI where REST does not cover a step
// (`env`, `approve -remember`, `log -verify-only`). The CLI is run with
// execFile and an argument list, never through a shell.
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open, readFile, rename, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { connect } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { config } from './config.js';

export interface PendingApproval {
  approval_id: string;
  decision_id: string;
  action_type: string;
  resource: string;
  created_at: string;
  status: string;
  reason?: string;
  context?: Record<string, string>;
}

export interface GatewayReceipt {
  receipt_id: string;
  decision_id: string;
  action_type: string;
  resource: string;
  decision: string;
  issued_at: string;
  signature?: string;
  gateway_sig?: string;
  [k: string]: unknown;
}

export interface PolicyRule {
  action_type: string;
  environment?: string;
  resource?: string;
  allow?: boolean;
  deny?: boolean;
  escalate?: boolean;
  description?: string;
  [k: string]: unknown;
}

export interface PolicyDoc {
  version?: string;
  precedence?: string;
  default?: string;
  rules: PolicyRule[];
  [k: string]: unknown;
}

export function runCli(args: string[], timeoutMs = 20000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(config.ovaraBin, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
      done({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function inDir(p: string): string {
  return isAbsolute(p) ? p : join(config.ovaraDir, p);
}

export class Gateway {
  private token = '';

  constructor(private readonly base = config.gatewayUrl, private readonly dir = config.ovaraDir) {}

  private async operatorToken(): Promise<string> {
    if (!this.token) {
      const c = await readJson<{ operator_tokens?: string[] }>(join(this.dir, 'config.json'));
      this.token = c.operator_tokens?.[0] || '';
      if (!this.token) throw new Error('no operator token in config.json');
    }
    return this.token;
  }

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: { Authorization: `Bearer ${await this.operatorToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON: keep the text */
    }
    if (!res.ok) {
      const msg = typeof data === 'object' && data && 'error' in data ? JSON.stringify(data) : String(text).slice(0, 300);
      throw new Error(`gateway ${method} ${path}: ${res.status} ${msg}`);
    }
    return data as T;
  }

  async ok(): Promise<boolean> {
    try {
      await this.request('GET', '/v1/approval/pending', undefined, 3000);
      return true;
    } catch {
      return false;
    }
  }

  async pending(): Promise<PendingApproval[]> {
    const r = await this.request<{ approvals: PendingApproval[] }>('GET', '/v1/approval/pending');
    return r.approvals || [];
  }

  async approval(id: string): Promise<PendingApproval> {
    return this.request('GET', `/v1/approval/${encodeURIComponent(id)}`);
  }

  async allApprovals(): Promise<PendingApproval[]> {
    const r = await this.request<{ approvals: PendingApproval[] }>('GET', '/v1/approvals');
    return r.approvals || [];
  }

  async approve(id: string): Promise<PendingApproval> {
    return this.request('POST', `/v1/approval/${encodeURIComponent(id)}/approve`, { resolved_by: 'console' });
  }

  async deny(id: string, reason = ''): Promise<PendingApproval> {
    return this.request('POST', `/v1/approval/${encodeURIComponent(id)}/deny`, { resolved_by: 'console', reason });
  }

  // `ovara approve <id> -remember tool-run`: approve and add an allow rule for
  // exactly this tool until `ovara run` stops (OVARA writes the rule itself).
  async approveRemember(id: string): Promise<{ ok: boolean; detail: string }> {
    const r = await runCli(['approve', id, '-dir', this.dir, '-remember', 'tool-run']);
    return { ok: r.code === 0, detail: (r.stdout + r.stderr).trim().slice(0, 500) };
  }

  async receipts(): Promise<GatewayReceipt[]> {
    const r = await this.request<{ receipts: GatewayReceipt[] }>('GET', '/v1/receipts', undefined, 15000);
    return r.receipts || [];
  }

  async receiptsForDecision(decisionId: string): Promise<GatewayReceipt[]> {
    const r = await this.request<{ receipts: GatewayReceipt[] }>('GET', `/v1/receipts/decision/${encodeURIComponent(decisionId)}`);
    return r.receipts || [];
  }

  async verifyReceipt(r: GatewayReceipt): Promise<{ valid: boolean; reason?: string }> {
    return this.request('POST', '/v1/receipts/verify', r);
  }

  async integrity(): Promise<{ passed: boolean; summary?: Record<string, number> }> {
    return this.request('GET', '/v1/runtime/integrity', undefined, 15000);
  }

  async rules(): Promise<PolicyRule[]> {
    const r = await this.request<{ rules: PolicyRule[] }>('GET', '/v1/policy/rules');
    return r.rules || [];
  }

  async validate(doc: PolicyDoc): Promise<{ valid: boolean; errors?: string[]; warnings?: string[] }> {
    // policy_data is []byte on the Go side, so it travels base64-encoded
    const policy_data = Buffer.from(JSON.stringify(doc)).toString('base64');
    return this.request('POST', '/v1/policy/validate', { policy_data });
  }
}

export const gateway = new Gateway();

// The environment `ovara env` prints, as an object: proxy variables, CA
// bundle paths and the PayPal placeholder. `unset` lines become deletions.
export async function ovaraEnv(): Promise<{ set: Record<string, string>; unset: string[] }> {
  const r = await runCli(['env', '-dir', config.ovaraDir]);
  if (r.code !== 0) throw new Error(`ovara env failed: ${r.stderr.trim().slice(0, 300)}`);
  return parseEnvScript(r.stdout);
}

export function parseEnvScript(text: string): { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  const unset: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    let m = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) {
      let v = m[2];
      if (v.length >= 2 && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"')))) {
        v = v.slice(1, -1);
        if (raw.includes(`='`)) v = v.replace(/'\\''/g, "'");
      }
      set[m[1]] = v;
      continue;
    }
    m = /^unset\s+(.+)$/.exec(line);
    if (m) unset.push(...m[1].split(/\s+/));
  }
  return { set, unset };
}

// --- files in the deployment directory ---

interface ProxyJson {
  listen_addr?: string;
  receipts_file?: string;
  pubkey_file?: string;
}

async function proxyJson(): Promise<ProxyJson> {
  return readJson<ProxyJson>(join(config.ovaraDir, 'proxy.json'));
}

export interface ProxyReceipt {
  receipt_id: string;
  timestamp: string;
  method?: string;
  url?: string;
  decision?: string;
  status?: number;
  phase?: string;
  rule?: string;
  approval_id?: string;
  signature?: string;
  [k: string]: unknown;
}

async function receiptsFile(): Promise<string> {
  const p = await proxyJson();
  return inDir(p.receipts_file || 'var/receipts.jsonl');
}

// The last `n` lines of a file, read from its tail (about 600 bytes a line is
// assumed; the read grows until it has enough lines or the whole file).
async function tailLines(path: string, n: number): Promise<string[]> {
  let fh: FileHandle;
  try {
    fh = await open(path, 'r');
  } catch {
    return [];
  }
  try {
    const size = (await fh.stat()).size;
    let bytes = Math.min(size, Math.max(64 * 1024, n * 600));
    for (;;) {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, size - bytes);
      const text = buf.subarray(0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      // the first line is cut unless the read started at the file's start
      if (bytes < size) lines.shift();
      const full = lines.filter(Boolean);
      if (full.length >= n || bytes >= size) return full.slice(-n);
      bytes = Math.min(size, bytes * 4);
    }
  } finally {
    await fh.close();
  }
}

// The proxy's HTTP receipts, newest last. Only the newest `n` lines are read.
export async function proxyReceipts(n = 400): Promise<ProxyReceipt[]> {
  const lines = await tailLines(await receiptsFile(), n);
  const out: ProxyReceipt[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* a partly written last line */
    }
  }
  return out;
}

// How many receipts the proxy has written. The file is only counted again when
// its size changed.
let countCache: { size: number; count: number } | undefined;

export async function proxyReceiptCount(): Promise<number> {
  const path = await receiptsFile();
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return 0;
  }
  if (countCache && countCache.size === size) return countCache.count;
  let count = 0;
  await new Promise<void>((done, fail) => {
    const s = createReadStream(path);
    let lastByte = 0x0a;
    s.on('data', (chunk) => {
      const b = chunk as Buffer;
      for (let i = 0; i < b.length; i++) if (b[i] === 0x0a) count++;
      if (b.length) lastByte = b[b.length - 1];
    });
    s.on('end', () => {
      if (lastByte !== 0x0a) count++;
      done();
    });
    s.on('error', fail);
  }).catch(() => (count = 0));
  countCache = { size, count };
  return count;
}

export async function receiptPublicKey(): Promise<string> {
  const p = await proxyJson();
  try {
    return (await readFile(inDir(p.pubkey_file || 'var/receipt_pubkey.hex'), 'utf8')).trim();
  } catch {
    return '';
  }
}

export async function proxyOk(): Promise<boolean> {
  const p = await proxyJson().catch(() => ({}) as ProxyJson);
  const [host, port] = (p.listen_addr || '127.0.0.1:9443').split(':');
  return new Promise((done) => {
    const s = connect({ host: host || '127.0.0.1', port: Number(port) || 9443, timeout: 1500 });
    s.once('connect', () => {
      s.destroy();
      done(true);
    });
    s.once('error', () => done(false));
    s.once('timeout', () => {
      s.destroy();
      done(false);
    });
  });
}

// `ovara log -verify-only`: signatures and hash chain of the proxy's receipts,
// and the anchors.
export async function verifyChainCli(): Promise<{ ok: boolean; detail: string }> {
  const r = await runCli(['log', '-dir', config.ovaraDir, '-verify-only'], 60000);
  const detail = (r.stdout + r.stderr).trim();
  // before the first proxied request there is no log to verify; that is not a broken chain
  const empty = r.code !== 0 && /no such file|no receipts|empty|0 receipts/i.test(detail);
  return { ok: r.code === 0 || empty, detail: empty ? 'proxy: no receipts yet' : detail };
}

export const policyPath = () => join(config.ovaraDir, 'policy.json');

export async function readPolicyFile(): Promise<PolicyDoc> {
  return readJson<PolicyDoc>(policyPath());
}

// The gateway watches policy.json and reloads it; writing the file (instead of
// PUT /v1/policy) keeps the file's precedence and default, which the PUT
// route does not carry.
export async function writePolicyFile(doc: PolicyDoc): Promise<void> {
  const p = policyPath();
  const tmp = `${p}.ovara-pay.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, p);
}

export function ruleKey(r: { action_type: string; resource?: string }): string {
  return `${r.action_type} ${r.resource || ''}`;
}

export function ruleEffect(r: PolicyRule): 'allow' | 'deny' | 'escalate' {
  if (r.deny) return 'deny';
  if (r.allow) return 'allow';
  return 'escalate';
}
