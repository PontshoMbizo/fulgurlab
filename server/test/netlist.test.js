import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNetlist, NetlistError } from '../src/netlist.js';
import { fmt, polyExpr, generate } from '../src/codegen.js';
import { BLOCKS, portCounts } from '../../shared/catalog.js';

const base = () => ({
  settings: { tf: 1, dt: 0.01 },
  blocks: [
    { id: 'a', type: 'step' },
    { id: 's', type: 'scope' },
  ],
  links: [{ from: { block: 'a', port: 0 }, to: { block: 's', port: 0 } }],
});

const issuesOf = (net) => {
  try { validateNetlist(net); return []; } catch (e) { assert.ok(e instanceof NetlistError); return e.issues.map((i) => i.message); }
};

test('accepts a minimal diagram and fills defaults', () => {
  const n = validateNetlist(base());
  assert.equal(n.blocks[0].params.final, 1);
  assert.equal(n.blocks[1].inputs, 1);
});

test('rejects unknown block types and parameters', () => {
  const net = base();
  net.blocks.push({ id: 'x', type: 'evil' });
  net.blocks[0].params = { time: 1, cmd: 'unix_g("rm -rf /")' };
  const msgs = issuesOf(net).join('\n');
  assert.match(msgs, /unknown block type "evil"/);
  assert.match(msgs, /unknown parameter/);
});

test('parameters must be numbers, never strings of code', () => {
  const net = base();
  net.blocks[0].params = { time: '1; unix_g("id")' };
  assert.match(issuesOf(net).join(), /finite number/);
  net.blocks[0].params = { time: Infinity };
  assert.match(issuesOf(net).join(), /finite number/);
});

test('signs are restricted to their alphabet', () => {
  const net = base();
  net.blocks.push({ id: 'sum', type: 'sum', params: { signs: '+");' } });
  assert.match(issuesOf(net).join(), /Signs must be/);
});

test('ids are restricted', () => {
  const net = base();
  net.blocks[0].id = 'a"; host("x")';
  assert.ok(issuesOf(net).some((m) => /id must be/.test(m)));
});

test('unconnected inputs, doubled inputs and bad ports are reported', () => {
  const net = base();
  net.blocks.push({ id: 'g', type: 'gain' });
  assert.match(issuesOf(net).join(), /input 1 of Gain "g" is not connected/);
  net.links.push({ from: { block: 'a', port: 0 }, to: { block: 's', port: 0 } });
  assert.match(issuesOf(net).join(), /already has a wire/);
  net.links.push({ from: { block: 'a', port: 3 }, to: { block: 'g', port: 0 } });
  assert.match(issuesOf(net).join(), /has no output 4/);
});

test('improper transfer functions are rejected', () => {
  const net = base();
  net.blocks.splice(1, 0, { id: 'tf', type: 'transferFn', params: { num: [1, 0, 0], den: [1, 1] } });
  net.links = [
    { from: { block: 'a', port: 0 }, to: { block: 'tf', port: 0 } },
    { from: { block: 'tf', port: 0 }, to: { block: 's', port: 0 } },
  ];
  assert.match(issuesOf(net).join(), /proper/);
  net.blocks[1].params.num = [0, 0, 5]; // leading zeros are trimmed -> proper
  assert.deepEqual(issuesOf(net), []);
});

test('sample budget and empty diagrams', () => {
  assert.match(issuesOf({ blocks: [] }).join(), /empty/);
  const net = base();
  net.settings = { tf: 10000, dt: 1e-6 };
  assert.match(issuesOf(net).join(), /samples per scope/);
});

test('catalogue: every block has consistent defaults and port counts', () => {
  for (const b of BLOCKS) {
    const pc = portCounts(b.type, {});
    assert.ok(pc.inputs >= 0 && pc.outputs >= 0, b.type);
  }
  assert.equal(portCounts('sum', { signs: '++-' }).inputs, 3);
  assert.equal(portCounts('scope', { inputs: 4 }).inputs, 4);
});

test('fmt and polyExpr produce plain Scilab numerics', () => {
  assert.equal(fmt(1e-7), '1e-7');
  assert.equal(fmt(-0), '0');
  assert.throws(() => fmt(NaN));
  assert.equal(polyExpr([1, 2, 1], 's'), '(1)*s^2+(2)*s+(1)');
  assert.equal(polyExpr([0, 3], 'z'), '(3)');
  assert.equal(polyExpr([1, 0, -0.5], 's'), '(1)*s^2+(-0.5)');
});

test('generated script contains no user-supplied text', () => {
  const net = base();
  net.blocks[0].id = 'ZZZ_marker_id';
  net.blocks[1].id = 'YYY_marker_id';
  net.links = [{ from: { block: 'ZZZ_marker_id', port: 0 }, to: { block: 'YYY_marker_id', port: 0 } }];
  const { script } = generate(validateNetlist(net), '/tmp/out');
  assert.ok(!script.includes('marker'));
});

test('fan-out inserts a split block', () => {
  const net = base();
  net.blocks[1].params = { inputs: 2 };
  net.links.push({ from: { block: 'a', port: 0 }, to: { block: 's', port: 1 } });
  const { script } = generate(validateNetlist(net), '/tmp/out');
  assert.match(script, /SPLIT_f\("define"\)/);
  assert.match(script, /MUX\("define"\)/);
});
