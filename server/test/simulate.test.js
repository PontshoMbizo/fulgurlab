// Integration tests against real headless Scilab. Skipped when scilab-cli is
// not installed (set SCILAB_BIN to point at it, or run inside the Docker image).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateNetlist } from '../src/netlist.js';
import { simulate, config } from '../src/runner.js';

const haveScilab = !spawnSync(config.scilab, ['-version'], { stdio: 'ignore', timeout: 20000 }).error;
// In CI and in the container Scilab must be there: set REQUIRE_SCILAB=1 so a
// missing binary fails loudly instead of quietly skipping these tests.
if (!haveScilab && process.env.REQUIRE_SCILAB === '1') {
  throw new Error(`REQUIRE_SCILAB=1 but "${config.scilab}" could not be started`);
}
const opts = { skip: haveScilab ? false : `${config.scilab} not found` };
const examplesDir = fileURLToPath(new URL('../../examples/', import.meta.url));

/** value of trace `k` at time `t` (first sample at or after t) */
const at = (scope, t, k = 0) => scope.y[k][scope.t.findIndex((x) => x >= t - 1e-9)];
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

/** source -> [block] -> scope, returning the scope trace */
async function chain(source, block, tf = 2, dt = 0.01) {
  const blocks = [{ id: 'src', ...source }];
  const links = [];
  let last = 'src';
  if (block) {
    blocks.push({ id: 'blk', ...block });
    links.push({ from: { block: 'src', port: 0 }, to: { block: 'blk', port: 0 } });
    last = 'blk';
  }
  blocks.push({ id: 'sc', type: 'scope' });
  links.push({ from: { block: last, port: 0 }, to: { block: 'sc', port: 0 } });
  const r = await simulate(validateNetlist({ settings: { tf, dt }, blocks, links }));
  return r.scopes.sc;
}

test('examples simulate and match analytic answers', opts, async () => {
  const load = (f) => validateNetlist(JSON.parse(readFileSync(examplesDir + f, 'utf8')));
  for (const f of readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
    const r = await simulate(load(f));
    assert.ok(Object.keys(r.scopes).length > 0, f);
  }
  const fo = (await simulate(load('first-order.json'))).scopes.scope;
  close(at(fo, 1), 1 - Math.exp(-1), 1e-3, 'first order y(1)');
  assert.equal(fo.t.length, 501);
  const pid = (await simulate(load('pid-loop.json'))).scopes.scope;
  close(pid.y[1].at(-1), 1, 5e-3, 'PID removes steady-state error');
  const sg = (await simulate(load('sine-gain.json'))).scopes.scope;
  close(at(sg, 1, 1), 2 * Math.sin(1), 1e-4, 'gain');
  close(at(sg, 2, 2), 1 - Math.cos(2), 1e-3, 'integral');
  const d = (await simulate(load('discrete.json'))).scopes.scope;
  close(at(d, 2.25, 1), 2, 1e-9, 'zoh holds');
  close(at(d, 2.25, 2), 1.5, 1e-9, 'unit delay');
});

test('every block type simulates', opts, async () => {
  const step = { type: 'step', params: { time: 0 } };
  close(at(await chain({ type: 'constant', params: { value: 3 } }), 1), 3, 1e-9, 'constant');
  close(at(await chain({ type: 'clock' }), 1.5), 1.5, 1e-6, 'clock');
  close(at(await chain({ type: 'ramp', params: { slope: 2, start: 0.5, initial: 0 } }), 1.5), 2, 1e-6, 'ramp');
  close(at(await chain({ type: 'sine', params: { amplitude: 2, frequency: 3, phase: 0 } }), 0.5), 2 * Math.sin(1.5), 1e-6, 'sine');
  close(at(await chain({ type: 'sine', params: { amplitude: 1, frequency: 3, phase: 0 } }, { type: 'abs' }), 1.5), Math.abs(Math.sin(4.5)), 1e-6, 'abs');
  close(at(await chain({ type: 'ramp' }, { type: 'saturation', params: { upper: 0.7, lower: -1 } }), 1.5), 0.7, 1e-9, 'saturation');
  close(at(await chain({ type: 'ramp', params: { slope: 3 } }, { type: 'derivative' }), 1), 3, 1e-3, 'derivative');
  close(at(await chain({ type: 'ramp' }, { type: 'delay', params: { T: 0.5, initial: 0 } }), 1.5), 1, 1e-2, 'transport delay');
  close(at(await chain(step, { type: 'integrator', params: { x0: 1 } }), 1), 2, 1e-6, 'integrator');
  close(at(await chain(step, { type: 'pid', params: { kp: 2, ki: 0, kd: 0, n: 100 } }), 1), 2, 1e-9, 'P only');
  close(at(await chain(step, { type: 'pid', params: { kp: 1, ki: 1, kd: 0, n: 100 } }), 1), 2, 1e-3, 'PI: 1 + t');
  close(at(await chain(step, { type: 'transferFn', params: { num: [2], den: [1, 2] } }), 1.5), 1 - Math.exp(-3), 1e-3, 'TF 2/(s+2)');
  // y[k] = 0.5 y[k-1] + u[k-1]  ->  after many samples -> 2
  close(at(await chain(step, { type: 'discreteTF', params: { num: [1], den: [1, -0.5], ts: 0.1 } }, 5), 5), 2, 1e-3, 'discrete TF');
});

