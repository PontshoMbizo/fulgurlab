import { CircuitElm, Stamper, Point, escapeDumpText, unescapeDumpText } from './base';
import { VoltageSource } from '../core/node';
import { ExprState, Expr, ExprParser, createExprState, updateLastValues, resetExprState } from '../core/exprParser';

// Ported from VCCSElm.java/VCVSElm.java/CCVSElm.java/CCCSElm.java (dump types
// 213/212/214/215) -- audit issue #2 part 2. These four classes all extend
// Java's abstract ChipElm and evaluate an ARBITRARY user-typed expression
// (ExprParser/Expr/ExprState, see core/exprParser.ts) of up to 9 named input
// pins (a..i), linearized every Newton sub-iteration via numerical
// (finite-difference) partial derivatives -- not the fixed-linear-gain model
// an earlier pass of this port shipped here (see git history / the previous
// revision of this file for that SIMPLIFIED version's own extensive comment).
//
// PIN GEOMETRY: faithfully mirrors ChipElm.Pin.setPoint() (verified against
// ChipElm.java:659-679, the same derivation custom_logic.ts's CustomLogicElm
// already ported and documented) -- NOT the old fixed-4-post
// interpPoint2-near-axis layout. West pins (inputs) sit at ABSOLUTE offsets
// (x, y+CSPC2*pos) from the element's own (x,y) alone, independent of
// point2/rotation; east pins (outputs) sit at (x+3*CSPC2, y+CSPC2*pos)
// (SIZE_X=2, CSPC2=32, matching ChipElm's sizeX=2/cspc2=32 for these four
// classes specifically -- see each Java setupPins()). Rotation
// (FLAG_FLIP_X/Y/XY) is not replicated, same documented simplification as
// custom_logic.ts.
//
// TOKEN SHAPE: verified against ChipElm's own StringTokenizer constructor
// (ChipElm.java:48-69) that for these 4 classes specifically (needsBits()
// false, hasCustomVoltage() false, and no pin has state=true) the super()
// call consumes ZERO tokens before VCCSElm's own constructor reads
// `inputCount` then the escaped expression string -- so the dump token
// order really is just `<inputCount> <escapedExprString>`, matching the
// real corpus lines exactly (e.g. tests/vccs-resistor.txt's
// `213 x y x2 y2 0 3 -(a-c)/(1000*(1\pb))`). CCVSElm/CCCSElm's own
// constructors comment OUT their own token reads and defer entirely to
// VCCSElm's -- same two tokens, no extra ones for spice-style etc.
//
// BACK-COMPAT: this port PREVIOUSLY shipped a from-scratch single-numeric-
// `gain` token format for these ids (see this file's git history) with its
// own 4-fixed-post geometry (ctrl+/-, out+/- straddling the point1-point2
// axis). Old saved circuits using that format still parse: a single numeric
// token is recognized and SYNTHESIZED into the electrically equivalent
// expression under the new inputCount=2 model (see synthesizeLegacyExpr()
// below) -- verified index-for-index that the resulting node/current sign
// conventions match the old stamp() methods exactly (same nodes[0..3]
// index roles: 0/1 = control+/-, 2/3 = output+/-, or for CC* the single
// control pair + output pair). What does NOT carry over is screen geometry:
// the old fixed-post layout and the new absolute chip-pin layout place pins
// at different pixel coordinates, so a circuit relying on the old dump's
// wire endpoints lining up with these posts will need to be rewired after
// upgrading -- an unavoidable consequence of adopting Java's authoritative
// (and totally different) chip pin placement. This is a one-time migration
// note, not a silent behavior change: the electrical formulas match exactly.
export const CSPC2 = 32;
const SIZE_X = 2;

function westPin(x: number, y: number, pos: number): Point {
    return { x, y: y + CSPC2 * pos };
}
function eastPin(x: number, y: number, pos: number): Point {
    return { x: x + SIZE_X * CSPC2 + CSPC2, y: y + CSPC2 * pos };
}

// Ported from VCCSElm.sign() (Expr.java... no, VCCSElm.java:87-89), shared
// by all four subclasses via inheritance in Java.
function sign(a: number, b: number): number {
    return a > 0 ? b : -b;
}

