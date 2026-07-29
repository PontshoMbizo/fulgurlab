import { Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { ChipElm, Pin, SIDE_N, SIDE_S, SIDE_W, SIDE_E } from './chip';
import { Diode, DEFAULT_DIODE_MODEL } from './diode';

// ChipElm subclasses that are analog (or mixed-signal) rather than pure logic:
// the 555 timer, the monostable, the VCO, the phase comparator, DAC/ADC, the
// second-generation current conveyor, and the LED matrix.
//
// Several of these stamp into voltage-source ROWS directly (stampMatrix with a
// VoltageSource on one axis), which is how Falstad expresses "tie this node's
// current to that branch current". The Stamper already exposes the needed
// primitives: stampMatrixNodeVS / stampMatrixVSNode / stampMatrixVSVS.

// ------------------------------------------------------------------ 555 Timer

export class TimerElm extends ChipElm {
    static FLAG_RESET = 2;
    static FLAG_GROUND = 4;
    static FLAG_NUMBERS = 8;

    static N_DIS = 0;
    static N_TRIG = 1;
    static N_THRES = 2;
    static N_VCC = 3;
    static N_CTL = 4;
    static N_OUT = 5;
    static N_RST = 6;
    static N_GND = 7;

    out = false;
    triggerSuppressed = false;
    private groundNode: CircuitNode = CircuitNode.ground;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 165; }
    getChipName() { return '555 timer'; }
    nonLinear() { return true; }
    hasGroundPin() { return (this.flags & TimerElm.FLAG_GROUND) !== 0; }
    hasReset() { return (this.flags & TimerElm.FLAG_RESET) !== 0 || this.hasGroundPin(); }
    usePinNames() { return (this.flags & TimerElm.FLAG_NUMBERS) === 0; }

    setupPins(): void {
        const N = TimerElm;
        const names = this.usePinNames();
        this.sizeX = 3;
        this.sizeY = 5;
        this.pins = new Array(8);
        this.pins[N.N_DIS] = new Pin(1, SIDE_W, names ? 'dis' : '7');
        this.pins[N.N_TRIG] = new Pin(3, SIDE_W, names ? 'tr' : '2');
        if (names) this.pins[N.N_TRIG].lineOver = true;
        this.pins[N.N_THRES] = new Pin(4, SIDE_W, names ? 'th' : '6');
        this.pins[N.N_VCC] = new Pin(1, SIDE_N, names ? 'Vcc' : '8');
        this.pins[N.N_CTL] = new Pin(1, SIDE_S, names ? 'ctl' : '5');
        this.pins[N.N_OUT] = new Pin(2, SIDE_E, names ? 'out' : '3');
        this.pins[N.N_OUT].state = true;
        this.pins[N.N_RST] = new Pin(1, SIDE_E, names ? 'rst' : '4');
        if (names) this.pins[N.N_RST].lineOver = true;
        this.pins[N.N_GND] = new Pin(2, SIDE_S, names ? 'gnd' : '1');
    }

    getPostCount() { return this.hasGroundPin() ? 8 : this.hasReset() ? 7 : 6; }
    getVoltageSourceCount() { return 0; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }

    stamp(stamper: Stamper): void {
        const N = TimerElm;
        this.groundNode = this.hasGroundPin() ? this.nodes[N.N_GND] : CircuitNode.ground;
        // Internal 5k/10k divider puts the control pin at 2/3 Vcc.
        stamper.stampResistor(this.nodes[N.N_VCC], this.nodes[N.N_CTL], 5000);
        stamper.stampResistor(this.nodes[N.N_CTL], this.groundNode, 10000);
        stamper.stampNonLinear(this.nodes[N.N_DIS]);
        stamper.stampNonLinear(this.nodes[N.N_OUT]);
        stamper.stampNonLinear(this.nodes[N.N_VCC]);
        if (this.hasGroundPin()) stamper.stampNonLinear(this.nodes[N.N_GND]);
    }

    startIteration(_stamper: Stamper): void {
        const N = TimerElm;
        const groundVolts = this.hasGroundPin() ? this.volts[N.N_GND] : 0;
        this.out = this.volts[N.N_OUT] > (this.volts[N.N_VCC] + groundVolts) / 2;
        if (this.volts[N.N_THRES] > this.volts[N.N_CTL]) this.out = false;

        // Trigger overrides threshold; the flag is saved in case the reset and
        // trigger pins are tied together.
        const triggered = ((this.volts[N.N_CTL] + groundVolts) / 2 > this.volts[N.N_TRIG]);
        if (triggered || this.triggerSuppressed) this.out = true;

        // Reset overrides trigger.
        if (this.hasReset() && this.volts[N.N_RST] < 0.7 + groundVolts) {
            this.out = false;
            this.triggerSuppressed = triggered;
        } else {
            this.triggerSuppressed = false;
        }
    }

    doStep(stamper: Stamper): void {
        const N = TimerElm;
        // Low output discharges pin 7 through a deliberately small resistor.
        if (!this.out) stamper.stampResistor(this.nodes[N.N_DIS], this.groundNode, 10);
        stamper.stampResistor(this.out ? this.nodes[N.N_VCC] : this.groundNode, this.nodes[N.N_OUT], 1);
    }

    calculateCurrent(): void {
        const N = TimerElm;
        const p = this.pins;
        p[N.N_VCC].current = (this.volts[N.N_CTL] - this.volts[N.N_VCC]) / 5000;
        const groundVolts = this.hasGroundPin() ? this.volts[N.N_GND] : 0;
        p[N.N_CTL].current = -(this.volts[N.N_CTL] - groundVolts) / 10000 - p[N.N_VCC].current;
        p[N.N_DIS].current = !this.out ? -(this.volts[N.N_DIS] - groundVolts) / 10 : 0;
        p[N.N_OUT].current = -(this.volts[N.N_OUT] - (this.out ? this.volts[N.N_VCC] : groundVolts));
        if (this.out) p[N.N_VCC].current -= p[N.N_OUT].current;
        if (this.hasGroundPin()) {
            p[N.N_GND].current = (this.volts[N.N_CTL] - groundVolts) / 10000;
            if (!this.out) {
                p[N.N_GND].current += (this.volts[N.N_DIS] - groundVolts) / 10
                    + (this.volts[N.N_OUT] - groundVolts);
            }
        }
    }
}

