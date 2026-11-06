import { useCallback, useEffect, useRef, useState } from 'react';
import type { Block, Link, Netlist, PortRef, Selection } from './types';
import { BlockGlyph } from './BlockGlyph';
import { blockSize, inPortPos, outPortPos, ports, snap, wirePath } from './model';

interface Props {
  net: Netlist;
  selection: Selection;
  errorBlocks: Set<string>;
  /** commit=false while dragging (no undo entry), true when the gesture ends */
  onChange: (net: Netlist, commit: boolean) => void;
  onSelect: (s: Selection) => void;
  onDropType: (type: string, x: number, y: number) => void;
  /** changes whenever a new diagram is loaded, to re-fit the view */
  loadKey: number;
  /** filled with a function returning the visible centre, in diagram coordinates */
  centerRef?: React.MutableRefObject<(() => { x: number; y: number }) | null>;
}

type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'wire'; from: PortRef; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number };

export function Canvas({ net, selection, errorBlocks, onChange, onSelect, onDropType, loadKey, centerRef }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverIn, setHoverIn] = useState<PortRef | null>(null);
  const byId = new Map(net.blocks.map((b) => [b.id, b]));

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
      const blocks = net.blocks.map((b) => (b.id === drag.id ? { ...b, x: snap(p.x - drag.dx), y: snap(p.y - drag.dy) } : b));
      if (!drag.moved) setDrag({ ...drag, moved: true });
      onChange({ ...net, blocks }, false);
    } else if (drag.kind === 'wire') {
      setDrag({ ...drag, x: p.x, y: p.y });
      setHoverIn(nearestInput(p.x, p.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === 'move' && drag.moved) onChange(net, true);
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
    setDrag({ kind: 'move', id: b.id, dx: p.x - b.x, dy: p.y - b.y, moved: false });
    onSelect({ kind: 'block', id: b.id });
  };

  const startWire = (e: React.PointerEvent, b: Block, port: number) => {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'wire', from: { block: b.id, port }, x: p.x, y: p.y });
  };

  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    onSelect(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y });
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

  const driven = new Set(net.links.map((l) => `${l.to.block}:${l.to.port}`));

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
          <pattern id="dots" width={16 * view.k} height={16 * view.k} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={1} cy={1} r={1} className="grid-dot" />
          </pattern>
          <marker id="arrow" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="wire-head" />
          </marker>
          <marker id="arrow-sel" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" className="wire-head is-selected" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
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
          {drag?.kind === 'wire' && byId.get(drag.from.block) && (
            <path
              d={wirePath(byId.get(drag.from.block)!, drag.from.port, hoverIn ? byId.get(hoverIn.block)! : null, hoverIn?.port ?? 0, { x: drag.x, y: drag.y })}
              className="wire is-drafting"
            />
          )}
          {net.blocks.map((b) => {
            const { w, h } = blockSize(b);
            const { inputs, outputs } = ports(b);
            const sel = selection?.kind === 'block' && selection.id === b.id;
            return (
              <g key={b.id} transform={`translate(${b.x},${b.y})`} className={`block ${sel ? 'is-selected' : ''} ${errorBlocks.has(b.id) ? 'has-error' : ''}`}>
                <g onPointerDown={(e) => startMove(e, b)} className="block-body">
                  <BlockGlyph block={b} />
                </g>
                <text x={w / 2} y={h + 16} textAnchor="middle" className="block-name">{b.name || b.id}</text>
                {Array.from({ length: inputs }, (_, i) => {
                  const p = inPortPos(b, i);
                  const hot = hoverIn?.block === b.id && hoverIn.port === i;
                  if (driven.has(`${b.id}:${i}`) && !hot) return null;
                  return (
                    <g key={`i${i}`}>
                      <path d={`M${p.x - b.x - 1},${p.y - b.y - 5} L${p.x - b.x + 5},${p.y - b.y} L${p.x - b.x - 1},${p.y - b.y + 5}`} className={`port-in ${driven.has(`${b.id}:${i}`) ? 'is-driven' : ''} ${hot ? 'is-hot' : ''}`} />
                    </g>
                  );
                })}
                {Array.from({ length: outputs }, (_, i) => {
                  const p = outPortPos(b, i);
                  return (
                    <g key={`o${i}`} onPointerDown={(e) => startWire(e, b, i)} className="port-out-hit">
                      <circle cx={p.x - b.x} cy={p.y - b.y} r={10} className="port-target" />
                      <path d={`M${p.x - b.x},${p.y - b.y - 5} L${p.x - b.x + 6},${p.y - b.y} L${p.x - b.x},${p.y - b.y + 5}`} className="port-out" />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
      {net.blocks.length === 0 && (
        <div className="canvas-empty">
          <p>Drag blocks here from the library, then drag from a block's output arrow to another block's input to wire them.</p>
        </div>
      )}
      <div className="canvas-tools">
        <button type="button" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.2) }))} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit}>Fit</button>
      </div>
    </div>
  );
}