// Ported from VCCSElm.getConvergeLimit() (VCCSElm.java:91-98): be more
// lenient about "did this converge" as sub-iterations climb, so a circuit
// that's merely slow to settle doesn't get declared non-convergent forever.
function getConvergeLimit(subIterations: number): number {
    if (subIterations < 10) return 0.001;
    if (subIterations < 200) return 0.01;
    return 0.1;
}

// Old single-`gain`-token back-compat (see file header). `kind` distinguishes
// the per-class semantics of what "gain" multiplied:
//   'v' (VCCS/VCVS): expr = "<gain>*(a-b)"  -- gain * (ctrl+ - ctrl-)
//   'c' (CCVS/CCCS): expr = "<gain>*a"      -- gain * Ictrl (pair 0's sensed current)
function synthesizeLegacyExpr(gain: number, kind: 'v' | 'c'): string {
    return kind === 'v' ? `${gain}*(a-b)` : `${gain}*a`;
}

// Shared parse of the constructor `params` token list into {inputCount,
// exprString}, handling both the real Java shape (`inputCount escapedExpr`)
// and the old back-compat single-numeric-gain shape.
function parseParams(
    params: string[] | undefined,
    kind: 'v' | 'c',
    defaultInputCount: number,
    defaultExprString: string,
): { inputCount: number; exprString: string } {
    if (!Array.isArray(params) || params.length === 0) {
        return { inputCount: defaultInputCount, exprString: defaultExprString };
    }
    if (params.length === 1) {
        const gain = parseFloat(params[0]);
        if (!Number.isNaN(gain)) {
            return { inputCount: 2, exprString: synthesizeLegacyExpr(gain, kind) };
        }
    }
    const inputCount = parseInt(params[0], 10) || defaultInputCount;
    const exprString = params.length > 1 ? unescapeDumpText(params[1]) : defaultExprString;
    return { inputCount, exprString };
}

