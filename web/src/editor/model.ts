// Geometry and pure helpers for the diagram model.
import { BLOCK_MAP, defaultParams, portCounts } from '../../../shared/catalog.js';
import type { Block, Link, Netlist, Params } from './types';

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
    case 'transferFn': case 'discreteTF': return { w: 120, h: Math.max(64, n * 24 + 16) };
    case 'pid': return { w: 104, h: 64 };
    default: return { w: 88, h: Math.max(56, n * 24 + 16) };
  }
}

export function ports(b: Block) {
  try { return portCounts(b.type, b.params); } catch { return { inputs: 0, outputs: 0 }; }
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

export function makeBlock(type: string, x: number, y: number, taken: Set<string>): Block {
  const id = newId(type, taken);
  const label = BLOCK_MAP[type].label;
  const same = [...taken].filter((t) => t.startsWith(type)).length;
  return { id, type, params: defaultParams(type), x: snap(x), y: snap(y), name: same ? `${label} ${same + 1}` : label };
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

export function emptyNetlist(): Netlist {
  return { version: 1, name: 'Untitled model', settings: { tf: 10, dt: 0.01 }, blocks: [], links: [] };
}

/** Strip editor-only fields that the server does not need. */
export function toWire(n: Netlist) {
  return {
    version: 1,
    settings: n.settings,
    blocks: n.blocks.map(({ id, type, params }) => ({ id, type, params })),
    links: n.links,
  };
}

export function paramsEqual(a: Params, b: Params) {
  return JSON.stringify(a) === JSON.stringify(b);
}
