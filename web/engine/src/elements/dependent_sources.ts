import { CircuitElm, Stamper, Point, interpPoint2 } from './base';
import { VoltageSource } from '../core/node';

// Ported from VCVSElm/VCCSElm/CCVSElm/CCCSElm.java -- SIMPLIFIED.
//
// SIMPLIFICATION (documented, not silently dropped): Java's real versions of
// all four of these extend ChipElm and evaluate an arbitrary user-typed
// expression (ExprParser/Expr/ExprState -- ANY function of up to 8 named
// input pins, e.g. "3*a*b-sin(c)") with a variable pin count, entirely
// separate infrastructure this port doesn't have (a generic multi-pin chip
// renderer + a full expression parser/evaluator -- roughly the same scale of
// undertaking as CustomCompositeElm/subcircuits, already deferred). These
// four classes instead implement the classic fixed-2-terminal-control,
// FIXED-GAIN dependent source every intro circuits course actually teaches
// (SPICE's E/G/F/H elements) -- output = gain * control-signal, nothing
// fancier. This is a real, useful, and byte-correct implementation of a
// *subset* of Java's feature (plain linear gain), not an approximation of
// the general case -- a circuit that only uses a numeric gain (the common
// case) behaves identically; one relying on an arbitrary expression has no
// equivalent here. Dump ids (212/213/214/215) match Java's own for these
// four classes for continuity, but the token SHAPE is this port's own
// (single `gain` number, not `inputCount` + an escaped expression string) --
// consistent with how this port's dump/parse has never claimed strict
// byte-compatibility with arbitrary real Falstad save files (see base.ts).
//
// Geometry/post layout (all four, own local convention -- Java's real
// layout comes from ChipElm's generic pin-side system, not replicated):
// posts 0/1 = ctrl+/ctrl- split perpendicular near point1 (the "input"
// side), posts 2/3 = out+/out- split perpendicular near point2 (the
// "output" side) -- same interpPoint2-at-a-fraction technique OpAmpElm
// already uses for its own 2 input posts.
abstract class DependentSourceElm extends CircuitElm {
    gain: number;
    static DEFAULT_HS = 12;

    ctrlP: Point = { x: 0, y: 0 };
    ctrlM: Point = { x: 0, y: 0 };
    outP: Point = { x: 0, y: 0 };
    outM: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params: string[] | undefined, defaultGain: number) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // Reject Java's expression form outright (inputCount + escaped
        // expression string, e.g. `3 -(a-c)/(1000*(1\pb))`) instead of
        // half-parsing the leading integer as a gain: the resulting circuit
        // has the wrong pin/behavior model and analyzed as "Singular
        // matrix!" on the Java test corpus. Throwing here makes the parser
        // preserve the original line verbatim (see CircuitParser), keeping
        // the rest of the circuit simulating and the file lossless.
        if (Array.isArray(params) && params.length > 1) {
            throw new Error("expression-based dependent source (Java VCCS/VCVS form) is not supported by this port");
        }
        this.gain = Array.isArray(params) && params.length > 0 ? parseFloat(params[0]) || 0 : defaultGain;
    }

    dumpTokens(): (string | number | boolean)[] { return [this.gain]; }
    getPostCount() { return 4; }

    setPoints() {
        super.setPoints();
        const hs = DependentSourceElm.DEFAULT_HS * this.dsign;
        [this.ctrlP, this.ctrlM] = interpPoint2(this.point1, this.point2, 0, hs);
        [this.outP, this.outM] = interpPoint2(this.point1, this.point2, 1, hs);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.ctrlP;
        if (n === 1) return this.ctrlM;
        if (n === 2) return this.outP;
        if (n === 3) return this.outM;
        return null;
    }

    // No single obvious "the" voltage for a 4-terminal element; showing the
    // output pair (the "productive" side) rather than the base default's
    // (volts[0]-volts[1], i.e. the control pair) reading.
    getVoltageDiff() { return this.volts[2] - this.volts[3]; }
}

