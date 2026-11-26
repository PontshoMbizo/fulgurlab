import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, isGrader, clientKey } from '../src/ratelimit.js';
import { validateNetlist } from '../src/netlist.js';

test('the limiter allows perMinute calls per key per minute, then refuses', () => {
  let t = 0;
  const l = createLimiter({ perMinute: 3, now: () => t });
  assert.deepEqual([1, 2, 3, 4].map(() => l.allow('a')), [true, true, true, false]);
  assert.equal(l.allow('b'), true, 'keys are independent');
  t = 60_001;
  assert.equal(l.allow('a'), true, 'the window slides');
});

test('perMinute 0 turns the limit off', () => {
  const l = createLimiter({ perMinute: 0 });
  for (let i = 0; i < 100; i++) assert.equal(l.allow('a'), true);
});

test('only the exact grader token is accepted, and only when one is configured', () => {
  assert.equal(isGrader('Bearer s3cret', 's3cret'), true);
  assert.equal(isGrader('Bearer s3cre', 's3cret'), false);
  assert.equal(isGrader('s3cret', 's3cret'), false);
  assert.equal(isGrader(undefined, 's3cret'), false);
  assert.equal(isGrader('Bearer ', ''), false);
});

test('X-Forwarded-For is used only behind a trusted proxy', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientKey(req, true), '203.0.113.9');
  assert.equal(clientKey(req, false), '10.0.0.1');
});

test('editor-only block fields (locked, name, x, y) are accepted and ignored', () => {
  const n = validateNetlist({
    settings: { tf: 1, dt: 0.01 },
    blocks: [
      { id: 'a', type: 'step', locked: true, name: 'Input', x: 10, y: 20 },
      { id: 's', type: 'scope', locked: true },
    ],
    links: [{ from: { block: 'a', port: 0 }, to: { block: 's', port: 0 } }],
  });
  assert.equal(n.blocks.length, 2);
});
