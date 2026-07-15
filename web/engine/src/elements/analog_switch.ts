import { CircuitElm, Stamper, Point, interpPoint, interpPoint2 } from './base';
import { CircuitNode } from '../core/node';

// Ported from AnalogSwitchElm.java: a voltage-controlled analog switch
// (think CD4066-style). Two switch terminals (post0/post1) connected via
// r_on (closed) or r_off (open), gated by a control voltage at post2 vs
// `threshold`. Genuinely nonlinear -- the resistance between post0/post1
// changes every Newton sub-iteration based on the LATEST known control
// voltage (doStep() re-stamps every call, exactly like a diode would).
export class AnalogSwitchElm extends CircuitElm {
    static FLAG_INVERT = 1;
    static FLAG_PULLDOWN = 2;

    r_on = 20;
    r_off = 1e10;
    threshold = 2.5;
    resistance = 0;
    open = false;

    // Control-post geometry (post2). Java derives an openhs sign from 3
    // separate flip-tracking flags (FLAG_FLIPPED_X/Y/FLIPPED) this port
    // doesn't replicate (no element mirroring support yet, matching e.g.
    // OpAmpElm's own skip of FLAG_SWAP's mirrored-drawing half); fixed at
    // the Java "not flipped" default (+16) instead. adjustLeadsToGrid() is
    // pure cosmetic grid-snapping, also not ported (electrically inert).
    static OPENHS = 16;
    point3: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 2) {
            this.r_on = parseFloat(params[0]);
            this.r_off = parseFloat(params[1]);
            this.threshold = parseFloat(params[2]);
        } else {
            // Fresh placement only (matches Java's 2-arg constructor).
            this.flags |= AnalogSwitchElm.FLAG_PULLDOWN;
        }
    }

    getDumpType() { return 159; }
    dumpTokens(): (string | number | boolean)[] { return [this.r_on, this.r_off, this.threshold]; }
    getPostCount() { return 3; }

    // Ported from AnalogSwitchElm.java's setPoints(): the control pin
    // (post2) sits at the midpoint of the leads, offset perpendicular by
    // -openhs (calcLeads()/lead1/lead2 are the same base-class helpers
    // OpAmpElm etc. already use).
    setPoints() {
        super.setPoints();
        this.calcLeads(32);
        this.point3 = interpPoint(this.lead1, this.lead2, 0.5, -AnalogSwitchElm.OPENHS);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.point2;
        if (n === 2) return this.point3;
        return null;
    }

    nonLinear() { return true; }
    needsPulldown() { return (this.flags & AnalogSwitchElm.FLAG_PULLDOWN) !== 0; }

    stamp(stamper: Stamper) {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
        if (this.needsPulldown()) {
            // Pulldown resistor on each side.
            stamper.stampResistor(this.nodes[0], CircuitNode.ground, this.r_off);
            stamper.stampResistor(this.nodes[1], CircuitNode.ground, this.r_off);
        }
    }

    doStep(stamper: Stamper) {
        this.open = this.volts[2] < this.threshold;
        if ((this.flags & AnalogSwitchElm.FLAG_INVERT) !== 0) this.open = !this.open;

        // If pulldown flag is set, resistance is r_on. Otherwise, no
        // connection. If pulldown flag is unset, resistance is r_on for on,
        // r_off for off.
        if (!(this.needsPulldown() && this.open)) {
            this.resistance = this.open ? this.r_off : this.r_on;
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
        }
    }

    calculateCurrent() {
        if (this.resistance === 0) return;
        if (this.needsPulldown() && this.open) {
            this.current = 0;
        } else {
            this.current = (this.volts[0] - this.volts[1]) / this.resistance;
        }
    }

    // We have to just assume current will flow either way, even though that
    // might cause singular matrix errors.
    getConnection(n1: number, n2: number) {
        if (n1 === 2 || n2 === 2) return false;
        return true;
    }

    hasGroundConnection(n1: number) {
        return this.needsPulldown() && n1 < 2;
    }

    // No getVoltageDiff() override -- the base class default (volts[0] -
    // volts[1]) already matches Java, which doesn't override it either.

    getCurrentIntoNode(n: number) {
        if (n === 2) return 0;
        if (n === 0) return -this.current;
        return this.current;
    }
}

