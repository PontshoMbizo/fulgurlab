// The scope plot: the light plot of the suite's results dock (dark when the system is), mono ticks,
// 1.6 px traces. Colours are the --scope-* tokens in styles.css.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trace } from './types';
import { num } from './model';

const M = { l: 46, r: 16, t: 8, b: 22 };

function niceTicks(lo: number, hi: number, count = 5) {
  if (!(hi > lo)) { const d = Math.abs(lo) || 1; lo -= d / 2; hi += d / 2; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, lo: start, hi: end };
}

/** Min/max decimation: keeps peaks visible when 10⁶ samples land on 800 px. */
function decimate(t: number[], y: number[], from: number, to: number, buckets: number) {
  const n = to - from;
  if (n <= buckets * 2) { const out: (readonly [number, number])[] = []; for (let i = from; i < to; i++) out.push([t[i], y[i]]); return out; }
  const out: (readonly [number, number])[] = [];
  const size = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = from + Math.floor(b * size), e = Math.min(to, from + Math.floor((b + 1) * size));
    let mi = s, ma = s;
    for (let i = s; i < e; i++) { if (y[i] < y[mi]) mi = i; if (y[i] > y[ma]) ma = i; }
    const [a, c] = mi < ma ? [mi, ma] : [ma, mi];
    out.push([t[a], y[a]]);
    if (c !== a) out.push([t[c], y[c]]);
  }
  return out;
}

/** First index with t[i] >= v. */
function lowerBound(t: number[], v: number) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < v) lo = m + 1; else hi = m; }
  return lo;
}

export function downloadCsv(title: string, names: string[], { t, y }: Trace) {
  const header = ['t', ...names].map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
  const rows = t.map((tt, i) => [tt, ...y.map((s) => s[i])].join(','));
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^\w-]+/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const traceColor = (i: number) => `var(--scope-${(i % 8) + 1})`;

/** Text of the cursor readout, shared by the plot box and the title row. */
export function readoutText(trace: Trace, names: string[], i: number) {
  return `t = ${num(+trace.t[i].toPrecision(6))} s · ` + trace.y.map((s, k) => `${names[k]} ${num(+s[i].toPrecision(5))}`).join(' · ');
}

interface PlotProps {
  title: string; trace: Trace; names: string[];
  /** fixed plot height in px (docked); omit to fill the container */
  plotHeight?: number;
  cursor: boolean;
  zoomMode: boolean;
  xRange: [number, number] | null;
  onXRange: (r: [number, number] | null) => void;
  hover: number | null;
  onHover: (i: number | null) => void;
}