// ------------------------------------------------------------------ Monostable

export class MonostableElm extends ChipElm {
    retriggerable = false;
    delay = 0.01;
    triggered = false;
    prevInputValue = false;
    lastRisingEdge = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.retriggerable = this.nextBoolean(false);
        this.delay = this.nextNumber(0.01);
        this.reset();
    }

    getDumpType() { return 194; }
    getChipName() { return 'monostable'; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.retriggerable, this.delay];
    }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 2;
        this.pins = new Array(3);
        this.pins[0] = new Pin(0, SIDE_W, '');
        this.pins[0].clock = true;
        this.pins[1] = new Pin(0, SIDE_E, 'Q');
        this.pins[1].output = true;
        this.pins[2] = new Pin(1, SIDE_E, 'Q');
        this.pins[2].output = true;
        this.pins[2].lineOver = true;
    }

    getPostCount() { return 3; }
    getVoltageSourceCount() { return 2; }

    reset(): void {
        super.reset();
        if (this.pins[2]) this.pins[2].value = true;
        this.triggered = false;
        this.prevInputValue = false;
    }

    // Needs the current sim time, which execute() doesn't get — ChipElm's
    // doStep() is overridden just to thread `stamper.t` through.
    doStep(stamper: Stamper): void {
        this.simTime = stamper.t;
        super.doStep(stamper);
    }
    private simTime = 0;

    execute(): void {
        if (this.pins[0].value && this.prevInputValue !== this.pins[0].value
            && (this.retriggerable || !this.triggered)) {
            this.lastRisingEdge = this.simTime;
            this.pins[1].value = true;
            this.pins[2].value = false;
            this.triggered = true;
        }
        if (this.triggered && this.simTime > this.lastRisingEdge + this.delay) {
            this.pins[1].value = false;
            this.pins[2].value = true;
            this.triggered = false;
        }
        this.prevInputValue = this.pins[0].value;
    }
}

