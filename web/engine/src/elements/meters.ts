import { CircuitElm, Stamper, Point, escapeDumpText, unescapeDumpText, interpPoint } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { CurrentElm } from './current';
import { RailElm, VoltageElm } from './voltage';
import { GraphicElm } from './graphic';

// Meters, single-post measurement taps, data sources/sinks and the drawing-only
// LineElm. Nothing here loads the circuit except WattmeterElm (two zero-valued
// voltage sources, exactly like AmmeterElm) and the two Rail-derived sources.

// ---------------------------------------------------------------- TestPoint

export const TP_VOL = 0, TP_RMS = 1, TP_MAX = 2, TP_MIN = 3, TP_P2P = 4;
export const TP_BIN = 5, TP_FRQ = 6, TP_PER = 7, TP_PWI = 8, TP_DUT = 9;

// A single-post probe that tracks running statistics of the node it sits on.
// It is electrically inert (1 post, no stamps, no ground connection), so the
// statistics are pure bookkeeping done in stepFinished().
export class TestPointElm extends CircuitElm {
    static FLAG_LABEL = 1;

    meter = TP_VOL;
    label = 'TP';

    // running statistics (Java keeps these as plain fields too)
    count = 0;
    total = 0;
    rmsV = 0;
    maxV = 0; lastMaxV = 0;
    minV = 0; lastMinV = 0;
    binaryLevel = 0;
    increasingV = true;
    decreasingV = true;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            const m = parseInt(params[0], 10);
            if (Number.isFinite(m)) this.meter = m;
            if ((flags & TestPointElm.FLAG_LABEL) !== 0 && params.length > 1) {
                this.label = unescapeDumpText(params[1]);
            }
        }
    }

    getDumpType() { return 368; }
    // Java's TestPointElm has no text dump() override (it round-trips through
    // XML only), but its text constructor still reads these back — see
    // combinational.ts's DUMP-FORMAT NOTE for why this port emits them.
    dumpTokens(): (string | number | boolean)[] {
        const out: (string | number | boolean)[] = [this.meter];
        if ((this.flags & TestPointElm.FLAG_LABEL) !== 0) out.push(escapeDumpText(this.label));
        return out;
    }

    getPostCount() { return 1; }
    getVoltageDiff() { return this.volts[0]; }
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(_n1: number) { return false; }

    setPoints(): void {
        super.setPoints();
        this.lead1 = this.dn === 0 ? this.point1 : interpPoint(this.point1, this.point2, 1 - 8 / this.dn);
    }

    reset(): void {
        this.count = 0; this.total = 0; this.rmsV = 0;
        this.maxV = 0; this.lastMaxV = 0; this.minV = 0; this.lastMinV = 0;
        this.binaryLevel = 0;
    }

    stepFinished(_stamper: Stamper): void {
        const v = this.volts[0];
        this.count++;
        this.total += v * v;
        this.binaryLevel = v < 2.5 ? 0 : 1;
        if (v > this.maxV && this.increasingV) {
            this.maxV = v;
            this.increasingV = true;
            this.decreasingV = false;
        }
        if (v < this.maxV && this.increasingV) {
            this.lastMaxV = this.maxV;
            this.minV = v;
            this.increasingV = false;
            this.decreasingV = true;
        }
        if (v < this.minV && this.decreasingV) {
            this.minV = v;
        }
        if (v > this.minV && this.decreasingV) {
            this.lastMinV = this.minV;
            this.maxV = v;
            this.increasingV = true;
            this.decreasingV = false;
            if (this.count > 0) this.rmsV = Math.sqrt(this.total / this.count);
            this.count = 0;
            this.total = 0;
        }
    }

    getMeterName(): string {
        return ['V', 'V(rms)', 'Vmax', 'Vmin', 'Peak to peak',
            'Binary', 'Frequency', 'Period', 'Pulse width', 'Duty cycle'][this.meter] ?? '';
    }

    // Value the renderer should print, in the currently selected mode.
    getReading(): number {
        switch (this.meter) {
            case TP_RMS: return this.rmsV;
            case TP_MAX: return this.lastMaxV;
            case TP_MIN: return this.lastMinV;
            case TP_P2P: return this.lastMaxV - this.lastMinV;
            case TP_BIN: return this.binaryLevel;
            default: return this.volts[0];
        }
    }
}

// --------------------------------------------------------------------- Line

