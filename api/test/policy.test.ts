import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson, mergeRules, normalizeRules } from '../src/policy.js';
import { parseEnvScript } from '../src/ovara.js';

test('drafted rules: only deny/escalate for one named tool', () => {
  const problems: string[] = [];
  const out = normalizeRules(
    [
      { action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/create_refund', deny: true, description: 'no refunds pushed by a note' },
      { action_type: 'mcp.tool_call', resource: 'cancel_sent_invoice', effect: 'escalate' },
      { action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/*', deny: true },
      { action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/send_invoice', allow: true },
    ],
    problems,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].deny, true);
  assert.equal(out[1].resource, 'mcp:stdio:paypal/cancel_sent_invoice');
  assert.equal(out[1].escalate, true);
  assert.equal(problems.length, 2);
});

test('merge puts new rules first and replaces the same key', () => {
  const cur = [{ action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/create_refund', escalate: true }, { action_type: 'http.request', resource: 'GET *', allow: true }];
  const add = [{ action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/create_refund', deny: true }];
  const m = mergeRules(cur, add);
  assert.equal(m.length, 2);
  assert.equal(m[0].deny, true);
});

test('extractJson finds the object in a fenced answer', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"english":"x","rules":[]}\n```'), { english: 'x', rules: [] });
  assert.equal(extractJson('no json'), undefined);
});

test('parseEnvScript reads export and unset lines', () => {
  const e = parseEnvScript("# c\nexport HTTPS_PROXY=http://127.0.0.1:9443\nexport A='x y'\nunset FOO BAR\n");
  assert.equal(e.set.HTTPS_PROXY, 'http://127.0.0.1:9443');
  assert.equal(e.set.A, 'x y');
  assert.deepEqual(e.unset, ['FOO', 'BAR']);
});
