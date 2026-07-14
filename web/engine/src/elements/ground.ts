import { CircuitElm, Stamper, Point } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from GroundElm.java.
export class GroundElm extends CircuitElm {
    static FLAG_OLD_STYLE = 1;
    static lastSymbolType = 0;
    symbolType: number;

    constructor(x: number, y: number, x2: number, y2: number, flags: number = 0, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.symbolType = GroundElm.lastSymbolType;
        if (Array.isArray(params) && params.length > 0) {
            this.symbolType = parseInt(params[0]) || 0;
        }
    }

    getDumpType() { return 'g'; }
    getPostCount() { return 1; }

    isGround() { return true; }
    hasGroundConnection(n1: number) { return true; }
    isWireEquivalent() { return true; }
    isRemovableWire() { return true; }

    isOldStyle() { return (this.flags & GroundElm.FLAG_OLD_STYLE) !== 0; }
    getVoltageSourceCount() { return this.isOldStyle() ? 1 : 0; }

    setVoltageSource(n: number, vs: VoltageSource) {
        super.setVoltageSource(n, vs);
    }

    stamp(stamper: Stamper) {
        if (this.isOldStyle()) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, 0);
        }
    }

    // Java: `setCurrent(VoltageSource vs, double c) { current = isOldStyle() ? -c : c; }`
    // -- only reachable via the old-style voltage-source branch; our engine
    // doesn't route setCurrent() through elements yet (see plan §5 gaps), so
    // this is kept for parity/future wiring rather than called today.
    setCurrent(vs: VoltageSource, c: number) {
        this.current = this.isOldStyle() ? -c : c;
    }

    // Multiple GroundElm instances anywhere in a circuit are all the SAME
    // node (real ground), not just each individually tied to CircuitNode
    // .ground in isolation -- Java does this via a static `firstGround` Point
    // that calculateWireClosure() resets once per analysis (SimulationManager
    // .calculateWireClosure(), which calls GroundElm.resetNodeList() right
    // alongside LabeledNodeElm.resetNodeList() -- see Analyzer.
    // calculateWireClosure() for the equivalent call site here). The first
    // ground encountered registers its own post and returns null (nothing to
    // connect to yet); every ground after that returns the first one's post,
    // which is what actually ties them together via the shared NodeMapEntry.
    static firstGround: Point | null = null;
    static resetNodeList() {
        GroundElm.firstGround = null;
    }

    getConnectedPost(n: number): Point | null {
        if (GroundElm.firstGround !== null) return GroundElm.firstGround;
        GroundElm.firstGround = this.point1;
        return null;
    }

    getVoltageDiff() { return 0; }
    getCurrentIntoNode(n: number) { return -this.current; }
}
