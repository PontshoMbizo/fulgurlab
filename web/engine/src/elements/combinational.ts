import { Point } from './base';
import { ChipElm, Pin, SIDE_W, SIDE_E, SIDE_N, SIDE_S } from './chip';

// Combinational + shift-register digital chips ported from Java. See chip.ts
// for the shared ChipElm machinery.
//
// DUMP-FORMAT NOTE: this fork of circuitjs1 dropped the legacy text `dump()`
// override on several of these (MultiplexerElm, SeqGenElm, PisoShiftElm,
// SipoShiftElm) — they serialize through XML only, while their *text*
// constructors still read the old trailing tokens so legacy files load. That
// asymmetry silently loses state on a text save (a sequence generator's whole
// pattern, a shift register's contents). This port keeps the reading side
// byte-compatible with Java and re-emits the same tokens on dump, so the
// round trip is lossless in this engine's own self-consistent format (see
// base.ts's dump() comment for why that format deliberately isn't Java's).

// -------------------------------------------------------------- Multiplexer

export const INPUT_MODE_INDIVIDUAL = 0;
export const INPUT_MODE_BUS_BIT = 1;
export const INPUT_MODE_BUS_BUS = 2;

export class MultiplexerElm extends ChipElm {
    static FLAG_INVERTED_OUTPUT = 1 << 1;
    static FLAG_STROBE = 1 << 2;
    static FLAG_BUS_SELECT = 1 << 3;

