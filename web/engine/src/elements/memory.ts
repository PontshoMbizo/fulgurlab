import { Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { ChipElm, Pin, SIDE_W, SIDE_E, SIDE_S } from './chip';

// Memory + analog-mux chips ported from Java: SRAMElm (413), ROMElm (436,
// a subclass of SRAM with no WE pin), AnalogMuxElm (432) and
// DecimalDisplayElm (419).
//
// SRAM/ROM drive their data bus through an internal node plus a switched
// resistor (1 ohm when output-enabled, 1e8 to ground when not) rather than
// stamping the data pins directly, which is what makes a shared bus with
// several chips on it work. That is why both are nonLinear() and declare
// dataBits internal nodes.

export class SRAMElm extends ChipElm {
    static FLAG_RELOAD_ON_RESET = 2;
    static FLAG_HEX_DISPLAY = 4;

    addressBits = 4;
    dataBits = 4;
    addressNodes = 2;
    dataNodes = 6;
    internalNodes = 10;
    address = 0;
    map = new Map<number, number>();
    initialMap: Map<number, number> | null = null;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.addressBits = this.nextInt(4);
        this.dataBits = this.nextInt(4);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
        this.parseContentsTokens();
        if ((this.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0) {
            this.initialMap = new Map(this.map);
        }
    }

    // Contents are dumped as run-length groups: `addr v v v ... -1` repeated,
    // terminated by a negative address (Java writes -2).
    protected parseContentsTokens(): void {
        for (;;) {
            const a0 = this.nextInt(NaN);
            if (!Number.isFinite(a0) || a0 < 0) break;
            let a = a0;
            const v0 = this.nextInt(NaN);
            if (!Number.isFinite(v0) || v0 < 0) break;
            this.map.set(a, v0);
            for (;;) {
                const v = this.nextInt(NaN);
                if (!Number.isFinite(v) || v < 0) break;
                this.map.set(++a, v);
            }
        }
    }

    protected contentsTokens(): number[] {
        const out: number[] = [];
        const maxI = 1 << this.addressBits;
        for (let i = 0; i < maxI; i++) {
            const val = this.map.get(i);
            if (val === undefined || val === 0) continue;
            out.push(i, val);
            for (;;) {
                const v = this.map.get(++i);
                if (v === undefined || v === 0) break;
                out.push(v);
            }
            out.push(-1);
        }
        out.push(-2);
        return out;
    }

    getDumpType() { return 413; }
    getChipName() { return 'Static RAM'; }
    nonLinear() { return true; }
    allowBus() { return true; }

    setupPins(): void {
        if (this.addressBits === 0) this.addressBits = this.dataBits = 4;
        this.sizeX = 2;
        const addrY = this.useBus() ? 1 : this.addressBits;
        const dataY = this.useBus() ? 1 : this.dataBits;
        this.sizeY = Math.max(addrY, dataY) + 1;
        this.bits = this.addressBits;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, 'WE');
        this.pins[0].lineOver = true;
        this.pins[1] = new Pin(0, SIDE_E, 'OE');
        this.pins[1].lineOver = true;
        this.addressNodes = 2;
        this.dataNodes = 2 + this.addressBits;
        this.internalNodes = 2 + this.addressBits + this.dataBits;
        this.makeBitPins(this.addressBits, this.sizeY - addrY, SIDE_W, this.addressNodes, 'A', false, false, true);
        this.makeBitPins(this.dataBits, this.sizeY - dataY, SIDE_E, this.dataNodes, 'D', true, false, true);
    }

    getPostCount() { return 2 + this.addressBits + this.dataBits; }
    getVoltageSourceCount() { return this.dataBits; }
    getInternalNodeCount() { return this.dataBits; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        super.setVoltageSource(j, vs);
        vs.setNodes(CircuitNode.ground, this.nodes[this.internalNodes + j]);
    }

    getMatrixConnection(n1: number, n2: number): boolean {
        for (let i = 0; i !== this.dataBits; i++) {
            const a = this.internalNodes + i, b = this.dataNodes + i;
            if ((n1 === a && n2 === b) || (n1 === b && n2 === a)) return true;
        }
        return false;
    }

    reset(): void {
        super.reset();
        if ((this.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0 && this.initialMap) {
            this.map = new Map(this.initialMap);
        }
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== this.dataBits; i++) {
            const p = this.pins[i + this.dataNodes];
            if (!p.voltSource) continue;
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[this.internalNodes + i], p.voltSource);
            stamper.stampNonLinear(this.nodes[this.internalNodes + i]);
            stamper.stampNonLinear(this.nodes[this.dataNodes + i]);
        }
    }

    protected readAddress(): number {
        let address = 0;
        for (let i = 0; i !== this.addressBits; i++) {
            if (this.volts[this.addressNodes + i] > this.getThreshold()) {
                address |= 1 << (this.addressBits - 1 - i);
            }
        }
        return address;
    }

    protected driveData(stamper: Stamper, outputEnabled: boolean): void {
        const data = this.map.get(this.address) ?? 0;
        for (let i = 0; i !== this.dataBits; i++) {
            const p = this.pins[i + this.dataNodes];
            if (!p.voltSource) continue;
            stamper.updateVoltageSource(
                CircuitNode.ground, this.nodes[this.internalNodes + i], p.voltSource,
                (data & (1 << (this.dataBits - 1 - i))) === 0 ? 0 : this.highVoltage);
            if (outputEnabled) {
                stamper.stampResistor(this.nodes[this.internalNodes + i], this.nodes[this.dataNodes + i], 1);
            } else {
                stamper.stampResistor(this.nodes[this.dataNodes + i], CircuitNode.ground, 1e8);
            }
        }
    }

    doStep(stamper: Stamper): void {
        const writeEnabled = this.volts[0] < this.getThreshold();
        const outputEnabled = this.volts[1] < this.getThreshold() && !writeEnabled;
        this.address = this.readAddress();
        this.driveData(stamper, outputEnabled);
    }

    stepFinished(_stamper: Stamper): void {
        if (!(this.volts[0] < this.getThreshold())) return; // write-enable is active low
        let data = 0;
        for (let i = 0; i !== this.dataBits; i++) {
            if (this.volts[this.dataNodes + i] > this.getThreshold()) {
                data |= 1 << (this.dataBits - 1 - i);
            }
        }
        this.map.set(this.address, data);
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.addressBits, this.dataBits, ...this.contentsTokens()];
    }
}

