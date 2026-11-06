// Netlist -> Scilab script (.sce) that builds an Xcos diagram (scs_m) and
// simulates it headlessly with scicos_simulate(..., "nw").
//
// Design notes
// - Only numbers produced by fmt() and the fixed strings below are written into
//   the script; user ids and labels never are.
// - Block parameters are set through graphics.exprs. scicos_simulate runs
//   do_eval, which re-evaluates every block's "set" job from its exprs and
//   rebuilds the model, so ports and rpar/ipar stay consistent with Xcos itself.
//   Superblocks (CLOCK_c, STEP_FUNCTION) are the exception: their inner block is
//   set directly.
// - Fan-out (one output to several inputs) needs explicit SPLIT_f blocks in
//   scs_m; the Xcos GUI adds these for you.
// - Each discrete block and each scope gets its own CLOCK_c, so no event
//   splitting is needed.

import { trimPoly } from './netlist.js';

/** Format a validated finite number for Scilab. */
export function fmt(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`not a finite number: ${x}`);
  if (Object.is(x, -0)) return '0';
  return String(x); // JS number syntax (1e-7, -0.5) is valid Scilab syntax
}

/** Coefficients (highest power first) -> Scilab polynomial expression in `v`. */
export function polyExpr(coeffs, v) {
  const c = trimPoly(coeffs);
  const n = c.length - 1;
  const terms = [];
  c.forEach((a, i) => {
    if (a === 0) return;
    const k = n - i;
    terms.push(k === 0 ? `(${fmt(a)})` : k === 1 ? `(${fmt(a)})*${v}` : `(${fmt(a)})*${v}^${k}`);
  });
  return terms.length ? terms.join('+') : '0';
}

const vec = (xs) => `[${xs.map(fmt).join(';')}]`;
const str = (s) => `"${s}"`; // only ever called with fixed/numeric content

/**
 * Lowering of one user block into scicos primitives.
 * Returns { nodes, inputs, outputs } where nodes are primitive blocks and
 * inputs[p] / outputs[q] point at (node index within `nodes`, 1-based port).
 */
function lower(b, settings) {
  const p = b.params;
  const prim = (gui, exprs, extra = {}) => ({ gui, exprs, ...extra });
  const one = (node) => ({ nodes: [node], inputs: b.inputs ? Array.from({ length: b.inputs }, (_, i) => [0, i + 1]) : [], outputs: b.outputs ? [[0, 1]] : [] });
  const clocked = (node, ts) => ({ ...one({ ...node, clock: ts }) });

  switch (b.type) {
    case 'step':
      return one(prim('STEP_FUNCTION', null, { step: { time: p.time, initial: p.initial, final: p.final } }));
    case 'constant':
      return one(prim('CONST_m', [fmt(p.value)]));
    case 'sine':
      return one(prim('GENSIN_f', [fmt(p.amplitude), fmt(p.frequency), fmt(p.phase)]));
    case 'ramp':
      return one(prim('RAMP', [fmt(p.slope), fmt(p.start), fmt(p.initial)]));
    case 'clock':
      return one(prim('TIME_f', null));
    case 'gain':
      return one(prim('GAINBLK', null, { exprsAt: { 1: fmt(p.k) } }));
    case 'sum': {
      const signs = [...p.signs].map((c) => (c === '+' ? 1 : -1));
      return one(prim('SUMMATION', ['1', vec(signs), '0'], { nin: signs.length }));
    }
    case 'product': {
      const ops = [...p.ops].map((c) => (c === '*' ? 1 : -1));
      return one(prim('PRODUCT', [vec(ops)], { nin: ops.length }));
    }
    case 'abs':
      return one(prim('ABS_VALUE', null));
    case 'saturation':
      return one(prim('SATURATION', [fmt(p.upper), fmt(p.lower), '1']));
    case 'integrator':
      return one(prim('INTEGRAL_m', null, { exprsAt: { 1: fmt(p.x0) } }));
    case 'derivative':
      return one(prim('DERIV', null));
    case 'transferFn':
      return one(prim('CLR', [polyExpr(p.num, 's'), polyExpr(p.den, 's')]));
    case 'pid': {
      const { kp, ki, kd, n } = p;
      let num, den;
      if (kd === 0 && ki === 0) return one(prim('GAINBLK', null, { exprsAt: { 1: fmt(kp) } }));
      if (kd === 0) { num = [kp, ki]; den = [1, 0]; }
      else { num = [kp + kd * n, kp * n + ki, ki * n]; den = [1, n, 0]; }
      return one(prim('CLR', [polyExpr(num, 's'), polyExpr(den, 's')]));
    }
    case 'delay':
      return one(prim('TIME_DELAY', [fmt(p.T), fmt(p.initial), '1024']));
    case 'zoh':
      return clocked(prim('SAMPHOLD_m', null), p.ts);
    case 'unitDelay':
      return clocked(prim('DOLLAR_m', [fmt(p.x0), '0']), p.ts);
    case 'discreteTF':
      return clocked(prim('DLR', [polyExpr(p.num, 'z'), polyExpr(p.den, 'z')]), p.ts);
    case 'scope': {
      const samples = Math.floor(settings.tf / settings.dt + 1e-9) + 2;
      const tows = prim('TOWS_c', [String(samples), '__VAR__', '0'], { clock: settings.dt, scope: true });
      if (b.inputs === 1) return { nodes: [tows], inputs: [[0, 1]], outputs: [] };
      const mux = prim('MUX', [String(b.inputs)], { nin: b.inputs });
      return {
        nodes: [mux, tows],
        inputs: Array.from({ length: b.inputs }, (_, i) => [0, i + 1]),
        outputs: [],
        internal: [[[0, 1], [1, 1]]],
      };
    }
    default:
      throw new Error(`no Scilab lowering for block type ${b.type}`);
  }
}

