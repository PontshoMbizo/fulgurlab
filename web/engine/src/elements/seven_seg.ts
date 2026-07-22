import { CircuitElm, Point } from './base';

// Ported from SevenSegElm.java (dump type 157). A PURE READER: every
// segment pin is a plain logic input (exactly like ChipElm's generic
// "!p.output -> p.value = volts[i] > threshold" read, but SevenSegElm's own
// getVoltageSourceCount() is 0 -- it never drives anything back onto the
// circuit). segmentLit(i) is the app-facing query CustomLogicBody's sibling,
// SevenSegBody.tsx, uses to decide which segments to light up.
//
// DIODE-MODE GAP (documented, not silently dropped): Java's SevenSegElm
// optionally wires each segment through a real Diode (common-cathode/anode,
// diodeDirection = +-1) to a shared `commonPin`, stamping a genuine
// nonlinear diode network and computing per-segment brightness from
// calculated diode current (see SevenSegElm.java's stamp()/doStep()/
// calculateCurrent()/setColor()). That diode network isn't ported here --
// this element only implements the diodeDirection===0 ("None (logic
// inputs)") mode, which is what every corpus fixture this pass targets
// (tests/7seg.txt) actually uses, and is a fully faithful, non-approximated
// port of that mode specifically. If diodeDirection!=0 is requested (e.g.
// loading a hand-edited or different corpus file), the extra `commonPin`
// post is still allocated (so pin indices/geometry line up with what Java
// would show) but carries no diode stamps -- it will read as a dangling
// node rather than participate in a current-brightness calculation.
export class SevenSegElm extends CircuitElm {
    static ES_NONE = 0;
    static ES_DP = 1;
    static ES_COLON = 2;
    static CSPC2 = 32; // ChipElm's cspc2 for the default (non-FLAG_SMALL) chip size

    baseSegmentCount = 7;
    extraSegment = 0; // ES_NONE/ES_DP/ES_COLON
    diodeDirection = 0; // 1 = common cathode, -1 = common anode, 0 = none (logic inputs)

    segmentCount = 7;
    pinCount = 7;
    commonPin = -1;

    highVoltage = 5;

