import { CircuitElm, Stamper, Point, interpPoint, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { Inductor } from './inductor';
import { SwitchElm } from './switch';

// Relays, multi-pole switches, and the two motors.
//
// Every relay-family element models its coil as an embedded Inductor (backward
// Euler, matching Java) in series with the coil resistance, and its contacts as
// resistors switched between r_on and r_off from a latched position variable.
// The multi-pole switches instead use SwitchElm's trick of representing a
// closed contact as a *zero-valued voltage source*, which both shorts the pair
// and hands you the branch current for free.

const IND_BACK_EULER = 2; // Inductor.FLAG_BACK_EULER

// ---------------------------------------------------------------- RelayModel

// Ported from RelayModel.java, minus the named-model library (Java keeps a
// static HashMap plus browser local storage; this port carries the parameters
// on the element, which is all the text dump format actually stores).
export class RelayModel {
    inductance = 0.2;
    r_on = 0.05;
    r_off = 1e6;
    onCurrent = 0.02;
    offCurrent = 0.015;
    coilR = 20;
    switchingTime = 5e-3;
    coilStyle = 0;
    poleCount = 1;
    showBox = true;
    pulldown = true;
}

// -------------------------------------------------------------------- Relay

export class RelayElm extends CircuitElm {
    static FLAG_SWAP_COIL = 1;
    static FLAG_SHOW_BOX = 2;
    static FLAG_BOTH_SIDES_COIL = 4;
    static FLAG_FLIP = 8;
    static FLAG_PULLDOWN = 16;

    model = new RelayModel();
    ind = new Inductor();
    coilCurrent = 0;
    switchCurrent: number[] = [];
    d_position = 0;
    i_position = 0;
    onState = false;
    nCoil1 = 3; nCoil2 = 4; nCoil3 = 5;
    swposts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 7) {
            this.model.poleCount = parseInt(params[0], 10) || 1;
            this.model.inductance = parseFloat(params[1]);
            this.coilCurrent = parseFloat(params[2]);
            this.model.r_on = parseFloat(params[3]);
            this.model.r_off = parseFloat(params[4]);
            this.model.onCurrent = parseFloat(params[5]);
            this.model.coilR = parseFloat(params[6]);
            // Older dumps stop here; offCurrent then mirrors onCurrent and
            // switchingTime 0 selects the legacy instantaneous-armature model.
            this.model.offCurrent = this.model.onCurrent;
            this.model.switchingTime = 0;
            if (params.length > 7) this.model.offCurrent = parseFloat(params[7]);
            if (params.length > 8) this.model.switchingTime = parseFloat(params[8]);
            if (params.length > 9) {
                this.i_position = parseInt(params[9], 10) || 0;
                this.d_position = this.i_position;
            }
            this.model.coilStyle = (flags & RelayElm.FLAG_SWAP_COIL) !== 0 ? 2
                : (flags & RelayElm.FLAG_BOTH_SIDES_COIL) !== 0 ? 0 : 1;
            this.model.showBox = (flags & RelayElm.FLAG_SHOW_BOX) !== 0;
            this.model.pulldown = (flags & RelayElm.FLAG_PULLDOWN) !== 0;
        }
        if (this.i_position === 1) this.onState = true;
        if (this.i_position === 2) this.d_position = 0.5;
        this.ind.setup(this.model.inductance, this.coilCurrent, IND_BACK_EULER);
        this.setupPoles();
    }

    getDumpType() { return 178; }
    dumpTokens() {
        return [this.model.poleCount, this.model.inductance, this.coilCurrent,
            this.model.r_on, this.model.r_off, this.model.onCurrent, this.model.coilR,
            this.model.offCurrent, this.model.switchingTime, this.i_position];
    }

    poleCount() { return this.model.poleCount; }
    needsPulldown() { return this.model.pulldown; }

    setupPoles(): void {
        this.nCoil1 = 3 * this.poleCount();
        this.nCoil2 = this.nCoil1 + 1;
        this.nCoil3 = this.nCoil1 + 2;
        if (this.switchCurrent.length !== this.poleCount()) {
            this.switchCurrent = new Array(this.poleCount()).fill(0);
        }
    }

    getPostCount() { return 2 + this.poleCount() * 3; }
    getInternalNodeCount() { return 1; }
    nonLinear() { return true; }

    setPoints(): void {
        super.setPoints();
        this.setupPoles();
        // Posts: per pole, [common, NC, NO] fanned perpendicular to the body,
        // then the two coil terminals. Only their relative positions matter
        // electrically.
        const openhs = 16 * (this.dsign || 1);
        const pts: Point[] = [];
        for (let p = 0; p < this.poleCount(); p++) {
            pts.push(interpPoint(this.point1, this.point2, 0, -openhs * 3 * p));
            pts.push(interpPoint(this.point1, this.point2, 1, -openhs * 3 * p - openhs));
            pts.push(interpPoint(this.point1, this.point2, 1, -openhs * 3 * p + openhs));
        }
        pts.push(interpPoint(this.point1, this.point2, 0, openhs * 3));
        pts.push(interpPoint(this.point1, this.point2, 1, openhs * 3));
        this.swposts = pts;
    }

    getPost(n: number): Point | null { return this.swposts[n] ?? null; }

    reset(): void {
        super.reset();
        this.ind.reset();
        this.coilCurrent = 0;
        this.switchCurrent.fill(0);
        this.d_position = 0;
        this.i_position = 0;
        this.onState = false;
    }

    stamp(stamper: Stamper): void {
        this.ind.stamp(stamper, this.nodes[this.nCoil1], this.nodes[this.nCoil3]);
        stamper.stampResistor(this.nodes[this.nCoil3], this.nodes[this.nCoil2], this.model.coilR);
        for (let i = 0; i !== this.poleCount() * 3; i++) stamper.stampNonLinear(this.nodes[i]);
        if (this.needsPulldown()) {
            for (let i = 0; i < this.poleCount(); i++) {
                stamper.stampResistor(this.nodes[1 + i * 3], CircuitNode.ground, this.model.r_off);
                stamper.stampResistor(this.nodes[2 + i * 3], CircuitNode.ground, this.model.r_off);
            }
        }
    }

    startIteration(stamper: Stamper): void {
        this.ind.startIteration(stamper, this.volts[this.nCoil1] - this.volts[this.nCoil3]);
        if (this.model.switchingTime === 0) { this.startIterationOld(); return; }

        const absCurrent = Math.abs(this.coilCurrent);
        if (this.onState) {
            if (absCurrent < this.model.offCurrent) {
                this.onState = false;
                this.i_position = 2;
            } else {
                this.d_position += stamper.timeStep / this.model.switchingTime;
                if (this.d_position >= 1) this.d_position = this.i_position = 1;
            }
        } else {
            if (absCurrent > this.model.onCurrent) {
                this.onState = true;
                this.i_position = 2;
            } else {
                this.d_position -= stamper.timeStep / this.model.switchingTime;
                if (this.d_position <= 0) this.d_position = this.i_position = 0;
            }
        }
    }

    // Legacy (switchingTime == 0) armature model: position derived directly
    // from coil current, with Java's "magic" 1.3 fudge factor.
    private startIterationOld(): void {
        const magic = 1.3;
        const pmult = Math.sqrt(magic + 1);
        const c = this.model.onCurrent;
        const p = this.coilCurrent * pmult / c;
        this.d_position = Math.abs(p * p) - 1.3;
        if (this.d_position < 0) this.d_position = 0;
        if (this.d_position > 1) this.d_position = 1;
        if (this.d_position < 0.1) this.i_position = 0;
        else if (this.d_position > 0.9) this.i_position = 1;
        else this.i_position = 2;
    }

    doStep(stamper: Stamper): void {
        const voltdiff = this.volts[this.nCoil1] - this.volts[this.nCoil3];
        this.ind.doStep(stamper, voltdiff);
        const { r_on, r_off } = this.model;
        for (let p = 0; p !== this.poleCount() * 3; p += 3) {
            if (this.i_position === 0) {
                stamper.stampResistor(this.nodes[p], this.nodes[1 + p], r_on);
                if (!this.needsPulldown()) stamper.stampResistor(this.nodes[p], this.nodes[2 + p], r_off);
            } else if (this.i_position === 1) {
                stamper.stampResistor(this.nodes[p], this.nodes[2 + p], r_on);
                if (!this.needsPulldown()) stamper.stampResistor(this.nodes[p], this.nodes[1 + p], r_off);
            } else {
                stamper.stampResistor(this.nodes[p], this.nodes[1 + p], r_off);
                stamper.stampResistor(this.nodes[p], this.nodes[2 + p], r_off);
            }
        }
    }

    calculateCurrent(): void {
        this.coilCurrent = this.ind.calculateCurrent(this.volts[this.nCoil1] - this.volts[this.nCoil3]);
        for (let p = 0; p !== this.poleCount(); p++) {
            this.switchCurrent[p] = this.i_position === 2 ? 0
                : (this.volts[p * 3] - this.volts[p * 3 + 1 + this.i_position]) / this.model.r_on;
        }
        this.current = this.switchCurrent[0] ?? 0;
    }
}