    selectBitCount = 2;
    outputCount = 4;
    inputMode = INPUT_MODE_INDIVIDUAL;
    dataBusWidth = 4;
    strobe = -1;
    outputPin = 0;
    selectPin = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.selectBitCount = this.nextInt(2);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
    }

    getDumpType() { return 184; }
    getChipName() { return 'Multiplexer'; }
    busSelect() { return (this.flags & MultiplexerElm.FLAG_BUS_SELECT) !== 0; }
    hasInverted() { return (this.flags & MultiplexerElm.FLAG_INVERTED_OUTPUT) !== 0; }
    hasStrobe() { return (this.flags & MultiplexerElm.FLAG_STROBE) !== 0; }

    private makeSelectPins(basePos: number): void {
        for (let i = 0; i < this.selectBitCount; i++) {
            const n = this.selectPin + i;
            if (this.busSelect()) {
                this.pins[n] = new Pin(0, SIDE_S, 'S');
                this.pins[n].busWidth = this.selectBitCount;
                this.pins[n].busZ = i;
            } else {
                this.pins[n] = new Pin(i + basePos, SIDE_S, 'S' + i);
            }
        }
    }

    setupPins(): void {
        if (this.selectBitCount === 0) this.selectBitCount = 2;
        this.outputCount = 1 << this.selectBitCount;
        this.pins = new Array(this.getPostCount());

        if (this.inputMode === INPUT_MODE_BUS_BUS) {
            const inputPinCount = this.outputCount * this.dataBusWidth;
            const invertedCount = this.hasInverted() ? this.dataBusWidth : 0;
            this.sizeX = this.selectBitCount + 1;
            this.sizeY = this.outputCount + 1;

            for (let g = 0; g < this.outputCount; g++) {
                for (let i = 0; i < this.dataBusWidth; i++) {
                    const n = g * this.dataBusWidth + i;
                    this.pins[n] = new Pin(g, SIDE_W, 'I' + g);
                    this.pins[n].busWidth = this.dataBusWidth;
                    this.pins[n].busZ = i;
                }
            }
            this.selectPin = inputPinCount;
            this.makeSelectPins(1);
            this.outputPin = this.selectPin + this.selectBitCount;
            for (let i = 0; i < this.dataBusWidth; i++) {
                const n = this.outputPin + i;
                this.pins[n] = new Pin(0, SIDE_E, 'Q');
                this.pins[n].output = true;
                this.pins[n].busWidth = this.dataBusWidth;
                this.pins[n].busZ = i;
            }
            if (this.hasInverted()) {
                for (let i = 0; i < this.dataBusWidth; i++) {
                    const n = this.outputPin + this.dataBusWidth + i;
                    this.pins[n] = new Pin(1, SIDE_E, 'Q');
                    this.pins[n].lineOver = true;
                    this.pins[n].output = true;
                    this.pins[n].bubble = (i === 0);
                    this.pins[n].busWidth = this.dataBusWidth;
                    this.pins[n].busZ = i;
                }
            }
            if (this.hasStrobe()) {
                const n = this.outputPin + this.dataBusWidth + invertedCount;
                this.pins[n] = new Pin(0, SIDE_S, 'STR');
                this.strobe = n;
            } else {
                this.strobe = -1;
            }
            return;
        }

        this.sizeX = this.selectBitCount + 1;
        this.sizeY = this.inputMode === INPUT_MODE_BUS_BIT ? 3 : this.outputCount + 1;

        if (this.inputMode === INPUT_MODE_BUS_BIT) {
            for (let i = 0; i < this.outputCount; i++) {
                this.pins[i] = new Pin(0, SIDE_W, 'I');
                this.pins[i].busWidth = this.outputCount;
                this.pins[i].busZ = i;
            }
        } else {
            for (let i = 0; i < this.outputCount; i++) {
                this.pins[i] = new Pin(i, SIDE_W, 'I' + i);
            }
        }
        this.selectPin = this.outputCount;
        this.makeSelectPins(1);

        let n = this.selectPin + this.selectBitCount;
        this.pins[n] = new Pin(0, SIDE_E, 'Q');
        this.pins[n].output = true;
        this.outputPin = n;
        if (this.hasInverted()) {
            n++;
            this.pins[n] = new Pin(1, SIDE_E, 'Q');
            this.pins[n].lineOver = true;
            this.pins[n].output = true;
            this.pins[n].bubble = true;
        }
        if (this.hasStrobe()) {
            n++;
            this.pins[n] = new Pin(0, SIDE_S, 'STR');
            this.strobe = n;
        } else {
            this.strobe = -1;
        }
    }

    getPostCount(): number {
        const outputCount = 1 << (this.selectBitCount || 2);
        if (this.inputMode === INPUT_MODE_BUS_BUS) {
            const invertedCount = this.hasInverted() ? this.dataBusWidth : 0;
            return outputCount * this.dataBusWidth + this.selectBitCount + this.dataBusWidth
                + invertedCount + (this.hasStrobe() ? 1 : 0);
        }
        return outputCount + this.selectBitCount + 1
            + (this.hasInverted() ? 1 : 0) + (this.hasStrobe() ? 1 : 0);
    }

    getVoltageSourceCount(): number {
        if (this.inputMode === INPUT_MODE_BUS_BUS) {
            return this.hasInverted() ? this.dataBusWidth * 2 : this.dataBusWidth;
        }
        return this.hasInverted() ? 2 : 1;
    }

    readSelectValue(): number {
        let sel = 0;
        for (let i = 0; i < this.selectBitCount; i++) {
            if (this.pins[this.selectPin + i].value) sel |= 1 << i;
        }
        return sel;
    }

    execute(): void {
        const selectedValue = this.readSelectValue();
        if (this.inputMode === INPUT_MODE_BUS_BUS) {
            const strobed = this.strobe !== -1 && this.pins[this.strobe].value;
            for (let i = 0; i < this.dataBusWidth; i++) {
                this.pins[this.outputPin + i].value = strobed
                    ? false
                    : this.pins[selectedValue * this.dataBusWidth + i].value;
            }
            if (this.hasInverted()) {
                for (let i = 0; i < this.dataBusWidth; i++) {
                    this.pins[this.outputPin + this.dataBusWidth + i].value =
                        !this.pins[this.outputPin + i].value;
                }
            }
        } else {
            let val = this.pins[selectedValue].value;
            if (this.strobe !== -1 && this.pins[this.strobe].value) val = false;
            this.pins[this.outputPin].value = val;
            if (this.hasInverted()) this.pins[this.outputPin + 1].value = !val;
        }
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.selectBitCount];
    }
}

// ------------------------------------------------------------ DeMultiplexer

export const OUTPUT_MODE_INDIVIDUAL = 0;
export const OUTPUT_MODE_BUS_BIT = 1;
export const OUTPUT_MODE_BUS_BUS = 2;

export class DeMultiplexerElm extends ChipElm {
    static FLAG_BUS_SELECT = 1 << 3;