// Pure annotation: two endpoints, no posts, no electrical presence at all.
// GraphicElm is this port's existing base for exactly that (TextElm/BoxElm).
export class LineElm extends GraphicElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, _params?: string[]) {
        super(x, y, x2, y2, flags);
    }
    getDumpType() { return 423; }
    // Java: creationFailed() rejects a line shorter than 16px at placement.
    creationFailed(): boolean { return Math.hypot(this.x - this.x2, this.y - this.y2) < 16; }
}

// ----------------------------------------------------------------- OhmMeter

// A CurrentElm that reports V/I as a resistance. Electrically it IS a current
// source (Java subclasses it directly and changes nothing but the readout).
export class OhmMeterElm extends CurrentElm {
    getDumpType() { return 216; }
    getResistance(): number {
        return this.current === 0 ? Infinity : this.getVoltageDiff() / this.current;
    }
}

// ---------------------------------------------------------------- Wattmeter

export const PM_INST = 0, PM_AVG = 1;

// Four posts: a voltage-sense pair and a current-sense pair, each shorted by a
// zero-valued voltage source so the branch current is solved for directly.
export class WattmeterElm extends CircuitElm {
    width = 16;
    meter = PM_INST;
    voltSources: VoltageSource[] = [];
    currents = [0, 0];
    posts: Point[] = [];
    avgPower = 0;
    totalPower = 0;
    count = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            const w = parseInt(params[0], 10);
            if (Number.isFinite(w)) this.width = w;
            if (params.length > 1) {
                const m = parseInt(params[1], 10);
                if (Number.isFinite(m)) this.meter = m;
            }
        }
    }

    getDumpType() { return 420; }
    dumpTokens() { return [this.width, this.meter]; }
    getPostCount() { return 4; }
    getVoltageSourceCount() { return 2; }

    setPoints(): void {
        super.setPoints();
        const ds = this.dy === 0 ? Math.sign(this.dx) : -Math.sign(this.dy);
        const p3 = interpPoint(this.point1, this.point2, 0, -this.width * ds);
        const p4 = interpPoint(this.point1, this.point2, 1, -this.width * ds);
        // Java numbers the posts so the lower-numbered ones sit on the bottom:
        // if they end up unconnected they get attached to ground automatically.
        this.posts = [p3, p4, this.point1, this.point2];
    }

    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        this.voltSources[j] = vs;
        vs.setNodes(this.nodes[j * 2], this.nodes[j * 2 + 1]);
    }

    stamp(stamper: Stamper): void {
        stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSources[0], 0);
        stamper.stampVoltageSource(this.nodes[2], this.nodes[3], this.voltSources[1], 0);
    }

    setCurrent(vs: VoltageSource, c: number): void {
        for (let i = 0; i < 2; i++) if (this.voltSources[i] === vs) this.currents[i] = c;
    }

    // Power = (voltage across the sense pair) x (current through the shunt).
    getPower(): number { return (this.volts[0] - this.volts[1]) * this.currents[1]; }

    stepFinished(_stamper: Stamper): void {
        const p = this.getPower();
        this.count++;
        this.totalPower += p;
        this.avgPower = this.totalPower / this.count;
    }

    reset(): void {
        super.reset();
        this.avgPower = this.totalPower = this.count = 0;
    }

    getReading(): number { return this.meter === PM_AVG ? this.avgPower : this.getPower(); }

    // Posts 0/1 are one branch, 2/3 the other; they are not connected to
    // each other (Java: `(n1/2) == (n2/2)`).
    getConnection(n1: number, n2: number): boolean {
        return Math.floor(n1 / 2) === Math.floor(n2 / 2);
    }
}

// -------------------------------------------------------------- StopTrigger

// Single-post trigger that halts the run when the node crosses a threshold.
// Java calls app.setSimRunning(false) directly; this port has no app handle
// inside an element, so it raises `stopped` and a stopMessage the engine reads
// (same mechanism PolarCapacitorElm uses).
export class StopTriggerElm extends CircuitElm {
    triggerVoltage = 1;
    type = 0; // 0 = ">=", 1 = "<="
    delay = 0;
    triggered = false;
    triggerTime = 0;
    stopped = false;
    stopMessage: string | null = null;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 3) {
            this.triggerVoltage = parseFloat(params[0]);
            this.type = parseInt(params[1], 10) || 0;
            this.delay = parseFloat(params[2]);
        }
    }

    getDumpType() { return 408; }
    dumpTokens() { return [this.triggerVoltage, this.type, this.delay]; }
    getPostCount() { return 1; }
    getVoltageDiff() { return this.volts[0]; }
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(_n1: number) { return false; }

    reset(): void {
        this.triggered = false;
        this.stopped = false;
        this.stopMessage = null;
    }

    stepFinished(stamper: Stamper): void {
        this.stopped = false;
        if (!this.triggered && ((this.type === 0 && this.volts[0] >= this.triggerVoltage)
            || (this.type === 1 && this.volts[0] <= this.triggerVoltage))) {
            this.triggered = true;
            this.triggerTime = stamper.t;
        }
        if (this.triggered && stamper.t >= this.triggerTime + this.delay) {
            this.triggered = false;
            this.stopped = true;
            this.stopMessage = 'stop trigger fired';
        }
    }
}