// Voltage-Controlled Current Source: Iout = gain*(Vctrl+ - Vctrl-), flowing
// out of out+ / into out- (matches the same "source pushes current out of
// its + terminal" convention as CurrentElm/RailElm). Purely linear -- no
// extra voltage-source unknown, no Newton iteration, stamped once.
export class VCCSElm extends DependentSourceElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, 1);
    }

    getDumpType() { return 213; }

    // MNA derivation (verified numerically, see docs/react-rewrite-plan.md):
    // "current leaving node n via this element" gets -gain*Vctrl+ +gain*Vctrl-
    // at the output+ row, and the mirror image at output-.
    stamp(stamper: Stamper) {
        const [cp, cm, op, om] = this.nodes;
        stamper.stampMatrix(om, cp, this.gain);
        stamper.stampMatrix(om, cm, -this.gain);
        stamper.stampMatrix(op, cp, -this.gain);
        stamper.stampMatrix(op, cm, this.gain);
    }

    // No voltage source at all here (purely linear conductance-style stamp),
    // so there's nothing for CircuitElm.setCurrent()'s dispatch to reach --
    // same situation as ResistorElm, whose calculateCurrent() also derives
    // current directly from volts[] rather than from a solved VS unknown.
    calculateCurrent() {
        this.current = this.gain * (this.volts[0] - this.volts[1]);
    }
}

// Voltage-Controlled Voltage Source: Vout+ - Vout- = gain*(Vctrl+ - Vctrl-),
// held regardless of load (needs its own voltage-source unknown, like a
// regular 2-terminal source) -- also purely linear, single stamp() call.
export class VCVSElm extends DependentSourceElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, 1);
    }

    getDumpType() { return 212; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    // BUGFIX (found via this file's own verification script): must call
    // vs.setNodes(...) with the OUTPUT posts, exactly like Java's real
    // VCVSElm.setVoltageSource() does (vs.setNodes(nodes[inputCount+1],
    // nodes[inputCount]) -- its two output pins). Without this, assignMatrix()
    // (core/node.ts) falls back to "this element's last post's matrix", which
    // is null whenever the LAST post (out-, index 3 here) happens to be
    // directly grounded -- exactly the natural way to reference a floating
    // VCVS's output to ground, so this was reliably hit, not a corner case.
    // Order matches CCVSElm.outputVS's own setNodes(om, op) below for
    // internal consistency (electrically it doesn't matter which of the two
    // is n1 vs n2 -- assignMatrix() only needs one of them to be non-ground).
    setVoltageSource(_j: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(this.nodes[3], this.nodes[2]);
    }

    // Aux equation (this element's own VS row): Vout+ - Vout- - gain*(Vctrl+
    // - Vctrl-) = 0. KCL: branch current leaves out-, enters out+ (matches
    // the existing VoltageElm/RailElm convention exactly -- see base.ts's
    // stampVoltageSource, which this can't reuse directly since the value
    // here is matrix-dependent, not a plain number).
    stamp(stamper: Stamper) {
        const [cp, cm, op, om] = this.nodes;
        const vs = this.voltSource;
        stamper.stampMatrixVSNode(vs, om, -1);
        stamper.stampMatrixVSNode(vs, op, 1);
        stamper.stampMatrixVSNode(vs, cp, -this.gain);
        stamper.stampMatrixVSNode(vs, cm, this.gain);
        stamper.stampMatrixNodeVS(om, vs, 1);
        stamper.stampMatrixNodeVS(op, vs, -1);
    }

    // No override needed: exactly one voltage source, so the base
    // CircuitElm.setCurrent(vs, c) default (`current = c`) is dispatched
    // correctly by CircuitEngine.applySolvedRightSide().
}