// ---------------------------------------------------------------- RelayCoil

export const RELAY_TYPE_NORMAL = 0;
export const RELAY_TYPE_ON_DELAY = 1;
export const RELAY_TYPE_OFF_DELAY = 2;
export const RELAY_TYPE_LATCHING = 3;

// A coil with no contacts of its own — it drives every RelayContactElm sharing
// its `label`. Java resolves that coupling by walking sim.elmList; this port
// has no engine back-reference from an element, so the pairing is done by the
// engine after analysis via linkRelayContacts() (see core/engine.ts).
export class RelayCoilElm extends CircuitElm {
    ind = new Inductor();
    label = 'label';
    inductance = 0.2;
    coilCurrent = 0;
    onCurrent = 0.02;
    offCurrent = 0.015;
    coilR = 20;
    switchingTime = 5e-3;
    type = RELAY_TYPE_NORMAL;
    state = 0;
    switchPosition = 0;
    d_position = 0;
    i_position = 0;
    lastTransition = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 10) {
            this.label = unescapeDumpText(params[0]);
            this.inductance = parseFloat(params[1]);
            this.coilCurrent = parseFloat(params[2]);
            this.onCurrent = parseFloat(params[3]);
            this.coilR = parseFloat(params[4]);
            this.offCurrent = parseFloat(params[5]);
            this.switchingTime = parseFloat(params[6]);
            this.type = parseInt(params[7], 10) || 0;
            this.state = parseInt(params[8], 10) || 0;
            this.switchPosition = parseInt(params[9], 10) || 0;
        }
        this.ind.setup(this.inductance, this.coilCurrent, IND_BACK_EULER);
    }

    getDumpType() { return 425; }
    dumpTokens() {
        return [escapeDumpText(this.label), this.inductance, this.coilCurrent, this.onCurrent,
            this.coilR, this.offCurrent, this.switchingTime, this.type, this.state, this.switchPosition];
    }

    getPostCount() { return 2; }
    getInternalNodeCount() { return 1; }
    nonLinear() { return true; }

    reset(): void {
        super.reset();
        this.ind.reset();
        this.coilCurrent = 0;
        this.state = 0;
        this.switchPosition = 0;
        this.d_position = this.i_position = 0;
    }

    stamp(stamper: Stamper): void {
        this.ind.stamp(stamper, this.nodes[0], this.nodes[2]);
        stamper.stampResistor(this.nodes[2], this.nodes[1], this.coilR);
    }

    startIteration(stamper: Stamper): void {
        this.ind.startIteration(stamper, this.volts[0] - this.volts[2]);
        const absCurrent = Math.abs(this.coilCurrent);
        const energised = this.state !== 0;
        if (energised) {
            if (absCurrent < this.offCurrent) {
                if (this.type === RELAY_TYPE_LATCHING) return; // latching stays put
                this.state = 0;
                this.lastTransition = stamper.t;
            }
        } else if (absCurrent > this.onCurrent) {
            this.state = 1;
            this.lastTransition = stamper.t;
        }

        // On/off-delay variants defer the CONTACT position, not the coil state.
        const elapsed = stamper.t - this.lastTransition;
        if (this.type === RELAY_TYPE_ON_DELAY) {
            this.switchPosition = (this.state === 1 && elapsed >= this.switchingTime) ? 1 : 0;
        } else if (this.type === RELAY_TYPE_OFF_DELAY) {
            this.switchPosition = (this.state === 1 || elapsed < this.switchingTime) ? 1 : 0;
        } else {
            this.switchPosition = this.state;
        }
        this.i_position = this.switchPosition;
    }

    doStep(stamper: Stamper): void {
        this.ind.doStep(stamper, this.volts[0] - this.volts[2]);
    }

    calculateCurrent(): void {
        this.coilCurrent = this.ind.calculateCurrent(this.volts[0] - this.volts[2]);
        this.current = this.coilCurrent;
    }
}

