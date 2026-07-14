import { CircuitElm, Stamper } from './base';

export class ResistorElm extends CircuitElm {
    resistance: number;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, resistance: number = 1000) {
        super(x, y, x2, y2, flags);
        this.resistance = resistance;
    }

    getDumpType() { return 'r'; }
    
    stamp(stamper: Stamper) {
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    
    calculateCurrent() {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}
