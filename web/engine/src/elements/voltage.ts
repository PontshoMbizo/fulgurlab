import { CircuitElm, Stamper } from './base';
import { VoltageSource } from '../core/node';

export class VoltageElm extends CircuitElm {
    waveform: number = 0; // 0 = DC
    maxVoltage: number = 5;
    voltSource!: VoltageSource;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, wf: number = 0) {
        super(x, y, x2, y2, flags);
        this.waveform = wf;
    }

    getDumpType() { return 'v'; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    
    setVoltageSource(j: number, vs: VoltageSource) {
        this.voltSource = vs;
    }

    getVoltage() {
        return this.maxVoltage; // Simplification for DC testing
    }

    stamp(stamper: Stamper) {
        if (this.waveform === 0) { // DC
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage());
        } else {
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource);
        }
    }
    
    doStep(stamper: Stamper) {
        if (this.waveform !== 0) {
            stamper.updateVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage());
        }
    }
}
