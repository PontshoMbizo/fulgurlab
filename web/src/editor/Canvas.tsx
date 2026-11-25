import { useCallback, useEffect, useRef, useState } from 'react';
import type { Block, Link, Netlist, PortRef, Selection } from './types';
import { BlockGlyph } from './BlockGlyph';
import { IconFit, IconMinus, IconPlus } from './Icons';
import { blockSize, blocksInRect, inPortPos, outPortPos, ports, selectedIds, selectionOf, snap, wirePath } from './model';

interface Props {
  net: Netlist;
  selection: Selection;
  errorBlocks: Set<string>;
  /** commit=false while dragging (no undo entry), true when the gesture ends */
  onChange: (net: Netlist, commit: boolean) => void;
  onSelect: (s: Selection) => void;
  /** double-click on a block (subsystems open) */
  onOpen?: (id: string) => void;
  onDropType: (type: string, x: number, y: number) => void;
  /** changes whenever a new diagram is loaded, to re-fit the view */
  loadKey: number;
  /** filled with a function returning the visible centre, in diagram coordinates */
  centerRef?: React.MutableRefObject<(() => { x: number; y: number }) | null>;
  /** filled with zoom commands so menus and toolbars outside the canvas can drive it */
  controlsRef?: React.MutableRefObject<CanvasControls | null>;
  /** reports the zoom factor (1 = 100%) whenever it changes */
  onZoom?: (k: number) => void;
}

export interface CanvasControls { zoomIn: () => void; zoomOut: () => void; fit: () => void }

type Drag =
  | { kind: 'move'; sx: number; sy: number; starts: Record<string, { x: number; y: number }>; moved: boolean; /** a plain click on a block of a multi-selection narrows it to that block */ collapseTo?: string }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; base: string[] }
  | { kind: 'wire'; from: PortRef; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number };

