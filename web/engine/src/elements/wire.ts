import { CircuitElm, Stamper } from './base';

export class WireElm extends CircuitElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number = 0) {
        super(x, y, x2, y2, flags);
    }

    getDumpType() { return 'w'; }
    
    isWireEquivalent() { return true; }
    isRemovableWire() { return true; }
    isWire() { return true; }

    stamp(stamper: Stamper) {
        // Wire stamping logic is handled by Analyzer node coalescing
    }
}