// ------------------------------------------------------------- RelayContact

// A changeover contact driven by whichever RelayCoilElm shares its label.
// Posts: 0 = common, 1 = NC, 2 = NO.
export class RelayContactElm extends CircuitElm {
    static FLAG_NORMALLY_CLOSED = 2;
    static FLAG_IEC = 4;

    label = 'label';
    r_on = 0.05;
    r_off = 1e6;
    i_position = 0;
    switchCurrent = 0;
    // Set by the engine from the matching coil (see RelayCoilElm's comment).
    coil: RelayCoilElm | null = null;
    swposts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 3) {
            this.label = unescapeDumpText(params[0]);
            this.r_on = parseFloat(params[1]);
            this.r_off = parseFloat(params[2]);
            if (params.length > 3) this.i_position = parseInt(params[3], 10) || 0;
        } else {
            this.flags |= RelayContactElm.FLAG_IEC;
        }
    }

    getDumpType() { return 426; }
    dumpTokens() {
        return [escapeDumpText(this.label), this.r_on, this.r_off, this.i_position];
    }
    useIECSymbol() { return (this.flags & RelayContactElm.FLAG_IEC) !== 0; }
    normallyClosed() { return (this.flags & RelayContactElm.FLAG_NORMALLY_CLOSED) !== 0; }

    getPostCount() { return 3; }
    nonLinear() { return true; }

    setPoints(): void {
        super.setPoints();
        const openhs = 16 * (this.dsign || 1);
        this.swposts = [
            this.point1,
            interpPoint(this.point1, this.point2, 1, -openhs),
            interpPoint(this.point1, this.point2, 1, openhs),
        ];
    }
    getPost(n: number): Point | null { return this.swposts[n] ?? null; }

    stamp(stamper: Stamper): void {
        for (let i = 0; i < 3; i++) stamper.stampNonLinear(this.nodes[i]);
    }

    startIteration(_stamper: Stamper): void {
        if (this.coil) {
            const energised = this.coil.switchPosition !== 0;
            this.i_position = (energised !== this.normallyClosed()) ? 1 : 0;
        }
    }

    doStep(stamper: Stamper): void {
        if (this.i_position === 0) {
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.r_on);
            stamper.stampResistor(this.nodes[0], this.nodes[2], this.r_off);
        } else {
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.r_off);
            stamper.stampResistor(this.nodes[0], this.nodes[2], this.r_on);
        }
    }

    calculateCurrent(): void {
        this.switchCurrent = (this.volts[0] - this.volts[1 + this.i_position]) / this.r_on;
        this.current = this.switchCurrent;
    }

    getCurrentIntoNode(n: number): number {
        if (n === 0) return -this.switchCurrent;
        if (n === 1 + this.i_position) return this.switchCurrent;
        return 0;
    }
}

