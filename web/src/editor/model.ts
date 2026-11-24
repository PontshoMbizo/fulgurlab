// Geometry and pure helpers for the diagram model.
import { BLOCK_MAP, defaultParams, portCounts } from '../../../shared/catalog.js';
import type { Block, Level, Link, Netlist, Params, Selection } from './types';

export const GRID = 8;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Block footprint. Gains are triangles and sums circles, like Simulink. */
export function blockSize(b: Block): { w: number; h: number } {
  const { inputs, outputs } = ports(b);
  const n = Math.max(inputs, outputs, 1);
  switch (b.type) {
    case 'gain': return { w: 64, h: 56 };
    case 'sum': return { w: 48, h: Math.max(48, n * 20 + 8) };
    case 'scope': return { w: 72, h: Math.max(64, n * 20 + 16) };
    case 'clock': return { w: 56, h: 56 };
    case 'transferFn': case 'discreteTF': {
      // widen with the polynomial: ~9.6 px per character of the longer line
      const v = b.type === 'transferFn' ? 's' : 'z';
      const longest = Math.max(polyText(b.params.num as number[], v).length, polyText(b.params.den as number[], v).length);
      return { w: Math.max(88, Math.ceil((16 + longest * 9.6) / GRID) * GRID), h: Math.max(64, n * 24 + 16) };
    }
    case 'pid': return { w: 104, h: 64 };
    case 'subsystem': return { w: 112, h: Math.max(64, n * 28 + 16) };
    case 'inport': case 'outport': return { w: 48, h: 32 };
    case 'stateSpace': return { w: 104, h: 64 };
    case 'switch': return { w: 88, h: 72 };
    case 'userFn': return { w: 96, h: Math.max(56, n * 24 + 16) };
    default: return { w: 88, h: Math.max(56, n * 24 + 16) };
  }
}

export function ports(b: Block) {
  try { return portCounts(b.type, b.params, b.system); } catch { return { inputs: 0, outputs: 0 }; }
}

export function inPortPos(b: Block, i: number) {
  const { w, h } = blockSize(b);
  const n = ports(b).inputs;
  void w;
  return { x: b.x, y: b.y + (h * (i + 1)) / (n + 1) };
}

export function outPortPos(b: Block, i: number) {
  const { w, h } = blockSize(b);
  const n = ports(b).outputs;
  return { x: b.x + w, y: b.y + (h * (i + 1)) / (n + 1) };
}

/**
 * Orthogonal wire route. Forward wires step at the midpoint; feedback wires
 * (target left of source) go out, down under both blocks, back and in.
 */
export function wirePath(src: Block, sp: number, dst: Block | null, dp: number, free?: { x: number; y: number }, obstacles: Block[] = []) {
  const a = outPortPos(src, sp);
  const b = dst ? inPortPos(dst, dp) : free!;
  const others = obstacles.filter((o) => o.id !== src.id && o.id !== dst?.id).map(rectOf);
  const toPath = (pts: { x: number; y: number }[]) => 'M' + pts.map((p) => `${p.x},${p.y}`).join(' L');
  const clear = (pts: { x: number; y: number }[]) => pts.every((p, i) => i === 0 || !others.some((r) => segHits(pts[i - 1], p, r)));

  if (b.x >= a.x + 24) {
    const mx = snap((a.x + b.x) / 2);
    const candidates = [
      [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b],
      [a, { x: b.x - 16, y: a.y }, { x: b.x - 16, y: b.y }, b],
      [a, { x: a.x + 16, y: a.y }, { x: a.x + 16, y: b.y }, b],
    ];
    for (const c of candidates) if (clear(c)) return toPath(c);
    // go around everything in between, above or below, whichever is shorter
    const between = others.filter((r) => r.x1 > a.x && r.x0 < b.x);
    const top = Math.min(a.y, b.y, ...between.map((r) => r.y0)) - 24;
    const bottom = Math.max(a.y, b.y, ...between.map((r) => r.y1)) + 24;
    const y = Math.abs(top - a.y) + Math.abs(top - b.y) <= Math.abs(bottom - a.y) + Math.abs(bottom - b.y) ? top : bottom;
    return toPath([a, { x: a.x + 16, y: a.y }, { x: a.x + 16, y }, { x: b.x - 16, y }, { x: b.x - 16, y: b.y }, b]);
  }
  const all = [rectOf(src), ...(dst ? [rectOf(dst)] : []), ...others.filter((r) => r.x1 > b.x - 16 && r.x0 < a.x + 16)];
  const bottom = snap(Math.max(b.y, ...all.map((r) => r.y1)) + 24);
  return toPath([a, { x: a.x + 16, y: a.y }, { x: a.x + 16, y: bottom }, { x: b.x - 16, y: bottom }, { x: b.x - 16, y: b.y }, b]);
}

