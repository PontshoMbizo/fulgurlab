// Standalone app around <FulgurEditor>. Also works inside an <iframe>:
//   ?embed=1            compact chrome (no file/example controls)
//   ?api=https://host   simulation server origin (default: same origin)
//   postMessage in:  { type: 'fulgurlab:load', netlist }
//   postMessage out: { type: 'fulgurlab:ready' } | { type: 'fulgurlab:change', netlist }
//                    | { type: 'fulgurlab:result', result, netlist }
import { useEffect, useMemo, useState } from 'react';
import { FulgurEditor } from './editor/FulgurEditor';
import type { Netlist } from './editor/types';

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

export function App() {
  const first = useMemo(restore, []);
  const [incoming, setIncoming] = useState<{ net: Netlist; key: number }>({ net: first, key: 0 });

  useEffect(() => {
    if (!embedded) return;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data;
      if (d && d.type === 'fulgurlab:load' && d.netlist) setIncoming((p) => ({ net: d.netlist as Netlist, key: p.key + 1 }));
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: 'fulgurlab:ready' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  return (
    <FulgurEditor
      initial={incoming.net}
      loadKey={incoming.key}
      apiBase={apiBase}
      compact={embedded}
      examples={embedded ? [] : EXAMPLES}
      onChange={(net) => {
        if (embedded) window.parent.postMessage({ type: 'fulgurlab:change', netlist: net }, '*');
        else { try { localStorage.setItem(STORE, JSON.stringify(net)); } catch { /* storage unavailable */ } }
      }}
      onResult={(result, netlist) => { if (embedded) window.parent.postMessage({ type: 'fulgurlab:result', result, netlist }, '*'); }}
    />
  );
}
