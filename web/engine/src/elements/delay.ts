import { CircuitElm, Stamper, Point, interpPoint2 } from './base';
import { CircuitNode } from '../core/node';

// Ported from DelayBufferElm.java: a digital buffer that only propagates an
// input-level change to the output after `delay` seconds have elapsed with
// the input steadily at its new level (a deglitch/propagation-delay
// buffer) -- NOT a shift-register-style fixed-length delay line.
export class DelayBufferElm extends CircuitElm {
    delay = 0;
    threshold = 2.5;
    highVoltage = 5;
    delayEndTime = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 0) {
            this.delay = parseFloat(params[0]) || 0.1;
            this.threshold = params.length > 1 ? parseFloat(params[1]) : 2.5;
            this.highVoltage = params.length > 2 ? parseFloat(params[2]) : 5;
        }
    }

    getDumpType() { return 422; }
    dumpTokens(): (string | number | boolean)[] { return [this.delay, this.threshold, this.highVoltage]; }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource);
    }

    doStep(stamper: Stamper) {
        const inState = this.volts[0] > this.threshold;
        const outStateNow = this.volts[1] > this.threshold;
        let outState = outStateNow;
        if (inState !== outStateNow) {
            if (stamper.t >= this.delayEndTime) outState = inState;
        } else {
            this.delayEndTime = stamper.t + this.delay;
        }
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[1], this.voltSource, outState ? this.highVoltage : 0);
    }

    getVoltageDiff() { return this.volts[0]; }

    // There is no current path through the input, but there is an indirect
    // path through the output to ground.
    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(n1: number) { return n1 === 1; }

    getCurrentIntoNode(n: number) {
        if (n === 1) return this.current;
        return 0;
    }
}

// Ported from TimeDelayRelayElm.java -- a 4-pin relay model. Java's version
// extends ChipElm purely for its generic multi-pin box rendering (fixed 2x2
// pin layout: Vin/gnd sense a "coil" voltage, in/out are the switched
// contacts) -- not for any variable-pin-count behavior, so this port
// doesn't need ChipElm at all (same "fixed pin count, skip ChipElm" call as
// this session's Power-group elements). Own 4-post geometry below mirrors
// Java's actual spatial layout: Vin+in on the point1 side (west), gnd+out
// on the point2 side (east).
//
// Behavior: nodes[0]/[1] (Vin/gnd) sense a "coil" voltage across a fixed
// 10k sense resistor; whenever that sensed voltage crosses 2.5V, a timer
// starts (onDelay if energizing, offDelay if de-energizing) -- only once
// that delay elapses does the ACTUAL relay contact (nodes[2]/[3], in/out)
// switch between onResistance and offResistance.
export class TimeDelayRelayElm extends CircuitElm {
    static VIN_RESISTANCE = 10e3;
    static HS = 12;

    onDelay = 1;
    offDelay = 0;
    onResistance = 1;
    offResistance = 10e6;
    resistance = 10e6;
    lastTransition = 0;
    poweredState = false;
    onState = false;

    vinP: Point = { x: 0, y: 0 };
    inP: Point = { x: 0, y: 0 };
    gndP: Point = { x: 0, y: 0 };
    outP: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 3) {
            this.onDelay = parseFloat(params[0]) || 1;
            this.offDelay = parseFloat(params[1]) || 0;
            this.onResistance = parseFloat(params[2]) || 1;
            this.offResistance = parseFloat(params[3]) || 10e6;
        }
        this.resistance = this.offResistance;
    }

    getDumpType() { return 414; }
    dumpTokens(): (string | number | boolean)[] {
        return [this.onDelay, this.offDelay, this.onResistance, this.offResistance];
    }

    reset() {
        super.reset();
        this.lastTransition = 0;
        this.poweredState = false;
        this.onState = false;
    }

    getPostCount() { return 4; }
    getVoltageSourceCount() { return 0; }
    nonLinear() { return true; }

    // West side (point1): Vin/in fanned perpendicular. East side (point2):
    // gnd/out fanned perpendicular -- mirrors Java's setupPins() SIDE_W/
    // SIDE_E rows (own layout, not a replica of ChipElm's exact pixel grid).
    setPoints() {
        super.setPoints();
        const hs = TimeDelayRelayElm.HS * this.dsign;
        [this.vinP, this.inP] = interpPoint2(this.point1, this.point2, 0, hs);
        [this.gndP, this.outP] = interpPoint2(this.point1, this.point2, 1, hs);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.vinP;
        if (n === 1) return this.gndP;
        if (n === 2) return this.inP;
        if (n === 3) return this.outP;
        return null;
    }

    stamp(stamper: Stamper) {
        this.resistance = this.onState ? this.onResistance : this.offResistance;
        stamper.stampResistor(this.nodes[0], this.nodes[1], TimeDelayRelayElm.VIN_RESISTANCE);
        stamper.stampNonLinear(this.nodes[2]);
        stamper.stampNonLinear(this.nodes[3]);
    }

    doStep(stamper: Stamper) {
        this.resistance = this.onState ? this.onResistance : this.offResistance;
        stamper.stampResistor(this.nodes[2], this.nodes[3], this.resistance);
    }

    stepFinished(stamper: Stamper) {
        // Power applied, then delay, then in and out are connected.
        const oldState = this.poweredState;
        this.poweredState = this.volts[0] - this.volts[1] > 2.5;
        if (oldState !== this.poweredState) this.lastTransition = stamper.t;
        if (stamper.t > this.lastTransition + (this.poweredState ? this.onDelay : this.offDelay)) {
            this.onState = this.poweredState;
        }
    }

    calculateCurrent() {
        // Matches Java's draw()-computed pin currents (the only place it
        // ever assigns them): sense-branch current and contact-branch
        // current are two independent quantities on this 2-in-1 element;
        // `current` here tracks the contact branch (nodes[2]/[3]), the more
        // electrically meaningful "is the relay conducting" reading.
        this.current = -(this.volts[2] - this.volts[3]) / this.resistance;
    }

    getConnection(n1: number, n2: number) {
        // Two independent branches (sense: 0-1, contact: 2-3), no path
        // between them.
        return (n1 < 2 && n2 < 2) || (n1 >= 2 && n2 >= 2);
    }

    hasGroundConnection(_n1: number) { return false; }
}