    selectBitCount = 2;
    outputCount = 4;
    outputMode = OUTPUT_MODE_INDIVIDUAL;
    dataBusWidth = 4;
    inputPin = 0;
    selectPin = 0;
    outputPin = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.selectBitCount = this.nextInt(2);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
    }

    getDumpType() { return 185; }
    getChipName() { return 'Demultiplexer'; }
    busSelect() { return (this.flags & DeMultiplexerElm.FLAG_BUS_SELECT) !== 0; }

    private makeSelectPins(basePos: number): void {
        for (let i = 0; i < this.selectBitCount; i++) {
            const n = this.selectPin + i;
            if (this.busSelect()) {
                this.pins[n] = new Pin(0, SIDE_S, 'S');
                this.pins[n].busWidth = this.selectBitCount;
                this.pins[n].busZ = i;
            } else {
                this.pins[n] = new Pin(i + basePos, SIDE_S, 'S' + i);
            }
        }
    }

    setupPins(): void {
        if (this.selectBitCount === 0) this.selectBitCount = 2;
        this.outputCount = 1 << this.selectBitCount;
        this.pins = new Array(this.getPostCount());

        if (this.outputMode === OUTPUT_MODE_BUS_BUS) {
            this.sizeX = this.selectBitCount + 1;
            this.sizeY = this.outputCount + 1;
            this.inputPin = 0;
            for (let i = 0; i < this.dataBusWidth; i++) {
                this.pins[i] = new Pin(0, SIDE_W, 'Q');
                this.pins[i].busWidth = this.dataBusWidth;
                this.pins[i].busZ = i;
            }
            this.selectPin = this.dataBusWidth;
            this.makeSelectPins(1);
            this.outputPin = this.selectPin + this.selectBitCount;
            for (let g = 0; g < this.outputCount; g++) {
                for (let i = 0; i < this.dataBusWidth; i++) {
                    const n = this.outputPin + g * this.dataBusWidth + i;
                    this.pins[n] = new Pin(g, SIDE_E, 'Q' + g);
                    this.pins[n].output = true;
                    this.pins[n].busWidth = this.dataBusWidth;
                    this.pins[n].busZ = i;
                }
            }
            return;
        }

        if (this.outputMode === OUTPUT_MODE_BUS_BIT) {
            this.sizeX = this.selectBitCount + 1;
            this.sizeY = 3;
            this.inputPin = 0;
            this.pins[0] = new Pin(0, SIDE_W, 'Q');
            this.selectPin = 1;
            this.makeSelectPins(1);
            this.outputPin = this.selectPin + this.selectBitCount;
            for (let i = 0; i < this.outputCount; i++) {
                const n = this.outputPin + i;
                this.pins[n] = new Pin(1, SIDE_E, 'Q');
                this.pins[n].output = true;
                this.pins[n].busWidth = this.outputCount;
                this.pins[n].busZ = i;
            }
            return;
        }

        this.sizeX = 1 + this.selectBitCount;
        this.sizeY = 1 + this.outputCount;
        this.outputPin = 0;
        for (let i = 0; i < this.outputCount; i++) {
            this.pins[i] = new Pin(i, SIDE_E, 'Q' + i);
            this.pins[i].output = true;
        }
        this.selectPin = this.outputCount;
        this.makeSelectPins(0);
        this.inputPin = this.outputCount + this.selectBitCount;
        this.pins[this.inputPin] = new Pin(0, SIDE_W, 'Q');
    }

    getPostCount(): number {
        const outputCount = 1 << (this.selectBitCount || 2);
        if (this.outputMode === OUTPUT_MODE_BUS_BUS) {
            return this.dataBusWidth + this.selectBitCount + outputCount * this.dataBusWidth;
        }
        return 1 + this.selectBitCount + outputCount;
    }

    getVoltageSourceCount(): number {
        const outputCount = 1 << (this.selectBitCount || 2);
        return this.outputMode === OUTPUT_MODE_BUS_BUS ? outputCount * this.dataBusWidth : outputCount;
    }

    readSelectValue(): number {
        let sel = 0;
        for (let i = 0; i < this.selectBitCount; i++) {
            if (this.pins[this.selectPin + i].value) sel |= 1 << i;
        }
        return sel;
    }

    execute(): void {
        const selectedValue = this.readSelectValue();
        if (this.outputMode === OUTPUT_MODE_BUS_BUS) {
            for (let g = 0; g < this.outputCount; g++) {
                for (let i = 0; i < this.dataBusWidth; i++) {
                    this.pins[this.outputPin + g * this.dataBusWidth + i].value = false;
                }
            }
            for (let i = 0; i < this.dataBusWidth; i++) {
                this.pins[this.outputPin + selectedValue * this.dataBusWidth + i].value =
                    this.pins[this.inputPin + i].value;
            }
            return;
        }
        for (let i = 0; i < this.outputCount; i++) this.pins[this.outputPin + i].value = false;
        this.pins[this.outputPin + selectedValue].value = this.pins[this.inputPin].value;
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.selectBitCount];
    }
}

