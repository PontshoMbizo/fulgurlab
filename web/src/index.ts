// Public surface for embedding the editor in another React app (e.g. scope.io):
//   import { FulgurEditor } from '@fulgurlab/web';
//   import '@fulgurlab/web/src/editor/styles.css';
export { FulgurEditor } from './editor/FulgurEditor';
export type { FulgurEditorProps } from './editor/FulgurEditor';
export type { Netlist, Block, Link, SimResult, Trace, Issue } from './editor/types';
export { runSimulation } from './editor/api';
