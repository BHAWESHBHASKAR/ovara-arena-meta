// Settings from the environment. Secrets are read here and passed only to the
// code that needs them; nothing in this file logs a value.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function num(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

export const MCP_TOOLS =
  'invoices.create,invoices.list,invoices.get,invoices.send,invoices.sendReminder,invoices.cancel,invoices.generateQRC,orders.create,orders.get,orders.capture,disputes.list,disputes.get,disputes.create,payments.createRefund,payments.getRefunds';

const ovaraDir = resolve(process.env.OVARA_DIR || '/srv/ovara');

export const config = {
  port: num('PORT', 10000),
  apiToken: process.env.API_TOKEN || '',

  ovaraDir,
  ovaraBin: process.env.OVARA_BIN || 'ovara',
  gatewayUrl: process.env.OVARA_GATEWAY_URL || 'http://127.0.0.1:8080',
  // policy.paypal.json lives here: it tells which rules are "paypal" in GET /api/policy
  payConfDir: resolve(process.env.OVARA_PAY_CONF || resolve(root, 'ovara')),
  // the API's own files (seed ids, drafts, recorded runs), next to the deployment
  stateDir: resolve(process.env.STATE_DIR || resolve(ovaraDir, 'ovara-pay')),
  webDist: resolve(process.env.WEB_DIST || resolve(root, 'web/dist')),
  webPublic: resolve(root, 'web/public'),

  // every tool the agent may use except transactions.list, whose schema carries
  // the current time and so would ask for a new pin on every boot
  mcpCmd: (process.env.PAYPAL_MCP_CMD || `npx -y @paypal/mcp --tools=${MCP_TOOLS}`).trim().split(/\s+/),
  mcpName: 'paypal',

  paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  paypalApi: 'https://api-m.sandbox.paypal.com',

  metaKey: process.env.META_API_KEY || '',
  metaBase: (process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
  agentModel: process.env.AGENT_MODEL || 'meta-models/muse-spark-open',
  drafterModel: process.env.DRAFTER_MODEL || 'meta-models/muse-spark-open',
  attackerModel: process.env.ATTACKER_MODEL || 'meta-models/muse-spark-open',

  maxSteps: num('MAX_STEPS', 12),
  dailyTasks: num('DAILY_TASKS', 60),
  // the PayPal tool schemas are large and go with every step: about 10k tokens a step
  taskTokenCap: num('TASK_TOKEN_CAP', 200000),
  heldAfterMs: 1500,
};

export type Config = typeof config;
