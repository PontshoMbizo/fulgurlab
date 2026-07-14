import { CircuitElm } from './base';

// Ported from GraphicElm.java: a common base for canvas-only annotations
// (TextElm, BoxElm) with no electrical presence at all -- zero posts, no
// nodes, no stamp. This engine has no renderer yet (that's Phase 5+), so
// TextElm/BoxElm below only carry the dump-relevant data needed to load and
// re-save a Falstad file that includes them without losing that data; all
// drawing code from the Java source is intentionally not ported here.
export abstract class GraphicElm extends CircuitElm {
    getPostCount() { return 0; }
}
