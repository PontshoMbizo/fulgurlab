// Types for shared/catalog.js (plain ESM so the Node server can import it without a build).
export type ParamKind = 'number' | 'vector' | 'signs' | 'int';
export interface Param {
  key: string;
  label: string;
  kind: ParamKind;
  default: number | number[] | string;
  min?: number;
  max?: number;
  alphabet?: string;
  hint?: string;
}
export type Params = Record<string, number | number[] | string>;
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
export function portCounts(type: string, params?: Params): { inputs: number; outputs: number };
export const LIMITS: {
  maxBlocks: number; maxLinks: number; maxVector: number; maxTf: number; minDt: number;
  maxSamplesPerScope: number; maxTotalSamples: number;
};
