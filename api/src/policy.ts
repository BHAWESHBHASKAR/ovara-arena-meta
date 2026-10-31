// The policy panel: the profile switch, the rules with where each came from,
// and the rule drafter (Nemotron 3 Ultra reads an incident and proposes
// OVARA rules; OVARA validates them; a person applies them).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chat, stripThink, type Profile } from './agent.js';
import { config } from './config.js';
import type { Feed } from './feed.js';
import { gateway, readPolicyFile, ruleEffect, ruleKey, writePolicyFile, type PolicyRule } from './ovara.js';

export interface ApiRule {
  action_type: string;
  resource: string;
  effect: 'allow' | 'deny' | 'escalate';
  description: string;
  origin: 'default' | 'paypal' | 'remembered' | 'drafted';
}

interface Draft {
  draft_id: string;
  incident_task_id: string;
  english: string;
  rules: PolicyRule[];
  valid: boolean;
  problems: string[];
  created_at: string;
  applied_at?: string;
}

interface Saved {
  profile: Profile;
  drafted: string[];
  drafts: Draft[];
}

const savedPath = () => join(config.stateDir, 'policy-state.json');

export class PolicyPanel {
  profile: Profile = 'strict';
  private drafted = new Set<string>();
  private drafts = new Map<string, Draft>();
  private paypalKeys?: Set<string>;

  async load(): Promise<void> {
    try {
      const s = JSON.parse(await readFile(savedPath(), 'utf8')) as Saved;
      this.profile = s.profile === 'observe' ? 'observe' : 'strict';
      this.drafted = new Set(s.drafted || []);
      for (const d of s.drafts || []) this.drafts.set(d.draft_id, d);
    } catch {
      /* first boot */
    }
  }

  private async save(): Promise<void> {
    await mkdir(config.stateDir, { recursive: true });
    const s: Saved = { profile: this.profile, drafted: [...this.drafted], drafts: [...this.drafts.values()].slice(-50) };
    await writeFile(savedPath(), JSON.stringify(s, null, 1));
  }

  async setProfile(p: Profile): Promise<Profile> {
    this.profile = p;
    await this.save();
    return p;
  }

  private async paypalRuleKeys(): Promise<Set<string>> {
    if (!this.paypalKeys) {
      try {
        const doc = JSON.parse(await readFile(join(config.payConfDir, 'policy.paypal.json'), 'utf8')) as { rules: PolicyRule[] };
        this.paypalKeys = new Set(doc.rules.map(ruleKey));
      } catch {
        this.paypalKeys = new Set();
      }
    }
    return this.paypalKeys;
  }

  async rules(): Promise<ApiRule[]> {
    const live = await gateway.rules();
    const paypal = await this.paypalRuleKeys();
    const out = live.map((r): ApiRule => {
      const k = ruleKey(r);
      const desc = r.description || '';
      const origin: ApiRule['origin'] = this.drafted.has(k)
        ? 'drafted'
        : desc.startsWith('[this run only]') || desc.startsWith('[remembered]')
          ? 'remembered'
          : paypal.has(k)
            ? 'paypal'
            : 'default';
      return { action_type: r.action_type, resource: r.resource || '*', effect: ruleEffect(r), description: desc, origin };
    });
    const rank = { drafted: 0, paypal: 1, remembered: 2, default: 3 };
    return out.map((r, i) => ({ r, i })).sort((a, b) => rank[a.r.origin] - rank[b.r.origin] || a.i - b.i).map((x) => x.r);
  }

  async view(): Promise<{ profile: Profile; rules: ApiRule[] }> {
    return { profile: this.profile, rules: await this.rules() };
  }

  // --- the drafter ---

  async draft(taskId: string, feed: Feed): Promise<{ draft_id: string; english: string; rules: ApiRule[]; valid: boolean; problems: string[] }> {
    const items = feed.forTask(taskId);
    if (!items.length) throw Object.assign(new Error(`no feed for task ${taskId}`), { status: 404 });
    const tools = [...new Set(items.filter((i) => i.kind === 'call').map((i) => String(i.tool)))];
    const incident = items
      .filter((i) => ['task', 'untrusted', 'call', 'decision', 'result', 'done'].includes(i.kind))
      .map((i) => {
        const { seq, at, task_id, ...rest } = i;
        void seq;
        void at;
        void task_id;
        return JSON.stringify(rest);
      })
      .join('\n')
      .slice(0, 12000);
    const prompt = `An AI agent runs a design studio's PayPal account through PayPal's MCP tools. OVARA sits between the agent and PayPal and decides every tool call by rule.

OVARA rules have this exact shape and nothing else:
{"action_type": "mcp.tool_call", "environment": "*", "resource": "mcp:stdio:paypal/<tool name>", "deny": true, "description": "<one plain sentence>"}
Use exactly one of "deny": true (refused without asking) or "escalate": true (a person decides). A rule matches a tool by name only: it cannot see the arguments, the payee or the text the agent read. Never use "*" in a resource and never write an "allow" rule.

Below is the incident: the task, the untrusted text the agent read from PayPal data, the calls it made and OVARA's decisions, one JSON object per line.

${incident}

Tools the agent called: ${tools.join(', ') || '(none)'}.

Propose the smallest set of rules (one to three) that would have stopped the harmful calls in this incident without a question, given what the rules can and cannot see. Answer with one JSON object and nothing else:
{"english": "<the rule in one or two plain sentences, including what it cannot see>", "rules": [ ... ]}`;
    const res = await chat(config.drafterModel, [{ role: 'user', content: prompt }], { maxTokens: 4000, temperature: 0.1 });
    const text = stripThink(res.choices?.[0]?.message?.content);
    const parsed = extractJson(text) as { english?: string; rules?: unknown[] } | undefined;
    const problems: string[] = [];
    if (!parsed) problems.push('the drafter did not answer with JSON');
    const rules = normalizeRules(parsed?.rules || [], problems);
    let valid = false;
    if (rules.length) {
      const doc = await readPolicyFile();
      const merged = mergeRules(doc.rules, rules);
      const v = await gateway.validate({ ...doc, rules: merged });
      valid = v.valid && !problems.length;
      problems.push(...(v.errors || []));
    } else problems.push('no usable rule in the draft');
    const d: Draft = {
      draft_id: `draft_${randomUUID().slice(0, 8)}`,
      incident_task_id: taskId,
      english: String(parsed?.english || '').trim(),
      rules,
      valid,
      problems,
      created_at: new Date().toISOString(),
    };
    this.drafts.set(d.draft_id, d);
    await this.save();
    return { draft_id: d.draft_id, english: d.english, valid, problems, rules: rules.map((r) => apiRule(r, 'drafted')) };
  }