interface Rect { x0: number; y0: number; x1: number; y1: number }
function rectOf(b: Block): Rect {
  const { w, h } = blockSize(b);
  return { x0: b.x - 4, y0: b.y - 4, x1: b.x + w + 4, y1: b.y + h + 20 }; // include the name label
}
/** Does an axis-aligned segment cross a rectangle? */
function segHits(p: { x: number; y: number }, q: { x: number; y: number }, r: Rect) {
  const [x0, x1] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
  const [y0, y1] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
  return x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0;
}

let counter = 0;
export function newId(type: string, taken: Set<string>) {
  let id: string;
  do { id = `${type}${++counter}`; } while (taken.has(id));
  return id;
}

/** What a new subsystem holds: one Inport wired straight to one Outport, so it is valid as soon as it is placed. */
export function defaultSystem(): Level {
  return {
    blocks: [
      { id: 'in1', type: 'inport', params: { index: 1 }, x: 48, y: 96, name: 'In1' },
      { id: 'out1', type: 'outport', params: { index: 1 }, x: 288, y: 96, name: 'Out1' },
    ],
    links: [{ from: { block: 'in1', port: 0 }, to: { block: 'out1', port: 0 } }],
  };
}

/** `siblings` are the blocks already on this level; Inports and Outports take the next free port number. */
export function makeBlock(type: string, x: number, y: number, taken: Set<string>, siblings: Block[] = []): Block {
  const id = newId(type, taken);
  const label = BLOCK_MAP[type].label;
  const same = [...taken].filter((t) => t.startsWith(type)).length;
  const b: Block = { id, type, params: defaultParams(type), x: snap(x), y: snap(y), name: same ? `${label} ${same + 1}` : label };
  if (type === 'subsystem') b.system = defaultSystem();
  if (type === 'inport' || type === 'outport') {
    const used = siblings.filter((o) => o.type === type).map((o) => Number(o.params.index) || 0);
    const index = Math.min(16, Math.max(0, ...used) + 1);
    b.params = { index };
    b.name = `${type === 'inport' ? 'In' : 'Out'}${index}`;
  }
  return b;
}

/** Drop links whose ports no longer exist (e.g. after changing Sum signs). */
export function pruneLinks(blocks: Block[], links: Link[]): Link[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return links.filter((l) => {
    const s = byId.get(l.from.block), d = byId.get(l.to.block);
    return s && d && l.from.port < ports(s).outputs && l.to.port < ports(d).inputs;
  });
}

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('');

export function num(x: number) {
  if (Number.isInteger(x)) return String(x);
  const s = Math.abs(x) >= 1e4 || Math.abs(x) < 1e-3 ? x.toExponential(2) : String(+x.toPrecision(4));
  return s;
}

/** [1, 2, 1] in s -> "s² + 2s + 1" */
export function polyText(c: number[], v: string) {
  let i = 0;
  while (i < c.length - 1 && c[i] === 0) i++;
  const cs = c.slice(i);
  const n = cs.length - 1;
  const parts: string[] = [];
  cs.forEach((a, k) => {
    const p = n - k;
    if (a === 0 && cs.length > 1) return;
    const mag = Math.abs(a);
    const coef = p === 0 ? num(mag) : mag === 1 ? '' : num(mag);
    const term = p === 0 ? coef : `${coef}${v}${p > 1 ? sup(p) : ''}`;
    if (parts.length === 0) parts.push(a < 0 ? `−${term}` : term);
    else parts.push(a < 0 ? `− ${term}` : `+ ${term}`);
  });
  return parts.join(' ') || '0';
}

/** Parse "[1 2 1]", "1, 2, 1" or "1 2 1" into numbers; null when invalid. */
export function parseVector(s: string): number[] | null {
  const parts = s.replace(/[[\]]/g, ' ').split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return null;
  const v = parts.map(Number);
  return v.every(Number.isFinite) ? v : null;
}

export function formatVector(v: number[]) {
  return `[${v.join(' ')}]`;
}