// ---------------------------------------------------------------- HalfAdder

export class HalfAdderElm extends ChipElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 195; }
    getChipName() { return 'Half Adder'; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 2;
        this.pins = new Array(4);
        this.pins[0] = new Pin(0, SIDE_E, 'S');
        this.pins[0].output = true;
        this.pins[1] = new Pin(1, SIDE_E, 'C');
        this.pins[1].output = true;
        this.pins[2] = new Pin(0, SIDE_W, 'A');
        this.pins[3] = new Pin(1, SIDE_W, 'B');
    }

    getPostCount() { return 4; }
    getVoltageSourceCount() { return 2; }

    execute(): void {
        this.pins[0].value = this.pins[2].value !== this.pins[3].value;
        this.pins[1].value = this.pins[2].value && this.pins[3].value;
    }
}

// ---------------------------------------------------------------- FullAdder

export class FullAdderElm extends ChipElm {
    static FLAG_BITS = 2;

    carryIn = 0;
    carryOut = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        if (!this.needsBits()) {
            this.bits = 1;
            this.setupPins();
            this.allocNodes();
            this.setPoints();
        }
    }

    getDumpType() { return 196; }
    getChipName() { return 'Adder'; }
    needsBits() { return (this.flags & FullAdderElm.FLAG_BITS) !== 0; }
    allowBus() { return this.needsBits(); }

    setupPins(): void {
        const bits = this.bits || 1;
        this.bits = bits;
        this.sizeX = 2;
        const bitsY = this.useBus() ? 1 : bits;
        this.sizeY = bitsY * 2 + 1;
        this.pins = new Array(this.getPostCount());
        this.makeBitPins(bits, 0, SIDE_W, 0, 'A', false, false, false);
        this.makeBitPins(bits, bitsY, SIDE_W, bits, 'B', false, false, false);
        this.makeBitPins(bits, 2, SIDE_E, bits * 2, 'S', true, false, false);
        this.carryIn = bits * 3;
        this.carryOut = bits * 3 + 1;
        this.pins[this.carryOut] = new Pin(0, SIDE_E, 'C');
        this.pins[this.carryOut].output = true;
        this.pins[this.carryIn] = new Pin(bitsY * 2, SIDE_W, 'Cin');
    }

    getPostCount() { return (this.bits || 1) * 3 + 2; }
    getVoltageSourceCount() { return (this.bits || 1) + 1; }

    execute(): void {
        let c = this.pins[this.carryIn].value ? 1 : 0;
        for (let i = 0; i !== this.bits; i++) {
            const v = (this.pins[i].value ? 1 : 0) + (this.pins[i + this.bits].value ? 1 : 0) + c;
            c = v > 1 ? 1 : 0;
            this.writeOutput(i + this.bits * 2, (v & 1) === 1);
        }
        this.writeOutput(this.carryOut, c === 1);
    }
}

// -------------------------------------------------------- SevenSegDecoder