// ------------------------------------------------------------- DataRecorder

// Single-post ring buffer of node voltages ("data export" in the Java UI).
export class DataRecorderElm extends CircuitElm {
    dataCount = 10240;
    dataPtr = 0;
    dataFull = false;
    data: Float64Array;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            const n = parseInt(params[0], 10);
            if (Number.isFinite(n) && n > 0) this.dataCount = n;
        }
        this.data = new Float64Array(this.dataCount);
    }

    getDumpType() { return 210; }
    dumpTokens() { return [this.dataCount]; }
    getPostCount() { return 1; }
    getVoltageDiff() { return this.volts[0]; }
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(_n1: number) { return false; }

    setDataCount(ct: number): void {
        this.dataCount = ct;
        this.data = new Float64Array(ct);
        this.dataPtr = 0;
        this.dataFull = false;
    }

    reset(): void {
        this.dataPtr = 0;
        this.dataFull = false;
    }

    stepFinished(_stamper: Stamper): void {
        this.data[this.dataPtr++] = this.volts[0];
        if (this.dataPtr >= this.dataCount) {
            this.dataPtr = 0;
            this.dataFull = true;
        }
    }

    // Samples in chronological order (oldest first), for export.
    getSamples(): number[] {
        if (!this.dataFull) return Array.from(this.data.subarray(0, this.dataPtr));
        return [...Array.from(this.data.subarray(this.dataPtr)), ...Array.from(this.data.subarray(0, this.dataPtr))];
    }
}

// -------------------------------------------------------------- AudioOutput

// Single-post sink that decimates node voltage down to `samplingRate`. Java
// wires the captured buffer to a WebAudio "play" button; this port keeps the
// capture (the simulation-visible half) and exposes getSamples() so a UI can
// do whatever it likes with it.
export class AudioOutputElm extends CircuitElm {
    static lastSamplingRate = 8000;
    static nextLabelNum = 1;

    duration = 1;
    samplingRate = AudioOutputElm.lastSamplingRate;
    labelNum = 0;
    dataCount = 0;
    dataPtr = 0;
    dataFull = false;
    data: Float64Array = new Float64Array(0);
    sampleStep = 0;
    private nextDataSample = 0;
    private dataSample = 0;
    private dataSampleCount = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 3) {
            this.duration = parseFloat(params[0]);
            this.samplingRate = parseInt(params[1], 10) || AudioOutputElm.lastSamplingRate;
            this.labelNum = parseInt(params[2], 10) || 0;
        } else {
            this.labelNum = AudioOutputElm.nextLabelNum++;
        }
        this.setDataCount();
    }

    getDumpType() { return 211; }
    dumpTokens() { return [this.duration, this.samplingRate, this.labelNum]; }
    getPostCount() { return 1; }
    getVoltageDiff() { return this.volts[0]; }
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(_n1: number) { return false; }

    setDataCount(): void {
        this.dataCount = Math.max(1, Math.round(this.duration * this.samplingRate));
        this.data = new Float64Array(this.dataCount);
        this.sampleStep = 1 / this.samplingRate;
        this.dataPtr = 0;
        this.dataFull = false;
        this.nextDataSample = 0;
        this.dataSample = 0;
        this.dataSampleCount = 0;
    }

    reset(): void {
        this.setDataCount();
    }

    stepFinished(stamper: Stamper): void {
        this.dataSample += this.volts[0];
        this.dataSampleCount++;
        if (stamper.t >= this.nextDataSample) {
            this.nextDataSample += this.sampleStep;
            this.data[this.dataPtr++] = this.dataSample / this.dataSampleCount;
            this.dataSampleCount = 0;
            this.dataSample = 0;
            if (this.dataPtr >= this.dataCount) {
                this.dataPtr = 0;
                this.dataFull = true;
            }
        }
    }

    getSamples(): number[] {
        return this.dataFull
            ? Array.from(this.data)
            : Array.from(this.data.subarray(0, this.dataPtr));
    }
}

