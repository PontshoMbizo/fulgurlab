// Block catalogue shared by the editor (web/) and the simulation server (server/).
//
// Each entry describes what the editor needs to draw and configure a block:
// ports, parameters and defaults. How a block becomes Scilab/Xcos code lives in
// server/src/codegen.js, keyed by the same `type`.
//
// Parameter kinds:
//   number  - a finite number
//   vector  - array of finite numbers (polynomial coefficients, highest power first)
//   signs   - string of '+'/'-' (Sum) or '*'/'/' (Product); sets the input count
//   int     - integer within [min, max]

/** @typedef {{key:string,label:string,kind:'number'|'vector'|'signs'|'int',default:any,min?:number,max?:number,alphabet?:string,hint?:string}} Param */
/** @typedef {{type:string,label:string,category:string,params:Param[],inputs:(p:object)=>number,outputs:(p:object)=>number,description:string}} BlockDef */

const fixed = (n) => () => n;

/** @type {BlockDef[]} */
export const BLOCKS = [
  // ---------------------------------------------------------------- Sources
  {
    type: 'step', label: 'Step', category: 'Sources',
    description: 'Jumps from the initial to the final value at the step time.',
    params: [
      { key: 'time', label: 'Step time (s)', kind: 'number', default: 1 },
      { key: 'initial', label: 'Initial value', kind: 'number', default: 0 },
      { key: 'final', label: 'Final value', kind: 'number', default: 1 },
    ],
    inputs: fixed(0), outputs: fixed(1),
  },
  {
    type: 'constant', label: 'Constant', category: 'Sources',
    description: 'Outputs a constant value.',
    params: [{ key: 'value', label: 'Value', kind: 'number', default: 1 }],
    inputs: fixed(0), outputs: fixed(1),
  },
  {
    type: 'sine', label: 'Sine Wave', category: 'Sources',
    description: 'A·sin(ω·t + φ).',
    params: [
      { key: 'amplitude', label: 'Amplitude', kind: 'number', default: 1 },
      { key: 'frequency', label: 'Frequency ω (rad/s)', kind: 'number', default: 1 },
      { key: 'phase', label: 'Phase φ (rad)', kind: 'number', default: 0 },
    ],
    inputs: fixed(0), outputs: fixed(1),
  },
  {
    type: 'ramp', label: 'Ramp', category: 'Sources',
    description: 'Rises with the given slope from the start time.',
    params: [
      { key: 'slope', label: 'Slope', kind: 'number', default: 1 },
      { key: 'start', label: 'Start time (s)', kind: 'number', default: 0 },
      { key: 'initial', label: 'Initial output', kind: 'number', default: 0 },
    ],
    inputs: fixed(0), outputs: fixed(1),
  },
  {
    type: 'clock', label: 'Clock (time)', category: 'Sources',
    description: 'Outputs the simulation time t.',
    params: [],
    inputs: fixed(0), outputs: fixed(1),
  },

  // ------------------------------------------------------------ Math
  {
    type: 'gain', label: 'Gain', category: 'Math',
    description: 'Multiplies the input by K.',
    params: [{ key: 'k', label: 'Gain K', kind: 'number', default: 1 }],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'sum', label: 'Sum', category: 'Math',
    description: 'Adds or subtracts its inputs. One sign per input, e.g. "+-".',
    params: [{ key: 'signs', label: 'Signs', kind: 'signs', alphabet: '+-', default: '+-', hint: 'e.g. +- or ++-' }],
    inputs: (p) => String(p.signs ?? '+-').length, outputs: fixed(1),
  },
  {
    type: 'product', label: 'Product', category: 'Math',
    description: 'Multiplies (*) or divides (/) by each input, e.g. "**" or "*/".',
    params: [{ key: 'ops', label: 'Operations', kind: 'signs', alphabet: '*/', default: '**', hint: 'e.g. ** or */' }],
    inputs: (p) => String(p.ops ?? '**').length, outputs: fixed(1),
  },
  {
    type: 'abs', label: 'Abs', category: 'Math',
    description: 'Absolute value |u|.',
    params: [],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'saturation', label: 'Saturation', category: 'Math',
    description: 'Limits the input to [lower, upper].',
    params: [
      { key: 'upper', label: 'Upper limit', kind: 'number', default: 1 },
      { key: 'lower', label: 'Lower limit', kind: 'number', default: -1 },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },

  // ------------------------------------------------------- Continuous
  {
    type: 'integrator', label: 'Integrator', category: 'Continuous',
    description: '1/s, with an initial condition.',
    params: [{ key: 'x0', label: 'Initial condition', kind: 'number', default: 0 }],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'derivative', label: 'Derivative', category: 'Continuous',
    description: 'du/dt (numerical).',
    params: [],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'transferFn', label: 'Transfer Fcn', category: 'Continuous',
    description: 'N(s)/D(s). Coefficients highest power first, like MATLAB: [1 2 1] = s²+2s+1.',
    params: [
      { key: 'num', label: 'Numerator', kind: 'vector', default: [1] },
      { key: 'den', label: 'Denominator', kind: 'vector', default: [1, 1] },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'pid', label: 'PID Controller', category: 'Continuous',
    description: 'Kp + Ki/s + Kd·N·s/(s+N) (parallel form, filtered derivative).',
    params: [
      { key: 'kp', label: 'Kp', kind: 'number', default: 1 },
      { key: 'ki', label: 'Ki', kind: 'number', default: 0 },
      { key: 'kd', label: 'Kd', kind: 'number', default: 0 },
      { key: 'n', label: 'Filter N', kind: 'number', default: 100 },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'delay', label: 'Transport Delay', category: 'Continuous',
    description: 'Delays the input by T seconds.',
    params: [
      { key: 'T', label: 'Delay T (s)', kind: 'number', default: 1 },
      { key: 'initial', label: 'Initial output', kind: 'number', default: 0 },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },

  // --------------------------------------------------------- Discrete
  {
    type: 'zoh', label: 'Zero-Order Hold', category: 'Discrete',
    description: 'Samples the input every Ts seconds and holds it.',
    params: [{ key: 'ts', label: 'Sample time Ts (s)', kind: 'number', default: 0.1 }],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'unitDelay', label: 'Unit Delay', category: 'Discrete',
    description: 'z⁻¹: outputs the previous sample.',
    params: [
      { key: 'ts', label: 'Sample time Ts (s)', kind: 'number', default: 0.1 },
      { key: 'x0', label: 'Initial value', kind: 'number', default: 0 },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },
  {
    type: 'discreteTF', label: 'Discrete TF', category: 'Discrete',
    description: 'N(z)/D(z), sampled every Ts. Coefficients highest power first.',
    params: [
      { key: 'num', label: 'Numerator', kind: 'vector', default: [1] },
      { key: 'den', label: 'Denominator', kind: 'vector', default: [1, -0.5] },
      { key: 'ts', label: 'Sample time Ts (s)', kind: 'number', default: 0.1 },
    ],
    inputs: fixed(1), outputs: fixed(1),
  },

  // ------------------------------------------------------------ Sinks
  {
    type: 'scope', label: 'Scope', category: 'Sinks',
    description: 'Records its inputs every dt; each input becomes one trace.',
    params: [{ key: 'inputs', label: 'Number of inputs', kind: 'int', default: 1, min: 1, max: 8 }],
    inputs: (p) => Number(p.inputs ?? 1), outputs: fixed(0),
  },
];

export const BLOCK_MAP = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));

export const CATEGORIES = [...new Set(BLOCKS.map((b) => b.category))];

/** Default parameter object for a block type. */
export function defaultParams(type) {
  const def = BLOCK_MAP[type];
  if (!def) throw new Error(`unknown block type: ${type}`);
  return Object.fromEntries(def.params.map((p) => [p.key, structuredClone(p.default)]));
}

/** Port counts for a block instance (after defaults are merged). */
export function portCounts(type, params) {
  const def = BLOCK_MAP[type];
  const p = { ...defaultParams(type), ...(params || {}) };
  return { inputs: def.inputs(p), outputs: def.outputs(p) };
}

/** Limits enforced by the server (the editor uses them for hints). */
export const LIMITS = {
  maxBlocks: 200,
  maxLinks: 400,
  maxVector: 16,
  maxTf: 10000,
  minDt: 1e-6,
  maxSamplesPerScope: 1_000_000,
  maxTotalSamples: 2_000_000,
};
