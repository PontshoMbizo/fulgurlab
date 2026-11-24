// Flattens a validated netlist: subsystems are expanded in place, so codegen only
// ever sees plain blocks and wires. This is a pure graph rewrite; nothing about
// Scilab is involved.
//
// Every block inside a subsystem gets an id path ("ctrl/pid"), which is also the key of
// its scope results. Ids cannot contain "/", so a path never collides with a top-level id.
//
// Method: Inport and Outport blocks become "wire nodes" that just pass a signal on, a link
// into a subsystem goes to its Inport, and a link out of it starts at its Outport. Once the
// whole tree is expanded, each real input is traced back through any wire nodes to the real
// output that drives it.

import { systemPorts } from '../../shared/catalog.js';

export class FlattenError extends Error {}

/**
 * @param {ReturnType<import('./netlist.js').validateNetlist>} net
 * @returns {{settings:object, blocks:object[], links:{from:{block:string,port:number},to:{block:string,port:number}}[]}}
 */
export function flatten(net) {
  if (!net.blocks.some((b) => b.type === 'subsystem')) return net; // nothing to do (the common case)

  const real = [];               // flat blocks, in order
  const wires = new Set();       // ids of Inport/Outport wire nodes
  const raw = [];                // links between flat ids, possibly ending or starting at wire nodes

  /** Expand one level; returns the flat ids of the Inport and Outport wire nodes, by port. */
  function expand(sys, prefix) {
    const ports = new Map(); // child subsystem id -> { inports:[flatId], outports:[flatId] }
    for (const b of sys.blocks) {
      const id = prefix + b.id;
      if (b.type === 'subsystem') {
        ports.set(b.id, expand(b.system, `${id}/`));
      } else if (b.type === 'inport' || b.type === 'outport') {
        wires.add(id);
      } else {
        real.push({ ...b, id });
      }
    }
    const resolveEnd = (end, isSource) => {
      const child = ports.get(end.block);
      if (!child) return { block: prefix + end.block, port: end.port };
      // a subsystem's port k is its k-th Inport/Outport wire node
      return { block: (isSource ? child.outports : child.inports)[end.port], port: 0 };
    };
    for (const l of sys.links) raw.push({ from: resolveEnd(l.from, true), to: resolveEnd(l.to, false) });
    const own = systemPorts(sys);
    return { inports: own.inports.map((b) => prefix + b.id), outports: own.outports.map((b) => prefix + b.id) };
  }
  expand(net, '');

  // what drives each input; wire nodes have exactly one input (port 0)
  const driver = new Map(raw.map((l) => [`${l.to.block}:${l.to.port}`, l.from]));
  const trace = (from) => {
    const seen = new Set();
    let cur = from;
    while (wires.has(cur.block)) {
      if (seen.has(cur.block)) throw new FlattenError(`a signal loops through subsystem ports without passing through any block ("${cur.block}")`);
      seen.add(cur.block);
      const next = driver.get(`${cur.block}:0`);
      if (!next) throw new FlattenError(`port "${cur.block}" is not connected`);
      cur = next;
    }
    return cur;
  };

  const links = [];
  for (const l of raw) {
    if (wires.has(l.to.block)) continue; // only links into real blocks matter
    links.push({ from: trace(l.from), to: l.to });
  }
  return { settings: net.settings, blocks: real, links };
}