// --------------------------------------------------------------- AudioInput

// RailElm whose output is an audio sample buffer played back at samplingRate.
// The buffer is set by the host (there is no file picker in the engine layer);
// with no data loaded it outputs 0, matching Java.
export class AudioInputElm extends RailElm {
    startPosition = 0;
    fileNum = 0;
    fileName: string | null = null;
    samplingRate = 8000;
    audioData: Float64Array | null = null;
    timeOffset = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.waveform = VoltageElm.WF_AC;
        if (Array.isArray(params) && params.length >= 9) {
            // RailElm/VoltageElm consumed params[0..5]; this class's own three
            // tokens follow.
            this.maxVoltage = parseFloat(params[6]);
            this.startPosition = parseFloat(params[7]);
            this.fileNum = parseInt(params[8], 10) || 0;
        } else {
            this.maxVoltage = 5;
        }
        this.timeOffset = this.startPosition;
    }

    getDumpType() { return 411; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.maxVoltage, this.startPosition, this.fileNum];
    }

    reset(): void {
        super.reset();
        this.timeOffset = this.startPosition;
    }

    getVoltage(_t: number): number {
        const data = this.audioData;
        if (!data) return 0;
        if (this.timeOffset < this.startPosition) this.timeOffset = this.startPosition;
        const dptr = this.timeOffset * this.samplingRate;
        const iptr = Math.floor(dptr);
        const frac = dptr - iptr;
        if (iptr >= data.length) return 0;
        const v1 = data[iptr];
        const v2 = iptr + 1 < data.length ? data[iptr + 1] : 0;
        return (v1 * (1 - frac) + v2 * frac) * this.maxVoltage;
    }

    stepFinished(stamper: Stamper): void {
        this.timeOffset += stamper.timeStep;
    }
}

// ---------------------------------------------------------------- DataInput

// RailElm that replays an arbitrary sampled waveform (Java loads it from a
// CSV/text file through a FileUpload widget). Same host-provides-the-data
// arrangement as AudioInputElm.
export class DataInputElm extends RailElm {
    static FLAG_REPEAT = 1 << 8;

    sampleLength = 1e-3;
    scaleFactor = 1;
    fileNum = 0;
    fileName: string | null = null;
    data: number[] | null = null;
    timeOffset = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.waveform = VoltageElm.WF_AC;
        if (Array.isArray(params) && params.length >= 9) {
            this.sampleLength = parseFloat(params[6]);
            this.scaleFactor = parseFloat(params[7]);
            this.fileNum = parseInt(params[8], 10) || 0;
        }
    }

    getDumpType() { return 424; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), this.sampleLength, this.scaleFactor, this.fileNum];
    }

    doesRepeat() { return (this.flags & DataInputElm.FLAG_REPEAT) !== 0; }

    reset(): void {
        super.reset();
        this.timeOffset = 0;
    }

    getVoltage(_t: number): number {
        if (!this.data) return 0;
        let ptr = Math.floor(this.timeOffset / this.sampleLength);
        if (ptr >= this.data.length) {
            if (this.doesRepeat()) {
                ptr = 0;
                this.timeOffset = 0;
            } else {
                ptr = this.data.length - 1;
            }
        }
        return this.data[ptr] * this.scaleFactor;
    }

    stepFinished(stamper: Stamper): void {
        this.timeOffset += stamper.timeStep;
    }
}

// -------------------------------------------------------------- ExtVoltage

// A named rail whose value is pushed in from outside the simulation (the
// JSInterface `setExtVoltage` hook in Java). Exactly the mechanism the
// fulgurlab co-simulation bridge needs on the analog side.
export class ExtVoltageElm extends RailElm {
    name = 'ext';
    voltage = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.waveform = VoltageElm.WF_AC;
        if (Array.isArray(params) && params.length >= 7) {
            this.name = unescapeDumpText(params[6]);
        }
    }

    getDumpType() { return 418; }
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), escapeDumpText(this.name)];
    }

    setVoltage(v: number): void { if (Number.isFinite(v)) this.voltage = v; }
    getVoltage(_t: number): number { return this.voltage; }
}

// Re-exported so callers importing from this module have the node types they
// need for the wattmeter's voltage sources without a second import.
export type { VoltageSource, CircuitNode };