test('sum and product with several inputs', opts, async () => {
  const net = {
    settings: { tf: 1, dt: 0.1 },
    blocks: [
      { id: 'a', type: 'constant', params: { value: 2 } },
      { id: 'b', type: 'constant', params: { value: 3 } },
      { id: 'c', type: 'constant', params: { value: 4 } },
      { id: 'sum', type: 'sum', params: { signs: '++-' } },
      { id: 'prod', type: 'product', params: { ops: '**/' } },
      { id: 'sc', type: 'scope', params: { inputs: 2 } },
    ],
    links: [
      ...['a', 'b', 'c'].flatMap((id, i) => [
        { from: { block: id, port: 0 }, to: { block: 'sum', port: i } },
        { from: { block: id, port: 0 }, to: { block: 'prod', port: i } },
      ]),
      { from: { block: 'sum', port: 0 }, to: { block: 'sc', port: 0 } },
      { from: { block: 'prod', port: 0 }, to: { block: 'sc', port: 1 } },
    ],
  };
  const s = (await simulate(validateNetlist(net))).scopes.sc;
  close(at(s, 0.5, 0), 1, 1e-9, '2+3-4');
  close(at(s, 0.5, 1), 1.5, 1e-9, '2*3/4');
});

test('algebraic loops come back as a readable error', opts, async () => {
  const net = {
    settings: { tf: 1, dt: 0.1 },
    blocks: [
      { id: 'u', type: 'step' },
      { id: 'sum', type: 'sum', params: { signs: '+-' } },
      { id: 'k', type: 'gain', params: { k: 2 } },
      { id: 'sc', type: 'scope' },
    ],
    links: [
      { from: { block: 'u', port: 0 }, to: { block: 'sum', port: 0 } },
      { from: { block: 'sum', port: 0 }, to: { block: 'k', port: 0 } },
      { from: { block: 'k', port: 0 }, to: { block: 'sum', port: 1 } },
      { from: { block: 'k', port: 0 }, to: { block: 'sc', port: 0 } },
    ],
  };
  await assert.rejects(simulate(validateNetlist(net)), /[Aa]lgebraic loop/);
});

test('a failed run does not poison the next one (warm worker reuse)', opts, async () => {
  const bad = validateNetlist({ settings: { tf: 1, dt: 0.01 }, blocks: [
    { id: 'c', type: 'constant' }, { id: 's', type: 'sum', params: { signs: '++' } },
    { id: 'g', type: 'gain', params: { k: 1 } }, { id: 'sc', type: 'scope' }],
  links: [
    { from: { block: 'c', port: 0 }, to: { block: 's', port: 0 } },
    { from: { block: 'g', port: 0 }, to: { block: 's', port: 1 } },
    { from: { block: 's', port: 0 }, to: { block: 'g', port: 0 } },
    { from: { block: 's', port: 0 }, to: { block: 'sc', port: 0 } }] });
  await assert.rejects(() => simulate(bad), /lgebraic loop/);
  const sc = await chain({ type: 'constant', params: { value: 3 } }, null, 1);
  close(at(sc, 1), 3, 1e-6, 'constant after a failed run');
});

