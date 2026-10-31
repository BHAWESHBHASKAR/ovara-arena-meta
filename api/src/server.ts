// HTTP API (docs/design.md) and the static console.
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { Agent, ruleFor, ToolHost, type Profile, type Task } from './agent.js';
import { config } from './config.js';
import { Feed } from './feed.js';
import {
  gateway,
  proxyOk,
  proxyReceipts,
  receiptPublicKey,
  verifyChainCli,
  type GatewayReceipt,
  type PendingApproval,
  type PolicyRule,
} from './ovara.js';
import { paypalConfigured, paypalToken } from './paypal.js';
import { PolicyPanel } from './policy.js';
import { loadSeed, prepareScenario, SCENARIO_NAMES, SCENARIO_TEXT, seed, seedStatus, type ScenarioName, type SeedState } from './scenarios.js';

const feed = new Feed();
const host = new ToolHost();
const agent = new Agent(feed, host);
const policy = new PolicyPanel();

const state = {
  boot: 'starting' as 'starting' | 'ready' | 'degraded',
  bootError: '',
  gatewayOk: false,
  proxyOk: false,
  tokenOk: false,
  seed: undefined as SeedState | undefined,
};

// --- task queue: one task at a time ---

const tasks: Task[] = [];
const controllers = new Map<string, AbortController>();
let running = false;
const daily = { day: '', count: 0 };

function enqueue(text: string, scenario?: string): Task {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, count: 0 });
  if (daily.count >= config.dailyTasks) throw httpError(429, `the daily task cap (${config.dailyTasks}) is reached`);
  daily.count++;
  const t: Task = {
    id: `task_${randomUUID().slice(0, 8)}`,
    text,
    scenario,
    profile: policy.profile,
    status: 'queued',
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
    steps: 0,
    tokens: 0,
  };
  tasks.push(t);
  if (tasks.length > 200) tasks.splice(0, tasks.length - 200);
  void pump();
  return t;
}

async function pump(): Promise<void> {
  if (running) return;
  const next = tasks.find((t) => t.status === 'queued');
  if (!next) return;
  running = true;
  const ctl = new AbortController();
  controllers.set(next.id, ctl);
  next.status = 'running';
  next.started_at = new Date().toISOString();
  try {
    if (next.scenario && SCENARIO_NAMES.includes(next.scenario as ScenarioName)) {
      // the invoices the scenario reads are open again before it starts
      state.seed = await prepareScenario(next.scenario as ScenarioName).catch((e) => {
        console.error(`prepare ${next.scenario}: ${(e as Error).message}`);
        return state.seed;
      });
    }
    await agent.run(next, ctl.signal);
  } finally {
    controllers.delete(next.id);
    running = false;
    setImmediate(() => void pump());
  }
}

// --- approvals ---

function waitingSeconds(a: PendingApproval): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(a.created_at)) / 1000));
}

function ruleWhy(rules: PolicyRule[], resource: string): string | undefined {
  const r = ruleFor(rules, 'mcp.tool_call', resource);
  return r?.description ? `rule ${r.resource}: ${r.description}` : undefined;
}

async function approvalsView() {
  const [pending, rules] = await Promise.all([gateway.pending(), gateway.rules().catch(() => [] as PolicyRule[])]);
  const receiptIds = await Promise.all(
    pending.map((a) =>
      gateway
        .receiptsForDecision(a.decision_id)
        .then((r) => r[0]?.receipt_id)
        .catch(() => undefined),
    ),
  );
  return pending
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((a, i) => {
      const c = a.context || {};
      const base = { id: a.approval_id, receipt_id: receiptIds[i], waiting_s: waitingSeconds(a), resource: a.resource };
      if (a.action_type === 'mcp.tools') {
        return {
          ...base,
          kind: 'tools' as const,
          asked_because: [c.why, c.mcp_tools].filter(Boolean).join('\n') || 'the tool definitions are new or changed',
        };
      }
      if (a.action_type === 'mcp.tool_call') {
        const rec = agent.callFor(c.arguments_sha256);
        let args: unknown = rec?.arguments;
        if (args === undefined && c.arguments) {
          try {
            args = JSON.parse(c.arguments);
          } catch {
            args = c.arguments;
          }
        }
        return {
          ...base,
          kind: 'tool_call' as const,
          tool: c.tool || a.resource.split('/').pop(),
          arguments: args,
          arguments_sha256: c.arguments_sha256,
          asked_because: c.warning || c.why || ruleWhy(rules, a.resource) || 'no rule allows this tool: a person decides',
          agent_reason: rec?.agent_reason,
          untrusted_context: rec?.untrusted_context ?? null,
          task_id: rec?.task_id,
        };
      }
      // anything else OVARA holds (an HTTP request from the MCP server)
      return { ...base, kind: 'http' as const, asked_because: c.why || a.resource };
    });
}

