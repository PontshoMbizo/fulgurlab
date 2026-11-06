import type { Params } from '../../../shared/catalog.js';

export type { Params };

export interface PortRef { block: string; port: number }

export interface Block {
  id: string;
  type: string;
  params: Params;
  x: number;
  y: number;
  /** Display name shown under the block (editor-only; the server ignores it). */
  name?: string;
}

export interface Link { from: PortRef; to: PortRef }

export interface Settings { tf: number; dt: number }

/** The diagram format sent to the server (see docs/netlist.md). */
export interface Netlist {
  version: 1;
  name?: string;
  description?: string;
  settings: Settings;
  blocks: Block[];
  links: Link[];
}

export interface Trace { t: number[]; y: number[][] }

export interface Issue { path: string; message: string; block?: string }

export type SimResult =
  | { ok: true; scopes: Record<string, Trace>; elapsedMs: number }
  | { ok: false; error: string; issues?: Issue[]; log?: string };

export type Selection = { kind: 'block'; id: string } | { kind: 'link'; index: number } | null;