export class ROMElm extends SRAMElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags, tokens);
    }

    getDumpType() { return 436; }
    getChipName() { return 'ROM'; }

    setupPins(): void {
        if (this.addressBits === 0) this.addressBits = this.dataBits = 4;
        this.sizeX = 2;
        const addrY = this.useBus() ? 1 : this.addressBits;
        const dataY = this.useBus() ? 1 : this.dataBits;
        this.sizeY = Math.max(addrY, dataY) + 1;
        this.bits = this.addressBits;
        this.pins = new Array(this.getPostCount());
        this.pins[0] = new Pin(0, SIDE_W, 'OE');
        this.pins[0].lineOver = true;
        this.addressNodes = 1;
        this.dataNodes = 1 + this.addressBits;
        this.internalNodes = 1 + this.addressBits + this.dataBits;
        this.makeBitPins(this.addressBits, this.sizeY - addrY, SIDE_W, this.addressNodes, 'A', false, false, true);
        this.makeBitPins(this.dataBits, this.sizeY - dataY, SIDE_E, this.dataNodes, 'D', true, false, true);
    }

    getPostCount() { return 1 + this.addressBits + this.dataBits; }

    doStep(stamper: Stamper): void {
        const outputEnabled = this.volts[0] < this.getThreshold();
        this.address = this.readAddress();
        this.driveData(stamper, outputEnabled);
    }

    stepFinished(_stamper: Stamper): void {} // read-only
}

// ----------------------------------------------------------------- AnalogMux

