import type { Netlist, SimResult } from './types';
import { toWire } from './model';

/** POST the diagram to the simulation server. `apiBase` is '' for same-origin. */
export async function runSimulation(net: Netlist, apiBase = '', signal?: AbortSignal): Promise<SimResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toWire(net)),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { ok: false, error: `Can't reach the simulation server at ${apiBase || window.location.origin}. Start it with "npm run dev" in server/.` };
  }
  try {
    return (await res.json()) as SimResult;
  } catch {
    return { ok: false, error: `The server answered ${res.status} without a result.` };
  }
}
