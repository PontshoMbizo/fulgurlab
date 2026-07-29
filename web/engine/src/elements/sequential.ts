import { Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { ChipElm, Pin, SIDE_W, SIDE_E, SIDE_N, SIDE_S } from './chip';

// Sequential digital chips ported from Java: the four flip-flops, the two
// counters, the ring counter and the (bus-capable, output-enable-capable)
// latch. All derive from ChipElm, so only setupPins()/execute() and the
// per-class flag accessors are class-specific.
//
// Dump id 164 is CounterElm. It was previously mapped to ClockElm, which does
// not have a dump id of its own at all (ClockElm.getDumpClass() is RailElm, so
// it dumps as 'R'); the mis-mapping loaded every counter in a Java-saved file
// as a 1-post rail and was the root cause of the two "Singular matrix!"
// failures in the corpus sweep (tests/7seg.txt, tests/custom.txt).

// ---------------------------------------------------------------- CounterElm

export class CounterElm extends ChipElm {
    static FLAG_UP_DOWN = 4;
    static FLAG_NEGATIVE_EDGE = 8;

    invertreset = true;
    modulus = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        // Java reads these two after super() has drained bits + state volts;
        // both are optional (older dumps omit them), hence the defaults.
        this.invertreset = this.nextBoolean(true);
        this.modulus = this.nextInt(0);
        if (this.pins[1]) this.pins[1].bubble = this.invertreset;
    }

    getDumpType() { return 164; }
    getChipName() { return this.modulus === 0 ? 'Counter' : `Counter (mod ${this.modulus})`; }
    needsBits() { return true; }
    allowBus() { return true; }
    hasUpDown() { return (this.flags & CounterElm.FLAG_UP_DOWN) !== 0; }
    negativeEdgeTriggered() { return (this.flags & CounterElm.FLAG_NEGATIVE_EDGE) !== 0; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = this.useBus() ? 3 : this.bits;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, '');
        this.pins[0].clock = true;
        this.pins[0].bubble = this.negativeEdgeTriggered();
        this.pins[1] = new Pin(this.sizeY - 1, SIDE_W, 'R');
        this.pins[1].bubble = this.invertreset;
        this.makeBitPins(this.bits, 0, SIDE_E, 2, 'Q', true, true, true);
        if (this.hasUpDown()) this.pins[this.bits + 2] = new Pin(this.sizeY - 2, SIDE_W, 'U/D');
    }

    getPostCount() { return this.hasUpDown() ? this.bits + 3 : this.bits + 2; }
    getVoltageSourceCount() { return this.bits; }

    execute(): void {
        const neg = this.negativeEdgeTriggered();
        if (this.pins[0].value !== neg && this.lastClock === neg) {
            let dir = 1;
            if (this.hasUpDown() && this.pins[this.bits + 2].value) dir = -1;

            const lastBit = 2 + this.bits - 1;
            let value = 0;
            for (let i = 0; i !== this.bits; i++) {
                if (this.pins[lastBit - i].value) value |= 1 << i;
            }
            value += dir;
            if (this.modulus !== 0) value = (value + this.modulus) % this.modulus;
            for (let i = 0; i !== this.bits; i++) {
                this.pins[lastBit - i].value = (value & (1 << i)) !== 0;
            }
        }
        // Java: `if (!pins[1].value == invertreset)` — i.e. reset fires when
        // the R pin reads the *inactive-inverted* level.
        if ((!this.pins[1].value) === this.invertreset) {
            for (let i = 0; i !== this.bits; i++) this.pins[i + 2].value = false;
        }
        this.lastClock = this.pins[0].value;
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.invertreset, this.modulus];
    }
}

// --------------------------------------------------------------- Counter2Elm