// ---------------------------------------------------------------- MBBSwitch

// Make-before-break SPDT: at the two intermediate positions BOTH contacts are
// closed, so it needs two voltage sources rather than one.
export class MBBSwitchElm extends SwitchElm {
    link = 0;
    both = false;
    voltSources: VoltageSource[] = [];
    currents = [0, 0];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
        this.posCount = 4;
        if (Array.isArray(params) && params.length > 2) {
            this.link = parseInt(params[2], 10) || 0;
        }
        this.noDiagonal = true;
    }

    getDumpType() { return 416; }
    dumpTokens(): (string | number | boolean)[] { return [...super.dumpTokens(), this.link]; }
    getPostCount() { return 3; }

    setPoints(): void {
        super.setPoints();
        const openhs = 16 * (this.dsign || 1);
        this.swposts = [
            this.point1,
            interpPoint(this.point1, this.point2, 1, -openhs),
            interpPoint(this.point1, this.point2, 1, openhs),
        ];
    }
    swposts: Point[] = [];
    getPost(n: number): Point | null { return this.swposts[n] ?? null; }

    getVoltageSourceCount(): number {
        this.both = (this.position === 1 || this.position === 3);
        return this.both ? 2 : 1;
    }

    setVoltageSource(n: number, v: VoltageSource): void {
        this.voltSources[n] = v;
        if (this.both) v.setNodes(this.nodes[0], this.nodes[n + 1]);
        else v.setNodes(this.nodes[0], this.nodes[1 + Math.floor(this.position / 2)]);
    }

    stamp(stamper: Stamper): void {
        let vs = 0;
        if (this.both || this.position === 0) {
            const v = this.voltSources[vs++];
            if (v) stamper.stampVoltageSource(v.n1!, v.n2!, v, 0);
        }
        if (this.both || this.position === 2) {
            const v = this.voltSources[vs++];
            if (v) stamper.stampVoltageSource(v.n1!, v.n2!, v, 0);
        }
    }

    setCurrent(vs: VoltageSource, c: number): void {
        for (let i = 0; i < 2; i++) if (this.voltSources[i] === vs) this.currents[i] = c;
    }

    calculateCurrent(): void {
        if (!this.both) this.currents[1 - Math.floor(this.position / 2)] = 0;
        this.current = this.currents[0];
    }

    getConnection(n1: number, n2: number): boolean {
        if (this.both) return true;
        const b = 1 + Math.floor(this.position / 2);
        return (n1 === 0 && n2 === b) || (n1 === b && n2 === 0);
    }
    isWireEquivalent() { return false; }
    isRemovableWire() { return false; }
}

// -------------------------------------------------------------- DPDTSwitch

// N-pole changeover switch: 3 posts per pole (common, A, B), one zero-valued
// voltage source per pole shorting the selected pair.
export class DPDTSwitchElm extends SwitchElm {
    poleCount = 2;
    voltageSources: VoltageSource[] = [];
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
        if (Array.isArray(params) && params.length > 2) {
            const n = parseInt(params[2], 10);
            if (Number.isFinite(n) && n > 0) this.poleCount = n;
        }
        this.noDiagonal = true;
    }

    getDumpType() { return 429; }
    dumpTokens(): (string | number | boolean)[] { return [...super.dumpTokens(), this.poleCount]; }
    getPostCount() { return 3 * this.poleCount; }
    getVoltageSourceCount() { return this.poleCount; }

    setPoints(): void {
        super.setPoints();
        const openhs = 16 * (this.dsign || 1);
        const pts: Point[] = [];
        for (let i = 0; i < this.poleCount; i++) {
            pts.push(interpPoint(this.point1, this.point2, 0, -openhs * 3 * i));
            pts.push(interpPoint(this.point1, this.point2, 1, -openhs * 3 * i - openhs));
            pts.push(interpPoint(this.point1, this.point2, 1, -openhs * 3 * i + openhs));
        }
        this.posts = pts;
    }
    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        this.voltageSources[j] = vs;
        vs.setNodes(this.nodes[j * 3], this.nodes[this.position + 1 + j * 3]);
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== this.poleCount; i++) {
            const vs = this.voltageSources[i];
            if (vs) stamper.stampVoltageSource(vs.n1!, vs.n2!, vs, 0);
        }
    }

    calculateCurrent(): void {}

    getConnection(n1: number, n2: number): boolean {
        for (let i = 0; i !== this.poleCount; i++) {
            const a = i * 3, b = i * 3 + 1 + this.position;
            if ((n1 === a && n2 === b) || (n1 === b && n2 === a)) return true;
        }
        return false;
    }
    isWireEquivalent() { return false; }
    isRemovableWire() { return false; }
}

