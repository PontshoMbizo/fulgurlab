import { CircuitElm, Stamper } from './base';
import { VoltageSource } from '../core/node';

// Ported from AmmeterElm.java: an ideal (zero-resistance) ammeter, modelled
// as a 0V voltage source between its two posts so current through the branch
// is directly available as the source's solved current. isWireEquivalent()
// is true (topologically it's a wire), but isRemovableWire() stays at the
// base default `false` -- Java's comment: "do not optimize out, even though
// isWireEquivalent() is true, because we need current calculated every
// timestep" (wire-closure removal would fold it away and lose that).
export class AmmeterElm extends CircuitElm {
    static AM_VOL = 0;
    static AM_RMS = 1;
    static FLAG_SHOWCURRENT = 1;
    static FLAG_CIRCLE = 2;
    static SCALE_AUTO = 0;

    meter = AmmeterElm.AM_VOL;
    scale = AmmeterElm.SCALE_AUTO;
    zerocount = 0;
    rmsI = 0; total = 0; count = 0;
    maxI = 0; lastMaxI = 0;
    minI = 0; lastMinI = 0;
    selectedValue = 0;
    increasingI = true; decreasingI = true;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.scale = AmmeterElm.SCALE_AUTO;
        if (Array.isArray(params) && params.length > 0) {
            this.meter = parseInt(params[0]) || AmmeterElm.AM_VOL;
            if (params.length > 1) this.scale = parseInt(params[1]) || AmmeterElm.SCALE_AUTO;
        } else {
            this.flags = flags | AmmeterElm.FLAG_SHOWCURRENT | AmmeterElm.FLAG_CIRCLE;
        }
    }

    getDumpType() { return 370; }
    dumpTokens() { return [this.meter, this.scale]; }

    setVoltageSource(n: number, vs: VoltageSource) {
        super.setVoltageSource(n, vs);
        vs.setNodes(this.nodes[0], this.nodes[1]);
    }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, 0);
    }

    getVoltageSourceCount() { return 1; }
    mustShowCurrent() { return (this.flags & AmmeterElm.FLAG_SHOWCURRENT) !== 0; }
    drawAsCircle() { return (this.flags & AmmeterElm.FLAG_CIRCLE) !== 0; }

    isWireEquivalent() { return true; }

    getPower() { return 0; }
    getVoltageDiff() { return this.volts[0]; }

    // BUGFIX (see CircuitElm.setCurrent()'s comment in base.ts): an ammeter
    // senses current via a 0V voltage source, so its own `current` is
    // entirely the solved branch current of that source. No override needed
    // here: the base setCurrent(vs, c) default (`current = c`) is dispatched
    // by CircuitEngine.applySolvedRightSide() DURING the solve (inside
    // stepOnce()'s subiteration loop) -- well before stepFinished() runs
    // below, which is important: stepFinished() reads `this.current` for
    // its min/max/rms stats, and an EARLIER version of this fix used a
    // calculateCurrent() override instead, which only runs later via
    // calcWireCurrents() -- AFTER stepFinished() in the same step. That
    // ordering meant these stats were always one step stale relative to
    // what had actually just been solved, even though the underlying
    // current value was otherwise correct. Relying on the setCurrent()
    // dispatch instead fixes both problems (populated at all + fresh in
    // time for stepFinished()) with the SAME mechanism Java itself uses.
    stepFinished() {
        this.count++;
        this.total += this.current * this.current;

        if (this.current > this.maxI && this.increasingI) {
            this.maxI = this.current;
            this.increasingI = true;
            this.decreasingI = false;
        }
        if (this.current < this.maxI && this.increasingI) {
            this.lastMaxI = this.maxI;
            this.minI = this.current;
            this.increasingI = false;
            this.decreasingI = true;
            this.total = this.total / this.count;
            this.rmsI = Math.sqrt(this.total);
            if (Number.isNaN(this.rmsI)) this.rmsI = 0;
            this.count = 0;
            this.total = 0;
        }
        if (this.current < this.minI && this.decreasingI) {
            this.minI = this.current;
            this.increasingI = false;
            this.decreasingI = true;
        }
        if (this.current > this.minI && this.decreasingI) {
            this.lastMinI = this.minI;
            this.maxI = this.current;
            this.increasingI = true;
            this.decreasingI = false;
            this.total = this.total / this.count;
            this.rmsI = Math.sqrt(this.total);
            if (Number.isNaN(this.rmsI)) this.rmsI = 0;
            this.count = 0;
            this.total = 0;
        }
        if (this.current === 0) {
            this.zerocount++;
            if (this.zerocount > 5) {
                this.total = 0;
                this.rmsI = 0;
                this.maxI = 0;
                this.minI = 0;
            }
        } else {
            this.zerocount = 0;
        }

        switch (this.meter) {
            case AmmeterElm.AM_VOL: this.selectedValue = this.current; break;
            case AmmeterElm.AM_RMS: this.selectedValue = this.rmsI; break;
        }
    }
}