// ------------------------------------------------------------------------ VCO

// Relaxation VCO: the input voltage sets a current through the R1 pin, which is
// mirrored into an external cap; the output flips between 0 and 5 V as the cap
// ramps between 0.5 V and 4.5 V.
export class VCOElm extends ChipElm {
    static cResistance = 1e6;
    cDir = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 158; }
    getChipName() { return 'VCO'; }
    nonLinear() { return true; }
    isDigitalChip() { return false; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 4;
        this.pins = new Array(6);
        this.pins[0] = new Pin(0, SIDE_W, 'Vi');
        this.pins[1] = new Pin(3, SIDE_W, 'Vo');
        this.pins[1].output = true;
        this.pins[2] = new Pin(0, SIDE_E, 'C');
        this.pins[3] = new Pin(1, SIDE_E, 'C');
        this.pins[4] = new Pin(2, SIDE_E, 'R1');
        this.pins[4].output = true;
        this.pins[5] = new Pin(3, SIDE_E, 'R2');
        this.pins[5].output = true;
    }

    getPostCount() { return 6; }
    getVoltageSourceCount() { return 3; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }

    stamp(stamper: Stamper): void {
        const p = this.pins;
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[1], p[1].voltSource!);
        // Vi is tied to the R1 pin so R1's current is proportional to Vi.
        stamper.stampVoltageSource(this.nodes[0], this.nodes[4], p[4].voltSource!, 0);
        // 5 V on the R2 pin gives a baseline current.
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[5], p[5].voltSource!, 5);
        // A resistor across the cap pins gives the current somewhere to go when
        // no cap is attached.
        stamper.stampResistor(this.nodes[2], this.nodes[3], VCOElm.cResistance);
        stamper.stampNonLinear(this.nodes[2]);
        stamper.stampNonLinear(this.nodes[3]);
    }

    doStep(stamper: Stamper): void {
        const p = this.pins;
        const vc = this.volts[3] - this.volts[2];
        let vo = this.volts[1];
        let dir = vo < 2.5 ? 1 : -1;
        if (vo < 2.5 && vc > 4.5) { vo = 5; dir = -1; }
        if (vo > 2.5 && vc < 0.5) { vo = 0; dir = 1; }

        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[1], p[1].voltSource!, vo);
        // Force the cap current to equal the R1+R2 currents, so the cap voltage
        // is what we actually measure.
        stamper.stampMatrixNodeVS(this.nodes[2], p[4].voltSource!, dir);
        stamper.stampMatrixNodeVS(this.nodes[2], p[5].voltSource!, dir);
        stamper.stampMatrixNodeVS(this.nodes[3], p[4].voltSource!, -dir);
        stamper.stampMatrixNodeVS(this.nodes[3], p[5].voltSource!, -dir);
        this.cDir = dir;
    }

    // Java calls this computeCurrent() and runs it after the per-VS currents
    // are known; the engine's calculateCurrent() hook is the same point.
    calculateCurrent(): void {
        const p = this.pins;
        const c = this.cDir * (p[4].current + p[5].current)
            + (this.volts[3] - this.volts[2]) / VCOElm.cResistance;
        p[2].current = -c;
        p[3].current = c;
        p[0].current = -p[4].current;
    }
}

// ------------------------------------------------------------ PhaseComparator

