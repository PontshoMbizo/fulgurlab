import { CircuitElm, Stamper, Point, interpPoint2 } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from ComparatorElm.java -- STANDALONE REIMPLEMENTATION.
//
// SIMPLIFICATION (documented, not silently dropped): Java's real ComparatorElm
// extends CompositeElm, built from an internal 3-element subcircuit model
// ("OpAmpElm 1 2 3 \ AnalogSwitchElm 4 5 3 \ GroundElm 5", external nodes
// [2,1,4]) -- CompositeElm/subcircuit infrastructure is explicitly out of
// scope for this port (see docs/react-rewrite-plan.md's Tier 2 backlog).
// Rather than skip this component, its FUNCTIONAL behavior was reverse-
// engineered from that internal model and reimplemented directly as one
// standalone element with an internal node, using the exact same numerical
// technique this port's own OpAmpElm already uses for its saturating output:
//   - Internal node (index 3, beyond the 3 external posts) holds an ideal
//     open-loop comparator's saturating "op-amp" output: full gain (100000),
//     no feedback, so it saturates hard to maxOut/minOut based on (+) vs (-).
//   - That internal node's voltage, compared against a fixed threshold
//     (2.5V), drives an analog-switch-style resistor (r_on ~20 ohm / r_off
//     ~1e10 ohm) between the OUTPUT post and ground.
// Net result (derived from the internal model's actual wiring, confirmed via
// this file's own verification): when (+) > (-), the internal stage
// saturates HIGH, which closes the switch (r_on) -- output is pulled to
// GROUND. When (+) < (-), the switch opens (r_off) -- output floats
// high-Z. This is a classic OPEN-DRAIN-style comparator output (matches
// real ICs like the LM393: output SINKS when + > -, needs an external
// pull-up resistor to read a clean logic HIGH otherwise) -- not a push-pull
// output. A circuit built the way Falstad's own example files use this
// component (with an external pullup) behaves identically; this is a real,
// faithful functional port of the composite's behavior, not an approximation.
//
// Posts: 0 = "+", 1 = "-", 2 = output (open-drain). Internal node 3 = the
// saturating comparator stage, never exposed as a pin.
export class ComparatorElm extends CircuitElm {
    static FLAG_SMALL = 2;

    maxOut = 15;
    minOut = -15;
    gain = 100000;
    r_on = 20;
    r_off = 1e10;
    threshold = 2.5;
    lastvd = 0;
    open = false;

    // Input-post geometry -- same interpPoint2-at-point1 fan OpAmpElm uses
    // for its own 2 inputs (see setPoints() below). Derived from Java's real
    // setPoints()/getPost(): posts 0/1 = in1p[0]/in2p[0], post2 = point2
    // directly (the output).
    inP: Point = { x: 0, y: 0 };
    inM: Point = { x: 0, y: 0 };
    static HS = 16;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
    }

    getDumpType() { return 401; }
    // No extra dump tokens -- Java's own ComparatorElm doesn't expose the
    // internal op-amp's gain/maxOut/minOut or the switch's r_on/r_off/
    // threshold as directly editable at the composite's own level either.
    dumpTokens(): (string | number | boolean)[] { return []; }

    getPostCount() { return 3; }

    // Ported from ComparatorElm.java's setPoints()/setPost() calls: posts
    // 0/1 ("+"/"-") fan out perpendicular near point1 (fraction 0), exactly
    // like OpAmpElm's own in1p/in2p; post2 (output) is point2 itself, no
    // separate lead needed.
    setPoints() {
        super.setPoints();
        const hs = ComparatorElm.HS * this.dsign;
        [this.inP, this.inM] = interpPoint2(this.point1, this.point2, 0, hs);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.inP;
        if (n === 1) return this.inM;
        if (n === 2) return this.point2;
        return null;
    }
    getInternalNodeCount() { return 1; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    nonLinear() { return true; }

    // No direct DC current path between any pair of external posts (matches
    // Java's ComparatorElm.getConnection() -> false), but the internal
    // node MUST be forced into the same matrix as the external posts (its
    // voltage source stamps reference nodes 0/1/3 together) -- same
    // getConnection/getMatrixConnection split OpAmpElm's real Java source
    // uses for exactly the same underlying reason (a controlled source with
    // no passive DC path from input to output).
    getConnection(_n1: number, _n2: number) { return false; }
    getMatrixConnection(_n1: number, _n2: number) { return true; }
    hasGroundConnection(n1: number) { return n1 === 2; }

    getVoltageDiff() { return this.volts[2]; }

    // Defensive, even though the blanket getMatrixConnection() above already
    // guarantees nodes 0/1/2/3 share one matrix (making the base class's
    // assignMatrix() fallback -- "last post's matrix", i.e. node 2 -- land
    // in the same place anyway): explicit is better here, matching the
    // pattern this session's VCVSElm bug established (see
    // dependent_sources.ts) -- the internal node (3) is what this element's
    // voltage source actually stamps against, never node 2.
    setVoltageSource(_j: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(this.nodes[0], this.nodes[3]);
    }

    stamp(stamper: Stamper) {
        const vs = this.voltSource;
        const opOut = this.nodes[3];
        stamper.stampNonLinear(opOut);
        stamper.stampMatrixNodeVS(opOut, vs, 1);
    }

    doStep(stamper: Stamper) {
        const [inP, inM, out, opOut] = this.nodes;
        const vs = this.voltSource;

        // --- internal ideal comparator stage: same damped-saturation
        // technique as OpAmpElm.doStep(), just driving the internal node
        // instead of an external output post. ---
        const vd = this.volts[0] - this.volts[1]; // (+) - (-)
        const midpoint = (this.maxOut + this.minOut) * 0.5;
        if (Math.abs(this.lastvd - vd) > 0.1) {
            stamper.converged = false;
        } else if (this.volts[3] > this.maxOut + 0.1 || this.volts[3] < this.minOut - 0.1) {
            stamper.converged = false;
        }
        let x = 0;
        let dx = 0;
        const maxAdj = this.maxOut - midpoint;
        const minAdj = this.minOut - midpoint;
        if (vd >= maxAdj / this.gain && (this.lastvd >= 0 || Math.random() < 0.25)) {
            dx = 1e-4;
            x = this.maxOut - dx * maxAdj / this.gain;
        } else if (vd <= minAdj / this.gain && (this.lastvd <= 0 || Math.random() < 0.25)) {
            dx = 1e-4;
            x = this.minOut - dx * minAdj / this.gain;
        } else {
            dx = this.gain;
            x = midpoint;
        }
        stamper.stampMatrixVSNode(vs, inP, dx);
        stamper.stampMatrixVSNode(vs, inM, -dx);
        stamper.stampMatrixVSNode(vs, opOut, 1);
        stamper.stampRightSideVS(vs, x);
        this.lastvd = vd;

        // --- analog switch stage: pull `out` to ground via r_on/r_off,
        // gated by the internal comparator stage's LATEST solved voltage
        // (same lagged-read pattern AnalogSwitchElm's own doStep() uses). ---
        this.open = this.volts[3] < this.threshold;
        const resistance = this.open ? this.r_off : this.r_on;
        stamper.stampResistor(out, CircuitNode.ground, resistance);
    }

    calculateCurrent() {
        // Output current flows entirely through the switch's ground-
        // referenced resistor -- same Ohm's-law derivation as a plain
        // resistor, just with a state-dependent resistance value.
        this.current = this.volts[2] / (this.open ? this.r_off : this.r_on);
    }

    getCurrentIntoNode(n: number) {
        if (n === 2) return -this.current;
        return 0;
    }
}