// Common base for the voltage-input pair (VCCS/VCVS): inputCount separate
// west input pins a..i, each pin's voltage is its own expression variable.
abstract class VExprSourceBase extends CircuitElm {
    inputCount: number;
    exprString: string;
    expr: Expr | null = null;
    exprError: string | null = null;
    exprState: ExprState = createExprState();
    lastVolts: number[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params: string[] | undefined, defaultExprString: string) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        const parsed = parseParams(params, 'v', 2, defaultExprString);
        this.inputCount = parsed.inputCount;
        this.exprString = parsed.exprString;
        this.parseExpr();
        this.lastVolts = new Array(this.inputCount).fill(0);
    }

    parseExpr(): void {
        const parser = new ExprParser(this.exprString);
        this.expr = parser.parseExpression();
        this.exprError = parser.gotError();
    }

    dumpTokens(): (string | number | boolean)[] {
        return [this.inputCount, escapeDumpText(this.exprString)];
    }

    getPostCount(): number { return this.inputCount + 2; }
    nonLinear(): boolean { return true; }

    // Back-compat accessor for the old fixed-gain port's `.gain` field:
    // recovers the leading numeric coefficient from an exprString of the
    // `<num>*(a-b)` shape synthesizeLegacyExpr() produces. Only meaningful
    // for elements constructed (or round-tripped) from the old single-token
    // format or an equivalently-shaped hand-written expression; NaN for any
    // other expression shape (there's no general notion of "the gain" for
    // an arbitrary expression).
    get gain(): number {
        const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\*/.exec(this.exprString);
        return m ? parseFloat(m[1]) : NaN;
    }

    getPost(n: number): Point | null {
        if (n < this.inputCount) return westPin(this.x, this.y, n);
        return eastPin(this.x, this.y, n - this.inputCount);
    }

    // Base default is volts[0]-volts[1] (the FIRST input pin pair), but for
    // a dependent source the "interesting" voltage to report is the OUTPUT
    // pair -- matches the old fixed-gain port's own override (and is what
    // this file's back-compat tests read via getVoltageDiff()).
    getVoltageDiff(): number { return this.volts[this.inputCount] - this.volts[this.inputCount + 1]; }

    // Ported from VCCSElm.getConnection() (VCCSElm.java:176-178): the only
    // real DC connection this element ever declares is between its own two
    // output posts (comparePair) -- inputs have no path to anything else
    // through this element.
    getConnection(n1: number, n2: number): boolean {
        const a = this.inputCount, b = this.inputCount + 1;
        return (n1 === a && n2 === b) || (n1 === b && n2 === a);
    }
    hasGroundConnection(_n1: number): boolean { return false; }

    // DEVIATION FROM JAVA (documented, safety-motivated): Java's own
    // VCCSElm.getMatrixConnection() already forces `true` unconditionally
    // (VCCSElm.java:179) because its nonlinear stamps write derivative terms
    // into columns for EVERY input node from the output rows -- input and
    // output pins must share one solver matrix or those stamps silently
    // corrupt an unrelated matrix row (core/engine.ts's stampMatrix* methods
    // have no cross-matrix guard/warning at all, unlike Java's own, which at
    // least logs). VCVSElm doesn't override this in Java (relies on
    // getConnection()'s inherited-from-VCCSElm comparePair default, which
    // ONLY connects the two output posts to each other) -- meaning a VCVS
    // whose input pins are electrically isolated from its output pins
    // except through ground (a completely ordinary, valid topology -- see
    // this file's own tests) would split into two matrices in Java too, and
    // VCVSElm.doStep()'s `stampMatrixVSNode(vn, nodes[i], -dx)` would then
    // corrupt whatever unrelated row happens to share nodes[i]'s row number
    // in vn's matrix. Real Java corpus circuits apparently never hit this
    // (their inputs and outputs end up sharing a matrix for other reasons),
    // but this port's own unit tests deliberately isolate control/output
    // sides to verify the electrical model in the simplest possible
    // topology -- so this override extends VCCSElm's own precedent to
    // VCVSElm as well, to keep that guarantee for BOTH classes rather than
    // relying on incidental corpus topology.
    getMatrixConnection(_n1: number, _n2: number): boolean { return true; }

    reset(): void {
        super.reset();
        resetExprState(this.exprState);
        this.lastVolts.fill(0);
    }
}

// Voltage-Controlled Current Source (dump 213). Ported from VCCSElm.java.
export class VCCSElm extends VExprSourceBase {
    broken = false; // see class header: FindPathInfo-based loop detection not ported (documented gap)

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, '.1*(a-b)');
    }

    getDumpType() { return 213; }
    getVoltageSourceCount() { return 0; }
    // getMatrixConnection()=>true is inherited from VExprSourceBase (see its
    // own comment) -- this is exactly Java's real VCCSElm.getMatrixConnection()
    // override (VCCSElm.java:179), just hoisted to the shared base since
    // VCVSElm needs the identical guarantee for the same reason.

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[this.inputCount]);
        stamper.stampNonLinear(this.nodes[this.inputCount + 1]);
    }

    // Ported from VCCSElm.doStep() (VCCSElm.java:105-164).
    doStep(stamper: Stamper): void {
        const ic = this.inputCount;
        const cp = this.nodes[ic];
        const cm = this.nodes[ic + 1];

        if (this.broken) {
            // avoid singular matrix errors
            stamper.stampMatrix(cp, cp, 1e-8);
            stamper.stampMatrix(cm, cm, 1e-8);
            stamper.stampMatrix(cp, cm, -1e-8);
            stamper.stampMatrix(cm, cp, -1e-8);
            return;
        }

        const convergeLimit = getConvergeLimit(stamper.subIterations);
        for (let i = 0; i !== ic; i++) {
            if (Math.abs(this.volts[i] - this.lastVolts[i]) > convergeLimit) {
                stamper.converged = false;
            }
        }

        if (this.expr) {
            for (let i = 0; i !== ic; i++) this.exprState.values[i] = this.volts[i];
            this.exprState.t = stamper.t;
            this.exprState.timeStep = stamper.timeStep;
            const v0 = -this.expr.eval(this.exprState);
            let rs = v0;

            for (let i = 0; i !== ic; i++) {
                let dv = this.volts[i] - this.lastVolts[i];
                if (Math.abs(dv) < 1e-6) dv = 1e-6;
                this.exprState.values[i] = this.volts[i];
                const v = -this.expr.eval(this.exprState);
                this.exprState.values[i] = this.volts[i] - dv;
                const v2 = -this.expr.eval(this.exprState);
                let dx = (v - v2) / dv;
                if (Math.abs(dx) < 1e-6) dx = sign(dx, 1e-6);
                // Ported from SimulationManager.stampVCCurrentSource(cp, cm,
                // nodes[i], ground, dx) -- the ground-referenced terms are
                // no-ops (ground.row === 0), so only these two remain.
                stamper.stampMatrix(cp, this.nodes[i], dx);
                stamper.stampMatrix(cm, this.nodes[i], -dx);
                rs -= dx * this.volts[i];
                this.exprState.values[i] = this.volts[i];
            }
            stamper.stampCurrentSource(cp, cm, rs);
            this.current = -v0;
        }

        for (let i = 0; i !== ic; i++) this.lastVolts[i] = this.volts[i];
    }

    stepFinished(): void {
        updateLastValues(this.exprState, this.current);
    }

    calculateCurrent(): void {
        // current already computed each doStep() above (independent current
        // source, no voltage-source unknown to read back through setCurrent()).
    }
}

