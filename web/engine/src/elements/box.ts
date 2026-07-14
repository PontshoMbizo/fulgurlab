import { GraphicElm } from './graphic';

// Ported from BoxElm.java (dump-relevant fields only -- see graphic.ts).
// x2/y2 are already base CircuitElm fields; Java stores the box's opposite
// corner in them directly (no separate fields needed).
export class BoxElm extends GraphicElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number) {
        super(x, y, x2, y2, flags);
    }

    getDumpType() { return 'b'; }
}
