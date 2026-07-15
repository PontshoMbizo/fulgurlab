import { CircuitElm, Stamper } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from SweepElm.java: a 1-terminal ground-referenced source that
// sweeps its output frequency between minF and maxF over sweepTime seconds
// (linear, or logarithmic under FLAG_LOG), optionally bouncing back and
// forth (FLAG_BIDIR) instead of snapping back to minF. `v` is computed once
// per REAL time step in startIteration() and just replayed by doStep() on
// every Newton sub-iteration -- byte-faithful to the oracle's own split
// between those two lifecycle hooks (both exist on this port's CircuitElm
// base and are called with the same once-per-step / once-per-sub-iteration
// cadence, see core/engine.ts's stepOnce()).
export class SweepElm extends CircuitElm {
    static FLAG_LOG = 1;
    static FLAG_BIDIR = 2;

    minF = 20;
    maxF = 4000;
    maxV = 5;
    sweepTime = 0.1;
    frequency = 20;
    fadd = 0;
    fmul = 1;
    freqTime = 0;
    savedTimeStep = 0;
    dir = 1;
    v = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 3) {
            this.minF = parseFloat(params[0]);
            this.maxF = parseFloat(params[1]);
            this.maxV = parseFloat(params[2]);
            this.sweepTime = parseFloat(params[3]);
        } else {
            // Fresh placement: Java's 2-arg constructor hardcodes these
            // defaults (including flags = FLAG_BIDIR, overwriting whatever
            // was passed in -- there's nothing pre-existing to preserve for
            // a brand-new element).
            this.minF = 20; this.maxF = 4000; this.maxV = 5; this.sweepTime = 0.1;
            this.flags = SweepElm.FLAG_BIDIR;
        }
        this.reset();
    }

    getDumpType() { return 170; }
    getPostCount() { return 1; }
    dumpTokens(): (string | number | boolean)[] { return [this.minF, this.maxF, this.maxV, this.sweepTime]; }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    hasGroundConnection(_n1: number) { return true; }

    setVoltageSource(_j: number, vs: VoltageSource) { this.voltSource = vs; }

    getVoltageDiff() { return this.volts[0]; }
    getPower() { return -this.getVoltageDiff() * this.current; }

    setParams(stamper: Stamper) {
        if (this.frequency < this.minF || this.frequency > this.maxF) {
            this.frequency = this.minF;
            this.freqTime = 0;
            this.dir = 1;
        }
        if ((this.flags & SweepElm.FLAG_LOG) === 0) {
            this.fadd = this.dir * stamper.timeStep * (this.maxF - this.minF) / this.sweepTime;
            this.fmul = 1;
        } else {
            this.fadd = 0;
            this.fmul = Math.pow(this.maxF / this.minF, this.dir * stamper.timeStep / this.sweepTime);
        }
        this.savedTimeStep = stamper.timeStep;
    }

    reset() {
        this.frequency = this.minF;
        this.freqTime = 0;
        this.dir = 1;
        // Java's reset() calls setParams() immediately using the sim
        // singleton's always-available timeStep. This port's reset() has no
        // Stamper to read timeStep from, so savedTimeStep is left at a
        // sentinel (0) -- the very first startIteration() call below sees
        // `stamper.timeStep !== savedTimeStep` and calls setParams() there
        // instead, before computing `v`. Functionally equivalent: fadd/fmul
        // are only ever consumed starting from that first startIteration().
        this.savedTimeStep = 0;
    }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
    }

    startIteration(stamper: Stamper) {
        if (stamper.timeStep !== this.savedTimeStep) this.setParams(stamper);
        this.v = Math.sin(this.freqTime) * this.maxV;
        this.freqTime += this.frequency * 2 * Math.PI * stamper.timeStep;
        this.frequency = this.frequency * this.fmul + this.fadd;
        if (this.frequency >= this.maxF && this.dir === 1) {
            if ((this.flags & SweepElm.FLAG_BIDIR) !== 0) {
                this.fadd = -this.fadd;
                this.fmul = 1 / this.fmul;
                this.dir = -1;
            } else {
                this.frequency = this.minF;
            }
        }
        if (this.frequency <= this.minF && this.dir === -1) {
            this.fadd = -this.fadd;
            this.fmul = 1 / this.fmul;
            this.dir = 1;
        }
    }

    doStep(stamper: Stamper) {
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.v);
    }
}