// Voltage-Controlled Voltage Source (dump 212). Ported from VCVSElm.java
// (extends VCCSElm in Java; here shares VExprSourceBase for the same reason).
export class VCVSElm extends VExprSourceBase {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, '.1*(a-b)');
    }

    getDumpType() { return 212; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    // Ported from VCVSElm.setVoltageSource() (VCVSElm.java:105-108): vs
    // nodes are (V-, V+) = (nodes[inputCount+1], nodes[inputCount]).
    setVoltageSource(_j: number, vs: VoltageSource): void {
        this.voltSource = vs;
        vs.setNodes(this.nodes[this.inputCount + 1], this.nodes[this.inputCount]);
    }

    stamp(stamper: Stamper): void {
        stamper.stampVoltageSource(this.nodes[this.inputCount + 1], this.nodes[this.inputCount], this.voltSource);
    }

    // Ported from VCVSElm.doStep() (VCVSElm.java:51-96).
    doStep(stamper: Stamper): void {
        const ic = this.inputCount;
        const convergeLimit = getConvergeLimit(stamper.subIterations);
        for (let i = 0; i !== ic; i++) {
            if (Math.abs(this.volts[i] - this.lastVolts[i]) > convergeLimit) stamper.converged = false;
        }

        const vn = this.voltSource;
        if (this.expr) {
            for (let i = 0; i !== ic; i++) this.exprState.values[i] = this.volts[i];
            this.exprState.t = stamper.t;
            this.exprState.timeStep = stamper.timeStep;
            const v0 = this.expr.eval(this.exprState);
            if (
                Math.abs(this.volts[ic] - this.volts[ic + 1] - v0) > Math.abs(v0) * 0.01 &&
                stamper.subIterations < 100
            ) {
                stamper.converged = false;
            }
            let rs = v0;

            for (let i = 0; i !== ic; i++) {
                let dv = this.volts[i] - this.lastVolts[i];
                if (Math.abs(dv) < 1e-6) dv = 1e-6;
                this.exprState.values[i] = this.volts[i];
                const v = this.expr.eval(this.exprState);
                this.exprState.values[i] = this.volts[i] - dv;
                const v2 = this.expr.eval(this.exprState);
                let dx = (v - v2) / dv;
                if (Math.abs(dx) < 1e-6) dx = sign(dx, 1e-6);
                stamper.stampMatrixVSNode(vn, this.nodes[i], -dx);
                rs -= dx * this.volts[i];
                this.exprState.values[i] = this.volts[i];
            }
            stamper.stampRightSideVS(vn, rs);
        }

        for (let i = 0; i !== ic; i++) this.lastVolts[i] = this.volts[i];
    }

    stepFinished(): void {
        updateLastValues(this.exprState, this.volts[this.inputCount] - this.volts[this.inputCount + 1]);
    }

    // Exactly one voltage source, so the base CircuitElm.setCurrent(vs, c)
    // default (`current = c`) dispatched by the engine is already correct.
}