export function ScopePlot({ title, trace, names, plotHeight, cursor, zoomMode, xRange, onXRange, hover, onHover }: PlotProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 220 });
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(240, e.contentRect.width), h: Math.max(120, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { t, y } = trace;
  const width = size.w;
  const height = plotHeight ? plotHeight + M.t + M.b : size.h;
  const iw = width - M.l - M.r, ih = height - M.t - M.b;

  const xs = useMemo(() => {
    if (!xRange) return niceTicks(t[0] ?? 0, t[t.length - 1] ?? 1, Math.max(2, Math.floor(iw / 90)));
    const n = niceTicks(xRange[0], xRange[1], Math.max(2, Math.floor(iw / 90)));
    return { ticks: n.ticks.filter((v) => v >= xRange[0] && v <= xRange[1]), lo: xRange[0], hi: xRange[1] };
  }, [t, iw, xRange]);
  const from = useMemo(() => lowerBound(t, xs.lo), [t, xs.lo]);
  const to = useMemo(() => Math.min(t.length, lowerBound(t, xs.hi) + 1), [t, xs.hi]);
  const ys = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of y) for (let i = from; i < to; i++) { const v = s[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 0.5;
    return niceTicks(lo - pad, hi + pad, Math.max(2, Math.floor(ih / 40)));
  }, [y, from, to, ih]);
  const X = (v: number) => M.l + ((v - xs.lo) / (xs.hi - xs.lo || 1)) * iw;
  const Y = (v: number) => M.t + ih - ((v - ys.lo) / (ys.hi - ys.lo || 1)) * ih;
  const paths = useMemo(
    () => y.map((s) => decimate(t, s, from, to, Math.ceil(iw)).map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(Number.isFinite(b) ? b : 0).toFixed(1)}`).join('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, y, iw, ih, xs, ys, from, to],
  );

  const px = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const nearest = (f: number) => {
    const tv = xs.lo + f * (xs.hi - xs.lo);
    const hi = Math.min(t.length - 1, Math.max(1, lowerBound(t, tv)));
    return Math.abs(t[hi - 1] - tv) < Math.abs(t[hi] - tv) ? hi - 1 : hi;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const f = px(e);
    if (sel) setSel({ ...sel, b: f });
    if (cursor || zoomMode) onHover(nearest(f));
  };
  const onDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (!zoomMode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const f = px(e);
    setSel({ a: f, b: f });
  };
  const onUp = () => {
    if (sel && Math.abs(sel.b - sel.a) * iw > 5) {
      const [a, b] = [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)];
      onXRange([xs.lo + a * (xs.hi - xs.lo), xs.lo + b * (xs.hi - xs.lo)]);
    }
    setSel(null);
  };

  const showCursor = cursor && hover !== null && hover < t.length && t[hover] >= xs.lo && t[hover] <= xs.hi;
  return (
    <div className="scope-plot" ref={box} style={plotHeight ? { height: plotHeight + M.t + M.b } : undefined}>
      <svg width={width} height={height} role="img" aria-label={`${title}: ${names.join(', ')} against time, ${t.length} samples`}>
        <rect width={width} height={height} className="scope-surround" />
        <rect x={M.l} y={M.t} width={iw} height={ih} className="scope-screen" />
        {ys.ticks.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={M.l + iw} y1={Y(v)} y2={Y(v)} className="scope-grid" />
            <text x={M.l - 6} y={Y(v) + 3.5} textAnchor="end" className="scope-tick">{num(v)}</text>
          </g>
        ))}
        {xs.ticks.map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={M.t} y2={M.t + ih} className="scope-grid" />
            <text x={X(v)} y={M.t + ih + 14} textAnchor="middle" className="scope-tick">{num(v)}</text>
          </g>
        ))}
        <clipPath id="scope-clip"><rect x={M.l} y={M.t} width={iw} height={ih} /></clipPath>
        <g clipPath="url(#scope-clip)">
          {paths.map((d, i) => <path key={i} d={d} className="scope-trace" style={{ stroke: traceColor(i) }} />)}
        </g>
        {showCursor && (
          <g pointerEvents="none">
            <line x1={X(t[hover!])} x2={X(t[hover!])} y1={M.t} y2={M.t + ih} className="scope-cursor" />
            {y.map((s, i) => Number.isFinite(s[hover!]) && (
              <rect key={i} x={X(t[hover!]) - 3} y={Y(s[hover!]) - 3} width={6} height={6} className="scope-marker" style={{ fill: traceColor(i) }} />
            ))}
          </g>
        )}
        {sel && <rect x={M.l + Math.min(sel.a, sel.b) * iw} y={M.t} width={Math.abs(sel.b - sel.a) * iw} height={ih} className="scope-zoombox" pointerEvents="none" />}
        <rect
          x={M.l} y={M.t} width={iw} height={ih} fill="transparent" className={zoomMode ? 'is-zoom' : undefined}
          onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => { onHover(null); setSel(null); }}
        />
      </svg>
      {showCursor && (
        <div className="scope-readout" style={{ left: Math.min(X(t[hover!]) + 12, width - 190), top: M.t + 6 }}>
          <div className="mono">t = {num(+t[hover!].toPrecision(6))} s</div>
          {y.map((s, i) => (
            <div key={i} className="scope-readout-row">
              <span className="scope-key" style={{ background: traceColor(i) }} />
              <span className="mono">{num(+s[hover!].toPrecision(6))}</span>
              <span>{names[i]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
