import { CircuitElm, Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from VoltageElm.java. waveform constants and phase/duty-cycle handling
// match the Java source; getVoltage(t) mirrors VoltageElm.getVoltage() exactly
// (including the square/pulse rise-time ramps).
export class VoltageElm extends CircuitElm {
    static FLAG_COS = 2;
    static FLAG_PULSE_DUTY = 4;
    static FLAG_CIRCLE_SYMBOL = 8;
    static FLAG_SHOW_VOLTAGE = 16;
    static FLAG_TIME_SPEC = 32;

    static WF_DC = 0;
    static WF_AC = 1;
    static WF_SQUARE = 2;
    static WF_TRIANGLE = 3;
    static WF_SAWTOOTH = 4;
    static WF_PULSE = 5;
    static WF_NOISE = 6;
    static WF_VAR = 7;
    static defaultPulseDuty = 1 / (2 * Math.PI);

    waveform = 0;
    maxVoltage = 5;
    frequency = 40;
    freqTimeZero = 0;
    bias = 0;
    phaseShift = 0;
    dutyCycle = 0.5;
    noiseValue = 0;
    riseTime = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        if (typeof params === 'number') {
            this.waveform = params;
        } else if (Array.isArray(params) && params.length > 0) {
            this.waveform = parseInt(params[0]) || 0;
            this.frequency = params.length > 1 ? parseFloat(params[1]) : 40;
            this.maxVoltage = params.length > 2 ? parseFloat(params[2]) : 5;
            this.bias = params.length > 3 ? parseFloat(params[3]) : 0;
            this.phaseShift = params.length > 4 ? parseFloat(params[4]) : 0;
            this.dutyCycle = params.length > 5 ? parseFloat(params[5]) : 0.5;
        } else {
            this.waveform = 0;
        }
        this.reset();
        if ((this.flags & VoltageElm.FLAG_COS) !== 0) {
            this.flags &= ~VoltageElm.FLAG_COS;
            this.phaseShift = Math.PI / 2;
        }
        if ((this.flags & VoltageElm.FLAG_PULSE_DUTY) === 0 && this.waveform === VoltageElm.WF_PULSE) {
            this.dutyCycle = VoltageElm.defaultPulseDuty;
        }
    }

    reset() {
        super.reset();
        this.freqTimeZero = 0;
    }

    getDumpType() { return 'v'; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    setVoltageSource(j: number, vs: VoltageSource) {
        this.voltSource = vs;
    }

    triangleFunc(x: number): number {
        if (x < Math.PI) return x * (2 / Math.PI) - 1;
        return 1 - (x - Math.PI) * (2 / Math.PI);
    }

    getVoltage(t: number): number {
        const w = 2 * Math.PI * (t - this.freqTimeZero) * this.frequency + this.phaseShift;
        switch (this.waveform) {
            case VoltageElm.WF_DC: return this.maxVoltage + this.bias;
            case VoltageElm.WF_AC: return Math.sin(w) * this.maxVoltage + this.bias;
            case VoltageElm.WF_SQUARE: {
                const wm = w % (2 * Math.PI);
                const dutyPhase = 2 * Math.PI * this.dutyCycle;
                if (this.riseTime > 0) {
                    const risePhase = this.riseTime * this.frequency * 2 * Math.PI;
                    const halfRise = risePhase / 2;
                    if (wm < halfRise) {
                        const tRatio = (wm + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (2 * tRatio - 1);
                    } else if (wm < dutyPhase - halfRise) {
                        return this.bias + this.maxVoltage;
                    } else if (wm < dutyPhase + halfRise) {
                        const tRatio = (wm - dutyPhase + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (1 - 2 * tRatio);
                    } else if (wm < 2 * Math.PI - halfRise) {
                        return this.bias - this.maxVoltage;
                    } else {
                        const tRatio = (wm - (2 * Math.PI - halfRise)) / risePhase;
                        return this.bias + this.maxVoltage * (2 * tRatio - 1);
                    }
                }
                return this.bias + ((wm > dutyPhase) ? -this.maxVoltage : this.maxVoltage);
            }
            case VoltageElm.WF_TRIANGLE:
                return this.bias + this.triangleFunc(w % (2 * Math.PI)) * this.maxVoltage;
            case VoltageElm.WF_SAWTOOTH:
                return this.bias + (w % (2 * Math.PI)) * (this.maxVoltage / Math.PI) - this.maxVoltage;
            case VoltageElm.WF_PULSE: {
                const wm = w % (2 * Math.PI);
                const dutyPhase = 2 * Math.PI * this.dutyCycle;
                if (this.riseTime > 0) {
                    const risePhase = this.riseTime * this.frequency * 2 * Math.PI;
                    const halfRise = risePhase / 2;
                    if (wm < halfRise) {
                        const tRatio = (wm + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * tRatio;
                    } else if (wm < dutyPhase - halfRise) {
                        return this.bias + this.maxVoltage;
                    } else if (wm < dutyPhase + halfRise) {
                        const tRatio = (wm - dutyPhase + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (1 - tRatio);
                    } else if (wm < 2 * Math.PI - halfRise) {
                        return this.bias;
                    } else {
                        const tRatio = (wm - (2 * Math.PI - halfRise)) / risePhase;
                        return this.bias + this.maxVoltage * tRatio;
                    }
                }
                return (wm < dutyPhase) ? this.maxVoltage + this.bias : this.bias;
            }
            case VoltageElm.WF_NOISE:
                return this.noiseValue;
            default:
                return 0;
        }
    }

    stamp(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_DC) {
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(stamper.t));
        } else {
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource);
        }
    }

    doStep(stamper: Stamper) {
        if (this.waveform !== VoltageElm.WF_DC) {
            stamper.updateVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(stamper.t));
        }
    }

    stepFinished(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_NOISE) {
            this.noiseValue = (Math.random() * 2 - 1) * this.maxVoltage + this.bias;
        }
    }
}

// Ported from RailElm.java: a one-post voltage source referenced to ground.
export class RailElm extends VoltageElm {
    static FLAG_CLOCK = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
    }

    getDumpType() { return 'R'; }
    getPostCount() { return 1; }
    hasGroundConnection(n1: number) { return true; }
    isRail() { return true; }

    stamp(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_DC) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
        } else {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
        }
    }

    doStep(stamper: Stamper) {
        if (this.waveform !== VoltageElm.WF_DC) {
            stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
        }
    }

    validateRailNode(n: number) { return true; }
    validate() { return this.validateRailNode(0); }
}

// Ported from ClockElm.java: a RailElm preset to a 0/2.5V+2.5V-bias square wave.
export class ClockElm extends RailElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, VoltageElm.WF_SQUARE);
        this.maxVoltage = 2.5;
        this.bias = 2.5;
        this.frequency = 100;
        if (Array.isArray(params) && params.length > 0) {
            this.frequency = parseFloat(params[0]) || 100;
            this.maxVoltage = params.length > 1 ? parseFloat(params[1]) : 2.5;
            this.bias = params.length > 2 ? parseFloat(params[2]) : 2.5;
            this.phaseShift = params.length > 3 ? parseFloat(params[3]) : 0;
            this.dutyCycle = params.length > 4 ? parseFloat(params[4]) : 0.5;
        }
        this.flags |= RailElm.FLAG_CLOCK;
    }

    getDumpType() { return '164'; }
}
