import { useState } from 'react';
import { BLOCK_MAP, LIMITS, type Param } from '../../../shared/catalog.js';
import type { Block, Issue, Netlist, Selection } from './types';
import { formatMatrix, formatVector, parseMatrix, parseVector, ports } from './model';

interface Props {
  net: Netlist;
  selection: Selection;
  issues: Issue[];
  onBlockChange: (id: string, patch: Partial<Block>) => void;
  onSettings: (patch: Partial<Netlist>) => void;
  onDelete: () => void;
  /** present when the selection can be grouped into a subsystem */
  onGroup?: () => void;
  /** OK: apply, then drop the selection */
  onClose: () => void;
}

type Parsed = { ok: true; v: unknown } | { ok: false; msg: string };
interface FieldDef {
  key: string; label: string; value: string; hint?: string; text?: boolean;
  parse: (s: string) => Parsed;
}

const HELP_URL = 'https://github.com/PontshoMbizo/fulgurlab/blob/master/docs/blocks.md';

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
    case 'matrix': return (s: string) => {
      const v = parseMatrix(s);
      return v && v.length <= LIMITS.maxVector && v[0].length <= LIMITS.maxVector
        ? { ok: true as const, v } : { ok: false as const, msg: 'Rows separated by ;, e.g. 0 1; -2 -3' };
    };
    case 'expr': return (s: string) => {
      const t = s.trim();
      return t && t.length <= 200 ? { ok: true as const, v: t } : { ok: false as const, msg: 'Enter an expression, up to 200 characters' };
    };
    case 'signs': return (s: string) => {
      const t = s.replace(/\s/g, '');
      return new RegExp(`^[${p.alphabet!.replace(/[-]/g, '\\-')}]{1,8}$`).test(t)
        ? { ok: true as const, v: t } : { ok: false as const, msg: `1–8 of ${[...p.alphabet!].join(' ')}` };
    };
  }
}

function show(p: Param, v: unknown) {
  if (p.kind === 'matrix') return formatMatrix(v as number[][]);
  return p.kind === 'vector' ? formatVector(v as number[]) : String(v);
}


/**
 * Block Parameters dialog: grey panel, etched fieldsets, OK / Cancel / Help / Apply.
 * Fields keep drafts; Apply commits every valid one as a single undo step.
 */
function ParamsPanel({ title, ariaLabel, legend, description, fields, ports, issues, onApply, onOk, onDelete, deleteLabel, help }: {
  title: string; ariaLabel: string; legend: string; description?: string;
  fields: FieldDef[]; ports?: string; issues: Issue[];
  onApply: (values: Record<string, unknown>) => void; onOk: () => void;
  onDelete?: () => void; deleteLabel?: string; help?: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const shown = (f: FieldDef) => drafts[f.key] ?? f.value;
  const results = fields.map((f) => ({ f, r: f.parse(shown(f)), changed: shown(f) !== f.value }));
  const invalid = results.some((x) => x.changed && !x.r.ok);
  const pending = results.some((x) => x.changed);

  const apply = () => {
    const values: Record<string, unknown> = {};
    for (const x of results) if (x.changed && x.r.ok) values[x.f.key] = x.r.v;
    if (Object.keys(values).length) onApply(values);
    // fields that were applied drop their draft; invalid ones keep theirs
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !(k in values))));
  };
  const ok = () => { apply(); if (!invalid) onOk(); };
  const cancel = () => setDrafts({});

  return (
    <aside
      className="inspector" aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); ok(); }
        else if (e.key === 'Escape' && pending) { e.stopPropagation(); cancel(); }
      }}
    >
      <div className="panel-title">{title}</div>
      <div className="inspector-body">
        <fieldset className="etched">
          <legend>{legend}</legend>
          {description && <p className="muted">{description}</p>}
        </fieldset>
        <fieldset className="etched">
          <legend>Parameters</legend>
          {results.map(({ f, r }) => {
            const id = `f-${f.key}`;
            return (
              <div className="param" key={f.key}>
                <label htmlFor={id}>{f.label}</label>
                <input
                  id={id}
                  className={f.text ? 'is-text' : 'num'}
                  value={shown(f)}
                  aria-invalid={!r.ok}
                  aria-describedby={!r.ok || f.hint ? `${id}-note` : undefined}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                />
                {(!r.ok || f.hint) && <small id={`${id}-note`} className={!r.ok ? 'field-error' : undefined}>{r.ok ? f.hint : r.msg}</small>}
              </div>
            );
          })}
        </fieldset>
        {ports && (
          <fieldset className="etched">
            <legend>Ports</legend>
            <p className="muted">{ports}</p>
          </fieldset>
        )}
        {issues.length > 0 && (
          <ul className="issues" aria-label="Problems">
            {issues.map((i, k) => <li key={k}>{i.message}</li>)}
          </ul>
        )}
      </div>
      <div className="dialog-buttons inspector-buttons">
        {onDelete && <button type="button" className="btn btn-delete" onClick={onDelete}>{deleteLabel}</button>}
        <button type="button" className="btn is-default" onClick={ok}>OK</button>
        <button type="button" className="btn" onClick={cancel} disabled={!pending}>Cancel</button>
        {help && <button type="button" className="btn" onClick={() => window.open(HELP_URL, '_blank', 'noopener')}>Help</button>}
        <button type="button" className="btn" onClick={apply} disabled={!pending}>Apply</button>
      </div>
    </aside>
  );
}

