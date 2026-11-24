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

// ---- state-space, switch, user function
const withBlock = (block, extra = {}) => {
  const net = base();
  net.blocks.splice(1, 0, { id: 'b', ...block });
  const n = portCounts(block.type, block.params).inputs;
  net.links = [{ from: { block: 'a', port: 0 }, to: { block: 'b', port: 0 } }, { from: { block: 'b', port: 0 }, to: { block: 's', port: 0 } }];
  for (let i = 1; i < n; i++) net.links.push({ from: { block: 'a', port: 0 }, to: { block: 'b', port: i } });
  return Object.assign(net, extra);
};

test('state-space dimensions are checked', () => {
  assert.deepEqual(issuesOf(withBlock({ type: 'stateSpace', params: {} })), []);
  const ok = { A: [[0, 1], [-2, -3]], B: [[0], [1]], C: [[1, 0]], D: [[0]], x0: [0, 0] };
  assert.deepEqual(issuesOf(withBlock({ type: 'stateSpace', params: ok })), []);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, A: [[0, 1]] } })).join(), /A must be square/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, B: [[0, 1]] } })).join(), /B must be 2×1/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, C: [[1], [0]] } })).join(), /C must be 1×2/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, x0: [0] } })).join(), /initial state needs 2/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, A: [[0, 1], [1]] } })).join(), /rectangular matrix/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, A: [[0, 'x'], [1, 1]] } })).join(), /finite numbers/);
  assert.match(issuesOf(withBlock({ type: 'stateSpace', params: { ...ok, D: [[Infinity]] } })).join(), /finite numbers/);
});

test('switch and user function accept their defaults; the switch rule is bounded', () => {
  assert.deepEqual(issuesOf(withBlock({ type: 'switch', params: {} })), []);
  assert.deepEqual(issuesOf(withBlock({ type: 'userFn', params: {} })), []);
  assert.ok(issuesOf(withBlock({ type: 'switch', params: { rule: 3 } })).length);
});

test('user function expressions are whitelisted', () => {
  const bad = ['u1; unix_g("id")', 'u1 `x`', 'u2', 'foo(u1)', 'u1 u1', '1e999', 'u1 +', '(u1', 'u1)', 'exec("x")', '"a"', "u1'", 'u1==1', 'u1\nu1', 'sin', '', ' ', 'x'.repeat(300), '('.repeat(40) + 'u1' + ')'.repeat(40)];
  for (const expr of bad) {
    assert.ok(issuesOf(withBlock({ type: 'userFn', params: { expr, inputs: 1 } })).length > 0, `should reject ${JSON.stringify(expr).slice(0, 40)}`);
  }
  for (const expr of ['u1', '-u1^2', '2*u1 + 3', 'sin(u1)/2', 'abs(u1)^0.5', '1.5e-3*u1', '.5*u1', 'exp(-u1) - -1']) {
    assert.deepEqual(issuesOf(withBlock({ type: 'userFn', params: { expr, inputs: 1 } })), [], `should accept ${expr}`);
  }
  assert.match(issuesOf(withBlock({ type: 'userFn', params: { expr: 'u1 + u3', inputs: 2 } })).join(), /u3 is not an input/);
});

test('generated script carries only the re-emitted expression and numbers', () => {
  const net = withBlock({ type: 'userFn', params: { expr: '  2 *  U_is_not_allowed'.replace('U_is_not_allowed', 'u1') + ' + sin( u1 )', inputs: 1 } });
  const { script } = generate(validateNetlist(net), '/tmp/out');
  assert.match(script, /\(\(2\*u1\)\+sin\(u1\)\)/);
  assert.ok(!script.includes('  2 *  u1'));
});

// ---- subsystems
import { flatten } from '../src/flatten.js';
const L = (a, ap, b, bp) => ({ from: { block: a, port: ap }, to: { block: b, port: bp } });
/** step -> sub[ inport -> gain k -> outport ] -> scope */
const subNet = (k = 3) => ({
  settings: { tf: 1, dt: 0.1 },
  blocks: [
    { id: 'a', type: 'step', params: { time: 0 } },
    { id: 'sub', type: 'subsystem', system: {
      blocks: [{ id: 'in', type: 'inport' }, { id: 'g', type: 'gain', params: { k } }, { id: 'out', type: 'outport' }],
      links: [L('in', 0, 'g', 0), L('g', 0, 'out', 0)] } },
    { id: 's', type: 'scope' },
  ],
  links: [L('a', 0, 'sub', 0), L('sub', 0, 's', 0)],
});

test('subsystem ports come from its Inport and Outport blocks', () => {
  const v = validateNetlist(subNet());
  const sub = v.blocks.find((b) => b.id === 'sub');
  assert.equal(sub.inputs, 1);
  assert.equal(sub.outputs, 1);
  assert.ok(sub.system.blocks.length === 3);
});