test('state-space, switch and user function', opts, async () => {
  const step = { type: 'step', params: { time: 0 } };
  // x' = -x + u, y = x  ->  1 - e^-t
  const ss = await chain(step, { type: 'stateSpace', params: { A: [[-1]], B: [[1]], C: [[1]], D: [[0]], x0: [0] } }, 3);
  close(at(ss, 1), 1 - Math.exp(-1), 1e-3, 'state-space first order');
  // double integrator with D feed-through: y = x1 + 0.5 u; x1' = x2, x2' = u  ->  t^2/2 + 0.5
  const dbl = await chain(step, { type: 'stateSpace', params: { A: [[0, 1], [0, 0]], B: [[0], [1]], C: [[1, 0]], D: [[0.5]], x0: [0, 0] } }, 2);
  close(at(dbl, 1), 1, 1e-3, 'state-space second order with D');

  // switch: input 1 = 10, input 3 = 20, control = ramp crossing the threshold 1 at t = 1
  const sw = (rule) => validateNetlist({
    settings: { tf: 2, dt: 0.01 },
    blocks: [
      { id: 'a', type: 'constant', params: { value: 10 } },
      { id: 'ctl', type: 'ramp', params: { slope: 1, start: 0, initial: 0 } },
      { id: 'b', type: 'constant', params: { value: 20 } },
      { id: 'sw', type: 'switch', params: { rule, threshold: 1 } },
      { id: 'sc', type: 'scope' },
    ],
    links: [
      { from: { block: 'a', port: 0 }, to: { block: 'sw', port: 0 } },
      { from: { block: 'ctl', port: 0 }, to: { block: 'sw', port: 1 } },
      { from: { block: 'b', port: 0 }, to: { block: 'sw', port: 2 } },
      { from: { block: 'sw', port: 0 }, to: { block: 'sc', port: 0 } },
    ],
  });
  const s0 = (await simulate(sw(0))).scopes.sc;
  close(at(s0, 0.5), 20, 1e-9, 'switch below threshold passes input 3');
  close(at(s0, 1.5), 10, 1e-9, 'switch above threshold passes input 1');
  const s2 = (await simulate(sw(2))).scopes.sc;
  close(at(s2, 0.5), 10, 1e-9, 'switch rule "not equal" passes input 1 away from the threshold');

  // user function of two inputs: 2*u1 + u2^2
  const fn = validateNetlist({
    settings: { tf: 1, dt: 0.1 },
    blocks: [
      { id: 'a', type: 'constant', params: { value: 3 } },
      { id: 'b', type: 'constant', params: { value: 4 } },
      { id: 'f', type: 'userFn', params: { expr: '2*u1 + u2^2 - -1', inputs: 2 } },
      { id: 'sc', type: 'scope' },
    ],
    links: [
      { from: { block: 'a', port: 0 }, to: { block: 'f', port: 0 } },
      { from: { block: 'b', port: 0 }, to: { block: 'f', port: 1 } },
      { from: { block: 'f', port: 0 }, to: { block: 'sc', port: 0 } },
    ],
  });
  close(at((await simulate(fn)).scopes.sc, 0.5), 2 * 3 + 16 + 1, 1e-9, 'user function');
  const sine = await chain({ type: 'sine', params: { amplitude: 1, frequency: 3, phase: 0 } }, { type: 'userFn', params: { expr: 'abs(u1) + exp(0.5)', inputs: 1 } });
  close(at(sine, 0.5), Math.abs(Math.sin(1.5)) + Math.exp(0.5), 1e-6, 'user function with functions and decimals');
});

test('a subsystem gives exactly the trace of the flat diagram', opts, async () => {
  const load = (f) => validateNetlist(JSON.parse(readFileSync(new URL(`../../examples/${f}`, import.meta.url), 'utf8')));
  const flat = (await simulate(load('pid-loop.json'))).scopes.scope;
  const nested = (await simulate(load('subsystem.json'))).scopes.scope;
  assert.equal(nested.t.length, flat.t.length);
  for (let k = 0; k < 2; k++) {
    let worst = 0;
    flat.y[k].forEach((v, i) => { worst = Math.max(worst, Math.abs(v - nested.y[k][i])); });
    assert.ok(worst < 1e-9, `trace ${k} differs by ${worst}`);
  }
});

test('scopes inside a subsystem are keyed by their path', opts, async () => {
  const net = validateNetlist({
    settings: { tf: 1, dt: 0.1 },
    blocks: [{ id: 'sub', type: 'subsystem', system: {
      blocks: [{ id: 'c', type: 'constant', params: { value: 7 } }, { id: 'sc', type: 'scope' }],
      links: [{ from: { block: 'c', port: 0 }, to: { block: 'sc', port: 0 } }] } }],
    links: [],
  });
  const r = await simulate(net);
  assert.deepEqual(Object.keys(r.scopes), ['sub/sc']);
  close(at(r.scopes['sub/sc'], 0.5), 7, 1e-9, 'constant in a subsystem');
});