// Common base for the current-input-pair family (CCVS/CCCS): inputCount
// west pins in PAIRS (A+/A-, B+/B-, ...), each pair's sensed branch current
// (via an internal 0V voltage source) is that pair's expression variable.
abstract class CExprSourceBase extends CircuitElm {
    inputCount: number;
    inputPairCount: number;
    exprString: string;
    expr: Expr | null = null;
    exprError: string | null = null;
    exprState: ExprState = createExprState();
    lastCurrents: number[] = [];
    pairVS: VoltageSource[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params: string[] | undefined, defaultExprString: string) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        const parsed = parseParams(params, 'c', 2, defaultExprString);
        this.inputCount = parsed.inputCount;
        this.exprString = parsed.exprString;
        this.inputPairCount = Math.floor(this.inputCount / 2);
        this.parseExpr();
        this.lastCurrents = new Array(this.inputPairCount).fill(0);
    }

    parseExpr(): void {
        const parser = new ExprParser(this.exprString);
        this.expr = parser.parseExpression();
        this.exprError = parser.gotError();
    }

    dumpTokens(): (string | number | boolean)[] {
        return [this.inputCount, escapeDumpText(this.exprString)];
    }

    getPostCount(): number { return this.inputCount + 2; }
    nonLinear(): boolean { return true; }

    // See VExprSourceBase's identical `.gain` back-compat accessor comment.
    get gain(): number {
        const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\*/.exec(this.exprString);
        return m ? parseFloat(m[1]) : NaN;
    }

    getPost(n: number): Point | null {
        if (n < this.inputCount) return westPin(this.x, this.y, n);
        return eastPin(this.x, this.y, n - this.inputCount);
    }

    // See VExprSourceBase.getVoltageDiff()'s comment.
    getVoltageDiff(): number { return this.volts[this.inputCount] - this.volts[this.inputCount + 1]; }

    // Ported from CCVSElm.getConnection()/CCCSElm.getConnection() (both
    // `n1/2 == n2/2`): each input PAIR's +/- are connected to each other
    // (current sensing branch), and the two output posts (inputCount,
    // inputCount+1) are likewise a pair when inputCount is even.
    getConnection(n1: number, n2: number): boolean {
        return Math.floor(n1 / 2) === Math.floor(n2 / 2);
    }

    // See VExprSourceBase.getMatrixConnection()'s comment for the full
    // rationale (same class of latent cross-matrix risk, extended to the
    // CCVS/CCCS family: their nonlinear stamps write from the output
    // row/VS into EVERY input pair's sensing-VS column).
    getMatrixConnection(_n1: number, _n2: number): boolean { return true; }

    // Ported from VCCSElm.setCurrentExprValue() (VCCSElm.java... actually
    // CCVSElm.java:154-159/CCCSElm.java:153-158): sets this pair's sensed
    // current into its expression slot, ALSO aliasing pair 0's current into
    // slot 8 (variable "i") for backward compatibility with the classic
    // single-pair CCVS/CCCS expression convention (see cccs.txt/
    // current-adder.txt's corpus expressions, which use "i" rather than "a").
    protected setCurrentExprValue(n: number, cur: number): void {
        if (n === 0 && this.inputPairCount < 9) this.exprState.values[8] = cur;
        this.exprState.values[n] = cur;
    }

    reset(): void {
        super.reset();
        resetExprState(this.exprState);
        this.lastCurrents.fill(0);
    }
}

