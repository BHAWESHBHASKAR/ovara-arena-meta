// arguments_sha256 must equal what OVARA computes in Go
// (proxy/internal/mcp/sniff.go: UseNumber decode, Encoder with SetEscapeHTML(false)).
// Expected values were produced by that Go code on the same inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argumentsSha256, canonicalJson, matchesCall } from '../src/mcp.js';

const cases: [string, string][] = [
  ['{}', '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'],
  // \ud834\udd1e is a character outside the BMP (a surrogate pair in JS)
  ['{"invoice_id":"INV2-ABCD","note":"Pay <now> & \\"quick\\"\\n\\ttab \\u2028 x\\u0001 é \\ud834\\udd1e"}', '5d264cf3928aeeb1afbf5844ead58578d4639091264808a750b69f1f78aaf4b2'],
  ['{"b":1,"a":[1.5,2e+21,-0,true,null],"é":{"z":"\\b\\f","A":"\\u007f"}}', 'b031f308d8d04a4144b5c20450eb646b2d7627e5120484f97ca56d2a6206aee9'],
  ['{"amount":{"value":"850.00","currency_code":"USD"},"capture_id":"2GG279541U471931P"}', '211bd09d12f2095025cb4e43fc6700d80e3578624c3511534a8374a27d4697b3'],
];

test('arguments_sha256 matches the Go encoder', () => {
  for (const [json, want] of cases) assert.equal(argumentsSha256(JSON.parse(json)), want, json);
});

test('canonical form sorts keys and does not escape HTML', () => {
  assert.equal(canonicalJson({ b: 1, a: '<&>' }), '{"a":"<&>","b":1}');
  assert.equal(canonicalJson({ s: ' ' }), '{"s":"\\u2028"}');
  assert.equal(canonicalJson(undefined), 'null');
});

test('a pending approval matches a call by resource and hash', () => {
  const a = { approval_id: 'apr_1', decision_id: 'dec_1', action_type: 'mcp.tool_call', resource: 'mcp:stdio:paypal/create_refund', created_at: '', status: 'pending', context: { arguments_sha256: 'abc' } };
  assert.ok(matchesCall(a, 'mcp:stdio:paypal/create_refund', 'abc'));
  assert.ok(!matchesCall(a, 'mcp:stdio:paypal/create_refund', 'abd'));
  assert.ok(!matchesCall({ ...a, action_type: 'mcp.tools' }, 'mcp:stdio:paypal/create_refund', 'abc'));
});
