import { useRef, useState } from 'react';
import type { Trace } from './types';
import { ScopePlot, downloadCsv, readoutText, traceColor } from './ScopeChart';
import { MenuBar } from './Menus';
import { IconAutoscale, IconCursor, IconDock, IconDownload, IconPop, IconScope, IconX, IconZoomIn } from './Icons';

export interface ScopeData { id: string; title: string; names: string[]; trace: Trace }

interface Props {
  scopes: ScopeData[];
  tf: number;
  popped: boolean;
  onTogglePop: () => void;
}

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
      {btn('Export CSV', <IconDownload />, exportCsv)}
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
  ) : <span className="scope-title"><IconScope size={14} />Scope</span>;

  if (popped) return <ScopeWindow title={cur.title} tf={tf} tabs={tabs} buttons={buttons} legend={legend} readout={readout} plot={plot()} onDock={onTogglePop} onExport={exportCsv} onAutoscale={autoscale} onCursor={() => setCursor((c) => !c)} cursor={cursor} />;

  return (
    <section className="scope-dock" aria-label="Scope output">
      <div className="scope-titlerow">
        {tabs}
        <span className="scope-spacer" />
        {buttons}
      </div>
      <div className="scope-legend-row">
        {legend}
        <span className="scope-readout-line mono" aria-live="off">{readout}</span>
      </div>
      {plot(160)}
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
        <IconScope size={15} />
        <span className="window-name">Scope — {title}</span>
        <button type="button" className="window-close" aria-label="Close scope window (dock it)" onClick={onDock}><IconX /></button>
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
      </div>
      <div className="scope-legend-row">{legend}</div>
      <div className="window-plot">{plot}</div>
      <div className="statusbar">
        <span className="status-main">Sample based · T={tf.toFixed(3)}</span>
        {readout && <span className="status-cell mono">{readout}</span>}
      </div>
    </div>
  );
}
