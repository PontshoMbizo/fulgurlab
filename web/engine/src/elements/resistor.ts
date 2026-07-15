import { CircuitElm, Stamper } from './base';

export class ResistorElm extends CircuitElm {
    resistance: number;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.resistance = parseFloat(params[0]) || 1000;
        } else if (typeof params === 'number') {
            this.resistance = params;
        } else {
            this.resistance = 1000;
        }
    }

    getDumpType() { return 'r'; }
    dumpTokens() { return [this.resistance]; }

    stamp(stamper: Stamper) {
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    
    calculateCurrent() {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}