export class AnalogMuxElm extends ChipElm {
    selectBitCount = 2;
    inputCount = 4;
    outputPin = 6;
    r_on = 20;
    r_off = 1e10;
    threshold = 2.5;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.selectBitCount = this.nextInt(2);
        this.r_on = this.nextNumber(20);
        this.r_off = this.nextNumber(1e10);
        this.threshold = this.nextNumber(2.5);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
    }

    getDumpType() { return 432; }
    getChipName() { return 'Analog Mux'; }
    nonLinear() { return true; }

    setupPins(): void {
        if (this.selectBitCount === 0) this.selectBitCount = 2;
        this.inputCount = 1 << this.selectBitCount;
        this.sizeX = this.selectBitCount + 1;
        this.sizeY = this.inputCount + 1;
        this.pins = new Array(this.getPostCount());
        for (let i = 0; i !== this.inputCount; i++) this.pins[i] = new Pin(i, SIDE_W, 'I' + i);
        for (let i = 0; i !== this.selectBitCount; i++) {
            this.pins[this.inputCount + i] = new Pin(i + 1, SIDE_S, 'S' + i);
        }
        this.outputPin = this.inputCount + this.selectBitCount;
        this.pins[this.outputPin] = new Pin(0, SIDE_E, 'Z');
    }

    getPostCount() { return (1 << (this.selectBitCount || 2)) + this.selectBitCount + 1; }
    getVoltageSourceCount() { return 0; }

    private selectedInput(): number {
        let sel = 0;
        for (let i = 0; i !== this.selectBitCount; i++) {
            if (this.volts[this.inputCount + i] > this.threshold) sel |= 1 << i;
        }
        return sel;
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== this.inputCount; i++) stamper.stampNonLinear(this.nodes[i]);
        stamper.stampNonLinear(this.nodes[this.outputPin]);
    }

    doStep(stamper: Stamper): void {
        const sel = this.selectedInput();
        for (let i = 0; i !== this.inputCount; i++) {
            stamper.stampResistor(this.nodes[i], this.nodes[this.outputPin], i === sel ? this.r_on : this.r_off);
        }
    }

    calculateCurrent(): void {
        const sel = this.selectedInput();
        let outputCurrent = 0;
        for (let i = 0; i !== this.inputCount; i++) {
            const r = i === sel ? this.r_on : this.r_off;
            const c = (this.volts[i] - this.volts[this.outputPin]) / r;
            this.pins[i].current = -c;
            outputCurrent += c;
        }
        this.pins[this.outputPin].current = outputCurrent;
        for (let i = 0; i !== this.selectBitCount; i++) this.pins[this.inputCount + i].current = 0;
        this.current = outputCurrent;
    }

    // Select pins are logic-only — no conductive path to the analog network.
    getConnection(n1: number, n2: number): boolean {
        if (n1 >= this.inputCount && n1 < this.outputPin) return false;
        if (n2 >= this.inputCount && n2 < this.outputPin) return false;
        return true;
    }
    hasGroundConnection(_n1: number): boolean { return false; }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.selectBitCount, this.r_on, this.r_off, this.threshold];
    }
}

// ------------------------------------------------------------ DecimalDisplay

export class DecimalDisplayElm extends ChipElm {
    bitCount = 4;
    displayMode = 0; // 0=decimal, 1=hex, 2=octal

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initChip(tokens);
        this.bitCount = this.nextInt(4);
        this.displayMode = this.nextInt(0);
        this.setupPins();
        this.allocNodes();
        this.setPoints();
    }

    getDumpType() { return 419; }
    getChipName() {
        return this.displayMode === 1 ? 'hex display'
            : this.displayMode === 2 ? 'octal display' : 'decimal display';
    }
    allowBus() { return true; }

    setupPins(): void {
        if (this.bitCount === 0) this.bitCount = 4;
        this.sizeX = 3;
        this.sizeY = this.useBus() ? 2 : this.bitCount;
        this.pins = new Array(this.bitCount);
        this.makeBitPins(this.bitCount, 0, SIDE_W, 0, 'I', false, false, false);
    }

    getPostCount() { return this.bitCount || 4; }
    getVoltageSourceCount() { return 0; }

    // The displayed value, exposed for the renderer (Java computes it inside
    // draw()). Bit i is pins[i], LSB first.
    getValue(): number {
        let value = 0;
        for (let i = 0; i !== this.bitCount; i++) if (this.pins[i].value) value |= 1 << i;
        return value;
    }

    getText(): string {
        const v = this.getValue();
        if (this.displayMode === 1) return v.toString(16).toUpperCase();
        if (this.displayMode === 2) return v.toString(8);
        return String(v);
    }

    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.bitCount, this.displayMode];
    }
}