  // Writes the drafted rules in front of policy.json; the gateway reloads the
  // file. Returns the policy once the gateway shows the new rules.
  async apply(draftId: string): Promise<{ profile: Profile; rules: ApiRule[] }> {
    const d = this.drafts.get(draftId);
    if (!d) throw Object.assign(new Error(`no draft ${draftId}`), { status: 404 });
    if (!d.valid) throw Object.assign(new Error(`draft ${draftId} is not valid: ${d.problems.join('; ')}`), { status: 409 });
    const doc = await readPolicyFile();
    const merged = mergeRules(doc.rules, d.rules);
    const v = await gateway.validate({ ...doc, rules: merged });
    if (!v.valid) throw Object.assign(new Error(`OVARA refused the policy: ${(v.errors || []).join('; ')}`), { status: 409 });
    await writePolicyFile({ ...doc, rules: merged });
    for (const r of d.rules) this.drafted.add(ruleKey(r));
    d.applied_at = new Date().toISOString();
    await this.save();
    const want = d.rules.map((r) => `${ruleKey(r)} ${ruleEffect(r)}`);
    for (let i = 0; i < 20; i++) {
      const live = await gateway.rules();
      const have = new Set(live.map((r) => `${ruleKey(r)} ${ruleEffect(r)}`));
      if (want.every((w) => have.has(w))) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    return this.view();
  }

  // Takes every drafted rule out of policy.json and puts back the PayPal rule
  // it replaced (the escalate on cancel_sent_invoice, for example), so a
  // deployment can be returned to its shipped policy without a restart.
  async reset(): Promise<{ profile: Profile; rules: ApiRule[]; removed: number }> {
    const doc = await readPolicyFile();
    const kept = doc.rules.filter((r) => !this.drafted.has(ruleKey(r)));
    const removed = doc.rules.length - kept.length;
    let paypal: PolicyRule[] = [];
    try {
      paypal = (JSON.parse(await readFile(join(config.payConfDir, 'policy.paypal.json'), 'utf8')) as { rules: PolicyRule[] }).rules;
    } catch {
      /* no PayPal rules to restore */
    }
    const present = new Set(kept.map(ruleKey));
    const restore = paypal.filter((r) => this.drafted.has(ruleKey(r)) && !present.has(ruleKey(r)));
    const rules = [...restore, ...kept];
    const v = await gateway.validate({ ...doc, rules });
    if (!v.valid) throw Object.assign(new Error(`OVARA refused the policy: ${(v.errors || []).join('; ')}`), { status: 409 });
    await writePolicyFile({ ...doc, rules });
    this.drafted.clear();
    for (const d of this.drafts.values()) delete d.applied_at;
    await this.save();
    for (let i = 0; i < 20; i++) {
      const live = await gateway.rules();
      if (!live.some((r) => String(r.description || '').startsWith('[drafted]'))) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    return { ...(await this.view()), removed };
  }
}

function apiRule(r: PolicyRule, origin: ApiRule['origin']): ApiRule {
  return { action_type: r.action_type, resource: r.resource || '*', effect: ruleEffect(r), description: r.description || '', origin };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const TOOL_RESOURCE = new RegExp(`^mcp:stdio:${config.mcpName}/[A-Za-z0-9_.-]+$`);

// Keeps only rules OVARA can evaluate and that narrow the policy: tool-call
// rules for one named tool, deny or escalate.
export function normalizeRules(raw: unknown[], problems: string[]): PolicyRule[] {
  const out: PolicyRule[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    let resource = String(r.resource || '');
    if (/^[A-Za-z0-9_.-]+$/.test(resource)) resource = `mcp:stdio:${config.mcpName}/${resource}`;
    if (r.action_type !== 'mcp.tool_call' || !TOOL_RESOURCE.test(resource)) {
      problems.push(`left out: ${JSON.stringify(x).slice(0, 160)} (only mcp.tool_call rules for one named tool)`);
      continue;
    }
    const effect = r.deny === true || r.effect === 'deny' ? 'deny' : r.escalate === true || r.effect === 'escalate' ? 'escalate' : '';
    if (!effect) {
      problems.push(`left out: ${resource} (a drafted rule may only deny or escalate)`);
      continue;
    }
    out.push({
      action_type: 'mcp.tool_call',
      environment: '*',
      resource,
      allow: false,
      deny: effect === 'deny',
      escalate: effect === 'escalate',
      description: `[drafted] ${String(r.description || '').slice(0, 300)}`.trim(),
    });
  }
  return out;
}

export function mergeRules(current: PolicyRule[], add: PolicyRule[]): PolicyRule[] {
  const keys = new Set(add.map(ruleKey));
  return [...add, ...current.filter((r) => !keys.has(ruleKey(r)))];
}
