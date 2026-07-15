import { CircuitElm, Stamper, Point, interpPoint } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from TriStateElm.java -- SINGLE-BIT ONLY.
//
// SIMPLIFICATION (documented, not silently dropped): Java's real TriStateElm
// supports an arbitrary `busWidth` (a variable number of parallel tri-state
// buffers sharing one control line, with a variable post count of
// `2*busWidth+1` -- the same "variable pin count" style of infrastructure
// this port has already deferred elsewhere, e.g. AnalogMuxElm). This port
// implements only busWidth=1 (a single tri-state buffer), which is the
// overwhelmingly common usage and a real, byte-correct implementation of
// that case -- not an approximation.
//
// A tri-state buffer: when the control pin is HIGH, the output actively
// drives the input's logic level (through r_on); when LOW, the output goes
// high-impedance (r_off) instead, optionally with a weak pulldown
// (r_off_ground) to keep a floating output from reporting an undefined
// voltage. Modelled with an internal node (the buffer's own idealized
// logic-level output) connected to the real output post through a
// state-dependent resistor -- same technique AnalogSwitchElm/ComparatorElm
// already use for their own resistor-based switching stage.
export class TriStateElm extends CircuitElm {
    r_on = 0.1;
    r_off = 1e10;
    r_off_ground = 1e8;
    highVoltage = 5;
    resistance = 0;
    open = false;

    // Control-post geometry (post2), same interpPoint pattern as
    // AnalogSwitchElm's own point3 (fixed sign=-1, matching the "not
    // flipped" default -- this port doesn't replicate FLAG_FLIP/FLIP_X/
    // FLIP_Y's mirroring, same scope decision as AnalogSwitchElm's OPENHS).
    static HS = 16;
    point3: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length > 3) {
            this.r_on = parseFloat(params[0]);
            this.r_off = parseFloat(params[1]);
            this.r_off_ground = parseFloat(params[2]);
            this.highVoltage = parseFloat(params[3]);
        } else {
            // Fresh placement only (matches Java's 2-arg constructor).
            this.r_off_ground = 1e8;
        }
    }

    getDumpType() { return 180; }
    dumpTokens(): (string | number | boolean)[] {
        return [this.r_on, this.r_off, this.r_off_ground, this.highVoltage];
    }

    getPostCount() { return 3; }
    getInternalNodeCount() { return 1; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }
    nonLinear() { return true; }

    setPoints() {
        super.setPoints();
        this.calcLeads(32);
        this.point3 = interpPoint(this.lead1, this.lead2, 0.5, -TriStateElm.HS);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.point2;
        if (n === 2) return this.point3;
        return null;
    }

    // Matches Java's setVoltageSource(): ties the VS directly to the
    // internal node (post-count index 3), not the fallback "last post"
    // (which would be post2/control here) -- same bug class this session
    // already found and fixed for VCVSElm.
    setVoltageSource(_j: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(CircuitNode.ground, this.nodes[3]);
    }

    stamp(stamper: Stamper) {
        stamper.stampVoltageSource(CircuitNode.ground, this.nodes[3], this.voltSource);
        stamper.stampNonLinear(this.nodes[3]);
        stamper.stampNonLinear(this.nodes[1]);
    }

    doStep(stamper: Stamper) {
        this.open = this.volts[2] < this.highVoltage * 0.5;
        this.resistance = this.open ? this.r_off : this.r_on;
        stamper.stampResistor(this.nodes[3], this.nodes[1], this.resistance);
        if (this.r_off_ground > 0) {
            stamper.stampResistor(this.nodes[1], CircuitNode.ground, this.r_off_ground);
        }
        stamper.updateVoltageSource(CircuitNode.ground, this.nodes[3], this.voltSource,
            this.volts[0] > this.highVoltage * 0.5 ? this.highVoltage : 0);
    }

    calculateCurrent() {
        const current31 = (this.volts[3] - this.volts[1]) / this.resistance;
        const current10 = this.r_off_ground === 0 ? 0 : this.volts[1] / this.r_off_ground;
        this.current = current31 - current10;
    }

    // There is no current path through the input, but there is an indirect
    // path through the output to ground.
    getConnection(_n1: number, _n2: number) { return false; }
    // The internal node and the output post are tied together via the
    // state-dependent resistor stamped every doStep() -- same reasoning as
    // ComparatorElm/OTAElm's own getMatrixConnection overrides.
    getMatrixConnection(n1: number, n2: number) {
        return (n1 === 1 && n2 === 3) || (n1 === 3 && n2 === 1);
    }
    hasGroundConnection(n1: number) { return n1 === 1; }

    getCurrentIntoNode(n: number) {
        if (n === 1) return this.current;
        return 0;
    }
}