export function Canvas({ net, selection, errorBlocks, onChange, onSelect, onOpen, onDropType, loadKey, centerRef, controlsRef, onZoom }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverIn, setHoverIn] = useState<PortRef | null>(null);
  const byId = new Map(net.blocks.map((b) => [b.id, b]));
  const selectedSet = new Set(selectedIds(selection));

  /** screen -> diagram coordinates */
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }, [view]);

  if (centerRef) centerRef.current = () => {
    const r = svg.current?.getBoundingClientRect();
    return r ? toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 200, y: 150 };
  };

  const nearestInput = (x: number, y: number): PortRef | null => {
    let best: PortRef | null = null, bd = 18 * 18;
    for (const b of net.blocks) {
      const n = ports(b).inputs;
      for (let i = 0; i < n; i++) {
        const p = inPortPos(b, i);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = { block: b.id, port: i }; }
      }
    }
    return best;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView((v) => ({ ...v, x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy }));
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (drag.kind === 'move') {
      const dx = p.x - drag.sx, dy = p.y - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) * view.k < 3) return; // a click, not a drag
      const blocks = net.blocks.map((b) => { const s = drag.starts[b.id]; return s ? { ...b, x: snap(s.x + dx), y: snap(s.y + dy) } : b; });
      if (!drag.moved) setDrag({ ...drag, moved: true });
      onChange({ ...net, blocks }, false);
    } else if (drag.kind === 'box') {
      const next = { ...drag, x1: p.x, y1: p.y };
      setDrag(next);
      onSelect(selectionOf([...new Set([...drag.base, ...blocksInRect(net.blocks, next)])]));
    } else if (drag.kind === 'wire') {
      setDrag({ ...drag, x: p.x, y: p.y });
      setHoverIn(nearestInput(p.x, p.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === 'move' && drag.moved) onChange(net, true);
    else if (drag?.kind === 'move' && drag.collapseTo) onSelect({ kind: 'block', id: drag.collapseTo });
    if (drag?.kind === 'wire') {
      const p = toWorld(e.clientX, e.clientY);
      const target = nearestInput(p.x, p.y);
      if (target && target.block !== drag.from.block) {
        const links: Link[] = net.links.filter((l) => !(l.to.block === target.block && l.to.port === target.port));
        links.push({ from: drag.from, to: target });
        onChange({ ...net, links }, true);
        onSelect({ kind: 'link', index: links.length - 1 });
      }
    }
    setDrag(null);
    setHoverIn(null);
  };

  const startMove = (e: React.PointerEvent, b: Block) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    const current = selectedIds(selection);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // shift/ctrl-click adds or removes a block; it does not start a drag
      onSelect(selectionOf(current.includes(b.id) ? current.filter((id) => id !== b.id) : [...current, b.id]));
      return;
    }
    const inSelection = current.includes(b.id) && current.length > 1;
    const moving = inSelection ? current : [b.id];
    const starts: Record<string, { x: number; y: number }> = {};
    for (const id of moving) { const m = byId.get(id); if (m) starts[id] = { x: m.x, y: m.y }; }
    setDrag({ kind: 'move', sx: p.x, sy: p.y, starts, moved: false, collapseTo: inSelection ? b.id : undefined });
    if (!inSelection) onSelect({ kind: 'block', id: b.id });
  };

  const startWire = (e: React.PointerEvent, b: Block, port: number) => {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'wire', from: { block: b.id, port }, x: p.x, y: p.y });
  };

  /** Left-drag on the background draws a selection box; middle-drag or Alt+drag pans. */
  const startPan = (e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y });
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? selectedIds(selection) : [];
    if (!base.length) onSelect(null);
    setDrag({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base });
  };

  // wheel zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(2.5, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const fit = () => {
    if (!net.blocks.length || !svg.current) return setView({ x: 0, y: 0, k: 1 });
    const r = svg.current.getBoundingClientRect();
    const xs = net.blocks.flatMap((b) => [b.x, b.x + blockSize(b).w]);
    const ys = net.blocks.flatMap((b) => [b.y, b.y + blockSize(b).h + 40]);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 40, Math.max(...xs) + 40, Math.min(...ys) - 40, Math.max(...ys) + 20];
    const k = Math.min(1.4, r.width / (x1 - x0), r.height / (y1 - y0));
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k });
  };
  // fit whenever a different diagram is loaded
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.3, v.k * f)) }));
  if (controlsRef) controlsRef.current = { zoomIn: () => zoomBy(1.2), zoomOut: () => zoomBy(1 / 1.2), fit };
  useEffect(() => { onZoom?.(view.k); }, [view.k]); // eslint-disable-line react-hooks/exhaustive-deps

  const driven = new Set(net.links.map((l) => `${l.to.block}:${l.to.port}`));
  /** outputs feeding more than one wire get a solid junction dot at the branch */
  const fanout = new Map<string, { n: number; x: number; y: number }>();
  for (const l of net.links) {
    const src = byId.get(l.from.block);
    if (!src) continue;
    const k = `${l.from.block}:${l.from.port}`;
    const c = fanout.get(k);
    if (c) c.n++; else fanout.set(k, { n: 1, ...outPortPos(src, l.from.port) });
  }
  const used = new Set(net.links.map((l) => `${l.from.block}:${l.from.port}`));

  return (
    <div
      className="canvas-wrap"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-fulgur-block')) e.preventDefault(); }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData('application/x-fulgur-block');
        if (!type) return;
        e.preventDefault();
        const p = toWorld(e.clientX, e.clientY);
        onDropType(type, p.x - 40, p.y - 28);
      }}
    >
      <div className="canvas-tools" role="toolbar" aria-label="Canvas tools">
        <button type="button" className="tb" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out"><IconMinus size={13} /></button>
        <span className="zoom-label" aria-hidden>{Math.round(view.k * 100)}%</span>
        <button type="button" className="tb" onClick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in"><IconPlus size={13} /></button>
        <button type="button" className="tb" onClick={fit} aria-label="Fit to view" title="Fit to view"><IconFit size={13} /></button>
      </div>
      <svg
        ref={svg}
        className={`canvas ${drag?.kind === 'pan' ? 'is-panning' : ''}`}
        onPointerDown={startPan}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="application"
        aria-label="Block diagram canvas"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="wire-head" />
          </marker>
          <marker id="arrow-sel" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="wire-head is-selected" />
          </marker>
          {/* dot grid that pans and zooms with the diagram */}
          <pattern id="canvas-grid" width={18} height={18} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <circle cx={1} cy={1} r={0.9} className="canvas-dot" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#canvas-grid)" pointerEvents="none" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {net.links.map((l, i) => {
            const s = byId.get(l.from.block), d = byId.get(l.to.block);
            if (!s || !d) return null;
            const sel = selection?.kind === 'link' && selection.index === i;
            const dpath = wirePath(s, l.from.port, d, l.to.port, undefined, net.blocks);
            return (
              <g key={i} onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'link', index: i }); }}>
                <path d={dpath} className="wire-hit" />
                <path d={dpath} className={`wire ${sel ? 'is-selected' : ''}`} markerEnd={`url(#${sel ? 'arrow-sel' : 'arrow'})`} />
              </g>
            );
          })}
          {[...fanout].filter(([, c]) => c.n > 1).map(([k, c]) => <circle key={k} cx={c.x} cy={c.y} r={2.5} className="junction" />)}
          {drag?.kind === 'wire' && byId.get(drag.from.block) && (
            <>
              <path
                d={wirePath(byId.get(drag.from.block)!, drag.from.port, hoverIn ? byId.get(hoverIn.block)! : null, hoverIn?.port ?? 0, { x: drag.x, y: drag.y })}
                className="wire is-drafting"
              />
              {(() => {
                const t = hoverIn && byId.get(hoverIn.block) ? inPortPos(byId.get(hoverIn.block)!, hoverIn.port) : { x: drag.x, y: drag.y };
                return <circle cx={t.x} cy={t.y} r={5} className="draft-target" />;
              })()}
            </>
          )}
          {net.blocks.map((b) => {
            const { w, h } = blockSize(b);
            const { inputs, outputs } = ports(b);
            const sel = selectedSet.has(b.id);
            return (
              <g key={b.id} transform={`translate(${b.x},${b.y})`} className={`block ${sel ? 'is-selected' : ''} ${errorBlocks.has(b.id) ? 'has-error' : ''}`}>
                <g onPointerDown={(e) => startMove(e, b)} onDoubleClick={() => onOpen?.(b.id)} className="block-body">
                  <BlockGlyph block={b} />
                </g>
                {sel && (
                  <g pointerEvents="none" className="selection">
                    <rect x={-4} y={-4} width={w + 8} height={h + 8} className="select-box" />
                    {[[-4, -4], [w + 4, -4], [-4, h + 4], [w + 4, h + 4]].map(([hx, hy], i) => (
                      <rect key={i} x={hx - 3} y={hy - 3} width={6} height={6} className="select-handle" />
                    ))}
                  </g>
                )}
                <text x={w / 2} y={h + (sel ? 20 : 15)} textAnchor="middle" className="block-name">{b.name || b.id}</text>
                {Array.from({ length: inputs }, (_, i) => {
                  const p = inPortPos(b, i);
                  const hot = hoverIn?.block === b.id && hoverIn.port === i;
                  if (driven.has(`${b.id}:${i}`) && !hot) return null;
                  return <path key={`i${i}`} transform={`translate(${p.x - b.x - 6},${p.y - b.y})`} d="M0,-4 L5,0 L0,4" className={`port-in ${hot ? 'is-hot' : ''}`} />;
                })}
                {Array.from({ length: outputs }, (_, i) => {
                  const p = outPortPos(b, i);
                  return (
                    <g key={`o${i}`} onPointerDown={(e) => startWire(e, b, i)} className="port-out-hit">
                      <circle cx={p.x - b.x + 3} cy={p.y - b.y} r={10} className="port-target" />
                      {!used.has(`${b.id}:${i}`) && <path transform={`translate(${p.x - b.x + 1.5},${p.y - b.y})`} d="M0,-4 L5,0 L0,4" className="port-out" />}
                    </g>
                  );
                })}
              </g>
            );
          })}
          {drag?.kind === 'box' && (
            <rect x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} className="marquee" pointerEvents="none" />
          )}
        </g>
      </svg>
      {net.blocks.length === 0 && (
        <div className="canvas-empty">
          <p>Drag blocks here from the library, then drag from a block's output arrow to another block's input to wire them.</p>
        </div>
      )}
    </div>
  );
}