// Type-II phase/frequency detector: two edge-set flip-flops, output driven high
// or low depending on which input led, and tri-stated when both have fired.
export class PhaseCompElm extends ChipElm {
    ff1 = false;
    ff2 = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 161; }
    getChipName() { return 'phase comparator'; }
    nonLinear() { return true; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 2;
        this.pins = new Array(3);
        this.pins[0] = new Pin(0, SIDE_W, 'I1');
        this.pins[1] = new Pin(1, SIDE_W, 'I2');
        this.pins[2] = new Pin(0, SIDE_E, 'O');
        this.pins[2].output = true;
    }

    getPostCount() { return 3; }
    getVoltageSourceCount() { return 1; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[2]);
    }

    doStep(stamper: Stamper): void {
        const p = this.pins;
        const v1 = this.volts[0] > this.getThreshold();
        const v2 = this.volts[1] > this.getThreshold();
        if (v1 && !p[0].value) this.ff1 = true;
        if (v2 && !p[1].value) this.ff2 = true;
        if (this.ff1 && this.ff2) this.ff1 = this.ff2 = false;

        const out = this.ff1 ? this.highVoltage : this.ff2 ? 0 : -1;
        if (out !== -1) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[2], p[2].voltSource!, out);
        } else {
            // High-Z: tie the output branch current to zero.
            stamper.stampMatrixVSVS(p[2].voltSource!, p[2].voltSource!, 1);
        }
        p[0].value = v1;
        p[1].value = v2;
    }
}

// ------------------------------------------------------------------------ DAC

export class DACElm extends ChipElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 166; }
    getChipName() { return 'DAC'; }
    needsBits() { return true; }
    allowBus() { return true; }

    setupPins(): void {
        this.sizeX = 2;
        const bitsY = this.useBus() ? 1 : (this.bits > 2 ? this.bits : 2);
        this.sizeY = bitsY > 2 ? bitsY : 2;
        this.pins = new Array(this.getPostCount());
        this.makeBitPins(this.bits, 0, SIDE_W, 0, 'D', false, false, false);
        this.pins[this.bits] = new Pin(0, SIDE_E, 'O');
        this.pins[this.bits].output = true;
        this.pins[this.bits + 1] = new Pin(this.sizeY - 1, SIDE_E, 'V+');
    }

    getPostCount() { return this.bits + 2; }
    getVoltageSourceCount() { return 1; }

    doStep(stamper: Stamper): void {
        let ival = 0;
        for (let i = 0; i !== this.bits; i++) {
            if (this.volts[i] > this.getThreshold()) ival |= 1 << i;
        }
        const ivalmax = (1 << this.bits) - 1;
        const v = ival * this.volts[this.bits + 1] / ivalmax;
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[this.bits],
            this.pins[this.bits].voltSource!, v);
    }
}

// ------------------------------------------------------------------------ ADC

export class ADCElm extends ChipElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 167; }
    getChipName() { return 'ADC'; }
    needsBits() { return true; }
    allowBus() { return true; }

    setupPins(): void {
        this.sizeX = 2;
        const bitsY = this.useBus() ? 1 : (this.bits > 2 ? this.bits : 2);
        this.sizeY = bitsY > 2 ? bitsY : 2;
        this.pins = new Array(this.getPostCount());
        this.makeBitPins(this.bits, 0, SIDE_E, 0, 'D', true, false, false);
        this.pins[this.bits] = new Pin(0, SIDE_W, 'In');
        this.pins[this.bits + 1] = new Pin(this.sizeY - 1, SIDE_W, 'V+');
    }

    getPostCount() { return this.bits + 2; }
    getVoltageSourceCount() { return this.bits; }

    execute(): void {
        const imax = (1 << this.bits) - 1;
        // Deliberately truncating rather than rounding — Java notes that
        // rounding breaks the half-flash converter example.
        const val = imax * this.volts[this.bits] / this.volts[this.bits + 1];
        let ival = Math.trunc(val);
        if (!Number.isFinite(ival)) ival = 0;
        ival = Math.min(imax, Math.max(0, ival));
        for (let i = 0; i !== this.bits; i++) {
            this.pins[i].value = (ival & (1 << i)) !== 0;
        }
    }
}

// ------------------------------------------------------------------------ CC2