/**
 * Generate the Scilab script.
 * @param {ReturnType<import('./netlist.js').validateNetlist>} net validated netlist
 * @param {string} outDir absolute directory (server-chosen) for results
 * @returns {{script:string, scopes:{block:string,var:string,file:string,inputs:number}[]}}
 */
export function generate(net, outDir) {
  if (!/^[A-Za-z0-9_\/.\-]+$/.test(outDir)) throw new Error('unsafe output directory');
  const { settings } = net;
  const L = []; // script lines
  const objs = []; // primitive block descriptors, index = scs_m.objs index - 1
  const links = []; // [fromObj, fromPort, toObj, toPort, kind]
  const map = new Map(); // block id -> { inputs, outputs } in objs indices
  const scopes = [];

  const add = (node) => { objs.push(node); return objs.length; }; // 1-based

  for (const b of net.blocks) {
    const low = lower(b, settings);
    const nodeIdx = [];
    low.nodes.forEach((n) => {
      const idx = add(n);
      nodeIdx.push(idx);
      if (n.clock !== undefined) {
        const ck = add({ gui: 'CLOCK_c', exprs: null, period: n.clock });
        links.push([ck, 1, idx, 1, 'event']);
      }
      if (n.scope) {
        const sv = `fl_sco_${scopes.length + 1}`;
        n.exprs = n.exprs.map((e) => (e === '__VAR__' ? sv : e));
        scopes.push({ block: b.id, var: sv, file: `${outDir}/${sv}.csv`, inputs: b.inputs });
      }
    });
    (low.internal || []).forEach(([[fn, fp], [tn, tp]]) => links.push([nodeIdx[fn], fp, nodeIdx[tn], tp, 'regular']));
    map.set(b.id, {
      inputs: low.inputs.map(([n, port]) => [nodeIdx[n], port]),
      outputs: low.outputs.map(([n, port]) => [nodeIdx[n], port]),
    });
  }

  // regular links, with SPLIT_f for fan-out
  const bySource = new Map();
  for (const l of net.links) {
    const k = `${l.from.block}:${l.from.port}`;
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(l);
  }
  for (const group of bySource.values()) {
    const [so, sp] = map.get(group[0].from.block).outputs[group[0].from.port];
    const dests = group.map((l) => map.get(l.to.block).inputs[l.to.port]);
    if (dests.length === 1) {
      links.push([so, sp, dests[0][0], dests[0][1], 'regular']);
    } else {
      const sp_ = add({ gui: 'SPLIT_f', exprs: null, fanout: dests.length });
      links.push([so, sp, sp_, 1, 'regular']);
      dests.forEach(([dn, dp], i) => links.push([sp_, i + 1, dn, dp, 'regular']));
    }
  }

  // ---------------------------------------------------------------- script
  L.push('// generated by fulgurlab server — do not edit');
  L.push('funcprot(0); ieee(2);');
  // headless Scilab can't show dialogs; Xcos reports compile errors through
  // messagebox, so capture them instead of losing the text
  L.push('fl_msgs = [];');
  L.push('function r = messagebox(m, varargin), global fl_msgs; fl_msgs = [fl_msgs; strcat(string(m), " ")]; mprintf("MSG: %s\\n", strcat(string(m), " ")); r = 1; endfunction');
  L.push('global fl_msgs;');
  L.push(`fl_out = ${str(outDir)};`);
  L.push('try');
  L.push('  loadXcosLibs(); loadScicos();');
  L.push('  scs_m = scicos_diagram();');
  // half a sample past tf so the scope also records the t = tf sample
  L.push(`  scs_m.props.tf = ${fmt(settings.tf + settings.dt / 2)};`);
  objs.forEach((o, i) => {
    const n = i + 1;
    L.push(`  b = ${o.gui}("define");`);
    if (o.exprs) L.push(`  b.graphics.exprs = [${o.exprs.map((e) => `"${e.replace(/"/g, '""')}"`).join(';')}];`);
    if (o.exprsAt) for (const [k, v] of Object.entries(o.exprsAt)) L.push(`  b.graphics.exprs(${k}) = "${v}";`);
    if (o.period !== undefined) {
      const T = fmt(o.period);
      L.push(`  e = b.model.rpar.objs(2); e.graphics.exprs = ["${T}";"0"]; e.model.rpar = [${T};0]; e.model.firing = 0; b.model.rpar.objs(2) = e;`);
      L.push(`  b.graphics.exprs = ["${T}";"0"];`);
    }
    if (o.step) {
      const { time, initial, final } = o.step;
      L.push(`  e = b.model.rpar.objs(1); e.graphics.exprs = ["${fmt(time)}";"${fmt(initial)}";"${fmt(final)}"]; e.model.rpar = [${fmt(initial)};${fmt(final)}]; e.model.firing = ${fmt(time)}; b.model.rpar.objs(1) = e;`);
    }
    if (o.nin) {
      // size input ports up front: links are checked against ports on insertion,
      // before do_eval would resize the block from its exprs
      const n = o.nin;
      const sizes = o.gui === 'MUX' ? `-[1:${n}]'` : `-ones(${n},1)`;
      const sizes2 = o.gui === 'MUX' ? `ones(${n},1)` : `-2*ones(${n},1)`;
      L.push(`  b.model.in = ${sizes}; b.model.in2 = ${sizes2}; b.model.intyp = ones(${n},1); b.graphics.pin = zeros(${n},1);${o.gui === 'MUX' ? ` b.model.ipar = ${n};` : ''}`);
    }
    if (o.fanout) {
      L.push(`  b.model.out = -ones(${o.fanout},1); b.model.out2 = ones(${o.fanout},1); b.model.outtyp = ones(${o.fanout},1); b.graphics.pout = zeros(${o.fanout},1);`);
    }
    L.push(`  scs_m.objs(${n}) = b;`);
  });
  links.forEach(([fo, fp, to, tp, kind]) => {
    const ct = kind === 'event' ? '[5 -1]' : '[1 1]';
    L.push(`  scs_m.objs($+1) = scicos_link(from=[${fo} ${fp} 0], to=[${to} ${tp} 1], ct=${ct});`);
  });
  L.push('  Info = scicos_simulate(scs_m, list(), "nw");');
  for (const s of scopes) {
    L.push(`  if ~exists("${s.var}") then error("simulation produced no data (scope ${scopes.indexOf(s) + 1})"); end`);
    L.push(`  csvWrite([${s.var}.time ${s.var}.values], "${s.file}", ",", ".", "%.10g");`);
  }
  L.push('  mputl("ok", fl_out + "/status");');
  L.push('catch');
  L.push('  [fl_msg] = lasterror();');
  L.push('  mputl(["error"; fl_msgs; fl_msg], fl_out + "/status");');
  L.push('end');
  L.push('');
  return { script: L.join('\n'), scopes };
}
