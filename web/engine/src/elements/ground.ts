import { CircuitElm, Stamper } from './base';

export class GroundElm extends CircuitElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number = 0) {
        super(x, y, x2, y2, flags);
    }

    getDumpType() { return 'g'; }
    getPostCount() { return 1; }
    
    isGround() { return true; }
    hasGroundConnection(n1: number) { return true; }
    
    stamp(stamper: Stamper) {
        // Normal ground doesn't need to stamp anything in the matrix.
        // The analyzer handles grounds directly.
    }
}