export class Counter2Elm extends ChipElm {
    modulus = 0;
    carry = false;
    clk = 0; clr = 0; enp = 0; rco = 0; load = 0; ent = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.modulus = this.nextInt(0);
    }

    getDumpType() { return 421; }
    getChipName() { return this.modulus === 0 ? 'Counter' : `Counter (mod ${this.modulus})`; }
    needsBits() { return true; }
    allowBus() { return true; }

    setupPins(): void {
        this.sizeX = 2;
        const bitsY = this.useBus() ? 1 : this.bits;
        this.sizeY = bitsY + 3;
        this.pins = new Array(this.getPostCount());
        this.makeBitPins(this.bits, 1, SIDE_E, 0, 'Q', true, true, true);
        this.makeBitPins(this.bits, 1, SIDE_W, this.bits, 'I', false, false, true);
        const p = this.bits * 2;
        this.clk = p; this.clr = p + 1; this.enp = p + 2;
        this.rco = p + 3; this.load = p + 4; this.ent = p + 5;
        this.pins[this.clk] = new Pin(0, SIDE_W, '');
        this.pins[this.clk].clock = true;
        this.pins[this.clr] = new Pin(bitsY + 1, SIDE_W, 'CLR');
        this.pins[this.clr].bubble = true;
        this.pins[this.enp] = new Pin(bitsY + 2, SIDE_W, 'EnP');
        this.pins[this.rco] = new Pin(0, SIDE_E, 'RCO');
        this.pins[this.rco].output = true;
        this.pins[this.load] = new Pin(bitsY + 1, SIDE_E, 'LOAD');
        this.pins[this.load].bubble = true;
        this.pins[this.ent] = new Pin(bitsY + 2, SIDE_E, 'EnT');
    }

    getPostCount() { return this.bits * 2 + 6; }
    getVoltageSourceCount() { return this.bits + 1; }

    private readValue(): number {
        const lastBit = this.bits - 1;
        let value = 0;
        for (let i = 0; i !== this.bits; i++) {
            if (this.pins[lastBit - i].value) value |= 1 << i;
        }
        return value;
    }

    execute(): void {
        if (this.pins[this.clk].value && !this.lastClock) {
            const realmod = this.modulus === 0 ? (1 << this.bits) : this.modulus;
            if (this.pins[this.enp].value && this.pins[this.ent].value) {
                const lastBit = this.bits - 1;
                let value = (this.readValue() + 1) % realmod;
                for (let i = 0; i !== this.bits; i++) {
                    this.writeOutput(lastBit - i, (value & (1 << i)) !== 0);
                }
                this.carry = (value === realmod - 1);
            }
            if (!this.pins[this.load].value) {
                for (let i = 0; i !== this.bits; i++) {
                    this.writeOutput(i, this.pins[i + this.bits].value);
                }
                this.carry = (this.readValue() === realmod - 1);
            }
        }
        if (!this.pins[this.clr].value) {
            for (let i = 0; i !== this.bits; i++) this.writeOutput(i, false);
            this.carry = false;
        }
        this.lastClock = this.pins[this.clk].value;
        this.writeOutput(this.rco, this.carry && this.pins[this.ent].value);
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.modulus];
    }
}

// ------------------------------------------------------------ RingCounterElm

export class RingCounterElm extends ChipElm {
    static FLAG_CLOCK_INHIBIT = 2;
    static FLAG_RESET_HIGH = 4;

    justLoaded = false;
    clockInhibit = -1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.justLoaded = true;
    }

    getDumpType() { return 163; }
    getChipName() { return 'ring counter'; }
    needsBits() { return true; }
    defaultBitCount() { return 10; }
    hasClockInhibit() { return (this.flags & RingCounterElm.FLAG_CLOCK_INHIBIT) !== 0 && this.bits >= 3; }
    hasInvertReset() { return (this.flags & RingCounterElm.FLAG_RESET_HIGH) === 0; }

    setupPins(): void {
        this.sizeX = this.bits > 2 ? this.bits : 2;
        this.sizeY = 2;
        const n = this.getPostCount();
        this.pins = new Array(n);
        this.pins[0] = new Pin(1, SIDE_W, '');
        this.pins[0].clock = true;
        this.pins[1] = new Pin(this.sizeX - 1, SIDE_S, 'R');
        this.pins[1].lineOver = this.hasInvertReset();
        for (let i = 0; i !== this.bits; i++) {
            const ii = i + 2;
            this.pins[ii] = new Pin(i, SIDE_N, 'Q' + i);
            this.pins[ii].output = this.pins[ii].state = true;
        }
        if (this.hasClockInhibit()) {
            this.clockInhibit = n - 1;
            this.pins[this.clockInhibit] = new Pin(1, SIDE_S, 'CE');
            this.pins[this.clockInhibit].lineOver = true;
        } else {
            this.clockInhibit = -1;
        }
    }

    getPostCount() { return this.hasClockInhibit() ? this.bits + 3 : this.bits + 2; }
    getVoltageSourceCount() { return this.bits; }

    execute(): void {
        // Right after a load the volts[] array is all zeroes, which would look
        // like a reset request and wipe the state we just restored; Java skips
        // the first execute() for exactly this reason.
        if (this.justLoaded) { this.justLoaded = false; return; }

        let running = true;
        if (this.hasClockInhibit() && this.pins[this.clockInhibit].value) running = false;

        let i = 0;
        for (; i !== this.bits; i++) if (this.pins[i + 2].value) break;

        if (this.pins[0].value && !this.lastClock && running) {
            if (i < this.bits) this.pins[i++ + 2].value = false;
            i %= this.bits;
            this.pins[i + 2].value = true;
        }

        if (this.pins[1].value !== this.hasInvertReset() || i === this.bits) {
            for (i = 1; i !== this.bits; i++) this.pins[i + 2].value = false;
            this.pins[2].value = true;
        }
        this.lastClock = this.pins[0].value;
    }
}

