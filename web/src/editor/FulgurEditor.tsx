import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BLOCK_MAP } from '../../../shared/catalog.js';
import type { Block, Issue, Netlist, Selection, SimResult } from './types';
import { Canvas } from './Canvas';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { ScopeChart } from './ScopeChart';
import { runSimulation } from './api';
import { emptyNetlist, makeBlock, ports, pruneLinks, snap, toWire } from './model';

export interface FulgurEditorProps {
  /** Diagram to start with. Change `loadKey` to load a different one later. */
  initial?: Netlist;
  loadKey?: number;
  /** Simulation server origin; '' means same origin (default). */
  apiBase?: string;
  /** Diagrams offered in the Examples menu. */
  examples?: { name: string; netlist: Netlist }[];
  onChange?: (net: Netlist) => void;
  onResult?: (result: SimResult, net: Netlist) => void;
  /** Hide file/example controls, e.g. when embedded in a problem page. */
  compact?: boolean;
}

const HISTORY = 100;

export function FulgurEditor({ initial, loadKey = 0, apiBase = '', examples = [], onChange, onResult, compact = false }: FulgurEditorProps) {
  const [net, setNet] = useState<Netlist>(() => initial ?? emptyNetlist());
  const [selection, setSelection] = useState<Selection>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [resultFor, setResultFor] = useState('');
  const [running, setRunning] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const undo = useRef<Netlist[]>([]);
  const redo = useRef<Netlist[]>([]);
  const committed = useRef(net);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const center = useRef<(() => { x: number; y: number }) | null>(null);

  const load = useCallback((n: Netlist) => {
    setNet(n); committed.current = n; undo.current = []; redo.current = [];
    setSelection(null); setResult(null); setViewKey((k) => k + 1);
  }, []);

  useEffect(() => { if (initial && loadKey) load(initial); }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onChange?.(net); }, [net]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Apply a change. commit=true records an undo step (end of a gesture/edit). */
  const update = useCallback((n: Netlist, commit = true) => {
    setNet(n);
    if (commit) {
      if (committed.current !== n) {
        undo.current = [...undo.current.slice(-HISTORY), committed.current];
        redo.current = [];
      }
      committed.current = n;
    }
  }, []);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(committed.current);
    committed.current = prev; setNet(prev); setSelection(null);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(committed.current);
    committed.current = next; setNet(next); setSelection(null);
  };

  const addBlock = (type: string, x?: number, y?: number) => {
    const taken = new Set(net.blocks.map((b) => b.id));
    let px = x, py = y;
    if (px === undefined || py === undefined) {
      // drop near the middle of what's visible, nudged so repeated clicks don't stack
      const c = center.current?.() ?? { x: 200, y: 150 };
      const k = net.blocks.filter((o) => Math.abs(o.x - (c.x - 44)) < 60 && Math.abs(o.y - (c.y - 28)) < 60).length;
      px = c.x - 44 + k * 24; py = c.y - 28 + k * 24;
    }
    const b = makeBlock(type, px, py, taken);
    update({ ...net, blocks: [...net.blocks, b] });
    setSelection({ kind: 'block', id: b.id });
  };

  const changeBlock = (id: string, patch: Partial<Block>) => {
    const blocks = net.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    update({ ...net, blocks, links: pruneLinks(blocks, net.links) });
  };

  const deleteSelection = () => {
    if (selection?.kind === 'block') {
      update({ ...net, blocks: net.blocks.filter((b) => b.id !== selection.id), links: net.links.filter((l) => l.from.block !== selection.id && l.to.block !== selection.id) });
    } else if (selection?.kind === 'link') {
      update({ ...net, links: net.links.filter((_, i) => i !== selection.index) });
    }
    setSelection(null);
  };

  const duplicate = () => {
    if (selection?.kind !== 'block') return;
    const src = net.blocks.find((b) => b.id === selection.id);
    if (!src) return;
    const b = { ...makeBlock(src.type, src.x + 24, src.y + 24, new Set(net.blocks.map((x) => x.id))), params: structuredClone(src.params) };
    update({ ...net, blocks: [...net.blocks, b] });
    setSelection({ kind: 'block', id: b.id });
  };

  const wireKey = JSON.stringify(toWire(net));
  const run = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setRunning(true);
    try {
      const r = await runSimulation(net, apiBase, ctl.signal);
      setResult(r); setResultFor(wireKey);
      onResult?.(r, net);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setResult({ ok: false, error: String(e) });
    } finally {
      if (abort.current === ctl) setRunning(false);
    }
  };

  // keyboard shortcuts (ignored while typing in a field)
  const runRef = useRef(run); runRef.current = run;
  const keysRef = useRef({ deleteSelection, doUndo, doRedo, duplicate });
  keysRef.current = { deleteSelection, doUndo, doRedo, duplicate };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); runRef.current(); return; }
      if (typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); keysRef.current.deleteSelection(); }
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); keysRef.current.doUndo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); keysRef.current.doRedo(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); keysRef.current.duplicate(); }
      else if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const issues: Issue[] = useMemo(() => {
    const raw = result && !result.ok ? result.issues ?? [] : [];
    // the server speaks in ids; show the names people see on the canvas
    return raw.map((i) => {
      let message = i.message;
      for (const b of net.blocks) if (b.name && message.includes(`"${b.id}"`)) message = message.split(`"${b.id}"`).join(`"${b.name}"`);
      return { ...i, message };
    });
  }, [result, net.blocks]);
  const errorBlocks = useMemo(() => new Set(issues.map((i) => i.block).filter(Boolean) as string[]), [issues]);
  const stale = result?.ok && resultFor !== wireKey;

  /** Name each scope trace after the block that feeds it. */
  const traceNames = (scopeId: string) => {
    const sc = net.blocks.find((b) => b.id === scopeId);
    const n = sc ? ports(sc).inputs : 1;
    return Array.from({ length: n }, (_, i) => {
      const l = net.links.find((l) => l.to.block === scopeId && l.to.port === i);
      const src = l && net.blocks.find((b) => b.id === l.from.block);
      if (!src) return `Input ${i + 1}`;
      return (src.name || src.id) + (ports(src).outputs > 1 ? ` (out ${l!.from.port + 1})` : '');
    });
  };

  const save = () => {
    const blob = new Blob([JSON.stringify(net, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(net.name || 'model').replace(/[^\w-]+/g, '_')}.fulgur.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const open = async (f: File) => {
    try {
      const n = JSON.parse(await f.text()) as Netlist;
      if (!Array.isArray(n.blocks) || !n.settings) throw new Error('not a fulgurlab model');
      n.blocks = n.blocks.filter((b) => BLOCK_MAP[b.type]).map((b) => ({ ...b, x: snap(b.x ?? 0), y: snap(b.y ?? 0), params: { ...b.params } }));
      n.links ??= [];
      load({ ...n, version: 1 });
    } catch (e) {
      setResult({ ok: false, error: `Couldn't open ${f.name}: ${(e as Error).message}` });
    }
  };

  return (
    <div className={`fulgur ${compact ? 'is-compact' : ''}`}>
      <header className="toolbar">
        <div className="brand"><span className="brand-mark" aria-hidden />fulgurlab</div>
        <span className="model-name">{net.name}</span>
        {!compact && (
          <div className="toolbar-group">
            <button type="button" onClick={() => load(emptyNetlist())}>New</button>
            <button type="button" onClick={() => fileInput.current?.click()}>Open…</button>
            <button type="button" onClick={save}>Save</button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ''; }} />
            {examples.length > 0 && (
              <select aria-label="Load an example" value="" onChange={(e) => { const ex = examples[Number(e.target.value)]; if (ex) load(structuredClone(ex.netlist)); }}>
                <option value="">Examples…</option>
                {examples.map((ex, i) => <option key={i} value={i}>{ex.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="toolbar-group">
          <button type="button" onClick={doUndo} disabled={!undo.current.length} aria-label="Undo">Undo</button>
          <button type="button" onClick={doRedo} disabled={!redo.current.length} aria-label="Redo">Redo</button>
        </div>
        <div className="toolbar-run">
          <span className="sim-time">0 → {net.settings.tf} s</span>
          <button type="button" className="primary" onClick={run} disabled={running || net.blocks.length === 0}>
            {running ? 'Simulating…' : 'Run'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <Palette onAdd={(t) => addBlock(t)} />
        <Canvas
          net={net}
          selection={selection}
          errorBlocks={errorBlocks}
          onChange={update}
          onSelect={setSelection}
          onDropType={(t, x, y) => addBlock(t, x, y)}
          loadKey={viewKey}
          centerRef={center}
        />
        <Inspector net={net} selection={selection} issues={issues} onBlockChange={changeBlock} onSettings={(p) => update({ ...net, ...p })} onDelete={deleteSelection} />
      </div>

      <section className={`results ${result ? 'has-result' : ''}`} aria-live="polite">
        {!result && !running && <p className="muted">Press Run (Ctrl+Enter) to simulate. Results from each Scope appear here.</p>}
        {running && !result && <p className="muted">Simulating with Scilab…</p>}
        {result && !result.ok && (
          <div className="sim-error" role="alert">
            <strong>{result.error}</strong>
            {result.issues && result.issues.length > 0 && <ul>{result.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
            {result.log && <details><summary>Scilab output</summary><pre>{result.log}</pre></details>}
          </div>
        )}
        {result?.ok && (
          <>
            <div className="results-meta">
              <span>Simulated in {(result.elapsedMs / 1000).toFixed(2)} s</span>
              {stale && <span className="stale">The diagram changed since this run. Run again to update.</span>}
            </div>
            <div className="scopes">
              {Object.entries(result.scopes).map(([id, tr]) => {
                const b = net.blocks.find((x) => x.id === id);
                return <ScopeChart key={id} title={b?.name || id} trace={tr} names={traceNames(id)} />;
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
