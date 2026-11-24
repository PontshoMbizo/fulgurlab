// Netlist validation.
//
// The netlist is the only thing that crosses from the browser to Scilab, and
// Scilab evaluates block parameters as code. So everything is checked here:
// block types come from the catalogue, parameters must be plain finite numbers,
// and ids never reach the generated script (codegen uses its own indices).

import { BLOCK_MAP, LIMITS, defaultParams, portCounts } from '../../shared/catalog.js';
import { parseExpr, ExprError } from './expr.js';

export class NetlistError extends Error {
  /** @param {{path:string,message:string,block?:string}[]} issues */
  constructor(issues) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.issues = issues;
  }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function checkParam(def, value, path, issues) {
  switch (def.kind) {
    case 'number':
      if (!isNum(value)) issues.push({ path, message: `${def.label} must be a finite number` });
      return value;
    case 'int':
      if (!Number.isInteger(value) || value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) {
        issues.push({ path, message: `${def.label} must be an integer in [${def.min}, ${def.max}]` });
      }
      return value;
    case 'vector':
      if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.maxVector || !value.every(isNum)) {
        issues.push({ path, message: `${def.label} must be 1–${LIMITS.maxVector} finite numbers` });
      }
      return value;
    case 'signs': {
      const re = new RegExp(`^[${def.alphabet.replace(/[-\\^\]]/g, '\\$&')}]{1,8}$`);
      if (typeof value !== 'string' || !re.test(value)) {
        issues.push({ path, message: `${def.label} must be 1–8 of "${def.alphabet}"` });
      }
      return value;
    }
    case 'matrix':
      if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.maxVector
        || !value.every((r) => Array.isArray(r) && r.length >= 1 && r.length <= LIMITS.maxVector && r.length === value[0].length && r.every(isNum))) {
        issues.push({ path, message: `${def.label} must be a rectangular matrix of finite numbers, at most ${LIMITS.maxVector}×${LIMITS.maxVector}` });
      }
      return value;
    case 'expr':
      // syntax is checked together with the input count in the block-specific checks
      if (typeof value !== 'string') issues.push({ path, message: `${def.label} must be text` });
      return value;
    default:
      issues.push({ path, message: `unsupported parameter kind ${def.kind}` });
      return value;
  }
}

/** Strip leading zeros from a coefficient vector (keeps at least one entry). */
export function trimPoly(c) {
  let i = 0;
  while (i < c.length - 1 && c[i] === 0) i++;
  return c.slice(i);
}

/**
 * Validate one level of the diagram: the top level, or the nested system of a subsystem block.
 * Everything that crosses levels (counts, scopes, issues) lives in `ctx`.
 * `prefix` is the id path of the enclosing subsystems ("sub/inner/"), used so an issue's `block`
 * names the same block the flattened netlist and the scope results do.
 */