// ------------------------------------------------------------- DFlipFlopElm

export class DFlipFlopElm extends ChipElm {
    static FLAG_RESET = 2;
    static FLAG_SET = 4;
    static FLAG_INVERT_SET_RESET = 8;

    justLoaded = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.pins[2].value = !this.pins[1].value;
        this.justLoaded = true;
    }

    getDumpType() { return 155; }
    getChipName() { return 'D flip-flop'; }
    hasSet() { return (this.flags & DFlipFlopElm.FLAG_SET) !== 0; }
    hasReset() { return (this.flags & DFlipFlopElm.FLAG_RESET) !== 0 || this.hasSet(); }
    invertSetReset() { return (this.flags & DFlipFlopElm.FLAG_INVERT_SET_RESET) !== 0; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 3;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, 'D');
        this.pins[1] = new Pin(0, SIDE_E, 'Q');
        this.pins[1].output = this.pins[1].state = true;
        this.pins[2] = new Pin(this.hasSet() ? 1 : 2, SIDE_E, 'Q');
        this.pins[2].output = true;
        this.pins[2].lineOver = true;
        this.pins[3] = new Pin(1, SIDE_W, '');
        this.pins[3].clock = true;
        if (!this.hasSet()) {
            if (this.hasReset()) {
                this.pins[4] = new Pin(2, SIDE_W, 'R');
                this.pins[4].bubble = this.invertSetReset();
            }
        } else {
            this.pins[5] = new Pin(2, SIDE_W, 'S');
            this.pins[4] = new Pin(2, SIDE_E, 'R');
            this.pins[4].bubble = this.pins[5].bubble = this.invertSetReset();
        }
    }

    getPostCount() { return 4 + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0); }
    getVoltageSourceCount() { return 2; }

    reset(): void {
        super.reset();
        this.volts[2] = this.highVoltage;
        this.pins[2].value = true;
    }

    execute(): void {
        if (this.justLoaded) { this.justLoaded = false; return; }

        let isSet = false, isReset = false;
        if (this.hasSet() && this.pins[5].value !== this.invertSetReset()) isSet = true;
        if (this.hasReset() && this.pins[4].value !== this.invertSetReset()) isReset = true;

        if (isSet || isReset) {
            this.writeOutput(1, false);
            this.writeOutput(2, false);
            if (isSet) this.writeOutput(1, true);
            if (isReset) this.writeOutput(2, true);
        } else {
            if (this.pins[3].value && !this.lastClock) this.writeOutput(1, this.pins[0].value);
            this.writeOutput(2, !this.pins[1].value);
        }
        this.lastClock = this.pins[3].value;
    }
}

// ------------------------------------------------------------ JKFlipFlopElm

export class JKFlipFlopElm extends ChipElm {
    static FLAG_RESET = 2;
    static FLAG_POSITIVE_EDGE = 4;
    static FLAG_INVERT_RESET = 8;