    pinPosts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        if (Array.isArray(params) && params.length >= 3) {
            const base = parseInt(params[0], 10);
            const extra = parseInt(params[1], 10);
            const diode = parseInt(params[2], 10);
            // Mirror Java's try/catch-and-keep-defaults: a NaN from a
            // malformed/missing token falls back to setDefaults()' values
            // rather than propagating NaN into pin-count math.
            if (!Number.isNaN(base)) this.baseSegmentCount = base;
            if (!Number.isNaN(extra)) this.extraSegment = extra;
            if (!Number.isNaN(diode)) this.diodeDirection = diode;
        }
        this.setPinCount();
    }

    getThreshold(): number {
        return this.highVoltage / 2;
    }

    getDumpType() { return 157; }
    // baseSegmentCount, extraSegment, diodeDirection -- exactly what this
    // constructor's own `params` parsing reads back, same order as Java's
    // `dump() { return super.dump() + " " + baseSegmentCount + " " + extraSegment + " " + diodeDirection; }`.
    dumpTokens(): (string | number | boolean)[] {
        return [this.baseSegmentCount, this.extraSegment, this.diodeDirection];
    }

    // Ported from SevenSegElm.setPinCount() (:391-405).
    setPinCount(): void {
        this.segmentCount = this.baseSegmentCount;
        if (this.extraSegment > 0) this.segmentCount++;
        if (this.diodeDirection === 0) {
            this.pinCount = this.segmentCount;
            this.commonPin = -1;
        } else {
            this.pinCount = this.segmentCount + 1;
            this.commonPin = this.pinCount - 1;
        }
    }

    getPostCount() { return this.pinCount; }
    getVoltageSourceCount() { return 0; }
    nonLinear() { return false; } // diode network (the only nonLinear case in Java) isn't ported -- see file header

    // Faithful port of ChipElm's real Pin.setPoint() formula (see
    // custom_logic.ts's CustomLogicElm.setPoints() for the full derivation
    // and the fixture-based verification methodology) -- NOT a simplified
    // fan, because exact pixel coincidence with tests/7seg.txt's own `w`
    // endpoints is load-bearing for this port's coordinate-based node
    // merging. Verified directly against that fixture's real wire endpoints
    // (688,288)/(688,320)/(688,352)/(688,384) for the west pins (segments
    // a-d) and (752,416)/(784,416)/(816,416) for the south pins (segments
    // e-g) -- both match this formula exactly for the default
    // baseSegmentCount=7/extraSegment=NONE/diodeDirection=0 fixture case.
    //
    // Only the "backward compatibility" layout (segmentCount===7 &&
    // diodeDirection===0 && extraSegment===NONE -- Java's own
    // `backwardCompatibility` flag) is faithfully replicated: west pins for
    // the first `segmentPinsOnLeftSide` segments, south pins for the rest.
    // The non-backward-compatible east-side layout (14/16-segment displays,
    // decimal point/colon, or diode mode) is NOT validated against a real
    // fixture -- approximated on the SIDE_E formula with sizeX=5 (Java's own
    // value for that branch) as a best-effort placeholder, documented here
    // rather than silently assumed correct.
    setPoints(): void {
        super.setPoints();
        const cspc2 = SevenSegElm.CSPC2;
        const segmentPinsOnLeftSide = Math.floor((this.baseSegmentCount + 1) / 2);
        let sizeY = segmentPinsOnLeftSide;
        if (this.pinCount > sizeY * 2) sizeY++;
        const backwardCompatible = (this.segmentCount === 7 && this.diodeDirection === 0 && this.extraSegment === SevenSegElm.ES_NONE);

        this.pinPosts = new Array(this.pinCount);
        let i = 0;
        for (; i < segmentPinsOnLeftSide && i < this.segmentCount; i++) {
            this.pinPosts[i] = { x: this.x, y: this.y + cspc2 * i };
        }
        let s = backwardCompatible ? 1 : 0;
        for (; i < this.segmentCount; i++) {
            if (backwardCompatible) {
                // SIDE_S: x = x0 + cspc2*pos (x0 = x+cspc2), y = y + sizeY*cspc2.
                this.pinPosts[i] = { x: this.x + cspc2 * (1 + s), y: this.y + sizeY * cspc2 };
            } else {
                // SIDE_E approximation (unvalidated -- see method comment).
                const sizeX = 5;
                this.pinPosts[i] = { x: this.x + sizeX * cspc2 + cspc2, y: this.y + cspc2 * s };
            }
            s++;
        }
        if (this.commonPin >= 0) {
            // Diode-mode commonPin: not validated against a real fixture
            // (see file header's diode-mode gap) -- parked past the last
            // segment pin so it never coincides with a segment position.
            this.pinPosts[this.commonPin] = { x: this.x + cspc2 * (segmentPinsOnLeftSide + 2), y: this.y + sizeY * cspc2 };
        }
    }

    getPost(n: number): Point | null {
        return this.pinPosts[n] ?? null;
    }

    getConnection(_n1: number, _n2: number): boolean {
        // Java: `diodeDirection == 0 ? false : true` -- no diode network
        // ported (see file header), so this always reads as Java's own
        // no-diode-mode answer regardless of diodeDirection.
        return false;
    }

    hasGroundConnection(_n1: number): boolean { return false; }

    // Pure reader: reads pin levels off `volts[]` every step (no stamping,
    // no state -- matches ChipElm's own `!p.output` doStep() branch, since
    // every SevenSegElm pin is a non-output "input" pin in Java's model
    // too, just never fed back into a rule engine).
    segmentLit(i: number): boolean {
        if (i < 0 || i >= this.segmentCount) return false;
        return this.volts[i] > this.getThreshold();
    }

    getChipName(): string {
        return `${this.segmentCount}-segment display`;
    }
}