function validateLevel(sys, path, prefix, depth, ctx) {
  const { issues } = ctx;
  const blocksIn = Array.isArray(sys.blocks) ? sys.blocks : [];
  const top = depth === 0;
  if (!Array.isArray(sys.blocks)) issues.push({ path: `${path}blocks`, message: 'blocks must be an array' });
  if (top && blocksIn.length === 0) issues.push({ path: 'blocks', message: 'the diagram is empty' });

  const byId = new Map();
  const blocks = [];
  blocksIn.forEach((b, i) => {
    const bpath = `${path}blocks[${i}]`;
    if (ctx.blockCount >= LIMITS.maxBlocks) {
      if (!ctx.blockLimitReported) { issues.push({ path: `${path}blocks`, message: `at most ${LIMITS.maxBlocks} blocks (all levels together)` }); ctx.blockLimitReported = true; }
      return;
    }
    if (!b || typeof b !== 'object') return issues.push({ path: bpath, message: 'block must be an object' });
    if (typeof b.id !== 'string' || !ID_RE.test(b.id)) return issues.push({ path: `${bpath}.id`, message: 'id must be 1–64 of [A-Za-z0-9_-]' });
    const fullId = prefix + b.id;
    if (byId.has(b.id)) return issues.push({ path: `${bpath}.id`, message: `duplicate id "${b.id}"`, block: fullId });
    const def = BLOCK_MAP[b.type];
    if (!def) return issues.push({ path: `${bpath}.type`, message: `unknown block type "${b.type}"`, block: fullId });
    ctx.blockCount++;

    const given = b.params && typeof b.params === 'object' ? b.params : {};
    for (const k of Object.keys(given)) {
      if (!def.params.some((p) => p.key === k)) issues.push({ path: `${bpath}.params.${k}`, message: `unknown parameter for ${def.label}`, block: fullId });
    }
    const params = { ...defaultParams(b.type) };
    for (const p of def.params) {
      if (p.key in given) params[p.key] = given[p.key];
      const before = issues.length;
      checkParam(p, params[p.key], `${bpath}.params.${p.key}`, issues);
      for (let j = before; j < issues.length; j++) issues[j].block = fullId;
    }

    // block-specific semantic checks
    const blockIssue = (message) => issues.push({ path: bpath, message, block: fullId });
    if ((b.type === 'transferFn' || b.type === 'discreteTF') && Array.isArray(params.num) && Array.isArray(params.den)) {
      const num = trimPoly(params.num), den = trimPoly(params.den);
      if (den.length === 1 && den[0] === 0) blockIssue('denominator cannot be zero');
      else if (num.length > den.length) blockIssue('transfer function must be proper (numerator degree ≤ denominator degree)');
    }
    if (['zoh', 'unitDelay', 'discreteTF'].includes(b.type) && isNum(params.ts) && params.ts <= 0) blockIssue('sample time must be positive');
    if (b.type === 'delay' && isNum(params.T) && params.T <= 0) blockIssue('delay must be positive');
    if (b.type === 'saturation' && isNum(params.upper) && isNum(params.lower) && params.lower > params.upper) blockIssue('lower limit must not exceed upper limit');
    if (b.type === 'stateSpace' && ['A', 'B', 'C', 'D'].every((k) => Array.isArray(params[k]) && !issues.some((x) => x.block === fullId && x.path.endsWith(`.${k}`)))) {
      const n = params.A.length;
      const dims = (m) => `${m.length}×${m[0].length}`;
      if (params.A[0].length !== n) blockIssue(`A must be square (it is ${dims(params.A)})`);
      else if (params.B.length !== n || params.B[0].length !== 1) blockIssue(`B must be ${n}×1 (it is ${dims(params.B)})`);
      else if (params.C.length !== 1 || params.C[0].length !== n) blockIssue(`C must be 1×${n} (it is ${dims(params.C)})`);
      else if (params.D.length !== 1 || params.D[0].length !== 1) blockIssue(`D must be 1×1 (it is ${dims(params.D)})`);
      else if (!Array.isArray(params.x0) || params.x0.length !== n) blockIssue(`initial state needs ${n} value${n === 1 ? '' : 's'}`);
    }
    if (b.type === 'userFn' && typeof params.expr === 'string' && Number.isInteger(params.inputs)) {
      try { parseExpr(params.expr, params.inputs); } catch (e) {
        if (!(e instanceof ExprError)) throw e;
        issues.push({ path: `${bpath}.params.expr`, message: e.message, block: fullId });
      }
    }
    if (b.type === 'pid' && isNum(params.n) && params.n <= 0) blockIssue('filter N must be positive');
    if ((b.type === 'inport' || b.type === 'outport') && top) blockIssue(`${def.label} blocks only make sense inside a subsystem`);

    // a subsystem validates its nested diagram first: its ports come from the Inport/Outport blocks in it
    let system;
    if (b.type === 'subsystem') {
      if (b.system === undefined || b.system === null || typeof b.system !== 'object') blockIssue('the subsystem has no diagram inside it');
      else if (depth + 1 > LIMITS.maxDepth) blockIssue(`subsystems can be nested at most ${LIMITS.maxDepth} deep`);
      else system = validateLevel(b.system, `${bpath}.system.`, `${fullId}/`, depth + 1, ctx);
    } else if (b.system !== undefined) {
      blockIssue(`${def.label} cannot contain a diagram`);
    }

    let counts = { inputs: 0, outputs: 0 };
    try { counts = portCounts(b.type, params, system); } catch { /* reported above */ }
    const nb = { id: b.id, type: b.type, params, ...counts, ...(system ? { system } : {}) };
    if (b.type === 'scope') ctx.scopeInputs.push(counts.inputs);
    byId.set(b.id, nb);
    blocks.push(nb);
  });

  // Inport and Outport indices identify the subsystem's ports, so they must be unique per level
  for (const type of ['inport', 'outport']) {
    const seen = new Map();
    for (const b of blocks.filter((x) => x.type === type)) {
      const k = b.params.index;
      if (seen.has(k)) issues.push({ path: `${path}blocks`, message: `two ${BLOCK_MAP[type].label} blocks use port number ${k} ("${seen.get(k)}" and "${b.id}")`, block: prefix + b.id });
      else seen.set(k, b.id);
    }
  }

  // ---- links
  const linksIn = Array.isArray(sys.links) ? sys.links : [];
  if (sys.links !== undefined && !Array.isArray(sys.links)) issues.push({ path: `${path}links`, message: 'links must be an array' });
  const driven = new Map(); // "block:port" -> link index
  const links = [];
  linksIn.forEach((l, i) => {
    const lpath = `${path}links[${i}]`;
    if (ctx.linkCount >= LIMITS.maxLinks) {
      if (!ctx.linkLimitReported) { issues.push({ path: `${path}links`, message: `at most ${LIMITS.maxLinks} links (all levels together)` }); ctx.linkLimitReported = true; }
      return;
    }
    ctx.linkCount++;
    const f = l?.from, t = l?.to;
    const src = f && byId.get(f.block), dst = t && byId.get(t.block);
    if (!src) return issues.push({ path: `${lpath}.from`, message: 'unknown source block' });
    if (!dst) return issues.push({ path: `${lpath}.to`, message: 'unknown destination block' });
    if (!Number.isInteger(f.port) || f.port < 0 || f.port >= src.outputs) return issues.push({ path: `${lpath}.from.port`, message: `${BLOCK_MAP[src.type].label} "${src.id}" has no output ${f.port + 1}`, block: prefix + src.id });
    if (!Number.isInteger(t.port) || t.port < 0 || t.port >= dst.inputs) return issues.push({ path: `${lpath}.to.port`, message: `${BLOCK_MAP[dst.type].label} "${dst.id}" has no input ${t.port + 1}`, block: prefix + dst.id });
    const key = `${t.block}:${t.port}`;
    if (driven.has(key)) return issues.push({ path: lpath, message: `input ${t.port + 1} of "${dst.id}" already has a wire`, block: prefix + dst.id });
    driven.set(key, i);
    links.push({ from: { block: f.block, port: f.port }, to: { block: t.block, port: t.port } });
  });

  // every input must be driven (Xcos refuses to compile otherwise)
  for (const b of blocks) {
    for (let p = 0; p < b.inputs; p++) {
      if (!driven.has(`${b.id}:${p}`)) issues.push({ path: `${path}blocks`, message: `input ${p + 1} of ${BLOCK_MAP[b.type].label} "${b.id}" is not connected`, block: prefix + b.id });
    }
  }
  return { blocks, links };
}

