import { useRef, useState } from 'react';
import type { Trace } from './types';
import { ScopePlot, downloadCsv, readoutText, traceColor } from './ScopeChart';
import { MenuBar } from './Menus';
import { IconDownload, IconScope, IconZoomIn } from './Icons';

export interface ScopeData { id: string; title: string; names: string[]; trace: Trace }

interface Props {
  scopes: ScopeData[];
  tf: number;
  popped: boolean;
  onTogglePop: () => void;
}

const IconAutoscale = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden focusable="false"><path d="M4 9V4h5M20 15v5h-5M4 4l7 7M20 20l-7-7" /></svg>
);
const IconCursor = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden focusable="false"><path d="M8 3v18M16 3v18" /><path d="M3 12h18" strokeDasharray="2 2" /></svg>
);
const IconPop = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden focusable="false"><path d="M13 4h7v7M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></svg>
);
const IconDock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden focusable="false"><rect x={3} y={4} width={18} height={16} /><path d="M3 14h18" /></svg>
);

/** Scopes below the workspace (docked) or in a movable in-app window (popped out). */
export function ScopePanel({ scopes, tf, popped, onTogglePop }: Props) {
  const [active, setActive] = useState(scopes[0]?.id);
  const [cursor, setCursor] = useState(true);
  const [zoomMode, setZoomMode] = useState(false);
  const [xRange, setXRange] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const cur = scopes.find((s) => s.id === active) ?? scopes[0];
  if (!cur) return null;

  const autoscale = () => { setXRange(null); setZoomMode(false); };
  const exportCsv = () => downloadCsv(cur.title, cur.names, cur.trace);
  const readout = cursor && hover !== null && hover < cur.trace.t.length ? readoutText(cur.trace, cur.names, hover) : '';

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, pressed?: boolean) => (
    <button type="button" className="tb" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>{icon}</button>
  );
  const buttons = (
    <>
      {btn('Zoom (drag a time range on the plot)', <IconZoomIn />, () => setZoomMode((z) => !z), zoomMode)}
      {btn('Autoscale', <IconAutoscale />, autoscale)}
      {btn('Cursor measurements', <IconCursor />, () => setCursor((c) => !c), cursor)}
      {btn('Export CSV', <IconDownload size={16} />, exportCsv)}
      {popped ? btn('Dock into editor', <IconDock />, onTogglePop) : btn('Pop out scope window', <IconPop />, onTogglePop)}
    </>
  );
  const legend = (
    <ul className="scope-legend">
      {cur.names.map((n, i) => <li key={i}><span className="scope-key" style={{ background: traceColor(i) }} />{n}</li>)}
    </ul>
  );
  const plot = (plotHeight?: number) => (
    <ScopePlot
      key={cur.id} title={cur.title} trace={cur.trace} names={cur.names} plotHeight={plotHeight}
      cursor={cursor} zoomMode={zoomMode} xRange={xRange} onXRange={setXRange} hover={hover} onHover={setHover}
    />
  );
  const tabs = scopes.length > 1 ? (
    <div role="tablist" aria-label="Scopes" className="scope-tabs">
      {scopes.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={s.id === cur.id} className={`scope-tab ${s.id === cur.id ? 'is-active' : ''}`}
          onClick={() => { setActive(s.id); setXRange(null); setHover(null); }}>{s.title}</button>
      ))}
    </div>
  ) : <span className="scope-title">Scope</span>;

  if (popped) return <ScopeWindow title={cur.title} tf={tf} tabs={tabs} buttons={buttons} legend={legend} readout={readout} plot={plot()} onDock={onTogglePop} onExport={exportCsv} onAutoscale={autoscale} onCursor={() => setCursor((c) => !c)} cursor={cursor} />;

  return (
    <section className="scope-dock" aria-label="Scope output">
      <div className="scope-titlerow">
        <IconScope size={16} />
        {tabs}
        {buttons}
        {legend}
        <span className="scope-readout-line mono" aria-live="off">{readout}</span>
      </div>
      {plot(190)}
    </section>
  );
}

function ScopeWindow({ title, tf, tabs, buttons, legend, readout, plot, onDock, onExport, onAutoscale, onCursor, cursor }: {
  title: string; tf: number; tabs: React.ReactNode; buttons: React.ReactNode; legend: React.ReactNode; readout: string; plot: React.ReactNode;
  onDock: () => void; onExport: () => void; onAutoscale: () => void; onCursor: () => void; cursor: boolean;
}) {
  const [pos, setPos] = useState({ x: 96, y: 72 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const win = useRef<HTMLDivElement>(null);
  const clamp = (x: number, y: number) => {
    const p = win.current?.parentElement?.getBoundingClientRect();
    const w = win.current?.getBoundingClientRect();
    if (!p || !w) return { x, y };
    return { x: Math.min(Math.max(0, x), Math.max(0, p.width - w.width)), y: Math.min(Math.max(0, y), Math.max(0, p.height - 30)) };
  };
  return (
    <div className="scope-window" ref={win} role="dialog" aria-label={`Scope window: ${title}`} style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDock(); } }}>
      <div
        className="window-title"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
        onPointerMove={(e) => { if (drag.current) setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy)); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <IconScope size={16} />
        <span className="window-name">Scope — {title}</span>
        <button type="button" className="window-close" aria-label="Close scope window (dock it)" onClick={onDock}>✕</button>
      </div>
      <div className="menubar window-menu">
        <MenuBar menus={[
          { label: 'File', mnemonic: 0, items: [{ label: 'Export CSV', onSelect: onExport }, { label: 'Close', onSelect: onDock }] },
          { label: 'View', mnemonic: 0, items: [
            { label: 'Autoscale', onSelect: onAutoscale },
            { label: 'Cursor measurements', checked: cursor, onSelect: onCursor },
            { label: 'Dock into editor', onSelect: onDock },
          ] },
        ]} />
      </div>
      <div className="toolbar" role="toolbar" aria-label="Scope toolbar">
        {tabs}
        <span className="tb-sep" aria-hidden />
        {buttons}
        {legend}
      </div>
      <div className="window-plot">{plot}</div>
      <div className="statusbar">
        <span className="status-main">Sample based · T={tf.toFixed(3)}</span>
        {readout && <span className="status-cell mono">{readout}</span>}
      </div>
    </div>
  );
}