// Current-Controlled Voltage Source: Vout+ - Vout- = gain*Ictrl, where Ictrl
// is the current flowing INTO ctrl+ / out of ctrl- (sensed via an internal
// 0V voltage source in the control branch, exactly the same technique
// AmmeterElm uses). Needs TWO voltage-source unknowns -- the base class only
// has room for one (`voltSource`), so both are held in this element's own
// fields instead, following the same pattern as multi-VS elements elsewhere
// in this port (e.g. Switch2Elm routes by index rather than using the base
// field directly).
export class CCVSElm extends DependentSourceElm {
    controlVS!: VoltageSource;
    outputVS!: VoltageSource;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, 2);
    }

    getDumpType() { return 214; }
    getVoltageSourceCount() { return 2; }
    isVoltageSource() { return true; }

    setVoltageSource(j: number, vs: VoltageSource) {
        if (j === 0) {
            this.controlVS = vs;
            vs.setNodes(this.nodes[0], this.nodes[1]);
        } else {
            this.outputVS = vs;
            vs.setNodes(this.nodes[3], this.nodes[2]);
        }
    }

    stamp(stamper: Stamper) {
        const [cp, cm, op, om] = this.nodes;
        // Control-current sense: a plain 0V source, same technique as
        // AmmeterElm -- controlVS.current becomes the sensed Ictrl.
        stamper.stampVoltageSource(cp, cm, this.controlVS, 0);
        // Output aux equation: Vout+ - Vout- - gain*Ictrl = 0. stampMatrixVSVS
        // is exactly "this VS's own row, referencing ANOTHER VS's current
        // column" -- the mechanism that makes a *current*-controlled (as
        // opposed to voltage-controlled) source possible at all.
        stamper.stampMatrixVSNode(this.outputVS, om, -1);
        stamper.stampMatrixVSNode(this.outputVS, op, 1);
        stamper.stampMatrixVSVS(this.outputVS, this.controlVS, -this.gain);
        stamper.stampMatrixNodeVS(om, this.outputVS, 1);
        stamper.stampMatrixNodeVS(op, this.outputVS, -1);
    }

    // Two voltage sources share this element, so the base setCurrent(vs, c)
    // default (which blindly does `current = c` for WHICHEVER vs solves)
    // isn't safe to rely on -- it would happen to pick outputVS only
    // because it's processed last in this port's iteration order, which is
    // exactly the kind of accidental-not-guaranteed behavior Java's own
    // CCVSElm.setCurrent() avoids by explicitly checking identity (`pins[i
    // +1].voltSource == vs`). This element's own reported current is its
    // OUTPUT current; controlVS's solved current is an internal sensing
    // value only (read directly via this.controlVS.current when needed,
    // e.g. for display/debugging -- see VoltageSource.current in node.ts).
    setCurrent(vs: VoltageSource, c: number) {
        if (vs === this.outputVS) this.current = c;
    }
}

// Current-Controlled Current Source: Iout = gain*Ictrl, flowing out of out+
// / into out- ; same control-current sensing as CCVS but the output side is
// a plain (matrix-dependent) current, so no output voltage-source unknown is
// needed at all -- one VS total (the control sense), fully linear.
export class CCCSElm extends DependentSourceElm {
    controlVS!: VoltageSource;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, 2);
    }

    getDumpType() { return 215; }
    getVoltageSourceCount() { return 1; }

    setVoltageSource(_j: number, vs: VoltageSource) {
        this.controlVS = vs;
        vs.setNodes(this.nodes[0], this.nodes[1]);
    }

    stamp(stamper: Stamper) {
        const [cp, cm, op, om] = this.nodes;
        stamper.stampVoltageSource(cp, cm, this.controlVS, 0);
        // "Current leaving out+ via this element" = -gain*Ictrl (i.e.
        // current gain*Ictrl actually ENTERS out+ from the source), mirror
        // image at out- -- same sign derivation as VCCSElm.stamp() above,
        // just referencing controlVS's current column instead of node
        // voltages directly.
        stamper.stampMatrixNodeVS(op, this.controlVS, -this.gain);
        stamper.stampMatrixNodeVS(om, this.controlVS, this.gain);
    }

    // controlVS is a pure current-SENSING branch, not this element's own
    // terminal current -- the base setCurrent(vs, c) default would
    // incorrectly report the raw sensed Ictrl (e.g. 0.002A) as `current`
    // instead of the actual output (gain*Ictrl, e.g. 0.02A for gain=10).
    // Override to translate: `c` here is always controlVS's solved current
    // (the only voltage source this element owns), so this element's own
    // current is simply gain*c -- no need to read back through
    // this.controlVS.current at all.
    setCurrent(_vs: VoltageSource, c: number) {
        this.current = this.gain * c;
    }
}