function portSummary(net: Netlist, b: Block, inputs: number, outputs: number) {
  const fed = new Set(net.links.filter((l) => l.to.block === b.id).map((l) => l.to.port)).size;
  const out = net.links.filter((l) => l.from.block === b.id).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ins = inputs ? `${plural(inputs, 'input')} (${fed} connected)` : 'no inputs';
  const outs = outputs ? `${plural(outputs, 'output')} (${plural(out, 'wire')})` : 'no outputs';
  return `${ins}, ${outs}.`;
}

export function Inspector({ net, selection, issues, onBlockChange, onSettings, onDelete, onGroup, onClose }: Props) {
  if (selection?.kind === 'blocks') {
    return (
      <aside className="inspector" aria-label="Selection">
        <div className="panel-title">{selection.ids.length} blocks selected</div>
        <div className="inspector-body">
          <fieldset className="etched">
            <legend>Selection</legend>
            <p className="muted">Drag to move them together. Select a single block to edit its parameters.</p>
          </fieldset>
        </div>
        <div className="dialog-buttons inspector-buttons">
          {onGroup && <button type="button" className="btn" onClick={onGroup}>Group</button>}
          <button type="button" className="btn btn-delete" onClick={onDelete}>Delete</button>
        </div>
      </aside>
    );
  }
  if (selection?.kind === 'block') {
    const b = net.blocks.find((x) => x.id === selection.id);
    if (!b) return null;
    const def = BLOCK_MAP[b.type];
    const { inputs, outputs } = ports(b);
    const fields: FieldDef[] = [
      { key: 'name', label: 'Name', value: b.name ?? '', text: true, parse: (s) => ({ ok: true, v: s }) },
      ...def.params.map((p): FieldDef => ({ key: `p:${p.key}`, label: p.label, hint: p.hint, value: show(p, b.params[p.key]), text: p.kind === 'expr' || p.kind === 'matrix', parse: paramParser(p) })),
    ];
    return (
      <ParamsPanel
        key={`${b.id}|${b.name}|${JSON.stringify(b.params)}`}
        title={`Block Parameters: ${b.name || def.label}`}
        ariaLabel="Block properties"
        legend={def.label}
        description={def.description}
        fields={fields}
        ports={portSummary(net, b, inputs, outputs)}
        issues={issues.filter((i) => i.block === b.id)}
        onApply={(v) => {
          const params = { ...b.params };
          for (const [k, val] of Object.entries(v)) if (k.startsWith('p:')) params[k.slice(2)] = val as number;
          onBlockChange(b.id, { ...('name' in v ? { name: String(v.name) } : {}), params });
        }}
        onOk={onClose}
        onDelete={onDelete}
        deleteLabel="Delete"
        help
      />
    );
  }
  if (selection?.kind === 'link') {
    const l = net.links[selection.index];
    if (!l) return null;
    const name = (id: string) => net.blocks.find((b) => b.id === id)?.name ?? id;
    return (
      <aside className="inspector" aria-label="Wire properties">
        <div className="panel-title">Wire</div>
        <div className="inspector-body">
          <fieldset className="etched">
            <legend>Connection</legend>
            <p className="muted">From {name(l.from.block)}, output {l.from.port + 1}, to {name(l.to.block)}, input {l.to.port + 1}.</p>
          </fieldset>
        </div>
        <div className="dialog-buttons inspector-buttons">
          <button type="button" className="btn btn-delete" onClick={onDelete}>Delete</button>
        </div>
      </aside>
    );
  }
  const general = issues.filter((i) => !i.block);
  const fields: FieldDef[] = [
    { key: 'name', label: 'Name', value: net.name ?? '', text: true, parse: (s) => ({ ok: true, v: s }) },
    {
      key: 'tf', label: 'Stop time (s)', value: String(net.settings.tf),
      parse: (s) => { const r = numParse(s); return r.ok && (r.v as number) > 0 && (r.v as number) <= LIMITS.maxTf ? r : { ok: false, msg: `Between 0 and ${LIMITS.maxTf}` }; },
    },
    {
      key: 'dt', label: 'Sample step (s)', value: String(net.settings.dt), hint: 'How often scopes record. The solver picks its own internal steps.',
      parse: (s) => { const r = numParse(s); return r.ok && (r.v as number) >= LIMITS.minDt ? r : { ok: false, msg: `At least ${LIMITS.minDt}` }; },
    },
  ];
  return (
    <ParamsPanel
      key={`model|${net.name}|${net.settings.tf}|${net.settings.dt}`}
      title="Model Configuration"
      ariaLabel="Model settings"
      legend="Model"
      description={net.description ?? 'Select a block to edit it. Ctrl+Enter runs the simulation.'}
      fields={fields}
      issues={general}
      onApply={(v) => onSettings({
        ...('name' in v ? { name: String(v.name) } : {}),
        settings: { tf: ('tf' in v ? (v.tf as number) : net.settings.tf), dt: ('dt' in v ? (v.dt as number) : net.settings.dt) },
      })}
      onOk={() => undefined}
    />
  );
}