// ------------------------------------------------------------- CrossSwitch

// 4-post crossover: position 0 connects 0-1 and 2-3, position 1 swaps to
// 0-3 and 2-1.
export class CrossSwitchElm extends SwitchElm {
    static poleCount = 2;
    voltageSources: VoltageSource[] = [];
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
        this.noDiagonal = true;
        this.posCount = 2;
    }

    getDumpType() { return 430; }
    getPostCount() { return 2 * CrossSwitchElm.poleCount; }
    getVoltageSourceCount() { return CrossSwitchElm.poleCount; }

    setPoints(): void {
        super.setPoints();
        const openhs = 16 * (this.dsign || 1);
        this.posts = [
            interpPoint(this.point1, this.point2, 0, -openhs),
            interpPoint(this.point1, this.point2, 1, -openhs),
            interpPoint(this.point1, this.point2, 0, openhs),
            interpPoint(this.point1, this.point2, 1, openhs),
        ];
    }
    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        this.voltageSources[j] = vs;
        if (this.position === 0) vs.setNodes(this.nodes[j * 2], this.nodes[j * 2 + 1]);
        else vs.setNodes(this.nodes[j * 2], this.nodes[3 - j * 2]);
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== CrossSwitchElm.poleCount; i++) {
            const vs = this.voltageSources[i];
            if (!vs) continue;
            if (this.position === 0) {
                stamper.stampVoltageSource(this.nodes[i * 2], this.nodes[i * 2 + 1], vs, 0);
            } else {
                stamper.stampVoltageSource(this.nodes[i * 2], this.nodes[3 - i * 2], vs, 0);
            }
        }
    }

    calculateCurrent(): void {}

    getConnection(n1: number, n2: number): boolean {
        const pair = (a: number, b: number) => (n1 === a && n2 === b) || (n1 === b && n2 === a);
        if (this.position === 0) return pair(0, 1) || pair(2, 3);
        return pair(0, 3) || pair(2, 1);
    }
    isWireEquivalent() { return false; }
    isRemovableWire() { return false; }
}

// --------------------------------------------------- MotorProtectionSwitch

// Three-phase thermal overload: three independent i2t accumulators; when any
// one melts, all three contacts open together.
export class MotorProtectionSwitchElm extends CircuitElm {
    static blownResistance = 1e9;

    resistance = 0.0613;
    i2t = 6.73;
    blown = false;
    label = '';
    heats = [0, 0, 0];
    currents = [0, 0, 0];
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 3) {
            this.resistance = parseFloat(params[0]);
            this.i2t = parseFloat(params[1]);
            this.blown = params[2] === 'true';
            if (params.length > 3) this.label = unescapeDumpText(params[3]);
        }
    }

    getDumpType() { return 428; }
    dumpTokens() { return [this.resistance, this.i2t, this.blown, escapeDumpText(this.label)]; }
    getPostCount() { return 6; }
    nonLinear() { return true; }

    setPoints(): void {
        super.setPoints();
        const q = Math.abs(this.dy) > Math.abs(this.dx) ? -1 : 1;
        const pts: Point[] = [];
        for (let i = 0; i < 3; i++) {
            pts.push(interpPoint(this.point1, this.point2, 0, -q * 32 * (i - 1)));
            pts.push(interpPoint(this.point1, this.point2, 1, -q * 32 * (i - 1)));
        }
        this.posts = pts;
    }
    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    reset(): void {
        super.reset();
        this.heats = [0, 0, 0];
        this.currents = [0, 0, 0];
        this.blown = false;
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i < 6; i++) stamper.stampNonLinear(this.nodes[i]);
    }

    startIteration(stamper: Stamper): void {
        for (let i = 0; i < 3; i++) {
            const c = this.currents[i];
            this.heats[i] += c * c * stamper.timeStep;
            this.heats[i] -= stamper.timeStep * this.i2t / 3;
            if (this.heats[i] < 0) this.heats[i] = 0;
            if (this.heats[i] > this.i2t) this.blown = true;
        }
    }

    doStep(stamper: Stamper): void {
        const r = this.blown ? MotorProtectionSwitchElm.blownResistance : this.resistance;
        for (let i = 0; i < 3; i++) stamper.stampResistor(this.nodes[i * 2], this.nodes[i * 2 + 1], r);
    }

    calculateCurrent(): void {
        const r = this.blown ? MotorProtectionSwitchElm.blownResistance : this.resistance;
        for (let i = 0; i < 3; i++) {
            this.currents[i] = (this.volts[i * 2] - this.volts[i * 2 + 1]) / r;
        }
        this.current = this.currents[0];
    }

    getConnection(n1: number, n2: number): boolean {
        return Math.floor(n1 / 2) === Math.floor(n2 / 2);
    }
}

