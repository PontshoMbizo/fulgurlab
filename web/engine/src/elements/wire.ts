import { CircuitElm, Stamper, Point } from './base';

export class WireElm extends CircuitElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number = 0) {
        super(x, y, x2, y2, flags);
    }

    getDumpType() { return 'w'; }

    isWireEquivalent() { return true; }
    isRemovableWire() { return true; }
    isWire() { return true; }

    // Ported from WireElm.java getConnectedPost(): post 0 connects to point2,
    // post 1 connects to point1. This is what Analyzer.calculateWireClosure()
    // uses to merge a wire's two ends into a single node — without it, a wire
    // just registers its two posts as independent, disconnected nodes and
    // doesn't actually connect anything (verified this was broken: an op-amp
    // follower's feedback wire produced a `null` voltage-source matrix and
    // crashed the solver before this override was added).
    getConnectedPost(n: number): Point | null {
        return (n === 0) ? this.point2 : this.point1;
    }

    stamp(stamper: Stamper) {
        // Wire stamping logic is handled by Analyzer node coalescing
    }
}