// --- receipts ---

const verified = new Map<string, boolean>();
let lastChain: { ok: boolean; detail: string; at: number } | undefined;

async function chainStatus() {
  if (!lastChain || Date.now() - lastChain.at > 60000) lastChain = { ...(await verifyChainCli()), at: Date.now() };
  return lastChain;
}

function gwOutcome(d: string): string {
  return d === 'allow' ? 'allowed' : d === 'escalate' ? 'held' : d === 'deny' ? 'refused' : d;
}

async function receiptsView(n: number) {
  const [gw, px, approvals, chain, key] = await Promise.all([
    gateway.receipts().catch(() => [] as GatewayReceipt[]),
    proxyReceipts(Math.max(400, n * 3)),
    gateway.allApprovals().catch(() => [] as PendingApproval[]),
    chainStatus(),
    receiptPublicKey(),
  ]);
  const approvalOf = new Map(approvals.map((a) => [a.decision_id, a]));
  const unverified = gw.filter((r) => !verified.has(r.receipt_id)).slice(-500);
  await Promise.all(
    unverified.map((r) =>
      gateway
        .verifyReceipt(r)
        .then((v) => verified.set(r.receipt_id, v.valid))
        .catch(() => undefined),
    ),
  );
  const rows = [
    ...gw.map((r) => {
      const a = approvalOf.get(r.decision_id);
      return {
        id: r.receipt_id,
        at: r.issued_at,
        kind: r.action_type,
        resource: r.resource,
        outcome: gwOutcome(r.decision),
        ...(a ? { approval_id: a.approval_id, approval: a.status } : {}),
        signature_kind: r.gateway_sig ? 'hmac_v1+ed25519' : 'hmac_v1',
        chain_ok: verified.get(r.receipt_id) ?? null,
        source: 'gateway',
      };
    }),
    ...px
      .filter((r) => r.phase !== 'attempt')
      .map((r) => ({
        id: r.receipt_id,
        at: r.timestamp,
        kind: 'http.request',
        resource: `${r.method || ''} ${String(r.url || '').replace(/:443(?=\/)/, '')}`.trim(),
        outcome: r.decision === 'allow' ? 'allowed' : r.decision === 'deny' ? 'refused' : r.decision === 'escalate' ? 'held' : String(r.decision || ''),
        ...(r.approval_id ? { approval_id: r.approval_id } : {}),
        ...(typeof r.status === 'number' && r.status ? { http_status: r.status } : {}),
        signature_kind: String(r.signature || '').split(':')[0] || 'none',
        chain_ok: chain.ok,
        source: 'proxy',
      })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, n);
  const gwOk = gw.every((r) => verified.get(r.receipt_id) !== false);
  return { receipts: rows, integrity: { ok: chain.ok && gwOk, count: gw.length + (await proxyReceipts(100000)).length, public_key: key } };
}

async function verifyAll() {
  const [gw, chain, integ] = await Promise.all([gateway.receipts(), verifyChainCli(), gateway.integrity().catch(() => undefined)]);
  let bad = 0;
  for (const r of gw) {
    const v = await gateway.verifyReceipt(r).catch(() => ({ valid: false }));
    verified.set(r.receipt_id, v.valid);
    if (!v.valid) bad++;
  }
  lastChain = { ...chain, at: Date.now() };
  const px = (await proxyReceipts(100000)).length;
  const ok = chain.ok && bad === 0 && (integ ? integ.passed : true);
  const detail = [
    `gateway: ${gw.length - bad} of ${gw.length} decision receipts have a valid signature (POST /v1/receipts/verify)`,
    `gateway runtime integrity: ${integ ? (integ.passed ? 'passed' : 'failed') : 'not available'}`,
    `proxy (ovara log -verify-only): ${chain.detail.replace(/\n+/g, '; ')}`,
  ].join('\n');
  return { ok, count: gw.length + px, detail };
}

// --- HTTP plumbing ---

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw httpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw httpError(400, 'body is not JSON');
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const root = config.webDist;
  const exists = await stat(join(root, 'index.html')).then(() => true, () => false);
  if (!exists) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OVARA for PayPal agents: the console is not built (web/dist is missing); the API is at /api/state.\n');
    return;
  }
  let file = resolve(root, '.' + normalize(decodeURIComponent(path)));
  if (!file.startsWith(root)) file = join(root, 'index.html');
  let st = await stat(file).catch(() => undefined);
  if (!st || st.isDirectory()) {
    file = join(root, 'index.html');
    st = await stat(file);
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

function authorized(req: IncomingMessage): boolean {
  if (!config.apiToken || req.method === 'GET' || req.method === 'HEAD') return true;
  return req.headers.authorization === `Bearer ${config.apiToken}`;
}

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp('^' + pattern.replace(/\{[a-z_]+\}/g, '([^/]+)') + '$'), h]);

