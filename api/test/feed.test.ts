import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Feed } from '../src/feed.js';

test('items are numbered and filtered by seq', () => {
  const f = new Feed();
  f.push('t1', 'task', { text: 'a' });
  f.push('t1', 'call', { tool: 'list_invoices' });
  f.push('t2', 'task', { text: 'b' });
  assert.deepEqual(f.since(1).map((i) => i.seq), [2, 3]);
  assert.deepEqual(f.since(0, 't2').map((i) => i.kind), ['task']);
  assert.equal(f.lastOf('t1', 'task')?.text, 'a');
});

test('wait returns at once when there is something new', async () => {
  const f = new Feed();
  f.push('t', 'task');
  assert.equal((await f.wait(0, 5000)).length, 1);
});

test('wait wakes up on push and times out with nothing', async () => {
  const f = new Feed();
  const p = f.wait(0, 5000);
  setTimeout(() => f.push('t', 'thought', { text: 'x' }), 20);
  const got = await p;
  assert.equal(got.length, 1);
  assert.equal(got[0].text, 'x');
  const t0 = Date.now();
  assert.deepEqual(await f.wait(1, 50), []);
  assert.ok(Date.now() - t0 >= 45);
});

test('an aborted wait resolves empty', async () => {
  const f = new Feed();
  const ctl = new AbortController();
  const p = f.wait(0, 5000, ctl.signal);
  ctl.abort();
  assert.deepEqual(await p, []);
});

test('the feed keeps only the newest items', () => {
  const f = new Feed(3);
  for (let i = 0; i < 5; i++) f.push('t', 'thought');
  assert.deepEqual(f.since(0).map((i) => i.seq), [3, 4, 5]);
});
