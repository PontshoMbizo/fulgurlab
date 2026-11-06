import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trace } from './types';
import { num } from './model';

const M = { l: 52, r: 16, t: 12, b: 30 };

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
function decimate(t: number[], y: number[], buckets: number) {
  if (t.length <= buckets * 2) return t.map((tt, i) => [tt, y[i]] as const);
  const out: (readonly [number, number])[] = [];
  const size = t.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * size), e = Math.min(t.length, Math.floor((b + 1) * size));
    let mi = s, ma = s;
    for (let i = s; i < e; i++) { if (y[i] < y[mi]) mi = i; if (y[i] > y[ma]) ma = i; }
    const [a, c] = mi < ma ? [mi, ma] : [ma, mi];
    out.push([t[a], y[a]]);
    if (c !== a) out.push([t[c], y[c]]);
  }
  return out;
}

export function ScopeChart({ title, trace, names }: { title: string; trace: Trace; names: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { t, y } = trace;
  const iw = width - M.l - M.r, ih = height - M.t - M.b;
  const xs = useMemo(() => niceTicks(t[0] ?? 0, t[t.length - 1] ?? 1, Math.max(2, Math.floor(iw / 90))), [t, iw]);
  const ys = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of y) for (const v of s) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 0.5;
    return niceTicks(lo - pad, hi + pad, 5);
  }, [y]);
  const X = (v: number) => M.l + ((v - xs.lo) / (xs.hi - xs.lo || 1)) * iw;
  const Y = (v: number) => M.t + ih - ((v - ys.lo) / (ys.hi - ys.lo || 1)) * ih;
  const paths = useMemo(() => y.map((s) => decimate(t, s, Math.ceil(iw)).map(([a, b], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(Number.isFinite(b) ? b : 0).toFixed(1)}`).join('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, y, iw, xs, ys]);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const tv = xs.lo + ((e.clientX - r.left) / r.width) * (xs.hi - xs.lo);
    // binary search for nearest sample
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] < tv) lo = m; else hi = m; }
    setHover(Math.abs(t[lo] - tv) < Math.abs(t[hi] - tv) ? lo : hi);
  };

  const download = () => {
    const header = ['t', ...names].map((n) => `"${n.replace(/"/g, '""')}"`).join(',');
    const rows = t.map((tt, i) => [tt, ...y.map((s) => s[i])].join(','));
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w-]+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <figure className="scope viz-root" ref={box}>
      <figcaption>
        <strong>{title}</strong>
        {names.length > 1 && (
          <ul className="legend">
            {names.map((n, i) => <li key={i}><span className="key" style={{ background: `var(--series-${(i % 8) + 1})` }} />{n}</li>)}
          </ul>
        )}
        <button type="button" className="link" onClick={download}>Download CSV</button>
      </figcaption>
      <svg width={width} height={height} role="img" aria-label={`${title}: ${names.join(', ')} against time, ${t.length} samples`}>
        {ys.ticks.map((v) => (
          <g key={`y${v}`}>
            <line x1={M.l} x2={M.l + iw} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'axis-zero' : 'gridline'} />
            <text x={M.l - 8} y={Y(v) + 4} textAnchor="end" className="tick">{num(v)}</text>
          </g>
        ))}
        {xs.ticks.map((v) => (
          <text key={`x${v}`} x={X(v)} y={height - 10} textAnchor="middle" className="tick">{num(v)}</text>
        ))}
        <text x={M.l + iw} y={height - 10} dx={14} className="tick unit" textAnchor="end">s</text>
        <line x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} className="axis" />
        {paths.map((d, i) => <path key={i} d={d} className="series-line" style={{ stroke: `var(--series-${(i % 8) + 1})` }} />)}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={X(t[hover])} x2={X(t[hover])} y1={M.t} y2={M.t + ih} className="crosshair" />
            {y.map((s, i) => Number.isFinite(s[hover]) && (
              <circle key={i} cx={X(t[hover])} cy={Y(s[hover])} r={4} className="hover-dot" style={{ fill: `var(--series-${(i % 8) + 1})` }} />
            ))}
          </g>
        )}
        <rect x={M.l} y={M.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(X(t[hover]) + 12, width - 170), top: M.t + 4 }}>
          <div className="tooltip-time">t = {num(+t[hover].toPrecision(6))} s</div>
          {y.map((s, i) => (
            <div key={i} className="tooltip-row">
              <span className="line-key" style={{ background: `var(--series-${(i % 8) + 1})` }} />
              <strong>{num(+s[hover].toPrecision(6))}</strong>
              <span>{names[i]}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}
