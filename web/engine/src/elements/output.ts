import { CircuitElm } from './base';

// Ported from OutputElm.java: a passive 1-post voltage probe. Purely a
// readout -- no stamp()/getVoltageSourceCount() override, so it never
// affects the circuit it's connected to.
export class OutputElm extends CircuitElm {
    static FLAG_VALUE = 1;
    static FLAG_FIXED = 2;
    static SCALE_AUTO = 0;

    scale = OutputElm.SCALE_AUTO;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.scale = parseInt(params[0]);
            if (Number.isNaN(this.scale)) this.scale = OutputElm.SCALE_AUTO;
        }
    }

    getDumpType() { return 'O'; }
    dumpTokens() { return [this.scale]; }
    getPostCount() { return 1; }

    isFixed() { return (this.flags & OutputElm.FLAG_FIXED) !== 0; }
    showVoltage() { return (this.flags & OutputElm.FLAG_VALUE) !== 0; }
    getVoltageDiff() { return this.volts[0]; }
}