// Segment tables copied verbatim from SevenSegDecoderElm.java.
const SYMBOLS_7 = [
    [1, 1, 1, 1, 1, 1, 0], [0, 1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0, 1], [1, 1, 1, 1, 0, 0, 1],
    [0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 1, 1], [1, 1, 1, 0, 1, 1, 1], [0, 0, 1, 1, 1, 1, 1],
    [1, 0, 0, 1, 1, 1, 0], [0, 1, 1, 1, 1, 0, 1], [1, 0, 0, 1, 1, 1, 1], [1, 0, 0, 0, 1, 1, 1],
];
const SYMBOLS_14 = [
    [1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
    [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1],
];
const SYMBOLS_16 = [
    [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0],
    [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1],
];

export class SevenSegDecoderElm extends ChipElm {
    static FLAG_ENABLE = 1 << 1;
    static FLAG_BLANK_F = 1 << 2;

    segmentType = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        const st = this.nextInt(-1);
        if (st >= 0) {
            this.segmentType = st;
            this.setupPins();
            this.allocNodes();
            this.setPoints();
        }
    }

    getDumpType() { return 197; }
    getSegmentCount() { return this.segmentType === 1 ? 14 : this.segmentType === 2 ? 16 : 7; }
    getChipName() { return `${this.getSegmentCount()}-Segment Decoder`; }
    needsBits() { return false; }
    allowBus() { return true; }
    hasBlank() { return (this.flags & SevenSegDecoderElm.FLAG_ENABLE) !== 0; }
    blankOnF() { return (this.flags & SevenSegDecoderElm.FLAG_BLANK_F) !== 0; }

    setupPins(): void {
        const segCount = this.getSegmentCount();
        this.bits = 4;
        this.sizeX = 3;
        const inputPinsY = this.useBus() ? 1 : 4;
        const outputPinsY = this.useBus() ? 1 : segCount;
        this.sizeY = Math.max(outputPinsY, inputPinsY + (this.hasBlank() ? 1 : 0));
        this.pins = new Array(this.getPostCount());

        this.makeBitPins(4, 0, SIDE_W, segCount, 'I', false, false, true);
        if (this.useBus()) {
            this.makeBitPins(segCount, 0, SIDE_E, 0, 'seg', true, false, false);
        } else {
            for (let i = 0; i < segCount; i++) {
                this.pins[i] = new Pin(i, SIDE_E, String.fromCharCode(97 + i));
                this.pins[i].output = true;
            }
        }
        if (this.hasBlank()) {
            this.pins[segCount + 4] = new Pin(inputPinsY, SIDE_W, 'BI');
            this.pins[segCount + 4].bubble = true;
        }
    }

    getPostCount() { return this.getSegmentCount() + 4 + (this.hasBlank() ? 1 : 0); }
    getVoltageSourceCount() { return this.getSegmentCount(); }

    execute(): void {
        const segCount = this.getSegmentCount();
        let input = 0;
        if (this.pins[segCount + 0].value) input += 8;
        if (this.pins[segCount + 1].value) input += 4;
        if (this.pins[segCount + 2].value) input += 2;
        if (this.pins[segCount + 3].value) input += 1;

        let en = true;
        if (this.hasBlank() && !this.pins[segCount + 4].value) en = false;
        if (!en || (input === 15 && this.blankOnF())) {
            for (let i = 0; i !== segCount; i++) this.writeOutput(i, false);
        } else {
            const sym = segCount === 14 ? SYMBOLS_14 : segCount === 16 ? SYMBOLS_16 : SYMBOLS_7;
            for (let i = 0; i < segCount; i++) this.writeOutput(i, sym[input][i] === 1);
        }
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.segmentType];
    }
}

// ------------------------------------------------------------------- SeqGen

const INT_SIZE = 32;

export class SeqGenElm extends ChipElm {
    static FLAG_NEW_VERSION = 2;
    static FLAG_PLAY_ONCE = 4;
    static FLAG_HAS_RESET = 8;

    bitPosition = 0;
    bitCount = 0;
    data: number[] = [0];
    clockstate = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);

        if ((this.flags & SeqGenElm.FLAG_NEW_VERSION) === 0) {
            // Pre-FLAG_NEW_VERSION dumps stored a single byte read right-to-
            // left. Java "upgrades" it in place; the bit-reversal loop there
            // is a no-op in practice (the mask it builds is non-zero for every
            // i), so this reproduces its actual result: keep the byte as-is.
            this.flags |= SeqGenElm.FLAG_NEW_VERSION;
            const oldData = this.nextInt(0);
            this.bitCount = 8;
            this.data = [oldData & 0xff];
        } else {
            this.bitCount = this.nextInt(0);
            const words = Math.floor(this.bitCount / INT_SIZE) + (this.bitCount % INT_SIZE !== 0 ? 1 : 0);
            this.data = new Array(Math.max(words, 0)).fill(0);
            for (let i = 0; i < this.data.length; i++) this.data[i] = this.nextInt(0);
        }
        if (this.bitCount > this.data.length * INT_SIZE) this.bitCount = this.data.length * INT_SIZE;
    }

    getDumpType() { return 188; }
    getChipName() { return 'sequence generator'; }
    hasPlayOnce() { return (this.flags & SeqGenElm.FLAG_PLAY_ONCE) !== 0; }
    hasReset() { return (this.flags & SeqGenElm.FLAG_HAS_RESET) !== 0; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = 2;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, '');
        this.pins[0].clock = true;
        this.pins[1] = new Pin(1, SIDE_E, 'Q');
        this.pins[1].output = true;
        if (this.hasReset()) this.pins[2] = new Pin(1, SIDE_W, 'R');
    }

    getPostCount() { return this.hasReset() ? 3 : 2; }
    getVoltageSourceCount() { return 1; }
    getVoltageDiff() { return this.volts[1]; }

    reset(): void {
        super.reset();
        this.bitPosition = 0;
    }

    private nextBit(): void {
        if (this.data.length > 0 && this.bitCount > 0) {
            if (this.bitPosition >= this.bitCount) {
                if (this.hasPlayOnce()) { this.pins[1].value = false; return; }
                this.bitPosition = 0;
            }
            const word = this.data[Math.floor(this.bitPosition / INT_SIZE)];
            this.pins[1].value = (word & (1 << (this.bitPosition % INT_SIZE))) !== 0;
            this.bitPosition++;
        } else {
            this.pins[1].value = false;
        }
    }

    execute(): void {
        if (this.hasReset() && this.pins[2].value) {
            this.bitPosition = 0;
            this.clockstate = this.pins[0].value;
            this.nextBit();
        } else if (this.pins[0].value !== this.clockstate) {
            this.clockstate = this.pins[0].value;
            if (this.clockstate) this.nextBit();
        }
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.bitCount, ...this.data];
    }
}