/** Parse "0 1; -2 -3" (rows separated by ";" or newlines) into a rectangular matrix; null when invalid. */
export function parseMatrix(s: string): number[][] | null {
  const rows = s.replace(/[[\]]/g, ' ').split(/[;\n]+/).map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/).map(Number));
  if (!rows.length || !rows.every((r) => r.length === rows[0].length && r.every(Number.isFinite))) return null;
  return rows;
}

export function formatMatrix(m: number[][]) {
  return m.map((r) => r.join(' ')).join('; ');
}

/** Ids of the selected blocks (one for a single selection, several for a marquee or shift-click). */
export function selectedIds(sel: Selection): string[] {
  return sel?.kind === 'block' ? [sel.id] : sel?.kind === 'blocks' ? sel.ids : [];
}

/** The selection for a list of block ids: none, one block, or several. */
export function selectionOf(ids: string[]): Selection {
  return ids.length === 0 ? null : ids.length === 1 ? { kind: 'block', id: ids[0] } : { kind: 'blocks', ids };
}

/** Copy blocks (and the wires between them) 24 px down and right. Returns the new level and the ids of the copies. */
export function duplicateBlocks(level: Level, ids: Set<string>): { level: Level; ids: string[] } {
  const taken = new Set(level.blocks.map((b) => b.id));
  const created: Block[] = [];
  const idMap = new Map<string, string>();
  for (const src of level.blocks.filter((b) => ids.has(b.id))) {
    const made = makeBlock(src.type, src.x + 24, src.y + 24, taken, [...level.blocks, ...created]);
    taken.add(made.id);
    idMap.set(src.id, made.id);
    // Inports and Outports keep the fresh port number from makeBlock; everything else copies the original
    const keepFresh = src.type === 'inport' || src.type === 'outport';
    created.push({ ...made, ...(keepFresh ? {} : { params: structuredClone(src.params), name: src.name }), ...(src.system ? { system: structuredClone(src.system) } : {}) });
  }
  const links = level.links.filter((l) => idMap.has(l.from.block) && idMap.has(l.to.block))
    .map((l) => ({ from: { block: idMap.get(l.from.block)!, port: l.from.port }, to: { block: idMap.get(l.to.block)!, port: l.to.port } }));
  return { level: { blocks: [...level.blocks, ...created], links: [...level.links, ...links] }, ids: created.map((b) => b.id) };
}

/** Blocks whose footprint touches the rectangle (diagram coordinates). */
export function blocksInRect(blocks: Block[], r: { x0: number; y0: number; x1: number; y1: number }): string[] {
  const [x0, x1] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
  const [y0, y1] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
  return blocks.filter((b) => { const { w, h } = blockSize(b); return b.x < x1 && b.x + w > x0 && b.y < y1 && b.y + h > y0; }).map((b) => b.id);
}

export function emptyNetlist(): Netlist {
  return { version: 1, name: 'Untitled model', settings: { tf: 10, dt: 0.01 }, blocks: [], links: [] };
}

/** Strip editor-only fields that the server does not need. */
export function toWire(n: Netlist) {
  return {
    version: 1,
    settings: n.settings,
    ...wireLevel(n),
  };
}

function wireLevel(l: Level): { blocks: object[]; links: Link[] } {
  return {
    blocks: l.blocks.map(({ id, type, params, system }) => (system ? { id, type, params, system: wireLevel(system) } : { id, type, params })),
    links: l.links,
  };
}

// ---- levels: the top diagram and the diagrams inside subsystems