// Ported from AMElm.java ("contributed by Edward Calver"): a 1-terminal
// ground-referenced amplitude-modulated source. Envelope and carrier are
// both plain sines recomputed fresh from sim time on every doStep() call
// (no per-real-step-only state like SweepElm/FMElm need), so this is a
// direct CircuitElm subclass with no startIteration() override.
export class AMElm extends CircuitElm {
    static FLAG_COS = 2;
    carrierfreq = 1000;
    signalfreq = 40;
    maxVoltage = 5;
    freqTimeZero = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 2) {
            this.carrierfreq = parseFloat(params[0]);
            this.signalfreq = parseFloat(params[1]);
            this.maxVoltage = parseFloat(params[2]);
        }
        // Java clears FLAG_COS unconditionally right after reading it -- it
        // has no other effect anywhere in this class (vestigial, likely a
        // copy-paste leftover from VoltageElm); replicated for byte-fidelity
        // even though it does nothing observable.
        this.flags &= ~AMElm.FLAG_COS;
        this.reset();
    }

    getDumpType() { return 200; }
    getPostCount() { return 1; }
    dumpTokens(): (string | number | boolean)[] { return [this.carrierfreq, this.signalfreq, this.maxVoltage]; }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    hasGroundConnection(_n1: number) { return true; }

    setVoltageSource(_j: number, vs: VoltageSource) { this.voltSource = vs; }

    reset() { this.freqTimeZero = 0; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
    }

    doStep(stamper: Stamper) {
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
    }

    getVoltage(t: number): number {
        const w = 2 * Math.PI * (t - this.freqTimeZero);
        return ((Math.sin(w * this.signalfreq) + 1) / 2) * Math.sin(w * this.carrierfreq) * this.maxVoltage;
    }

    getVoltageDiff() { return this.volts[0]; }
    getPower() { return -this.getVoltageDiff() * this.current; }
}

// Ported from FMElm.java ("contributed by Edward Calver"): a 1-terminal
// ground-referenced frequency-modulated source.
//
// NOTE: getVoltage() has a real side effect (accumulates `funcx`, a running
// phase integral, based on the wall-sim-time delta since the LAST call) --
// byte-faithful to the oracle's own FMElm.getVoltage(), warts and all. If
// doStep() runs multiple times within one real time step (Newton iteration
// on a nonlinear circuit elsewhere), funcx accumulates once per sub-
// iteration rather than once per real step, exactly like Java does. Not
// "fixed" here -- the oracle wins, including its own imprecisions.
export class FMElm extends CircuitElm {
    static FLAG_COS = 2;
    carrierfreq = 800;
    signalfreq = 40;
    maxVoltage = 5;
    deviation = 200;
    freqTimeZero = 0;
    lasttime = 0;
    funcx = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 3) {
            this.carrierfreq = parseFloat(params[0]);
            this.signalfreq = parseFloat(params[1]);
            this.maxVoltage = parseFloat(params[2]);
            this.deviation = parseFloat(params[3]);
        }
        this.flags &= ~FMElm.FLAG_COS;
        this.reset();
    }

    getDumpType() { return 201; }
    getPostCount() { return 1; }
    dumpTokens(): (string | number | boolean)[] {
        return [this.carrierfreq, this.signalfreq, this.maxVoltage, this.deviation];
    }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    hasGroundConnection(_n1: number) { return true; }

    setVoltageSource(_j: number, vs: VoltageSource) { this.voltSource = vs; }

    reset() { this.freqTimeZero = 0; this.lasttime = 0; this.funcx = 0; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
    }

    doStep(stamper: Stamper) {
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
    }

    getVoltage(t: number): number {
        const deltaT = t - this.lasttime;
        this.lasttime = t;
        const signalamplitude = Math.sin((2 * Math.PI * (t - this.freqTimeZero)) * this.signalfreq);
        this.funcx += deltaT * (this.carrierfreq + signalamplitude * this.deviation);
        const w = 2 * Math.PI * this.funcx;
        return Math.sin(w) * this.maxVoltage;
    }

    getVoltageDiff() { return this.volts[0]; }
    getPower() { return -this.getVoltageDiff() * this.current; }
}
