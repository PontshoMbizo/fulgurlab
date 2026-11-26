// postMessage bridge to scope.io (and any other host that embeds the editor in an iframe).
//
// scope.io's protocol, shared with its other embedded simulators (fpgasim, mcusim, fulgurspice):
//   host -> sim  { type: 'scopeio:init', protocol: 2, mode, starterCode, config }
//   sim  -> host { type: 'scopeio:ready' }                 once the listener is registered
//                { type: 'scopeio:change', code }          debounced, so the host can keep a draft
//                { type: 'scopeio:result', payload }       when the host's action button is pressed
// mode: 'export' (author the starter: "Save starter"), 'capture' (run the reference: "Capture golden"),
// 'solve' (a learner: "Submit"). `starterCode` is the diagram as a JSON string; `config` holds
// { lockSettings?, theme? }.
//
// The older generic messages (docs/embedding.md) still work:
//   host -> sim  { type: 'fulgurlab:load', netlist }
//   sim  -> host { type: 'fulgurlab:ready' } | { type: 'fulgurlab:change', netlist } | { type: 'fulgurlab:result', result, netlist }
//
// Only the data-free ready messages go to '*'. Everything that carries a diagram or a result goes to
// the origin that last sent init or load, so a page that frames the editor without talking to it
// learns nothing.

import type { Netlist, SimResult } from './editor/types';

export type Mode = 'export' | 'capture' | 'solve';

export interface InitMessage {
  mode: Mode;
  /** The diagram as JSON text ('' = start empty). */
  starterCode: string;
  config: { lockSettings?: boolean; theme?: 'auto' | 'light' };
}

export interface ResultPayload {
  /** The diagram as JSON text: what the host stores and, for grading, re-simulates. */
  code: string;
  ok: boolean;
  /** Human-readable failure text (error, issues, Scilab output), for the host to show. */
  log?: string;
  /** capture mode only: the traces, so the host can store a golden without simulating itself. */
  scopes?: Record<string, { t: number[]; y: number[][] }>;
}

let hostOrigin: string | null = null;

const inFrame = () => typeof window !== 'undefined' && window.parent !== window;

export function announceReady() {
  if (!inFrame()) return;
  window.parent.postMessage({ type: 'scopeio:ready' }, '*');
  window.parent.postMessage({ type: 'fulgurlab:ready' }, '*');
}

const MODES: Mode[] = ['export', 'capture', 'solve'];

/** Listen for the host. Returns the unsubscribe function. */
export function listen(handlers: { onInit: (m: InitMessage) => void; onLoad: (net: Netlist) => void }) {
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'scopeio:init') {
      hostOrigin = e.origin;
      handlers.onInit({
        mode: MODES.includes(d.mode) ? d.mode : 'solve',
        starterCode: typeof d.starterCode === 'string' ? d.starterCode : '',
        config: d.config && typeof d.config === 'object' ? d.config : {},
      });
    } else if (d.type === 'fulgurlab:load' && d.netlist) {
      hostOrigin = e.origin;
      handlers.onLoad(d.netlist as Netlist);
    }
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

function post(msg: unknown) {
  if (!hostOrigin || !inFrame()) return;
  window.parent.postMessage(msg, hostOrigin);
}

let changeTimer: ReturnType<typeof setTimeout> | undefined;
/** Tell the host the diagram changed: the generic message at once, scope.io's debounced. */
export function sendChange(net: Netlist, scopeio: boolean) {
  post({ type: 'fulgurlab:change', netlist: net });
  if (!scopeio) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => post({ type: 'scopeio:change', code: JSON.stringify(net) }), 800);
}

export function sendRunResult(result: SimResult, net: Netlist) {
  post({ type: 'fulgurlab:result', result, netlist: net });
}

export function sendResult(payload: ResultPayload) {
  clearTimeout(changeTimer);
  post({ type: 'scopeio:result', payload });
}

/** Failure text for the host: the error, then each issue, then Scilab's output. */
export function failureLog(r: SimResult): string | undefined {
  if (r.ok) return undefined;
  return [r.error, ...(r.issues ?? []).map((i) => `- ${i.message}`), r.log ? `\nScilab output:\n${r.log}` : '']
    .filter(Boolean).join('\n');
}

/** Parse starter code; '' or bad JSON gives null. */
export function parseNetlist(code: string): Netlist | null {
  if (!code.trim()) return null;
  try {
    const n = JSON.parse(code) as Netlist;
    return n && Array.isArray(n.blocks) && n.settings ? n : null;
  } catch {
    return null;
  }
}
