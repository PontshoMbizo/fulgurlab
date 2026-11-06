import { useEffect, useState } from 'react';
import { BLOCK_MAP, LIMITS, type Param } from '../../../shared/catalog.js';
import type { Block, Issue, Netlist, Selection } from './types';
import { formatVector, parseVector } from './model';

interface Props {
  net: Netlist;
  selection: Selection;
  issues: Issue[];
  onBlockChange: (id: string, patch: Partial<Block>) => void;
  onSettings: (patch: Partial<Netlist>) => void;
  onDelete: () => void;
}

/** Text field that keeps a draft while typing and commits on blur / Enter. */
function Field({ label, value, parse, onCommit, hint, id }: {
  label: string; value: string; id: string; hint?: string;
  parse: (s: string) => { ok: true; v: unknown } | { ok: false; msg: string };
  onCommit: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const r = parse(draft);
  const commit = () => { if (r.ok && draft !== value) onCommit(r.v); };
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={draft}
        aria-invalid={!r.ok}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { commit(); if (!r.ok) setDraft(value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setDraft(value); }}
      />
      {!r.ok ? <small className="field-error">{r.msg}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

const numParse = (s: string) => {
  const v = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(v) ? { ok: true as const, v } : { ok: false as const, msg: 'Enter a number' };
};

function paramParser(p: Param) {
  switch (p.kind) {
    case 'number': return numParse;
    case 'int': return (s: string) => {
      const v = Number(s);
      return Number.isInteger(v) && v >= (p.min ?? -Infinity) && v <= (p.max ?? Infinity)
        ? { ok: true as const, v } : { ok: false as const, msg: `Whole number from ${p.min} to ${p.max}` };
    };
    case 'vector': return (s: string) => {
      const v = parseVector(s);
      return v && v.length <= LIMITS.maxVector ? { ok: true as const, v } : { ok: false as const, msg: 'Numbers separated by spaces, e.g. [1 2 1]' };
    };
    case 'signs': return (s: string) => {
      const t = s.replace(/\s/g, '');
      return new RegExp(`^[${p.alphabet!.replace(/[-]/g, '\\-')}]{1,8}$`).test(t)
        ? { ok: true as const, v: t } : { ok: false as const, msg: `1–8 of ${[...p.alphabet!].join(' ')}` };
    };
  }
}

function show(p: Param, v: unknown) {
  return p.kind === 'vector' ? formatVector(v as number[]) : String(v);
}

export function Inspector({ net, selection, issues, onBlockChange, onSettings, onDelete }: Props) {
  if (selection?.kind === 'block') {
    const b = net.blocks.find((x) => x.id === selection.id);
    if (!b) return null;
    const def = BLOCK_MAP[b.type];
    const mine = issues.filter((i) => i.block === b.id);
    return (
      <aside className="inspector" aria-label="Block properties">
        <h2>{def.label}</h2>
        <p className="muted">{def.description}</p>
        <Field id="f-name" label="Name" value={b.name ?? ''} parse={(s) => ({ ok: true, v: s })} onCommit={(v) => onBlockChange(b.id, { name: String(v) })} />
        {def.params.map((p) => (
          <Field
            key={`${b.id}-${p.key}`}
            id={`f-${p.key}`}
            label={p.label}
            hint={p.hint}
            value={show(p, b.params[p.key])}
            parse={paramParser(p)}
            onCommit={(v) => onBlockChange(b.id, { params: { ...b.params, [p.key]: v as number } })}
          />
        ))}
        {mine.length > 0 && (
          <ul className="issues" aria-label="Problems with this block">
            {mine.map((i, k) => <li key={k}>{i.message}</li>)}
          </ul>
        )}
        <button type="button" className="danger" onClick={onDelete}>Delete block</button>
      </aside>
    );
  }
  if (selection?.kind === 'link') {
    const l = net.links[selection.index];
    if (!l) return null;
    const name = (id: string) => net.blocks.find((b) => b.id === id)?.name ?? id;
    return (
      <aside className="inspector" aria-label="Wire properties">
        <h2>Wire</h2>
        <p className="muted">From {name(l.from.block)}, output {l.from.port + 1}, to {name(l.to.block)}, input {l.to.port + 1}.</p>
        <button type="button" className="danger" onClick={onDelete}>Delete wire</button>
      </aside>
    );
  }
  const general = issues.filter((i) => !i.block);
  return (
    <aside className="inspector" aria-label="Model settings">
      <h2>Model</h2>
      <Field id="f-model" label="Name" value={net.name ?? ''} parse={(s) => ({ ok: true, v: s })} onCommit={(v) => onSettings({ name: String(v) })} />
      <Field id="f-tf" label="Stop time (s)" value={String(net.settings.tf)} parse={(s) => {
        const r = numParse(s); return r.ok && (r.v as number) > 0 && (r.v as number) <= LIMITS.maxTf ? r : { ok: false, msg: `Between 0 and ${LIMITS.maxTf}` };
      }} onCommit={(v) => onSettings({ settings: { ...net.settings, tf: v as number } })} />
      <Field id="f-dt" label="Scope sample step (s)" hint="How often scopes record. The solver picks its own internal steps." value={String(net.settings.dt)} parse={(s) => {
        const r = numParse(s); return r.ok && (r.v as number) >= LIMITS.minDt ? r : { ok: false, msg: `At least ${LIMITS.minDt}` };
      }} onCommit={(v) => onSettings({ settings: { ...net.settings, dt: v as number } })} />
      {net.description && <p className="muted">{net.description}</p>}
      {general.length > 0 && <ul className="issues">{general.map((i, k) => <li key={k}>{i.message}</li>)}</ul>}
      <p className="muted small">Select a block to edit it. Delete removes the selection; Ctrl+Z undoes; Ctrl+Enter runs.</p>
    </aside>
  );
}
