// Netlist validation.
//
// The netlist is the only thing that crosses from the browser to Scilab, and
// Scilab evaluates block parameters as code. So everything is checked here:
// block types come from the catalogue, parameters must be plain finite numbers,
// and ids never reach the generated script (codegen uses its own indices).

import { BLOCK_MAP, LIMITS, defaultParams, portCounts } from '../../shared/catalog.js';

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
 * Validate and normalise a netlist.
 * @returns {{settings:{tf:number,dt:number}, blocks:{id:string,type:string,params:object,inputs:number,outputs:number}[], links:{from:{block:string,port:number},to:{block:string,port:number}}[]}}
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

  // ---- blocks
  const blocksIn = Array.isArray(net.blocks) ? net.blocks : [];
  if (!Array.isArray(net.blocks)) issues.push({ path: 'blocks', message: 'blocks must be an array' });
  if (blocksIn.length === 0) issues.push({ path: 'blocks', message: 'the diagram is empty' });
  if (blocksIn.length > LIMITS.maxBlocks) issues.push({ path: 'blocks', message: `at most ${LIMITS.maxBlocks} blocks` });

  const byId = new Map();
  const blocks = [];
  blocksIn.slice(0, LIMITS.maxBlocks).forEach((b, i) => {
    const path = `blocks[${i}]`;
    if (!b || typeof b !== 'object') return issues.push({ path, message: 'block must be an object' });
    if (typeof b.id !== 'string' || !ID_RE.test(b.id)) return issues.push({ path: `${path}.id`, message: 'id must be 1–64 of [A-Za-z0-9_-]' });
    if (byId.has(b.id)) return issues.push({ path: `${path}.id`, message: `duplicate id "${b.id}"`, block: b.id });
    const def = BLOCK_MAP[b.type];
    if (!def) return issues.push({ path: `${path}.type`, message: `unknown block type "${b.type}"`, block: b.id });

    const given = b.params && typeof b.params === 'object' ? b.params : {};
    for (const k of Object.keys(given)) {
      if (!def.params.some((p) => p.key === k)) issues.push({ path: `${path}.params.${k}`, message: `unknown parameter for ${def.label}`, block: b.id });
    }
    const params = { ...defaultParams(b.type) };
    for (const p of def.params) {
      if (p.key in given) params[p.key] = given[p.key];
      const before = issues.length;
      checkParam(p, params[p.key], `${path}.params.${p.key}`, issues);
      for (let j = before; j < issues.length; j++) issues[j].block = b.id;
    }

    // block-specific semantic checks
    const blockIssue = (message) => issues.push({ path, message, block: b.id });
    if ((b.type === 'transferFn' || b.type === 'discreteTF') && Array.isArray(params.num) && Array.isArray(params.den)) {
      const num = trimPoly(params.num), den = trimPoly(params.den);
      if (den.length === 1 && den[0] === 0) blockIssue('denominator cannot be zero');
      else if (num.length > den.length) blockIssue('transfer function must be proper (numerator degree ≤ denominator degree)');
    }
    if (['zoh', 'unitDelay', 'discreteTF'].includes(b.type) && isNum(params.ts) && params.ts <= 0) blockIssue('sample time must be positive');
    if (b.type === 'delay' && isNum(params.T) && params.T <= 0) blockIssue('delay must be positive');
    if (b.type === 'saturation' && isNum(params.upper) && isNum(params.lower) && params.lower > params.upper) blockIssue('lower limit must not exceed upper limit');
    if (b.type === 'pid' && isNum(params.n) && params.n <= 0) blockIssue('filter N must be positive');

    let counts = { inputs: 0, outputs: 0 };
    try { counts = portCounts(b.type, params); } catch { /* reported above */ }
    const nb = { id: b.id, type: b.type, params, ...counts };
    byId.set(b.id, nb);
    blocks.push(nb);
  });

  // ---- links
  const linksIn = Array.isArray(net.links) ? net.links : [];
  if (net.links !== undefined && !Array.isArray(net.links)) issues.push({ path: 'links', message: 'links must be an array' });
  if (linksIn.length > LIMITS.maxLinks) issues.push({ path: 'links', message: `at most ${LIMITS.maxLinks} links` });
  const driven = new Map(); // "block:port" -> link index
  const links = [];
  linksIn.slice(0, LIMITS.maxLinks).forEach((l, i) => {
    const path = `links[${i}]`;
    const f = l?.from, t = l?.to;
    const src = f && byId.get(f.block), dst = t && byId.get(t.block);
    if (!src) return issues.push({ path: `${path}.from`, message: 'unknown source block' });
    if (!dst) return issues.push({ path: `${path}.to`, message: 'unknown destination block' });
    if (!Number.isInteger(f.port) || f.port < 0 || f.port >= src.outputs) return issues.push({ path: `${path}.from.port`, message: `${BLOCK_MAP[src.type].label} "${src.id}" has no output ${f.port + 1}`, block: src.id });
    if (!Number.isInteger(t.port) || t.port < 0 || t.port >= dst.inputs) return issues.push({ path: `${path}.to.port`, message: `${BLOCK_MAP[dst.type].label} "${dst.id}" has no input ${t.port + 1}`, block: dst.id });
    const key = `${t.block}:${t.port}`;
    if (driven.has(key)) return issues.push({ path, message: `input ${t.port + 1} of "${dst.id}" already has a wire`, block: dst.id });
    driven.set(key, i);
    links.push({ from: { block: f.block, port: f.port }, to: { block: t.block, port: t.port } });
  });

  // every input must be driven (Xcos refuses to compile otherwise)
  for (const b of blocks) {
    for (let p = 0; p < b.inputs; p++) {
      if (!driven.has(`${b.id}:${p}`)) issues.push({ path: `blocks`, message: `input ${p + 1} of ${BLOCK_MAP[b.type].label} "${b.id}" is not connected`, block: b.id });
    }
  }

  // ---- sample budget
  if (isNum(tf) && isNum(dt) && dt > 0) {
    const per = Math.ceil(tf / dt) + 1;
    const scopes = blocks.filter((b) => b.type === 'scope');
    if (scopes.length === 0) issues.push({ path: 'blocks', message: 'add a Scope so there is something to record' });
    if (per > LIMITS.maxSamplesPerScope) issues.push({ path: 'settings', message: `tf/dt gives ${per} samples per scope (max ${LIMITS.maxSamplesPerScope})` });
    const total = per * scopes.reduce((a, b) => a + b.inputs, 0);
    if (total > LIMITS.maxTotalSamples) issues.push({ path: 'settings', message: `${total} samples in total (max ${LIMITS.maxTotalSamples}); raise dt or remove traces` });
  }

  if (issues.length) throw new NetlistError(issues);
  return { settings: { tf, dt }, blocks, links };
}