// ---------------------------------------------------------------- PisoShift

// ChipElm.writeBits()/readBits(): a boolean[] packed LSB-first into 32-bit
// integers, one whitespace token per integer.
export function writeBits(data: boolean[]): number[] {
    const out: number[] = [];
    let integer = 0, bitIndex = 0;
    for (let i = 0; i < data.length; i++) {
        if (bitIndex >= INT_SIZE) { out.push(integer); integer = 0; bitIndex = 0; }
        if (data[i]) integer |= 1 << bitIndex;
        bitIndex++;
    }
    if (bitIndex > 0) out.push(integer);
    return out;
}

export function readBits(next: () => number | undefined, output: boolean[]): void {
    let integer = 0, bitIndex = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < output.length; i++) {
        if (bitIndex >= INT_SIZE) {
            const v = next();
            if (v === undefined) break;
            integer = v;
            bitIndex = 0;
        }
        output[i] = (integer & (1 << bitIndex)) !== 0;
        bitIndex++;
    }
}

export class PisoShiftElm extends ChipElm {
    static FLAG_NEW_BEHAVIOR = 2;

    data: boolean[] = [];
    dataIndex = 0;
    clockState = false;
    loadState = false;
    dataPinIndex = 3;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.data = new Array(this.bits).fill(false);
        readBits(() => {
            const t = this.nextToken();
            if (t === undefined) return undefined;
            const v = parseInt(t, 10);
            return Number.isFinite(v) ? v : undefined;
        }, this.data);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
    }

    getDumpType() { return 186; }
    getChipName() { return 'PISO shift register'; }
    needsBits() { return true; }
    defaultBitCount() { return 8; }
    hasNewBhvr() { return (this.flags & PisoShiftElm.FLAG_NEW_BEHAVIOR) !== 0; }

    reset(): void {
        super.reset();
        this.data = new Array(this.bits).fill(false);
    }

    setupPins(): void {
        this.sizeX = this.bits + 2;
        this.sizeY = 3;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(1, SIDE_W, 'LD');
        this.pins[1] = new Pin(2, SIDE_W, '');
        this.pins[1].clock = true;
        this.pins[2] = new Pin(1, SIDE_E, 'Q' + (this.hasNewBhvr() ? this.bits - 1 : this.bits));
        this.pins[2].output = true;
        if (this.hasNewBhvr()) {
            this.pins[3] = new Pin(0, SIDE_W, 'SER');
            if (this.data && this.data.length > 0) this.pins[2].value = this.data[0];
            this.dataPinIndex = 4;
        } else {
            this.dataPinIndex = 3;
        }
        for (let i = 0; i < this.bits; i++) {
            this.pins[this.dataPinIndex + i] = new Pin(this.bits - i, SIDE_N, 'D' + (this.bits - (i + 1)));
        }
    }

    getPostCount() { return (this.hasNewBhvr() ? 4 : 3) + this.bits; }
    getVoltageSourceCount() { return 1; }

    execute(): void {
        if (this.pins[0].value !== this.loadState) {
            this.loadState = this.pins[0].value;
            if (this.loadState && this.data.length > 0) {
                if (this.hasNewBhvr()) {
                    this.pins[2].value = this.pins[this.dataPinIndex].value;
                    this.dataIndex = 0;
                } else {
                    this.dataIndex = -1;
                }
                for (let i = 0; i < this.data.length; i++) {
                    this.data[i] = this.pins[this.dataPinIndex + i].value;
                }
            }
        }
        if (this.pins[1].value !== this.clockState) {
            this.clockState = this.pins[1].value;
            if (this.clockState) {
                if (this.dataIndex >= 0) this.data[this.dataIndex] = this.hasNewBhvr() && this.pins[3].value;
                this.dataIndex++;
                if (this.dataIndex >= this.data.length) this.dataIndex = 0;
                this.pins[2].value = this.data[this.dataIndex];
            }
        }
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), ...writeBits(this.data)];
    }
}

