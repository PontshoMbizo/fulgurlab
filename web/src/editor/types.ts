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
  /** The nested diagram of a subsystem block. */
  system?: Level;
  /** Fixed by a problem author (editor-only; the server ignores it). With `enforceLocks` the
   * block can be moved and wired but not deleted, renamed into another type or re-parameterised. */
  locked?: boolean;
}

/** One level of the diagram: the top level, or what is inside a subsystem. */
export interface Level { blocks: Block[]; links: Link[] }

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

export type Selection = { kind: 'block'; id: string } | { kind: 'blocks'; ids: string[] } | { kind: 'link'; index: number } | null;