// Second-generation current conveyor (CCII): Vx follows Vy, and Iz = gain * Ix.
export class CC2Elm extends ChipElm {
    gain = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.gain = this.nextNumber(1);
    }

    getDumpType() { return 179; }
    getChipName() { return 'CCII'; }
    isDigitalChip() { return false; }
    dumpTokens(): (string | number | boolean)[] { return [...super.dumpTokens(), this.gain]; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 3;
        this.pins = new Array(3);
        this.pins[0] = new Pin(0, SIDE_W, 'X');
        this.pins[0].output = true;
        this.pins[1] = new Pin(2, SIDE_W, 'Y');
        this.pins[2] = new Pin(1, SIDE_E, 'Z');
    }

    getPostCount() { return 3; }
    getVoltageSourceCount() { return 1; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }

    stamp(stamper: Stamper): void {
        const vs = this.pins[0].voltSource!;
        // Vx = Vy: an independent source on X, controlled by Y.
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], vs);
        // stampVCVS(ground, nodes[1], 1, vs)
        stamper.stampMatrixVSNode(vs, CircuitNode.ground, 1);
        stamper.stampMatrixVSNode(vs, this.nodes[1], -1);
        // stampCCCS(ground, nodes[2], vs, gain)
        stamper.stampMatrixNodeVS(CircuitNode.ground, vs, this.gain);
        stamper.stampMatrixNodeVS(this.nodes[2], vs, -this.gain);
    }

    calculateCurrent(): void {
        this.pins[2].current = this.pins[0].current * this.gain;
    }
}

// ------------------------------------------------------------------ LEDArray

// An X-by-Y matrix of LEDs: column pins on the south side, row pins on the
// west, one diode per crossing. `brightness` is exposed for the renderer.
export class LEDArrayElm extends ChipElm {
    diodes: Diode[] = [];
    brightness: number[] = [];
    // 30ms persistence-of-vision decay constant, as in Java.
    static brightnessTau = 0.03;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        const sx = this.nextInt(0);
        const sy = this.nextInt(0);
        if (sx > 0 && sy > 0) {
            this.sizeX = sx;
            this.sizeY = sy;
            this.setupPins();
            this.allocNodes();
            this.setPoints();
        }
    }

    getDumpType() { return 405; }
    getChipName() { return 'LED array'; }
    nonLinear() { return true; }
    isDigitalChip() { return false; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.sizeX, this.sizeY];
    }

    setupPins(): void {
        if (this.sizeX === 0 || this.sizeY === 0) this.sizeX = this.sizeY = 8;
        this.pins = new Array(this.sizeX + this.sizeY);
        for (let i = 0; i !== this.sizeX; i++) this.pins[i] = new Pin(i, SIDE_S, '');
        for (let i = 0; i !== this.sizeY; i++) this.pins[i + this.sizeX] = new Pin(i, SIDE_W, '');
        this.brightness = new Array(this.sizeX * this.sizeY).fill(0);
    }

    getPostCount() { return this.sizeX + this.sizeY; }
    getVoltageSourceCount() { return 0; }

    reset(): void {
        super.reset();
        this.brightness = new Array(this.sizeX * this.sizeY).fill(0);
    }

    stamp(stamper: Stamper): void {
        this.diodes = new Array(this.sizeX * this.sizeY);
        for (let i = 0; i !== this.diodes.length; i++) {
            const d = new Diode();
            d.setup(DEFAULT_DIODE_MODEL);
            d.stamp(stamper, this.nodes[this.sizeX + Math.floor(i / this.sizeX)], this.nodes[i % this.sizeX]);
            this.diodes[i] = d;
        }
    }

    doStep(stamper: Stamper): void {
        let i = 0;
        for (let iy = 0; iy !== this.sizeY; iy++) {
            for (let ix = 0; ix !== this.sizeX; ix++, i++) {
                this.diodes[i].doStep(stamper, this.volts[this.sizeX + iy] - this.volts[ix]);
            }
        }
    }

    // Instantaneous per-LED current, for the renderer's brightness model.
    calculateCurrent(): void {
        let i = 0;
        for (let iy = 0; iy !== this.sizeY; iy++) {
            for (let ix = 0; ix !== this.sizeX; ix++, i++) {
                const vd = this.volts[this.sizeX + iy] - this.volts[ix];
                this.brightness[i] = this.diodes[i]?.calculateCurrent(vd) ?? 0;
            }
        }
    }
}