    justLoaded = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.pins[4].value = !this.pins[3].value;
        this.justLoaded = true;
    }

    getDumpType() { return 156; }
    getChipName() { return 'JK flip-flop'; }
    hasReset() { return (this.flags & JKFlipFlopElm.FLAG_RESET) !== 0; }
    positiveEdgeTriggered() { return (this.flags & JKFlipFlopElm.FLAG_POSITIVE_EDGE) !== 0; }
    invertReset() { return (this.flags & JKFlipFlopElm.FLAG_INVERT_RESET) !== 0; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 3;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, 'J');
        this.pins[1] = new Pin(1, SIDE_W, '');
        this.pins[1].clock = true;
        this.pins[1].bubble = !this.positiveEdgeTriggered();
        this.pins[2] = new Pin(2, SIDE_W, 'K');
        this.pins[3] = new Pin(0, SIDE_E, 'Q');
        this.pins[3].output = this.pins[3].state = true;
        this.pins[4] = new Pin(2, SIDE_E, 'Q');
        this.pins[4].output = true;
        this.pins[4].lineOver = true;
        if (this.hasReset()) {
            this.pins[5] = new Pin(1, SIDE_E, 'R');
            this.pins[5].bubble = this.invertReset();
        }
    }

    getPostCount() { return 5 + (this.hasReset() ? 1 : 0); }
    getVoltageSourceCount() { return 2; }

    execute(): void {
        if (this.justLoaded) { this.justLoaded = false; return; }

        const transition = this.positiveEdgeTriggered()
            ? (this.pins[1].value && !this.lastClock)
            : (!this.pins[1].value && this.lastClock);
        if (transition) {
            let q = this.pins[3].value;
            if (this.pins[0].value) {
                q = this.pins[2].value ? !q : true;
            } else if (this.pins[2].value) {
                q = false;
            }
            this.writeOutput(3, q);
        }
        this.lastClock = this.pins[1].value;

        if (this.hasReset() && this.pins[5].value !== this.invertReset()) this.writeOutput(3, false);
        this.writeOutput(4, !this.pins[3].value);
    }
}

// ------------------------------------------------------------- TFlipFlopElm

export class TFlipFlopElm extends ChipElm {
    static FLAG_RESET = 2;
    static FLAG_SET = 4;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.pins[2].value = !this.pins[1].value;
    }

    getDumpType() { return 193; }
    getChipName() { return 'T flip-flop'; }
    hasSet() { return (this.flags & TFlipFlopElm.FLAG_SET) !== 0; }
    hasReset() { return (this.flags & TFlipFlopElm.FLAG_RESET) !== 0 || this.hasSet(); }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 3;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, 'T');
        this.pins[1] = new Pin(0, SIDE_E, 'Q');
        this.pins[1].output = this.pins[1].state = true;
        this.pins[2] = new Pin(this.hasSet() ? 1 : 2, SIDE_E, 'Q');
        this.pins[2].output = true;
        this.pins[2].lineOver = true;
        this.pins[3] = new Pin(1, SIDE_W, '');
        this.pins[3].clock = true;
        if (!this.hasSet()) {
            if (this.hasReset()) this.pins[4] = new Pin(2, SIDE_W, 'R');
        } else {
            this.pins[5] = new Pin(2, SIDE_W, 'S');
            this.pins[4] = new Pin(2, SIDE_E, 'R');
        }
    }

    getPostCount() { return 4 + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0); }
    getVoltageSourceCount() { return 2; }

    reset(): void {
        super.reset();
        this.volts[2] = this.highVoltage;
        this.pins[2].value = true;
    }

    execute(): void {
        if (this.pins[3].value && !this.lastClock) {
            if (this.pins[0].value) this.pins[1].value = !this.pins[1].value;
        }
        if (this.hasSet() && this.pins[5].value) this.pins[1].value = true;
        if (this.hasReset() && this.pins[4].value) this.pins[1].value = false;
        this.pins[2].value = !this.pins[1].value;
        this.lastClock = this.pins[3].value;
    }
}

// ------------------------------------------------------------------ LatchElm