// ------------------------------------------------------------------ DCMotor

// Brushed DC motor. The mechanical side is simulated as a second, fictitious
// electrical branch: an "inertia inductor" (L = J) whose current IS the shaft
// speed, driven by a voltage source of value K*Ia and damped by a resistor
// b. Back-EMF Kb*speed is fed into the armature loop by the other source.
// Nodes: 0/1 external, 2/3 armature internal, 4/5 mechanical.
export class DCMotorElm extends CircuitElm {
    ind = new Inductor();
    indInertia = new Inductor();
    inductance = 1e-3;
    resistance = 10;
    K = 0.01;
    Kb = 0.01;
    J = 1e-4;
    b = 1e-3;
    gearRatio = 1;
    tau = 0;
    angle = Math.PI / 2;
    speed = 0;
    coilCurrent = 0;
    inertiaCurrent = 0;
    voltSources: VoltageSource[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 8) {
            this.inductance = parseFloat(params[0]);
            this.resistance = parseFloat(params[1]);
            this.K = parseFloat(params[2]);
            this.Kb = parseFloat(params[3]);
            this.J = parseFloat(params[4]);
            this.b = parseFloat(params[5]);
            this.gearRatio = parseFloat(params[6]);
            this.tau = parseFloat(params[7]);
        }
        this.ind.setup(this.inductance, 0, IND_BACK_EULER);
        this.indInertia.setup(this.J, 0, IND_BACK_EULER);
    }

    getDumpType() { return 415; }
    dumpTokens() {
        return [this.inductance, this.resistance, this.K, this.Kb, this.J, this.b,
            this.gearRatio, this.tau];
    }
    getPostCount() { return 2; }
    getInternalNodeCount() { return 4; }
    getVoltageSourceCount() { return 2; }

    setVoltageSource(n: number, v: VoltageSource): void {
        this.voltSources[n] = v;
        if (n === 0) v.setNodes(this.nodes[3], this.nodes[1]);
        else v.setNodes(this.nodes[4], CircuitNode.ground);
    }

    reset(): void {
        super.reset();
        this.ind.reset();
        this.indInertia.reset();
        this.coilCurrent = 0;
        this.inertiaCurrent = 0;
        this.speed = 0;
        this.angle = Math.PI / 2;
    }

    stamp(stamper: Stamper): void {
        // Armature: L (0->2), R (2->3), back-EMF source (3->1).
        this.ind.stamp(stamper, this.nodes[0], this.nodes[2]);
        stamper.stampResistor(this.nodes[2], this.nodes[3], this.resistance);
        stamper.stampVoltageSource(this.nodes[3], this.nodes[1], this.voltSources[0]);
        // Mechanical: inertia "inductor" (4->5), viscous damping to ground,
        // torque source (4->gnd).
        this.indInertia.stamp(stamper, this.nodes[4], this.nodes[5]);
        stamper.stampResistor(this.nodes[5], CircuitNode.ground, this.b);
        stamper.stampVoltageSource(this.nodes[4], CircuitNode.ground, this.voltSources[1]);
    }

    startIteration(stamper: Stamper): void {
        this.ind.startIteration(stamper, this.volts[0] - this.volts[2]);
        this.indInertia.startIteration(stamper, this.volts[4] - this.volts[5]);
        this.angle += this.speed * stamper.timeStep;
    }

    doStep(stamper: Stamper): void {
        stamper.updateVoltageSource(this.nodes[4], CircuitNode.ground, this.voltSources[1],
            this.coilCurrent * this.K);
        stamper.updateVoltageSource(this.nodes[3], this.nodes[1], this.voltSources[0],
            this.inertiaCurrent * this.Kb);
        this.ind.doStep(stamper, this.volts[0] - this.volts[2]);
        this.indInertia.doStep(stamper, this.volts[4] - this.volts[5]);
    }

    calculateCurrent(): void {
        this.coilCurrent = this.ind.calculateCurrent(this.volts[0] - this.volts[2]);
        this.inertiaCurrent = this.indInertia.calculateCurrent(this.volts[4] - this.volts[5]);
        this.speed = this.inertiaCurrent;
    }

    setCurrent(vs: VoltageSource, c: number): void {
        if (vs === this.voltSources[0]) this.current = c;
    }

    getConnection(n1: number, n2: number): boolean {
        const pair = (a: number, b: number) => (n1 === a && n2 === b) || (n1 === b && n2 === a);
        return pair(0, 2) || pair(2, 3) || pair(1, 3) || pair(4, 5);
    }
}