// Ported from AnalogSwitch2Elm.java: an SPDT analog switch -- one common
// terminal (post0) thrown to either post1 or post2 depending on the control
// voltage at post3, vs the same AnalogSwitchElm inherits (r_on/r_off/
// threshold/FLAG_INVERT/FLAG_PULLDOWN all reused unchanged).
export class AnalogSwitch2Elm extends AnalogSwitchElm {
    swpostA: Point = { x: 0, y: 0 };
    swpostB: Point = { x: 0, y: 0 };
    ctlPoint: Point = { x: 0, y: 0 };

    getDumpType() { return 160; }
    getPostCount() { return 4; }

    // Ported from AnalogSwitch2Elm.java's setPoints(): throw-A/throw-B sit
    // at point2's end of the line, split perpendicular by +/-OPENHS (note:
    // POSITIVE openhs here, unlike AnalogSwitchElm's own point3 which uses
    // the negated sign -- a real, deliberate difference in the oracle, not
    // a typo). The control pin sits at the leads' midpoint, also offset by
    // +OPENHS. swpoles (Java's OTHER point pair, used only for drawing the
    // switch arm) isn't needed here -- this port's symbol renderer doesn't
    // replicate Java's draw() pixel-for-pixel.
    setPoints() {
        super.setPoints();
        [this.swpostA, this.swpostB] = interpPoint2(this.point1, this.point2, 1, AnalogSwitchElm.OPENHS);
        this.ctlPoint = interpPoint(this.lead1, this.lead2, 0.5, AnalogSwitchElm.OPENHS);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.swpostA;
        if (n === 2) return this.swpostB;
        if (n === 3) return this.ctlPoint;
        return null;
    }

    stamp(stamper: Stamper) {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
        stamper.stampNonLinear(this.nodes[2]);
        if (this.needsPulldown()) {
            stamper.stampResistor(this.nodes[1], CircuitNode.ground, this.r_off);
            stamper.stampResistor(this.nodes[2], CircuitNode.ground, this.r_off);
        }
    }

    doStep(stamper: Stamper) {
        this.open = this.volts[3] < this.threshold;
        if ((this.flags & AnalogSwitchElm.FLAG_INVERT) !== 0) this.open = !this.open;
        if (this.open) {
            stamper.stampResistor(this.nodes[0], this.nodes[2], this.r_on);
            if (!this.needsPulldown()) stamper.stampResistor(this.nodes[0], this.nodes[1], this.r_off);
        } else {
            stamper.stampResistor(this.nodes[0], this.nodes[1], this.r_on);
            if (!this.needsPulldown()) stamper.stampResistor(this.nodes[0], this.nodes[2], this.r_off);
        }
    }

    calculateCurrent() {
        if (this.open) {
            this.current = (this.volts[0] - this.volts[2]) / this.r_on;
        } else {
            this.current = (this.volts[0] - this.volts[1]) / this.r_on;
        }
    }

    getConnection(n1: number, n2: number) {
        if (n1 === 3 || n2 === 3) return false;
        if (this.needsPulldown()) {
            const target = this.open ? 2 : 1;
            return (n1 === 0 && n2 === target) || (n1 === target && n2 === 0);
        }
        return true;
    }

    hasGroundConnection(n: number) {
        return this.needsPulldown() && n !== 3;
    }

    // No getVoltageDiff() override in Java here either -- it uses the base
    // default (volts[0] - volts[1]), i.e. common vs throw-A specifically,
    // regardless of which way the switch is thrown. Matched faithfully
    // rather than "improving" it to track the actually-connected throw.

    getCurrentIntoNode(n: number) {
        if (n === 0) return -this.current;
        const position = this.open ? 1 : 0;
        if (n === position + 1) return this.current;
        return 0;
    }
}