test('flatten removes the subsystem and rewires through its ports', () => {
  const f = flatten(validateNetlist(subNet(5)));
  assert.deepEqual(f.blocks.map((b) => b.id).sort(), ['a', 's', 'sub/g']);
  assert.deepEqual(f.links.map((l) => `${l.from.block}>${l.to.block}`).sort(), ['a>sub/g', 'sub/g>s']);
  assert.equal(f.blocks.find((b) => b.id === 'sub/g').params.k, 5);
});

test('flatten handles fan-out through an Inport, pass-through ports and two levels', () => {
  const net = {
    settings: { tf: 1, dt: 0.1 },
    blocks: [
      { id: 'a', type: 'step' },
      { id: 'outer', type: 'subsystem', system: {
        blocks: [
          { id: 'in', type: 'inport' },
          { id: 'inner', type: 'subsystem', system: {
            blocks: [{ id: 'i', type: 'inport' }, { id: 'o', type: 'outport' }], // pure pass-through
            links: [L('i', 0, 'o', 0)] } },
          { id: 'g', type: 'gain' },
          { id: 'o1', type: 'outport', params: { index: 1 } },
          { id: 'o2', type: 'outport', params: { index: 2 } },
        ],
        links: [L('in', 0, 'inner', 0), L('inner', 0, 'o1', 0), L('in', 0, 'g', 0), L('g', 0, 'o2', 0)] } },
      { id: 's', type: 'scope', params: { inputs: 2 } },
    ],
    links: [L('a', 0, 'outer', 0), L('outer', 0, 's', 0), L('outer', 1, 's', 1)],
  };
  const f = flatten(validateNetlist(net));
  assert.deepEqual(f.blocks.map((b) => b.id).sort(), ['a', 'outer/g', 's']);
  const pairs = f.links.map((l) => `${l.from.block}:${l.from.port}>${l.to.block}:${l.to.port}`).sort();
  assert.deepEqual(pairs, ['a:0>outer/g:0', 'a:0>s:0', 'outer/g:0>s:1']);
  // and codegen accepts it, with the fan-out from `a` becoming a split
  assert.match(generate(validateNetlist(net), '/tmp/out').script, /SPLIT_f\("define"\)/);
});

test('subsystem validation reports problems with a path to the block', () => {
  const bad = subNet();
  bad.blocks[1].system.links = []; // g and out are now unconnected
  const e = (() => { try { validateNetlist(bad); } catch (x) { return x; } })();
  assert.ok(e instanceof NetlistError);
  assert.ok(e.issues.some((i) => i.block === 'sub/g' && /not connected/.test(i.message)), JSON.stringify(e.issues));

  assert.match(issuesOf({ ...base(), blocks: [...base().blocks, { id: 'p', type: 'inport' }] }).join(), /only make sense inside a subsystem/);
  const dupe = subNet();
  dupe.blocks[1].system.blocks.push({ id: 'in2', type: 'inport' });
  assert.match(issuesOf(dupe).join(), /port number 1/);
  const noSys = subNet();
  delete noSys.blocks[1].system;
  assert.match(issuesOf(noSys).join(), /no diagram inside/);
  const stray = base();
  stray.blocks[0].system = { blocks: [], links: [] };
  assert.match(issuesOf(stray).join(), /cannot contain a diagram/);
});

test('same ids at different levels are fine; depth and total counts are limited', () => {
  const net = subNet();
  net.blocks[1].system.blocks[1].id = 'a'; // same id as the top-level step
  net.blocks[1].system.links = [L('in', 0, 'a', 0), L('a', 0, 'out', 0)];
  assert.deepEqual(issuesOf(net), []);

  // nest 6 levels deep
  const deep = { blocks: [], links: [] };
  let cur = deep;
  for (let d = 0; d < 6; d++) {
    const next = { blocks: [], links: [] };
    cur.blocks.push({ id: 'n', type: 'subsystem', system: next });
    cur = next;
  }
  assert.match(issuesOf({ settings: { tf: 1, dt: 0.1 }, ...deep }).join(), /nested at most 4 deep/);

  // 120 subsystems of 2 blocks each blow the 200-block budget even though no level is large
  const many = { settings: { tf: 1, dt: 0.1 }, blocks: [], links: [] };
  for (let i = 0; i < 120; i++) many.blocks.push({ id: `s${i}`, type: 'subsystem', system: { blocks: [{ id: 'x', type: 'constant' }, { id: 'o', type: 'outport' }], links: [L('x', 0, 'o', 0)] } });
  assert.match(issuesOf(many).join(), /at most 200 blocks/);
});

test('scopes inside subsystems count towards the sample budget and satisfy the scope requirement', () => {
  const net = {
    settings: { tf: 1, dt: 0.1 },
    blocks: [{ id: 'sub', type: 'subsystem', system: { blocks: [{ id: 'c', type: 'constant' }, { id: 'sc', type: 'scope' }], links: [L('c', 0, 'sc', 0)] } }],
    links: [],
  };
  assert.deepEqual(issuesOf(net), []);
  net.settings = { tf: 10000, dt: 0.001 }; // 10M samples
  assert.match(issuesOf(net).join(), /samples per scope/);
});