export class LatchElm extends ChipElm {
    static FLAG_STATE = 2;
    static FLAG_NO_EDGE = 4;
    static FLAG_RESET = 8;
    static FLAG_SET = 16;
    static FLAG_ENABLE_MASK = 32 | 64;
    static FLAG_ENABLE_SHIFT = 5;

    loadPin = 0; resetPin = 0; setPin = 0;
    ie1Pin = 0; ie2Pin = 0; oe1Pin = 0; oe2Pin = 0;
    intNodes = 0;
    vSources: VoltageSource[] = [];
    lastLoad = false;
    outputValues: boolean[] | null = null;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        // Old latches predate FLAG_STATE; Java adds it on load so their state
        // starts being saved from here on, which changes which pins are
        // `state` and therefore has to re-run setupPins().
        if ((this.flags & LatchElm.FLAG_STATE) === 0) {
            this.flags |= LatchElm.FLAG_STATE;
            this.setupPins();
            this.allocNodes();
            this.setPoints();
        }
        this.restoreOutputValues();
    }

    getDumpType() { return 168; }
    getChipName() { return 'Latch'; }
    needsBits() { return true; }
    allowBus() { return true; }
    isEdgeTriggered() { return (this.flags & LatchElm.FLAG_NO_EDGE) === 0; }
    hasReset() { return (this.flags & LatchElm.FLAG_RESET) !== 0; }
    hasSet() { return (this.flags & LatchElm.FLAG_SET) !== 0; }
    enableMode() { return (this.flags & LatchElm.FLAG_ENABLE_MASK) >> LatchElm.FLAG_ENABLE_SHIFT; }
    inputEnableCount() { return this.enableMode(); }
    outputEnableCount() { return this.enableMode(); }
    hasOutputEnable() { return this.enableMode() > 0; }
    nonLinear() { return this.hasOutputEnable(); }

    setupPins(): void {
        this.sizeX = 2;
        const ieCount = this.inputEnableCount();
        const oeCount = this.outputEnableCount();
        const extraLeftPins = (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0) + ieCount;
        const bitsY = this.useBus() ? 1 : this.bits;
        this.sizeY = Math.max(bitsY + 1 + extraLeftPins, bitsY + oeCount);
        this.pins = new Array(this.getPostCount());
        this.makeBitPins(this.bits, 0, SIDE_W, 0, 'I', false, false, false);
        this.makeBitPins(this.bits, 0, SIDE_E, this.bits, 'O',
            !this.hasOutputEnable(), (this.flags & LatchElm.FLAG_STATE) !== 0, false);

        let pinIndex = this.bits * 2;
        let leftPos = bitsY;
        this.pins[this.loadPin = pinIndex++] = new Pin(leftPos++, SIDE_W, 'Ld');
        if (this.hasReset()) this.pins[this.resetPin = pinIndex++] = new Pin(leftPos++, SIDE_W, 'R');
        if (this.hasSet()) this.pins[this.setPin = pinIndex++] = new Pin(leftPos++, SIDE_W, 'S');
        let rightPos = leftPos;
        if (ieCount >= 1) {
            this.pins[this.ie1Pin = pinIndex++] = new Pin(leftPos++, SIDE_W, 'IE');
            this.pins[this.ie1Pin].lineOver = true;
        }
        if (ieCount >= 2) {
            this.pins[this.ie2Pin = pinIndex++] = new Pin(leftPos++, SIDE_W, 'IE');
            this.pins[this.ie2Pin].lineOver = true;
        }
        if (oeCount >= 1) {
            this.pins[this.oe1Pin = pinIndex++] = new Pin(rightPos++, SIDE_E, 'OE');
            this.pins[this.oe1Pin].lineOver = true;
        }
        if (oeCount >= 2) {
            this.pins[this.oe2Pin = pinIndex++] = new Pin(rightPos++, SIDE_E, 'OE');
            this.pins[this.oe2Pin].lineOver = true;
        }
        this.intNodes = pinIndex;
    }

    getPostCount() {
        return this.bits * 2 + 1
            + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0)
            + this.inputEnableCount() + this.outputEnableCount();
    }
    getVoltageSourceCount() { return this.bits; }
    getInternalNodeCount() { return this.hasOutputEnable() ? this.bits : 0; }

    lastOutputValues(): boolean[] {
        if (!this.outputValues) this.outputValues = new Array(this.bits).fill(false);
        return this.outputValues;
    }

    restoreOutputValues(): void {
        const ov = this.lastOutputValues();
        for (let i = 0; i !== this.bits; i++) ov[i] = this.pins[i + this.bits].value;
    }

    reset(): void {
        super.reset();
        this.outputValues = null;
    }

    private doLoad(): void {
        const ov = this.lastOutputValues();
        if (this.hasSet() && this.pins[this.setPin].value) {
            for (let i = 0; i !== this.bits; i++) ov[i] = true;
            this.lastLoad = this.pins[this.loadPin].value;
            return;
        }
        if (this.hasReset() && this.pins[this.resetPin].value) {
            for (let i = 0; i !== this.bits; i++) ov[i] = false;
            this.lastLoad = this.pins[this.loadPin].value;
            return;
        }
        let inputEnabled = true;
        if (this.inputEnableCount() >= 1 && this.pins[this.ie1Pin].value) inputEnabled = false;
        if (this.inputEnableCount() >= 2 && this.pins[this.ie2Pin].value) inputEnabled = false;
        if (inputEnabled && this.pins[this.loadPin].value && (!this.isEdgeTriggered() || !this.lastLoad)) {
            for (let i = 0; i !== this.bits; i++) ov[i] = this.pins[i].value;
        }
        this.lastLoad = this.pins[this.loadPin].value;
    }

    execute(): void {
        this.doLoad();
        for (let i = 0; i !== this.bits; i++) {
            this.pins[i + this.bits].value = this.lastOutputValues()[i];
        }
    }

    // With output enables present the outputs are tri-stated through a
    // switched resistor rather than driven directly, so the whole ChipElm
    // stamp/doStep pair is replaced (Java does the same).
    stamp(stamper: Stamper): void {
        if (!this.hasOutputEnable()) { super.stamp(stamper); return; }
        for (let i = 0; i < this.bits; i++) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[this.intNodes + i], this.vSources[i]);
            stamper.stampNonLinear(this.nodes[this.intNodes + i]);
            stamper.stampNonLinear(this.nodes[this.bits + i]);
        }
    }

    doStep(stamper: Stamper): void {
        if (!this.hasOutputEnable()) { super.doStep(stamper); return; }

        for (let i = 0; i < this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && !p.output) p.value = this.volts[i] > this.getThreshold();
        }
        this.doLoad();

        let outputEnabled = true;
        if (this.outputEnableCount() >= 1 && this.pins[this.oe1Pin].value) outputEnabled = false;
        if (this.outputEnableCount() >= 2 && this.pins[this.oe2Pin].value) outputEnabled = false;

        for (let i = 0; i < this.bits; i++) {
            const v = this.lastOutputValues()[i] ? this.highVoltage : 0;
            stamper.updateVoltageSource(CircuitNode.ground, this.nodes[this.intNodes + i], this.vSources[i], v);
            if (outputEnabled) {
                stamper.stampResistor(this.nodes[this.intNodes + i], this.nodes[this.bits + i], 1);
            } else {
                stamper.stampResistor(this.nodes[this.bits + i], CircuitNode.ground, 1e8);
            }
        }
    }

    setVoltageSource(j: number, vs: VoltageSource): void {
        if (this.hasOutputEnable()) {
            if (this.vSources.length !== this.bits) this.vSources = new Array(this.bits);
            this.vSources[j] = vs;
            vs.setNodes(CircuitNode.ground, this.nodes[this.intNodes + j]);
        } else {
            super.setVoltageSource(j, vs);
        }
    }

    getMatrixConnection(n1: number, n2: number): boolean {
        if (this.hasOutputEnable()) {
            for (let i = 0; i < this.bits; i++) {
                const a = this.intNodes + i, b = this.bits + i;
                if ((n1 === a && n2 === b) || (n1 === b && n2 === a)) return true;
            }
        }
        return false;
    }

    getConnection(_n1: number, _n2: number): boolean { return false; }
    hasGroundConnection(n1: number): boolean {
        if (this.hasOutputEnable()) return n1 >= this.bits && n1 < this.bits * 2;
        const p = this.pins[n1];
        return !!p && p.output;
    }
}
