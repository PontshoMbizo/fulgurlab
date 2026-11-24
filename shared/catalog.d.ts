// Types for shared/catalog.js (plain ESM so the Node server can import it without a build).
export type ParamKind = 'number' | 'vector' | 'signs' | 'int' | 'matrix' | 'expr';
export interface Param {
  key: string;
  label: string;
  kind: ParamKind;
  default: number | number[] | number[][] | string;
  min?: number;
  max?: number;
  alphabet?: string;
  hint?: string;
}
export type Params = Record<string, number | number[] | number[][] | string>;
export interface BlockDef {
  type: string;
  label: string;
  category: string;
  description: string;
  params: Param[];
  inputs: (p: Params) => number;
  outputs: (p: Params) => number;
}
export const BLOCKS: BlockDef[];
export const BLOCK_MAP: Record<string, BlockDef>;
export const CATEGORIES: string[];
export function defaultParams(type: string): Params;
export interface NestedBlock { id: string; type: string; params?: Params; system?: NestedSystem }
export interface NestedSystem { blocks: NestedBlock[]; links: unknown[] }
export function systemPorts(system?: { blocks?: NestedBlock[] } | null): { inports: NestedBlock[]; outports: NestedBlock[] };
export function portCounts(type: string, params?: Params, system?: { blocks?: NestedBlock[] } | null): { inputs: number; outputs: number };
export const LIMITS: {
  maxBlocks: number; maxLinks: number; maxDepth: number; maxVector: number; maxTf: number; minDt: number;
  maxSamplesPerScope: number; maxTotalSamples: number;
};
