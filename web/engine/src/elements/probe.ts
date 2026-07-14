import { CircuitElm, Stamper } from './base';

// Ported from ProbeElm.java (a voltmeter). Two posts; stamps a large series
// resistance (default 1e7ohm) between them if `resistance != 0`, otherwise
// (the common case for a dumped/loaded probe, per Java's dump-constructor
// default of 0) doesn't connect its posts at all electrically.
//
// DEVIATION (documented): Java's stepFinished() measures period/pulseWidth/
// dutyCycle using System.currentTimeMillis() -- real wall-clock time. That's
// fine for a live, animated UI, but actively wrong for this engine's
// determinism goals (Phase 0's whole point is reproducible golden fixtures;
// wall-clock timestamps would make two runs of the same circuit disagree).
// This port uses the simulation clock (`stamper.t`, seconds) in its place --
// same algorithm, deterministic clock. rms/max/min tracking needed no clock
// to begin with and is ported as-is.
export class ProbeElm extends CircuitElm {
    static FLAG_SHOWVOLTAGE = 1;
    static FLAG_CIRCLE = 2;
    static SCALE_AUTO = 0;

    static TP_VOL = 0; static TP_RMS = 1; static TP_MAX = 2; static TP_MIN = 3;
    static TP_P2P = 4; static TP_BIN = 5; static TP_FRQ = 6; static TP_PER = 7;
    static TP_PWI = 8; static TP_DUT = 9;

    meter = ProbeElm.TP_VOL;
    scale = ProbeElm.SCALE_AUTO;
    resistance = 0;

    rmsV = 0; total = 0; count = 0;
    binaryLevel = 0;
    zerocount = 0;
    maxV = 0; lastMaxV = 0;
    minV = 0; lastMinV = 0;
    frequency = 0; period = 0; pulseWidth = 0; dutyCycle = 0;
    selectedValue = 0;
    increasingV = true; decreasingV = true;
    periodStart = 0; periodLength = 0; pulseStart = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.resistance = 0;
        if (Array.isArray(params) && params.length > 0) {
            this.meter = parseInt(params[0]) || ProbeElm.TP_VOL;
            if (params.length > 1) this.scale = parseInt(params[1]) || ProbeElm.SCALE_AUTO;
            if (params.length > 2) this.resistance = parseFloat(params[2]) || 0;
        } else {
            // Two-arg (fresh, non-dumped) construction in Java defaults to
            // FLAG_SHOWVOLTAGE|FLAG_CIRCLE and resistance=1e7; mirrored here
            // via the `flags` default parameter callers can still override.
            this.resistance = 1e7;
        }
    }

    getDumpType() { return 'p'; }

    mustShowVoltage() { return (this.flags & ProbeElm.FLAG_SHOWVOLTAGE) !== 0; }
    drawAsCircle() { return (this.flags & ProbeElm.FLAG_CIRCLE) !== 0; }

    stamp(stamper: Stamper) {
        if (this.resistance !== 0) {
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
        }
    }

    calculateCurrent() {
        this.current = (this.resistance === 0) ? 0 : (this.volts[0] - this.volts[1]) / this.resistance;
    }

    getConnection(n1: number, n2: number): boolean { return this.resistance !== 0; }

    stepFinished(stamper: Stamper) {
        this.count++;
        const v = this.getVoltageDiff();
        this.total += v * v;

        this.binaryLevel = v < 2.5 ? 0 : 1;

        if (v > this.maxV && this.increasingV) {
            this.maxV = v;
            this.increasingV = true;
            this.decreasingV = false;
        }
        if (v < this.maxV && this.increasingV) {
            this.lastMaxV = this.maxV;
            this.periodLength = stamper.t - this.periodStart;
            this.periodStart = stamper.t;
            this.period = this.periodLength;
            this.pulseWidth = stamper.t - this.pulseStart;
            this.dutyCycle = this.periodLength === 0 ? 0 : this.pulseWidth / this.periodLength;
            this.minV = v;
            this.increasingV = false;
            this.decreasingV = true;
            this.total = this.total / this.count;
            this.rmsV = Math.sqrt(this.total);
            if (Number.isNaN(this.rmsV)) this.rmsV = 0;
            this.count = 0;
            this.total = 0;
        }
        if (v < this.minV && this.decreasingV) {
            this.minV = v;
            this.increasingV = false;
            this.decreasingV = true;
        }
        if (v > this.minV && this.decreasingV) {
            this.lastMinV = this.minV;
            this.pulseStart = stamper.t;
            this.maxV = v;
            this.increasingV = true;
            this.decreasingV = false;
            this.total = this.total / this.count;
            this.rmsV = Math.sqrt(this.total);
            if (Number.isNaN(this.rmsV)) this.rmsV = 0;
            this.count = 0;
            this.total = 0;
        }
        if (v === 0) {
            this.zerocount++;
            if (this.zerocount > 5) {
                this.total = 0;
                this.rmsV = 0;
                this.maxV = 0;
                this.minV = 0;
            }
        } else {
            this.zerocount = 0;
        }
        // Note: Java's ProbeElm never actually assigns `selectedValue` in
        // stepFinished() (it's read by getEditInfo() but only ever written,
        // if at all, from UI code this port doesn't have yet) -- left at its
        // constructor default here too, faithfully, rather than inventing an
        // assignment the oracle doesn't have.
    }
}
