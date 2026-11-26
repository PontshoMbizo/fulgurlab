// Standalone app around <FulgurEditor>. Also works inside an <iframe>:
//   ?embed=1            compact chrome (no file/example controls)
//   ?api=https://host   simulation server origin (default: same origin)
// The postMessage protocols (scope.io's scopeio:* and the generic fulgurlab:*) are in scopeio.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FulgurEditor } from './editor/FulgurEditor';
import { emptyNetlist, normalizeLevel } from './editor/model';
import type { Netlist } from './editor/types';
import { announceReady, failureLog, listen, parseNetlist, sendChange, sendResult, sendRunResult, type InitMessage, type Mode } from './scopeio';

const exampleFiles = import.meta.glob('../../examples/*.json', { eager: true, import: 'default' }) as Record<string, Netlist>;
const EXAMPLES = Object.values(exampleFiles)
  .map((n) => ({ name: n.name ?? 'Example', netlist: n }))
  .sort((a, b) => a.name.localeCompare(b.name));

const params = new URLSearchParams(window.location.search);
const embedded = params.get('embed') === '1' || window.parent !== window;
const apiBase = (params.get('api') || '').replace(/\/$/, '');
const STORE = 'fulgurlab:autosave';

function restore(): Netlist {
  if (!embedded) {
    try {
      const s = localStorage.getItem(STORE);
      if (s) return JSON.parse(s) as Netlist;
    } catch { /* storage unavailable */ }
  }
  return structuredClone((EXAMPLES.find((e) => e.name.startsWith('PID')) ?? EXAMPLES[0]).netlist);
}

const ACTION: Record<Mode, { label: string; run: boolean }> = {
  export: { label: 'Save starter', run: false },
  capture: { label: 'Capture golden', run: true },
  solve: { label: 'Submit', run: true },
};

const tidy = (n: Netlist): Netlist => ({ ...n, ...normalizeLevel(n), version: 1 });

export function App() {
  const first = useMemo(restore, []);
  const [incoming, setIncoming] = useState<{ net: Netlist; key: number }>({ net: first, key: 0 });
  /** set once scope.io has sent scopeio:init */
  const [host, setHost] = useState<InitMessage | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!embedded) return;
    const off = listen({
      onInit: (m) => {
        setHost(m);
        // the host may send init more than once (on our ready and on iframe load): seed only once
        if (seeded.current) return;
        seeded.current = true;
        const net = parseNetlist(m.starterCode) ?? emptyNetlist();
        setIncoming((p) => ({ net: tidy(net), key: p.key + 1 }));
      },
      onLoad: (net) => setIncoming((p) => ({ net: tidy(net), key: p.key + 1 })),
    });
    announceReady();
    return off;
  }, []);

  const mode = host?.mode;
  return (
    <FulgurEditor
      initial={incoming.net}
      loadKey={incoming.key}
      apiBase={apiBase}
      compact={embedded}
      examples={embedded ? [] : EXAMPLES}
      action={mode ? ACTION[mode] : undefined}
      enforceLocks={mode === 'solve'}
      canLock={mode === 'export' || mode === 'capture'}
      lockSettings={host?.config.lockSettings ?? mode === 'solve'}
      theme={host?.config.theme ?? 'auto'}
      onChange={(net) => {
        if (embedded) sendChange(net, !!host);
        else { try { localStorage.setItem(STORE, JSON.stringify(net)); } catch { /* storage unavailable */ } }
      }}
      onResult={(result, netlist) => { if (embedded) sendRunResult(result, netlist); }}
      onAction={(net, result) => {
        const code = JSON.stringify(net);
        if (!result) { sendResult({ code, ok: true }); return; }
        sendResult({
          code,
          ok: result.ok,
          log: failureLog(result),
          ...(mode === 'capture' && result.ok ? { scopes: result.scopes } : {}),
        });
      }}
    />
  );
}
