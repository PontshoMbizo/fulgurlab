import { Stamper, Point, interpPoint } from './base';
import { CircuitNode, VoltageSource } from '../core/node';
import { SwitchElm } from './switch';

// Ported from Switch2Elm.java (SPDT / multi-throw switch). Post 0 is the
// common pole; posts 1..throwCount are the throws. Only one throw is
// electrically connected (via a zero-volt voltage source) at a time, unless
// position is the synthetic "center off" position.
//
// SIMPLIFICATIONS (documented, not silently dropped):
//  - Group linking (`link` field): Java's toggle() re-syncs every other
//    Switch2Elm in the same sim.elmList sharing this `link` value. CircuitElm
//    has no back-reference to the engine/elmList, so cross-instance sync isn't
//    wired up — call `syncLinkedSwitches(allSwitches)` manually after toggling
//    if you need it, or wire it in once elements carry an engine reference.
//  - validate()'s loop-detection (FindPathInfo) isn't ported — same gap as
//    CurrentElm.
export class Switch2Elm extends SwitchElm {
    link = 0;
    throwCount = 2;
    static FLAG_CENTER_OFF = 1;
    positionFlipped = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.throwCount = 2;
        if (Array.isArray(params) && params.length > 2) {
            this.link = parseInt(params[2]) || 0;
        }
        if (Array.isArray(params) && params.length > 3) {
            this.throwCount = parseInt(params[3]) || 2;
        }
        this.posCount = this.hasCenterOff() ? 3 : this.throwCount;
    }

    getDumpType() { return 'S'; }
    // Appends to SwitchElm's [position, momentary] -- link/throwCount are
    // read from params[2]/params[3] by this class's own constructor.
    dumpTokens() { return [...super.dumpTokens(), this.link, this.throwCount]; }
    getPostCount() { return 1 + this.throwCount; }

    static OPEN_HS = 16;
    swposts: Point[] = [];

    // Ported from Switch2Elm.java setPoints(): throw i sits at fraction 1
    // along point1->point2, offset perpendicular by a multiple of OPEN_HS
    // centered on the line — except the 2-throw (plain SPDT) case, where
    // throw 0 is forced to +OPEN_HS instead of following the centered formula
    // (Java: `if (throwCount==2 && i==0) hs = openhs`). Note Java's
    // `(throwCount-1)/2` is integer division.
    setPoints() {
        super.setPoints();
        this.calcLeads(32);
        this.swposts = new Array(this.throwCount);
        for (let i = 0; i < this.throwCount; i++) {
            let hs = -Switch2Elm.OPEN_HS * (i - Math.floor((this.throwCount - 1) / 2));
            if (this.throwCount === 2 && i === 0) hs = Switch2Elm.OPEN_HS;
            this.swposts[i] = interpPoint(this.point1, this.point2, 1, hs);
        }
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        return this.swposts[n - 1] ?? null;
    }

    getCurrentIntoNode(n: number) {
        if (n === 0) return -this.current;
        if (n === this.position + 1) return this.current;
        return 0;
    }

    getConnection(n1: number, n2: number): boolean {
        if (this.position === 2 && this.hasCenterOff()) return false;
        // Java's comparePair(n1, n2, 0, 1+position): true if {n1,n2} == {0, 1+position}
        // as an unordered pair. (Array.sort() defaults to lexicographic string
        // ordering for numbers, so a plain numeric sort here would be a bug.)
        const thrown = 1 + this.position;
        return (n1 === 0 && n2 === thrown) || (n2 === 0 && n1 === thrown);
    }

    calculateCurrent() {
        if (this.position === 2 && this.hasCenterOff()) {
            this.current = 0;
        }
    }

    setVoltageSource(n: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(this.nodes[0], this.nodes[this.position + 1]);
    }

    stamp(stamper: Stamper) {
        if (this.position === 2 && this.hasCenterOff()) return;
        stamper.stampVoltageSource(this.nodes[0], this.nodes[this.position + 1], this.voltSource, 0);
    }

    getVoltageSourceCount() {
        return (this.position === 2 && this.hasCenterOff()) ? 0 : 1;
    }

    // See file-level note: cross-switch `link` sync isn't wired to the engine
    // yet. This performs the local toggle only.
    toggle() {
        super.toggle();
    }

    // Optional helper for callers that do have the full element list handy.
    syncLinkedSwitches(allSwitches: Switch2Elm[]) {
        if (this.link === 0) return;
        for (const s2 of allSwitches) {
            if (s2 === this || s2.link !== this.link) continue;
            let pos = this.position;
            if (s2.positionFlipped !== this.positionFlipped) {
                pos = this.posCount - 1 - pos;
            }
            if (pos < s2.posCount) s2.position = pos;
        }
    }

    isWireEquivalent() { return true; }
    // Optimizing this out is too complicated to be worth it (Java: issue #646).
    isRemovableWire() { return false; }

    hasCenterOff() { return (this.flags & Switch2Elm.FLAG_CENTER_OFF) !== 0 && this.throwCount === 2; }

    validate() {
        // Java uses FindPathInfo(VOLTAGE, ...) to detect a voltage-source/wire
        // loop with no resistance; not ported yet (see file-level note).
        return true;
    }
}