/**
 * Validate and normalise a netlist. Subsystems stay nested here (`block.system`);
 * flatten.js turns the result into the flat form that codegen consumes.
 * @returns {{settings:{tf:number,dt:number}, blocks:object[], links:{from:{block:string,port:number},to:{block:string,port:number}}[]}}
 * @throws {NetlistError}
 */
export function validateNetlist(net) {
  const issues = [];
  if (!net || typeof net !== 'object') throw new NetlistError([{ path: '', message: 'netlist must be an object' }]);

  // ---- settings
  const s = net.settings ?? {};
  const tf = s.tf ?? 10;
  const dt = s.dt ?? 0.01;
  if (!isNum(tf) || tf <= 0 || tf > LIMITS.maxTf) issues.push({ path: 'settings.tf', message: `final time must be in (0, ${LIMITS.maxTf}]` });
  if (!isNum(dt) || dt < LIMITS.minDt || dt > tf) issues.push({ path: 'settings.dt', message: `sample step must be in [${LIMITS.minDt}, tf]` });

  // ---- the diagram, level by level
  const ctx = { issues, blockCount: 0, linkCount: 0, scopeInputs: [], blockLimitReported: false, linkLimitReported: false };
  const { blocks, links } = validateLevel(net, '', '', 0, ctx);

  // ---- sample budget, over every scope at every level
  if (isNum(tf) && isNum(dt) && dt > 0) {
    const per = Math.ceil(tf / dt) + 1;
    if (ctx.scopeInputs.length === 0) issues.push({ path: 'blocks', message: 'add a Scope so there is something to record' });
    if (per > LIMITS.maxSamplesPerScope) issues.push({ path: 'settings', message: `tf/dt gives ${per} samples per scope (max ${LIMITS.maxSamplesPerScope})` });
    const total = per * ctx.scopeInputs.reduce((a, n) => a + n, 0);
    if (total > LIMITS.maxTotalSamples) issues.push({ path: 'settings', message: `${total} samples in total (max ${LIMITS.maxTotalSamples}); raise dt or remove traces` });
  }

  if (issues.length) throw new NetlistError(issues);
  return { settings: { tf, dt }, blocks, links };
}