// Current-Controlled Voltage Source (dump 214). Ported from CCVSElm.java.
export class CCVSElm extends CExprSourceBase {
    outputVS!: VoltageSource;
    lastOutput = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, '2*a');
    }

    // Back-compat accessor for the old single-pair fixed-gain port's
    // `controlVS` field name -- now generalized to `pairVS[0]` since the
    // real Java model supports multiple current-sensing input pairs.
    get controlVS(): VoltageSource { return this.pairVS[0]; }

    getDumpType() { return 214; }
    // Non-spice-style only (see file header / class comment on spice
    // rejection below) -- one VS per input pair (current sense) plus one
    // for the output.
    getVoltageSourceCount() { return this.inputPairCount + 1; }
    isVoltageSource() { return true; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        if (j < this.inputPairCount) {
            this.pairVS[j] = vs;
            vs.setNodes(this.nodes[j * 2], this.nodes[j * 2 + 1]);
        } else {
            this.outputVS = vs;
            vs.setNodes(this.nodes[this.inputCount + 1], this.nodes[this.inputCount]);
        }
    }

    stamp(stamper: Stamper): void {
        // 0V voltage sources between each pair's +/- so we can measure current
        for (let i = 0; i !== this.inputPairCount; i++) {
            stamper.stampVoltageSource(this.nodes[i * 2], this.nodes[i * 2 + 1], this.pairVS[i], 0);
        }
        stamper.stampVoltageSource(this.nodes[this.inputCount + 1], this.nodes[this.inputCount], this.outputVS);
    }

    // Ported from CCVSElm.doStep() (CCVSElm.java:90-146).
    doStep(stamper: Stamper): void {
        const ic = this.inputCount, ipc = this.inputPairCount;
        const convergeLimitCurrent = getConvergeLimit(stamper.subIterations) * 0.1;
        for (let i = 0; i !== ipc; i++) {
            const cur = this.pairVS[i].current;
            if (Math.abs(cur - this.lastCurrents[i]) > convergeLimitCurrent) stamper.converged = false;
        }
        const convergeLimitVoltage = getConvergeLimit(stamper.subIterations);
        if (Math.abs(this.volts[ic] - this.volts[ic + 1] - this.lastOutput) > convergeLimitVoltage) {
            stamper.converged = false;
        }

        const vno = this.outputVS;
        if (this.expr) {
            for (let i = 0; i !== ipc; i++) this.setCurrentExprValue(i, this.pairVS[i].current);
            this.exprState.t = stamper.t;
            this.exprState.timeStep = stamper.timeStep;
            const v0 = this.expr.eval(this.exprState);
            let rs = v0;

            for (let i = 0; i !== ipc; i++) {
                const cur = this.pairVS[i].current;
                // Java (CCVSElm.java:120-124): computes dv from cur-lastCurrents[i]
                // and clamps it to a 1e-6 floor, then UNCONDITIONALLY overwrites
                // dv = 1e-9 anyway right after -- a real quirk of the Java source,
                // kept byte-for-byte rather than "fixed" here.
                const dv = 1e-9;
                this.setCurrentExprValue(i, cur);
                const v = this.expr.eval(this.exprState);
                this.setCurrentExprValue(i, cur - dv);
                const v2 = this.expr.eval(this.exprState);
                let dx = (v - v2) / dv;
                if (Math.abs(dx) < 1e-6) dx = sign(dx, 1e-6);
                stamper.stampMatrixVSVS(vno, this.pairVS[i], -dx);
                rs -= dx * cur;
                this.setCurrentExprValue(i, cur);
            }
            stamper.stampRightSideVS(vno, rs);
        }

        for (let i = 0; i !== ipc; i++) this.lastCurrents[i] = this.pairVS[i].current;
        this.lastOutput = this.volts[ic] - this.volts[ic + 1];
    }

    stepFinished(): void {
        updateLastValues(this.exprState, this.volts[this.inputCount] - this.volts[this.inputCount + 1]);
        for (let i = 0; i !== this.inputPairCount; i++) this.exprState.lastValues[i] = this.pairVS[i].current;
    }

    // outputVS's solved current is this element's own reported current;
    // pairVS[i].current values are internal sensing-only (read directly).
    setCurrent(vs: VoltageSource, c: number): void {
        if (vs === this.outputVS) this.current = c;
    }
}

