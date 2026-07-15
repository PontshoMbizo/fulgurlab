import { CircuitElm, Stamper, Point, interpPoint, interpPoint2 } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from OTAElm.java -- SIMPLIFIED.
//
// SIMPLIFICATION (documented, not silently dropped): Java's real OTAElm is a
// CompositeElm built from a genuine 17-transistor LM13700-style netlist (7
// external pins: +, -, a secondary node, Iabc, output, plus 2 internal bias
// rails) -- full transistor-level infrastructure this port doesn't have
// (same CompositeElm gap as ComparatorElm/subcircuits). Rather than skip
// this component, it's reimplemented here using the textbook operational-
// transconductance-amplifier equation every analog course actually teaches:
//   Iout = gm * (Vin+ - Vin-),  gm = Iabc / (2*VT)
// (VT = thermal voltage, ~26mV, the standard bipolar transistor constant --
// this is the same equation the LM13700 datasheet itself gives for the
// "simplified" application view, even though the real chip is a 2-stage
// transistor circuit). This is a real, physically-grounded implementation
// of the universally-recognized 4-pin OTA interface (+, -, Iabc, out), not
// an approximation of Falstad's specific 7-pin/dual-rail packaging of it.
//
// Posts: 0 = "+", 1 = "-", 2 = Iabc (bias current, sensed the same 0V-
// sense-branch way AmmeterElm/CCVSElm's control branch already do -- current
// flowing INTO this pin, referenced directly to ground), 3 = output (an
// ideal ground-referenced current source -- ungrounded/floating like this
// port's VCCS is NOT how the real single-ended LM13700 output works, so no
// separate out- terminal is needed).
export class OTAElm extends CircuitElm {
    static VT = 0.026; // thermal voltage (V) -- gm = Iabc / (2*VT)
    static HS = 16;

    lastIabc = 0;

    // Own simplified 4-post geometry (this port's own layout, not a replica
    // of Java's real 5-pin/17-transistor visual model -- see header):
    // "+"/"-" fan out near point1 like a standard 2-input element; Iabc
    // sits a bit further along the line on its own small perpendicular
    // offset; output is point2 directly.
    inP: Point = { x: 0, y: 0 };
    inM: Point = { x: 0, y: 0 };
    iabcPost: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
    }

    getDumpType() { return 402; }
    // No extra dump tokens -- Java's own OTAElm only exposes its two supply-
    // rail voltages (posVolt/negVolt), which don't exist as separate concepts
    // in this simplified gm=Iabc/(2VT) model (no internal bias rails at all).
    dumpTokens(): (string | number | boolean)[] { return []; }

    getPostCount() { return 4; }

    setPoints() {
        super.setPoints();
        const hs = OTAElm.HS * this.dsign;
        [this.inP, this.inM] = interpPoint2(this.point1, this.point2, 0, hs);
        this.iabcPost = interpPoint(this.point1, this.point2, 0.3, hs * 2);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.inP;
        if (n === 1) return this.inM;
        if (n === 2) return this.iabcPost;
        if (n === 3) return this.point2;
        return null;
    }

    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    nonLinear() { return true; }

    // Matches Java's OTAElm.getConnection() -> false (no direct DC path
    // between any pair of external posts -- it's a controlled source, not a
    // passive network). getMatrixConnection is force-true (same reasoning as
    // OpAmpElm/ComparatorElm): the doStep() cross-coupling stamp between
    // nodes 0/1 and node 3 needs all of them in the same matrix.
    getConnection(_n1: number, _n2: number) { return false; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }
    // Only the Iabc pin has an unconditional, always-present path to ground
    // (its 0V sense source). The output is an ideal current source with NO
    // inherent path to ground of its own -- same as this port's VCCS/CCCS,
    // it relies on the user's own circuit (or the engine's dangling-node
    // safety net) to provide a return path, so it's deliberately NOT marked
    // here (matches how dependent_sources.ts's DependentSourceElm doesn't
    // mark its own floating output posts either).
    hasGroundConnection(n1: number) { return n1 === 2; }

    getVoltageDiff() { return this.volts[0] - this.volts[1]; }

    // BUGFIX pattern applied proactively (see VCVSElm's own bugfix comment
    // in dependent_sources.ts for the discovery): getPostCount()-1 here is 3
    // (the OUTPUT post), which is NOT the node this element's one voltage
    // source actually spans (the Iabc sense branch touches node 2, not node
    // 3) -- assignMatrix()'s fallback would silently pick the wrong node's
    // matrix without this explicit setNodes() call.
    setVoltageSource(_j: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(CircuitNode.ground, this.nodes[2]);
    }

    stamp(stamper: Stamper) {
        // Iabc sense: a plain 0V source between the bias pin and ground,
        // same technique as AmmeterElm/CCVSElm's control branch.
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[2], this.voltSource, 0);
    }

    doStep(stamper: Stamper) {
        // gm depends on Iabc, which is itself a solved matrix unknown --
        // linearized the same way AnalogSwitchElm's threshold-dependent
        // resistance is: use the LATEST known value (from the previous
        // sub-iteration's solve, 0 on the very first call) as this
        // iteration's fixed coefficient, and re-stamp every call so it
        // converges as Iabc settles (nonLinear()=true guarantees at least
        // one extra pass beyond the first, which is enough here since Iabc
        // has no feedback path from the output/input side in this model).
        const iabc = Math.abs(this.voltSource.current);
        if (Math.abs(iabc - this.lastIabc) > 1e-9) stamper.converged = false;
        this.lastIabc = iabc;

        const gm = iabc / (2 * OTAElm.VT);
        const [inP, inM, , out] = this.nodes;
        // Sign verified numerically against this port's own already-tested
        // VCCSElm (dependent_sources.ts): for a ground-referenced current
        // source to physically SOURCE current out of `out` (i.e. produce
        // Vout=+gm*vd*Rload through a grounded load resistor) the matrix
        // entry must be NEGATIVE on the "+" input, not positive -- the
        // combined KCL row (this stamp's contribution + the load resistor's
        // own +1/R self-term) only balances to the intended sign that way.
        // (An earlier draft had the signs flipped; caught by this file's
        // own verification script -- see docs/react-rewrite-plan.md.)
        stamper.stampMatrix(out, inP, -gm);
        stamper.stampMatrix(out, inM, gm);
    }

    // The Iabc-sense VS's solved current is the bias current, NOT this
    // element's own reported current (which is the OUTPUT current) -- same
    // situation, same fix, as CCCSElm's setCurrent() override.
    setCurrent(_vs: VoltageSource, c: number) {
        const gm = Math.abs(c) / (2 * OTAElm.VT);
        this.current = gm * (this.volts[0] - this.volts[1]);
    }

    getCurrentIntoNode(n: number) {
        if (n === 3) return -this.current;
        return 0;
    }
}