route('GET', '/api/state', async () => ({
  boot: state.boot,
  ...(state.bootError ? { error: state.bootError } : {}),
  ovara: {
    gateway_ok: state.gatewayOk,
    proxy_ok: state.proxyOk,
    pins: host.pins.state === 'approved' ? 'approved' : 'pending',
    ...(host.pins.approval_id && host.pins.state === 'pending' ? { pins_approval_id: host.pins.approval_id } : {}),
  },
  paypal: { sandbox: true, token_ok: state.tokenOk, seed: seedStatus(state.seed) },
  models: { agent: config.agentModel, drafter: config.drafterModel },
  profile: policy.profile,
}));

route('GET', '/api/tasks', async () => tasks.map(({ tokens, ...t }) => (void tokens, t)));

route('POST', '/api/tasks', async (req) => {
  const b = await readBody(req);
  if (typeof b.scenario === 'string') {
    if (!SCENARIO_NAMES.includes(b.scenario as ScenarioName)) throw httpError(400, `scenario must be one of ${SCENARIO_NAMES.join(', ')}`);
    const name = b.scenario as ScenarioName;
    return enqueue(SCENARIO_TEXT[name], name);
  }
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) throw httpError(400, 'send {text} or {scenario}');
  if (text.length > 2000) throw httpError(400, 'text is longer than 2000 characters');
  return enqueue(text);
});

route('POST', '/api/tasks/{id}/stop', async (_req, _res, [id]) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) throw httpError(404, `no task ${id}`);
  if (t.status === 'queued') {
    t.status = 'stopped';
    t.ended_at = new Date().toISOString();
    feed.push(t.id, 'done', { status: 'stopped', text: 'stopped before it started' });
  } else controllers.get(id)?.abort();
  return t;
});

route('GET', '/api/feed', async (req, _res, _p, url) => {
  const since = Number(url.searchParams.get('since') || 0) || 0;
  const taskId = url.searchParams.get('task_id') || undefined;
  const ctl = new AbortController();
  req.on('close', () => ctl.abort());
  return feed.wait(since, 25000, ctl.signal, taskId);
});

route('GET', '/api/approvals', async () => approvalsView());

route('POST', '/api/approvals/{id}/approve', async (req, _res, [id]) => {
  const b = await readBody(req);
  if (b.remember === true) {
    const a = await gateway.approval(id);
    if (a.action_type !== 'mcp.tool_call') throw httpError(400, 'only a tool call can be remembered');
    const r = await gateway.approveRemember(id);
    if (!r.ok) throw httpError(502, `ovara approve -remember tool-run failed: ${r.detail}`);
    return { id, status: 'approved', remembered: a.resource, detail: r.detail };
  }
  const a = await gateway.approve(id);
  return { id, status: a.status };
});

route('POST', '/api/approvals/{id}/deny', async (req, _res, [id]) => {
  const b = await readBody(req);
  const a = await gateway.deny(id, typeof b.reason === 'string' ? b.reason.slice(0, 500) : '');
  return { id, status: a.status };
});

route('GET', '/api/receipts', async (_req, _res, _p, url) => {
  const n = Math.min(1000, Math.max(1, Number(url.searchParams.get('n') || 100) || 100));
  return receiptsView(n);
});

route('POST', '/api/receipts/verify', async () => verifyAll());

route('GET', '/api/policy', async () => policy.view());