// ---------------------------------------------------------------- SipoShift

export class SipoShiftElm extends ChipElm {
    static DATA_PIN_INDEX = 2;
    clockstate = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        const data = new Array(this.bits).fill(false);
        readBits(() => {
            const t = this.nextToken();
            if (t === undefined) return undefined;
            const v = parseInt(t, 10);
            return Number.isFinite(v) ? v : undefined;
        }, data);
        for (let i = 0; i < this.bits; i++) {
            this.pins[SipoShiftElm.DATA_PIN_INDEX + i].value = data[i];
        }
    }

    getDumpType() { return 189; }
    getChipName() { return 'SIPO shift register'; }
    needsBits() { return true; }
    defaultBitCount() { return 8; }

    setupPins(): void {
        this.sizeX = this.bits + 1;
        this.sizeY = 3;
        const old = this.pins;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(1, SIDE_W, 'D');
        this.pins[1] = new Pin(2, SIDE_W, '');
        this.pins[1].clock = true;
        for (let i = 0; i < this.bits; i++) {
            const prev = old[SipoShiftElm.DATA_PIN_INDEX + i];
            const pin = new Pin(i + 1, SIDE_N, 'Q' + i);
            pin.value = prev ? prev.value : false;
            pin.output = true;
            this.pins[SipoShiftElm.DATA_PIN_INDEX + i] = pin;
        }
    }

    getPostCount() { return 2 + this.bits; }
    getVoltageSourceCount() { return this.bits; }

    execute(): void {
        if (this.pins[1].value !== this.clockstate) {
            this.clockstate = this.pins[1].value;
            if (this.clockstate && this.bits > 0) {
                const base = SipoShiftElm.DATA_PIN_INDEX;
                for (let i = this.bits - 2; i >= 0; i--) {
                    this.pins[base + i + 1].value = this.pins[base + i].value;
                }
                this.pins[2].value = this.pins[0].value;
            }
        }
    }

    dumpTokens(): (string | number | boolean)[] {
        const data: boolean[] = [];
        for (let i = 0; i < this.bits; i++) data.push(this.pins[SipoShiftElm.DATA_PIN_INDEX + i].value);
        return [...super.dumpTokens(), ...writeBits(data)];
    }
}

// -------------------------------------------------------------- BusSplitter

export class BusSplitterElm extends ChipElm {
    currents: number[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
    }

    getDumpType() { return 433; }
    getChipName() { return 'Bus Splitter'; }
    needsBits() { return true; }

    setupPins(): void {
        this.sizeX = 2;
        this.sizeY = this.bits;
        this.currents = new Array(this.bits).fill(0);
        this.pins = new Array(this.getPostCount());
        for (let i = 0; i !== this.bits; i++) {
            this.pins[i] = new Pin(0, SIDE_W, 'Bus');
            this.pins[i].busWidth = this.bits;
            this.pins[i].busZ = i;
        }
        for (let i = 0; i !== this.bits; i++) {
            this.pins[i + this.bits] = new Pin(this.bits - 1 - i, SIDE_E, '' + i);
        }
    }

    getPostCount() { return this.bits * 2; }
    getBusWidth() { return this.bits; }
    getVoltageSourceCount() { return 0; }

    // Bus bit i and individual pin i+bits are the same electrical node — the
    // splitter is a wire-equivalent, so node closure walks straight through it.
    getConnection(n1: number, n2: number): boolean { return Math.abs(n1 - n2) === this.bits; }
    isWire() { return true; }
    isRemovableWire() { return true; }
    getConnectedPost(n: number): Point | null { return this.getPost(n + this.bits); }
    hasGroundConnection(_n1: number): boolean { return false; }
}
