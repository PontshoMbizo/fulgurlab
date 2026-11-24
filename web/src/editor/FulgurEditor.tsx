import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BLOCK_MAP, LIMITS } from '../../../shared/catalog.js';
import type { Block, Issue, Netlist, Selection, SimResult } from './types';
import { Canvas, type CanvasControls } from './Canvas';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { downloadCsv } from './ScopeChart';
import { ScopePanel } from './ScopePanel';
import { MenuBar, type MenuDef } from './Menus';
import * as I from './Icons';
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
  const canvasControls = useRef<CanvasControls | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLibrary, setShowLibrary] = useState(true);
  const [scopePopped, setScopePopped] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** the model as last loaded or saved, to mark unsaved changes with * */
  const [savedNet, setSavedNet] = useState(net);
  const dirty = net !== savedNet;

  const load = useCallback((n: Netlist) => {
    setNet(n); setSavedNet(n); committed.current = n; undo.current = []; redo.current = [];
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

  const stop = () => { abort.current?.abort(); abort.current = null; setRunning(false); };

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
    setSavedNet(net);
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

  const hasScopes = !!result?.ok && Object.keys(result.scopes).length > 0;
  const exportCsv = () => {
    if (!result?.ok) return;
    for (const [id, tr] of Object.entries(result.scopes)) downloadCsv(net.blocks.find((x) => x.id === id)?.name || id, traceNames(id), tr);
  };
  const canRun = !running && net.blocks.length > 0;
  const chooseFile = () => fileInput.current?.click();
  const loadExample = (i: number) => { const ex = examples[i]; if (ex) load(structuredClone(ex.netlist)); };

  const menus: MenuDef[] = [
    { label: 'File', mnemonic: 0, items: [
      { label: 'New', onSelect: () => load(emptyNetlist()) },
      { label: 'Open…', onSelect: chooseFile },
      { label: 'Save', onSelect: save },
    ] },
    { label: 'Edit', mnemonic: 0, items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !undo.current.length, onSelect: doUndo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !redo.current.length, onSelect: doRedo },
      { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: selection?.kind !== 'block', onSelect: duplicate },
      { label: 'Delete', shortcut: 'Del', disabled: !selection, onSelect: deleteSelection },
    ] },
    { label: 'View', mnemonic: 0, items: [
      { label: 'Zoom in', onSelect: () => canvasControls.current?.zoomIn() },
      { label: 'Zoom out', onSelect: () => canvasControls.current?.zoomOut() },
      { label: 'Fit', onSelect: () => canvasControls.current?.fit() },
      { label: 'Library', checked: showLibrary, onSelect: () => setShowLibrary((v) => !v) },
      { label: scopePopped ? 'Dock Scope' : 'Pop out Scope', onSelect: () => setScopePopped((v) => !v) },
    ] },
    { label: 'Simulation', mnemonic: 0, items: [
      { label: 'Run', shortcut: 'Ctrl+Enter', disabled: !canRun, onSelect: run },
      { label: 'Stop', disabled: !running, onSelect: stop },
      { label: 'Model settings…', onSelect: () => setSelection(null) },
    ] },
    ...(examples.length ? [{ label: 'Examples', mnemonic: 1, items: examples.map((ex, i) => ({ label: ex.name, onSelect: () => loadExample(i) })) }] : []),
    { label: 'Help', mnemonic: 0, items: [{ label: 'Keyboard shortcuts', onSelect: () => setHelpOpen(true) }] },
  ];

  const status = running ? 'Simulating…'
    : result && !result.ok ? result.error
    : stale ? 'The diagram changed since this run. Run again to update.'
    : 'Ready';
  const tb = (label: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => (
    <button type="button" className="tb" aria-label={label} title={label} onClick={onClick} disabled={opts.disabled} aria-pressed={opts.pressed}>{icon}</button>
  );

  return (
    <div className={`fulgur ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <div className="menubar">
          <div className="brand"><I.BrandMark />fulgurlab</div>
          <MenuBar menus={menus} />
          <span className="model-name" title={net.name}>{net.name}{dirty ? ' *' : ''}</span>
        </div>
      )}

      <div className="toolbar" role="toolbar" aria-label="Model toolbar">
        {!compact && (
          <>
            {tb('New model', <I.IconNew />, () => load(emptyNetlist()))}
            {tb('Open model', <I.IconOpen />, chooseFile)}
            {tb('Save model', <I.IconSave />, save)}
            <span className="tb-sep" aria-hidden />
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ''; }} />
          </>
        )}
        {tb('Undo', <I.IconUndo />, doUndo, { disabled: !undo.current.length })}
        {tb('Redo', <I.IconRedo />, doRedo, { disabled: !redo.current.length })}
        <span className="tb-sep" aria-hidden />
        {tb('Library browser', <I.IconLibrary />, () => setShowLibrary((v) => !v), { pressed: showLibrary })}
        {tb('Model settings', <I.IconSettings />, () => setSelection(null))}
        <span className="tb-sep" aria-hidden />
        <button type="button" className="run-btn" aria-label="Run simulation (Ctrl+Enter)" title="Run (Ctrl+Enter)" onClick={run} disabled={!canRun}><I.IconRun /></button>
        {tb('Stop simulation', <I.IconStop />, stop, { disabled: !running })}
        <span className="tb-sep" aria-hidden />
        <NumberField
          label="Stop time" unit="s" aria="Stop time in seconds" width={64}
          value={net.settings.tf}
          valid={(v) => v > 0 && v <= LIMITS.maxTf}
          onCommit={(v) => update({ ...net, settings: { ...net.settings, tf: v } })}
        />
        <NumberField
          label="Step" aria="Scope sample step in seconds" width={52}
          value={net.settings.dt}
          valid={(v) => v >= LIMITS.minDt}
          onCommit={(v) => update({ ...net, settings: { ...net.settings, dt: v } })}
        />
        <label className="tb-field">
          <span>Solver</span>
          <select aria-label="Solver" disabled value="lsodar" onChange={() => undefined}>
            <option value="lsodar">LSODAR (auto)</option>
          </select>
        </label>
        <span className="tb-sep" aria-hidden />
        {tb(scopePopped ? 'Dock scope' : 'Open scope', <I.IconScope />, () => setScopePopped((v) => !v), { pressed: scopePopped })}
        {tb('Export CSV', <I.IconDownload />, exportCsv, { disabled: !hasScopes })}
      </div>

      {!compact && (
        <>
          <div className="tabstrip" role="tablist" aria-label="Open models">
            <div className="tab is-active" role="tab" aria-selected="true" tabIndex={0}>{net.name}{dirty ? ' *' : ''}</div>
          </div>
          <div className="pathbar">
            <button type="button" className="tb tb-small" aria-label={showLibrary ? 'Hide library' : 'Show library'} title={showLibrary ? 'Hide library' : 'Show library'} onClick={() => setShowLibrary((v) => !v)}>
              <span className={showLibrary ? '' : 'flip'}><I.IconChevronLeft /></span>
            </button>
            <div className="path"><I.BrandMark size={14} /><span>{net.name}</span></div>
          </div>
        </>
      )}

      <div className={`workspace ${showLibrary ? '' : 'no-library'}`}>
        {showLibrary && <Palette onAdd={(t) => addBlock(t)} />}
        <Canvas
          net={net}
          selection={selection}
          errorBlocks={errorBlocks}
          onChange={update}
          onSelect={setSelection}
          onDropType={(t, x, y) => addBlock(t, x, y)}
          loadKey={viewKey}
          centerRef={center}
          controlsRef={canvasControls}
          onZoom={setZoom}
        />
        <Inspector net={net} selection={selection} issues={issues} onBlockChange={changeBlock} onSettings={(p) => update({ ...net, ...p })} onDelete={deleteSelection} onClose={() => setSelection(null)} />
      </div>

      {(!result || !result.ok || Object.keys(result.scopes).length === 0) && (
        <section className="results" aria-live="polite">
          {!result && !running && <p className="muted">Press Run (Ctrl+Enter) to simulate. Results from each Scope appear here.</p>}
          {running && !result && <p className="muted">Simulating with Scilab…</p>}
          {result && !result.ok && (
            <div className="sim-error" role="alert">
              <strong>{result.error}</strong>
              {result.issues && result.issues.length > 0 && <ul>{result.issues.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
              {result.log && <details><summary>Scilab output</summary><pre>{result.log}</pre></details>}
            </div>
          )}
          {result?.ok && <p className="muted">The diagram ran, but it has no Scope block to plot.</p>}
        </section>
      )}
      {result?.ok && Object.keys(result.scopes).length > 0 && (
        <ScopePanel
          scopes={Object.entries(result.scopes).map(([id, trace]) => ({ id, title: net.blocks.find((x) => x.id === id)?.name || id, names: traceNames(id), trace }))}
          tf={net.settings.tf}
          popped={scopePopped}
          onTogglePop={() => setScopePopped((v) => !v)}
        />
      )}

      <footer className="statusbar" role="status">
        <span className={`status-main ${result && !result.ok ? 'is-error' : ''}`}>{status}</span>
        {result?.ok && <span className="status-cell">Simulated in {(result.elapsedMs / 1000).toFixed(2)} s</span>}
        <span className="status-cell">{Math.round(zoom * 100)}%</span>
        <span className="status-cell mono">T={net.settings.tf.toFixed(3)}</span>
        <span className="status-cell status-solver">LSODAR</span>
      </footer>

      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/** Mono, right-aligned number input that commits a valid draft on blur or Enter. */
function NumberField({ label, unit, aria, width, value, valid, onCommit }: {
  label: string; unit?: string; aria: string; width: number; value: number;
  valid: (v: number) => boolean; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const v = Number(draft);
  const ok = draft.trim() !== '' && Number.isFinite(v) && valid(v);
  const commit = () => { if (ok && v !== value) onCommit(v); else if (!ok) setDraft(String(value)); };
  return (
    <label className="tb-field">
      <span>{label}</span>
      <input
        className="num"
        style={{ width }}
        value={draft}
        aria-label={aria}
        aria-invalid={!ok}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(String(value)); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {unit && <span>{unit}</span>}
    </label>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl+Enter', 'Run the simulation'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+D', 'Duplicate the selected block'],
  ['Delete / Backspace', 'Delete the selection'],
  ['Escape', 'Clear the selection'],
  ['Mouse wheel', 'Zoom the diagram'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); }, []);
  return (
    <div className="dialog-scrim" onPointerDown={onClose}>
      <div
        className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      >
        <div className="dialog-title">Keyboard shortcuts</div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => (<div key={k}><dt>{k}</dt><dd>{d}</dd></div>))}
        </dl>
        <div className="dialog-buttons"><button type="button" className="btn is-default" ref={ok} onClick={onClose}>OK</button></div>
      </div>
    </div>
  );
}