/** The diagram at `path` (subsystem ids from the top), or null when the path leads nowhere. */
export function levelAt(top: Level, path: string[]): Level | null {
  let cur: Level = top;
  for (const id of path) {
    const next = cur.blocks.find((b) => b.id === id)?.system;
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** The longest leading part of `path` that still exists (undo can remove a subsystem you are inside). */
export function validPath(top: Level, path: string[]): string[] {
  let cur: Level = top;
  const out: string[] = [];
  for (const id of path) {
    const next = cur.blocks.find((b) => b.id === id)?.system;
    if (!next) break;
    out.push(id);
    cur = next;
  }
  return out;
}

/**
 * Replace the blocks and links at `path`. Ports of a subsystem come from the Inports and
 * Outports inside it, so links in the levels above may now point at ports that are gone: prune those.
 */
export function withLevel(net: Netlist, path: string[], blocks: Block[], links: Link[]): Netlist {
  const replace = (level: Level, rest: string[]): Level => {
    if (!rest.length) return { blocks, links };
    const [head, ...tail] = rest;
    const nb = level.blocks.map((b) => (b.id === head && b.system ? { ...b, system: replace(b.system, tail) } : b));
    return { blocks: nb, links: pruneLinks(nb, level.links) };
  };
  return { ...net, ...replace({ blocks: net.blocks, links: net.links }, path) };
}

/** Find a block by the id path the server uses ("fwd/pid"), with the level it sits in and its enclosing subsystem names. */
export function findByPath(top: Level, idPath: string): { block: Block; level: Level; names: string[] } | null {
  const parts = idPath.split('/');
  let level: Level = top;
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const b = level.blocks.find((x) => x.id === parts[i]);
    if (!b) return null;
    if (i === parts.length - 1) return { block: b, level, names };
    if (!b.system) return null;
    names.push(b.name || b.id);
    level = b.system;
  }
  return null;
}

/** Clean a loaded diagram: known block types only, snapped positions, copies of params, recursively. */
export function normalizeLevel(l: Partial<Level>): Level {
  const blocks = (Array.isArray(l.blocks) ? l.blocks : []).filter((b) => b && BLOCK_MAP[b.type]).map((b) => {
    const nb: Block = { ...b, x: snap(b.x ?? 0), y: snap(b.y ?? 0), params: { ...b.params } };
    if (b.type === 'subsystem') nb.system = normalizeLevel(b.system ?? defaultSystem());
    else delete nb.system;
    return nb;
  });
  return { blocks, links: Array.isArray(l.links) ? l.links : [] };
}

/**
 * Move the blocks `ids` of a level into a new subsystem. Wires that crossed the boundary
 * now go through Inports and Outports. Returns the new level and the subsystem's id.
 */
export function groupIntoSubsystem(level: Level, ids: Set<string>): { level: Level; id: string } {
  const inside = level.blocks.filter((b) => ids.has(b.id));
  const outside = level.blocks.filter((b) => !ids.has(b.id));
  const x0 = Math.min(...inside.map((b) => b.x)), y0 = Math.min(...inside.map((b) => b.y));
  const x1 = Math.max(...inside.map((b) => b.x + blockSize(b).w));
  const taken = new Set(level.blocks.map((b) => b.id));
  const id = newId('subsystem', taken);
  const innerTaken = new Set(inside.map((b) => b.id));
  const innerBlocks: Block[] = inside.map((b) => ({ ...b, x: b.x - x0 + 120, y: b.y - y0 + 48 }));
  const innerLinks: Link[] = [];
  const outerLinks: Link[] = [];
  let nIn = 0, nOut = 0;
  const outFor = new Map<string, number>(); // "block:port" inside -> subsystem output number (0-based)
  const mk = (type: 'inport' | 'outport', n: number, y: number): Block => {
    const bid = newId(type === 'inport' ? 'in' : 'out', innerTaken);
    innerTaken.add(bid);
    const b: Block = { id: bid, type, params: { index: n }, x: type === 'inport' ? 48 : x1 - x0 + 192, y: snap(y), name: `${type === 'inport' ? 'In' : 'Out'}${n}` };
    innerBlocks.push(b);
    return b;
  };
  for (const l of level.links) {
    const fromIn = ids.has(l.from.block), toIn = ids.has(l.to.block);
    if (fromIn && toIn) innerLinks.push(l);
    else if (toIn) {
      const dst = inside.find((b) => b.id === l.to.block)!;
      const ip = mk('inport', ++nIn, dst.y - y0 + 48);
      innerLinks.push({ from: { block: ip.id, port: 0 }, to: l.to });
      outerLinks.push({ from: l.from, to: { block: id, port: nIn - 1 } });
    } else if (fromIn) {
      const key = `${l.from.block}:${l.from.port}`;
      let k = outFor.get(key);
      if (k === undefined) {
        const src = inside.find((b) => b.id === l.from.block)!;
        const op = mk('outport', ++nOut, src.y - y0 + 48);
        innerLinks.push({ from: l.from, to: { block: op.id, port: 0 } });
        k = nOut - 1;
        outFor.set(key, k);
      }
      outerLinks.push({ from: { block: id, port: k }, to: l.to });
    } else outerLinks.push(l);
  }
  const sub: Block = { id, type: 'subsystem', params: {}, x: snap(x0), y: snap(y0), name: 'Subsystem', system: { blocks: innerBlocks, links: innerLinks } };
  return { level: { blocks: [...outside, sub], links: outerLinks }, id };
}

export function paramsEqual(a: Params, b: Params) {
  return JSON.stringify(a) === JSON.stringify(b);
}