// Current-Controlled Current Source (dump 215). Ported from CCCSElm.java.
export class CCCSElm extends CExprSourceBase {
    broken = false; // see VCCSElm's `broken` comment -- FindPathInfo not ported (documented gap)
    outputCurrent = 0;
    lastOutputCurrent = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params, '2*a');
    }

    // See CCVSElm's identical back-compat accessor comment.
    get controlVS(): VoltageSource { return this.pairVS[0]; }

    getDumpType() { return 215; }
    getVoltageSourceCount() { return this.inputPairCount; }

    setVoltageSource(j: number, vs: VoltageSource): void {
        this.pairVS[j] = vs;
        vs.setNodes(this.nodes[j * 2], this.nodes[j * 2 + 1]);
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== this.inputPairCount; i++) {
            stamper.stampVoltageSource(this.nodes[i * 2], this.nodes[i * 2 + 1], this.pairVS[i], 0);
        }
        stamper.stampNonLinear(this.nodes[this.inputCount]);
        stamper.stampNonLinear(this.nodes[this.inputCount + 1]);
    }

    // Ported from CCCSElm.doStep() (CCCSElm.java:83-147). Note Java's
    // convergence-check loop runs `i <= inputPairCount` (inclusive) against
    // a `lastCurrents[inputPairCount+1]`-sized array, where the EXTRA slot
    // tracks the OUTPUT current's own convergence (pins[inputCount+1].current)
    // -- ported here as the separate `lastOutputCurrent` field instead of a
    // widened array, same information.
    doStep(stamper: Stamper): void {
        const ic = this.inputCount, ipc = this.inputPairCount;
        const op = this.nodes[ic], om = this.nodes[ic + 1];

        if (this.broken) {
            stamper.stampMatrix(op, op, 1e-8);
            stamper.stampMatrix(om, om, 1e-8);
            stamper.stampMatrix(op, om, -1e-8);
            stamper.stampMatrix(om, op, -1e-8);
            return;
        }

        const convergeLimit = getConvergeLimit(stamper.subIterations) * 0.1;
        for (let i = 0; i !== ipc; i++) {
            const cur = this.pairVS[i].current;
            if (Math.abs(cur - this.lastCurrents[i]) > convergeLimit) stamper.converged = false;
        }
        if (Math.abs(this.outputCurrent - this.lastOutputCurrent) > convergeLimit) stamper.converged = false;

        for (let i = 0; i !== ipc; i++) this.lastCurrents[i] = this.pairVS[i].current;
        this.lastOutputCurrent = this.outputCurrent;

        if (this.expr) {
            for (let i = 0; i !== ipc; i++) this.setCurrentExprValue(i, this.pairVS[i].current);
            this.exprState.t = stamper.t;
            this.exprState.timeStep = stamper.timeStep;
            const v0 = this.expr.eval(this.exprState);
            let rs = v0;
            this.outputCurrent = v0;

            for (let i = 0; i !== ipc; i++) {
                const cur = this.pairVS[i].current;
                let dv = cur - this.lastCurrents[i];
                if (Math.abs(dv) < 1e-6) dv = 1e-6;
                this.setCurrentExprValue(i, cur);
                const v = this.expr.eval(this.exprState);
                this.setCurrentExprValue(i, cur - dv);
                const v2 = this.expr.eval(this.exprState);
                let dx = (v - v2) / dv;
                if (Math.abs(dx) < 1e-6) dx = sign(dx, 1e-6);
                // Ported from SimulationManager.stampCCCS(om_here=nodes[ic+1],
                // nodes[ic], pairVS[i], dx): stampMatrixNodeVS(n1, vs, gain);
                // stampMatrixNodeVS(n2, vs, -gain).
                stamper.stampMatrixNodeVS(om, this.pairVS[i], dx);
                stamper.stampMatrixNodeVS(op, this.pairVS[i], -dx);
                rs -= dx * cur;
                this.setCurrentExprValue(i, cur);
            }
            stamper.stampCurrentSource(om, op, rs);
        }
    }

    stepFinished(): void {
        updateLastValues(this.exprState, this.outputCurrent);
    }

    calculateCurrent(): void {
        this.current = this.outputCurrent;
    }
}