// ------------------------------------------------------- ThreePhaseMotor

// Squirrel-cage induction motor, from the coupled-coil model at
// https://forum.kicad.info/t/ac-motors-simulation-1-phase-3-phase/14188/3 :
// three stator coils plus two rotor (d/q) coils, all mutually coupled, with
// two speed-dependent voltage sources providing the rotational EMF.
// Posts 0..5 are the three winding pairs; nodes 6..12 are internal.
export class ThreePhaseMotorElm extends CircuitElm {
    static Zp = 2;
    static coilCount = 5;
    // Internal node indices, named as in Java.
    static n001 = 6; static n002 = 7; static n003 = 8; static n004 = 9;
    static n005 = 10; static n006 = 11; static n007 = 12;
    static coilNodes = [
        ThreePhaseMotorElm.n001, 1,
        ThreePhaseMotorElm.n003, 3,
        ThreePhaseMotorElm.n005, 5,
        ThreePhaseMotorElm.n002, ThreePhaseMotorElm.n004,
        ThreePhaseMotorElm.n006, ThreePhaseMotorElm.n007,
    ];

    Rs = 1; Rr = 1; Ls = 0.1; Lr = 0.1; Lm = 0.09;
    b = 1e-3;
    J = 1;
    angle = Math.PI / 2;
    speed = 0;
    coilCurrents = new Array(ThreePhaseMotorElm.coilCount).fill(0);
    coilCurSourceValues = new Array(ThreePhaseMotorElm.coilCount).fill(0);
    xformMatrix: number[][] | null = null;
    voltSources: VoltageSource[] = [];
    vs1value = 0;
    vs2value = 0;
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 6) {
            this.Rs = parseFloat(params[0]);
            this.Rr = parseFloat(params[1]);
            this.Ls = parseFloat(params[2]);
            this.Lr = parseFloat(params[3]);
            this.Lm = parseFloat(params[4]);
            this.b = parseFloat(params[5]);
            this.J = params.length > 6 ? parseFloat(params[6]) : 1;
            if (!Number.isFinite(this.J)) this.J = 1;
        }
    }

    getDumpType() { return 427; }
    dumpTokens() { return [this.Rs, this.Rr, this.Ls, this.Lr, this.Lm, this.b, this.J]; }
    getPostCount() { return 6; }
    getInternalNodeCount() { return 7; }
    getVoltageSourceCount() { return 2; }

    setPoints(): void {
        super.setPoints();
        const q = Math.abs(this.dy) > Math.abs(this.dx) ? -1 : 1;
        const pts: Point[] = [];
        for (let i = 0; i !== 3; i++) {
            pts.push(interpPoint(this.point1, this.point2, 0, -q * 32 * (i - 1)));
            pts.push(interpPoint(this.point1, this.point2, 1, q * 32 * (i - 1)));
        }
        this.posts = pts;
    }
    getPost(n: number): Point | null { return this.posts[n] ?? null; }

    reset(): void {
        super.reset();
        this.speed = 0;
        this.angle = Math.PI / 2;
        this.coilCurrents.fill(0);
        this.coilCurSourceValues.fill(0);
    }

    setVoltageSource(n: number, v: VoltageSource): void {
        this.voltSources[n] = v;
        v.setNodes(this.nodes[n === 0 ? ThreePhaseMotorElm.n002 : ThreePhaseMotorElm.n006], CircuitNode.ground);
    }

    stamp(stamper: Stamper): void {
        const N = ThreePhaseMotorElm;
        stamper.stampResistor(this.nodes[0], this.nodes[N.n001], this.Rs);
        stamper.stampResistor(this.nodes[2], this.nodes[N.n003], this.Rs);
        stamper.stampResistor(this.nodes[4], this.nodes[N.n005], this.Rs);
        stamper.stampResistor(this.nodes[N.n004], CircuitNode.ground, 1.5 * this.Rr);
        stamper.stampResistor(this.nodes[N.n007], CircuitNode.ground, 1.5 * this.Rr);

        const cc = N.coilCount;
        const Lr2 = this.Lr * 1.5;
        const coilInductances = [this.Ls, this.Ls, this.Ls, Lr2, Lr2];
        const k0 = this.Lm / Math.sqrt(this.Ls * Lr2);
        const kk: number[][] = Array.from({ length: cc }, () => new Array(cc).fill(0));
        kk[0][3] = kk[3][0] = k0;
        kk[1][3] = kk[3][1] = -k0 / 2;
        kk[1][4] = kk[4][1] = k0 * Math.sqrt(3) / 2;
        kk[2][3] = kk[3][2] = -k0 / 2;
        kk[2][4] = kk[4][2] = -k0 * Math.sqrt(3) / 2;

        const L: number[][] = Array.from({ length: cc }, () => new Array(cc).fill(0));
        for (let i = 0; i !== cc; i++) L[i][i] = coilInductances[i];
        for (let i = 0; i !== cc; i++) {
            for (let j = 0; j !== i; j++) {
                L[i][j] = L[j][i] = kk[i][j] * Math.sqrt(coilInductances[i] * coilInductances[j]);
            }
        }
        const inv = invertMatrix(L);
        const ts = stamper.timeStep;
        this.xformMatrix = inv.map(row => row.map(v => v * ts));

        for (let i = 0; i !== cc; i++) {
            for (let j = 0; j !== cc; j++) {
                const ni1 = N.coilNodes[i * 2], ni2 = N.coilNodes[i * 2 + 1];
                const nj1 = N.coilNodes[j * 2], nj2 = N.coilNodes[j * 2 + 1];
                if (i === j) stamper.stampConductance(this.nodes[ni1], this.nodes[ni2], this.xformMatrix[i][i]);
                else stamper.stampVCCurrentSource(this.nodes[ni1], this.nodes[ni2], this.nodes[nj1], this.nodes[nj2], this.xformMatrix[i][j]);
            }
        }
        stamper.stampVoltageSource(this.nodes[N.n002], CircuitNode.ground, this.voltSources[0]);
        stamper.stampVoltageSource(this.nodes[N.n006], CircuitNode.ground, this.voltSources[1]);
    }

    startIteration(stamper: Stamper): void {
        const cc = ThreePhaseMotorElm.coilCount;
        for (let i = 0; i !== cc; i++) this.coilCurSourceValues[i] = this.coilCurrents[i];

        const Zp = ThreePhaseMotorElm.Zp;
        const torque = Zp * Math.sqrt(3) / 2 * this.Lm
            * ((this.coilCurrents[1] - this.coilCurrents[2]) * this.coilCurrents[3]
                - Math.sqrt(3) * this.coilCurrents[0] * this.coilCurrents[4]);
        this.speed += stamper.timeStep * (torque - this.b * this.speed) / this.J;
        this.angle += this.speed * stamper.timeStep;

        this.vs1value = -Zp * this.speed
            * (this.Lm * Math.sqrt(3) / 2 * (this.coilCurrents[1] - this.coilCurrents[2])
                + 1.5 * this.Lr * this.coilCurrents[4]);
        this.vs2value = Zp * this.speed
            * (3 / 2 * this.Lm * this.coilCurrents[0] + 1.5 * this.Lr * this.coilCurrents[3]);
    }

    doStep(stamper: Stamper): void {
        const N = ThreePhaseMotorElm;
        for (let i = 0; i !== N.coilCount; i++) {
            stamper.stampCurrentSource(this.nodes[N.coilNodes[i * 2]], this.nodes[N.coilNodes[i * 2 + 1]],
                this.coilCurSourceValues[i]);
        }
        stamper.updateVoltageSource(this.nodes[N.n002], CircuitNode.ground, this.voltSources[0], -this.vs1value);
        stamper.updateVoltageSource(this.nodes[N.n006], CircuitNode.ground, this.voltSources[1], -this.vs2value);
    }

    calculateCurrent(): void {
        const N = ThreePhaseMotorElm;
        for (let i = 0; i !== N.coilCount; i++) {
            let val = this.coilCurSourceValues[i];
            if (this.xformMatrix) {
                for (let j = 0; j !== N.coilCount; j++) {
                    const voltdiff = this.volts[N.coilNodes[j * 2]] - this.volts[N.coilNodes[j * 2 + 1]];
                    val += voltdiff * this.xformMatrix[i][j];
                }
            }
            this.coilCurrents[i] = val;
        }
        this.current = this.coilCurrents[0];
    }

    hasGroundConnection(_n1: number) { return false; }
    getConnection(_n1: number, _n2: number) { return true; }
}

// Gauss-Jordan inverse, matching SimulationManager.invertMatrix()'s role.
function invertMatrix(m: number[][]): number[][] {
    const n = m.length;
    const a = m.map(r => [...r]);
    const inv: number[][] = a.map((_, i) => a.map((_, j) => (i === j ? 1 : 0)));
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
        if (Math.abs(a[piv][col]) < 1e-300) continue;
        [a[col], a[piv]] = [a[piv], a[col]];
        [inv[col], inv[piv]] = [inv[piv], inv[col]];
        const d = a[col][col];
        for (let j = 0; j < n; j++) { a[col][j] /= d; inv[col][j] /= d; }
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = a[r][col];
            if (f === 0) continue;
            for (let j = 0; j < n; j++) { a[r][j] -= f * a[col][j]; inv[r][j] -= f * inv[col][j]; }
        }
    }
    return inv;
}