route('POST', '/api/policy/profile', async (req) => {
  const b = await readBody(req);
  if (b.profile !== 'strict' && b.profile !== 'observe') throw httpError(400, 'profile is strict or observe');
  const p = await policy.setProfile(b.profile as Profile);
  return {
    profile: p,
    note:
      p === 'observe'
        ? 'OVARA off: the next tasks run the PayPal MCP server directly, with the real token and no checks.'
        : 'OVARA on: the next tasks run the PayPal MCP server through OVARA.',
  };
});

route('POST', '/api/policy/draft', async (req) => {
  const b = await readBody(req);
  const id = typeof b.incident_task_id === 'string' ? b.incident_task_id : '';
  if (!id) throw httpError(400, 'send {incident_task_id}');
  return policy.draft(id, feed);
});

route('POST', '/api/policy/draft/{id}/apply', async (_req, _res, [id]) => policy.apply(id));
route('POST', '/api/policy/reset', async () => policy.reset());

route('GET', '/api/replay', async () => {
  // web/public is the recorded source; web/dist has the copy the build made
  for (const p of [join(config.webPublic, 'replay.json'), join(config.webDist, 'replay.json')]) {
    try {
      return JSON.parse(await readFile(p, 'utf8'));
    } catch {
      /* next */
    }
  }
  throw httpError(404, 'no replay.json');
});

// Not in the contract: the seed ids, and a fresh seed (`{"force": true}`
// clears the sandbox's open invoices first).
route('POST', '/api/seed', async (req) => {
  const b = await readBody(req);
  state.seed = await seed(b.force === true);
  return { status: seedStatus(state.seed), seed: state.seed };
});
route('GET', '/api/seed', async () => ({ status: seedStatus(state.seed), seed: state.seed }));

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;
  try {
    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'method not allowed');
      return await serveStatic(req, res, path);
    }
    if (!authorized(req)) throw httpError(401, 'API_TOKEN required: Authorization: Bearer <token>');
    for (const [method, re, h] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(path);
      if (!m) continue;
      const out = await h(req, res, m.slice(1).map(decodeURIComponent), url);
      if (!res.headersSent) send(res, 200, out);
      return;
    }
    throw httpError(404, `no route ${req.method} ${path}`);
  } catch (e) {
    const status = (e as { status?: number }).status || 500;
    if (status >= 500) console.error(`${req.method} ${path}: ${(e as Error).message}`);
    if (!res.headersSent) send(res, status, { error: (e as Error).message });
  }
});

// --- boot ---

async function boot(): Promise<void> {
  await policy.load();
  state.gatewayOk = await gateway.ok();
  state.proxyOk = await proxyOk();
  state.seed = await loadSeed();
  if (paypalConfigured()) {
    paypalToken()
      .then(() => {
        state.tokenOk = true;
        return seed();
      })
      .then((s) => {
        state.seed = s;
        if (s?.problems.length) console.log(`seed: ${s.problems.length} problem(s): ${s.problems.join(' | ').slice(0, 600)}`);
      })
      .catch((e) => console.error(`seed: ${(e as Error).message}`));
  } else console.log('boot: PAYPAL_CLIENT_ID/SECRET not set; no seed, and "OVARA off" cannot run');
  if (!state.gatewayOk) {
    state.boot = 'degraded';
    state.bootError = `OVARA gateway not reachable at ${config.gatewayUrl}`;
    console.error(`boot: ${state.bootError}`);
    return;
  }
  try {
    await host.ensureWrapped();
    state.boot = 'ready';
    console.log(`boot: ready; ${host.wrapped?.tools.length ?? 0} PayPal tools through OVARA`);
  } catch (e) {
    state.boot = 'degraded';
    state.bootError = `PayPal MCP server through OVARA: ${(e as Error).message}`;
    console.error(`boot: ${state.bootError}`);
  }
  void pump();
}

setInterval(async () => {
  state.gatewayOk = await gateway.ok();
  state.proxyOk = await proxyOk();
}, 15000).unref();

server.listen(config.port, () => {
  console.log(`ovara-pay api on :${config.port} (OVARA_DIR ${config.ovaraDir})`);
  stat(join(config.webDist, 'index.html')).then(
    () => console.log(`console: ${config.webDist}`),
    () => console.log(`console: no index.html in ${config.webDist} (set WEB_DIST); / shows a placeholder`),
  );
  void boot();
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const c of controllers.values()) c.abort();
    host.stop();
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  });
}
