export interface Point {
    x: number;
    y: number;
}
export function pointKey(p: Point): string {
    return `${p.x},${p.y}`;
}

// Geometry helpers ported from CircuitElm.java. These compute POST positions
// (load-bearing for circuit connectivity — two posts at the same coordinate
// are the same node) as pure data; actual pixel rendering is a Phase 5
// concern, but where a post sits is not. The `Math.floor(... + .48)` bias
// (not a round()) is copied byte-for-byte from the Java source.

export function distance(a: Point, b: Point): number {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Point at fraction `f` along the line from a to b, optionally offset
// perpendicular to that line by `g` (Java's 3-arg and 4-arg interpPoint).
export function interpPoint(a: Point, b: Point, f: number, g = 0): Point {
    if (g === 0) {
        return {
            x: Math.floor(a.x * (1 - f) + b.x * f + 0.48),
            y: Math.floor(a.y * (1 - f) + b.y * f + 0.48),
        };
    }
    const gx = b.y - a.y;
    const gy = a.x - b.x;
    const len = Math.sqrt(gx * gx + gy * gy);
    const gg = len === 0 ? 0 : g / len;
    return {
        x: Math.floor(a.x * (1 - f) + b.x * f + gg * gx + 0.48),
        y: Math.floor(a.y * (1 - f) + b.y * f + gg * gy + 0.48),
    };
}

// Java's interpPoint2: a symmetric +/-g pair of points at fraction f (used
// for elements whose posts straddle the point1-point2 line, e.g. op-amp
// inputs or transistor collector/emitter).
export function interpPoint2(a: Point, b: Point, f: number, g: number): [Point, Point] {
    const gx = b.y - a.y;
    const gy = a.x - b.x;
    const len = Math.sqrt(gx * gx + gy * gy);
    const gg = len === 0 ? 0 : g / len;
    return [
        {
            x: Math.floor(a.x * (1 - f) + b.x * f + gg * gx + 0.48),
            y: Math.floor(a.y * (1 - f) + b.y * f + gg * gy + 0.48),
        },
        {
            x: Math.floor(a.x * (1 - f) + b.x * f - gg * gx + 0.48),
            y: Math.floor(a.y * (1 - f) + b.y * f - gg * gy + 0.48),
        },
    ];
}

export interface Stamper {
    stampResistor(n1: CircuitNode, n2: CircuitNode, r: number): void;
    stampConductance(n1: CircuitNode, n2: CircuitNode, g: number): void;
    stampVoltageSource(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, v?: number): void;
    stampCurrentSource(n1: CircuitNode, n2: CircuitNode, i: number): void;
    stampMatrix(n1: CircuitNode, n2: CircuitNode, val: number): void;
    stampMatrixVSNode(vs: VoltageSource, n: CircuitNode, val: number): void;
    stampMatrixNodeVS(n: CircuitNode, vs: VoltageSource, val: number): void;
    stampMatrixVSVS(vs1: VoltageSource, vs2: VoltageSource, val: number): void;
    stampRightSide(n: CircuitNode, val: number): void;
    stampRightSideVS(vs: VoltageSource, val: number): void;
    updateVoltageSource(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, v: number): void;
    // No-op in the current dense-matrix engine (whole matrix is re-stamped every
    // sub-iteration when circuitNonLinear is true). Kept so elements can mark nodes
    // as nonlinear-adjacent, matching Java's SimulationManager.stampNonLinear(), for
    // when row-level ROW_CONST simplification (plan §5.1) lands.
    stampNonLinear(n: CircuitNode): void;
    // Stamper implementations also carry solver state elements read during
    // doStep/startIteration (mirrors Java's `sim.timeStep`, `sim.t`, `sim.converged`,
    // `sim.subIterations` being reachable from any CircuitElm via the `sim` field).
    readonly t: number;
    readonly timeStep: number;
    converged: boolean;
    readonly subIterations: number;
}

// Forward declare for typing
import type { CircuitNode, VoltageSource, WireSegment } from '../core/node';

export abstract class CircuitElm {
    x = 0; y = 0; x2 = 0; y2 = 0; flags = 0;
    nodes: CircuitNode[] = [];
    volts: number[] = [];
    current = 0;
    // Java CircuitElm fields needed by several element families (op-amps, gates,
    // MOSFETs use noDiagonal; anything with a single voltage-source output pin
    // uses voltSource). Declared on the base so every subclass can rely on them
    // without re-declaring, matching the Java base class.
    noDiagonal = false;
    voltSource!: VoltageSource;

    // Geometry derived from x/y/x2/y2 by setPoints() — see CircuitElm.java:315.
    // dpx1/dpy1 is the unit vector perpendicular to the point1->point2 line;
    // dsign is Java's sign convention (based on dy, falling back to dx when
    // the line is horizontal). Multi-post elements (op-amp, gates, switch2,
    // transistor, mosfet, pot) use these to place posts beyond post 0/1.
    dx = 0; dy = 0; dn = 0; dpx1 = 0; dpy1 = 0; dsign = 1;
    point1: Point = { x: 0, y: 0 };
    point2: Point = { x: 0, y: 0 };
    lead1: Point = { x: 0, y: 0 };
    lead2: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number) {
        this.x = x;
        this.y = y;
        this.x2 = x2;
        this.y2 = y2;
        this.flags = flags;
    }

    abstract getDumpType(): number | string;
    getPostCount(): number { return 2; }
    getVoltageSourceCount(): number { return 0; }
    getInternalNodeCount(): number { return 0; }
    getNodeCount(): number { return this.getPostCount() + this.getInternalNodeCount(); }
    nonLinear(): boolean { return false; }
    
    getNode(j: number): CircuitNode | null { return this.nodes[j] || null; }
    setNode(j: number, cn: CircuitNode): void { this.nodes[j] = cn; }
    
    getPost(j: number): Point | null {
        if (j === 0) return { x: this.x, y: this.y };
        if (j === 1) return { x: this.x2, y: this.y2 };
        return null; // Must be overridden for >2 posts
    }
    
    setNodeVoltage(j: number, v: number): void { this.volts[j] = v; }
    // Java's CircuitElm.setVoltageSource() default assigns the base `voltSource`
    // field (CircuitElm.java:683-685) — it is NOT a no-op. Elements with more than
    // one voltage source (e.g. Switch2Elm) override this to route by index `j`;
    // everything else (op-amps, gates, logic inputs, the inverter) relies on this
    // default to ever get a working voltSource.
    setVoltageSource(j: number, vs: VoltageSource): void { this.voltSource = vs; }

    isWire(): boolean { return false; }
    isRemovableWire(): boolean { return false; }
    isGround(): boolean { return false; }
    isVoltageSource(): boolean { return false; }
    
    hasGroundConnection(n1: number): boolean { return false; }
    getConnection(n1: number, n2: number): boolean { return true; } // most elements connect their nodes
    getMatrixConnection(n1: number, n2: number): boolean { return this.getConnection(n1, n2); }
    getWireSegments(list: WireSegment[]): void {}
    getBusWidth(): number { return 1; }
    // Java: CircuitElm.getConnectedPost() defaults to `point2`, and the 1-arg
    // overload just delegates to it (CircuitElm.java:719-726) — NOT null. This
    // only matters for elements with isRemovableWire()==true (the only ones
    // Analyzer.calculateWireClosure() consults it for), so the unconditional
    // point2 default is harmless for everything else. WireElm/GroundElm/
    // LabeledNodeElm all override this with their own real logic; this default
    // exists so a *future* isRemovableWire()==true element that forgets to
    // override it fails the same faithful way Java would, rather than silently
    // never connecting (the exact bug class found and fixed this session).
    getConnectedPost(j: number): Point | null { return this.point2; }
    getChildElmList(): CircuitElm[] | null { return null; }
    // Java: CircuitElm.getVoltageDiff() default (:690-692). Single-post
    // elements (OutputElm, GroundElm, LabeledNodeElm) override this with
    // volts[0] (or 0) since volts[1] isn't meaningful for them.
    getVoltageDiff(): number { return this.volts[0] - this.volts[1]; }
    // Java: `ce instanceof RailElm` is used directly by SimulationManager.
    // setGroundNode() to gate the "alias first voltage source's post to
    // ground" fallback — that fallback must NOT fire when a rail is present,
    // even without an explicit ground (see RailElm.isRail() override).
    isRail(): boolean { return false; }
    
    // Java: CircuitElm.allocNodes() — `volts = new double[n]`, which the JVM
    // zero-fills automatically. JS arrays don't zero-fill, so without this,
    // any element whose doStep()/startIteration() reads `this.volts[j]` on the
    // very first sub-iteration (before any solve has ever run) reads
    // `undefined` and silently propagates NaN into the matrix (diode/
    // transistor/mosfet/op-amp all do this). preStamp() is already called for
    // every element before node assignment (see Analyzer.makeNodeList()), so
    // it's the natural place for this — "preserve voltages if possible" per
    // the Java comment, i.e. only reallocate when the size actually changes.
    allocNodes(): void {
        const n = this.getNodeCount();
        if (this.volts.length !== n) {
            this.volts = new Array(n).fill(0);
        }
    }
    // setPoints() runs here (rather than only in a UI move/place handler,
    // which doesn't exist yet) so that any multi-post element's getPost()
    // has valid geometry by the time Analyzer.makeNodeList() calls it — this
    // runs for every element before node assignment either way.
    preStamp(): void {
        this.setPoints();
        this.allocNodes();
    }
    validate(): boolean { return true; }

    // Java: CircuitElm.setPoints() (:315). Subclasses with more than 2 posts
    // override this — always calling `super.setPoints()` first, matching the
    // Java pattern — to compute their extra post positions from dx/dy/dn/
    // dsign, then override getPost() to expose them.
    setPoints(): void {
        this.dx = this.x2 - this.x;
        this.dy = this.y2 - this.y;
        this.dn = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
        this.dpx1 = this.dn === 0 ? 0 : this.dy / this.dn;
        this.dpy1 = this.dn === 0 ? 0 : -this.dx / this.dn;
        this.dsign = (this.dy === 0) ? Math.sign(this.dx) : Math.sign(this.dy);
        this.point1 = { x: this.x, y: this.y };
        this.point2 = { x: this.x2, y: this.y2 };
    }

    // Java: CircuitElm.calcLeads() (:327) — centers a body of length `len` on
    // the point1-point2 line; lead1/lead2 are where the body meets the wire
    // stubs (used both for drawing and, in a couple of elements, as the basis
    // point for post-offset math instead of point1/point2 directly).
    calcLeads(len: number): void {
        if (this.dn < len || len === 0) {
            this.lead1 = this.point1;
            this.lead2 = this.point2;
            return;
        }
        this.lead1 = interpPoint(this.point1, this.point2, (this.dn - len) / (2 * this.dn));
        this.lead2 = interpPoint(this.point1, this.point2, (this.dn + len) / (2 * this.dn));
    }
    stamp(e: Stamper): void {}
    startIteration(e: Stamper): void {}
    doStep(e: Stamper): void {}
    stepFinished(e: Stamper): void {}
    reset(): void {}
    calculateCurrent(): void {}
}
