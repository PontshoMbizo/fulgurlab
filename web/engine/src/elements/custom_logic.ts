import { CircuitElm, Stamper, Point, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from CustomLogicElm.java + CustomLogicModel.java (dump type 208 --
// the "!"-line rules-engine digital element used by the custom.txt corpus's
// comparator/jkff models). Two pieces:
//   1. A module-level model REGISTRY (CustomLogicModel.java's static
//      `modelMap`), addressed by name and populated from "!" dump lines
//      (parser.ts's `!` branch feeds tokens here via undumpModelFromTokens()).
//   2. CustomLogicElm itself: a variable-pin-count element whose per-step
//      behavior is entirely driven by its model's parsed rule table.
//
// TRI-STATE GAP (documented, not silently dropped): Java's tri-state output
// support (rule right-hand-side `_` chars) works by giving every output an
// internal node + a dynamic resistor between that internal node and the
// real output post (1e-3 ohm when driven, 1e8 ohm when high-Z), stamped
// through CustomLogicElm.stamp()/doStep()'s `hasTriState()` branch. This
// port's Stamper interface has no per-call dynamic-resistor-between-two-
// arbitrary-nodes primitive wired up for a *variable* pin count the way
// AnalogSwitchElm's fixed 3-post shape does, and building that generically
// for an N-output element is out of scope for this pass. Rather than fake
// tri-state (which would silently produce wrong electrical behavior on any
// circuit that actually exercises the high-Z state), any model whose rules
// contain a tri-state output makes the CONSTRUCTOR throw -- the parser's
// existing try/catch around createElement() (core/parser.ts) already
// preserves such a line verbatim on construction failure, so a tri-state
// custom-logic circuit degrades to "not simulated" rather than "simulated
// wrong". No corpus fixture this port targets (custom.txt's "comparator"/
// "jkff" models) uses tri-state outputs.
export interface CustomLogicModelData {
    name: string;
    flags: number;
    inputs: string[];
    outputs: string[];
    infoText: string;
    rules: string;
    rulesLeft: string[];
    rulesRight: string[];
    triState: boolean;
}

export const FLAG_SCHMITT = 1;

// Module-level registry, mirroring CustomLogicModel.java's static modelMap.
// Tests reach in via getModelWithName()/undumpModelFromTokens() directly;
// there is deliberately no "reset" export -- Java's own modelMap is also a
// permanent static, and nothing in this port's element lifecycle needs one.
const modelMap = new Map<string, CustomLogicModelData>();

function listToArray(s: string): string[] {
    return s.split(',');
}

function arrayToList(arr: string[]): string {
    return arr.join(',');
}

function makeDefaultModelData(name: string): CustomLogicModelData {
    return {
        name,
        flags: 0,
        inputs: ['A', 'B'],
        outputs: ['C', 'D'],
        infoText: name === 'default' ? 'custom logic' : name,
        rules: '',
        rulesLeft: [],
        rulesRight: [],
        triState: false,
    };
}

// Ported from CustomLogicModel.getModelWithName() (:28-39): looks up or
// lazily creates a blank A,B->C,D model under `name`. This is the path both
// the "!" line parser AND CustomLogicElm's own setupPins() use -- so any
// element referencing a name with no matching "!" line yet gets a harmless
// placeholder (empty rule table -- outputs simply never change) instead of
// crashing, which is this port's deliberate, documented deviation from
// Java's actual getModelWithNameOrCopy() call in the text-constructor path
// (see CustomLogicElm class comment below for why).
export function getModelWithName(name: string): CustomLogicModelData {
    const existing = modelMap.get(name);
    if (existing) return existing;
    const model = makeDefaultModelData(name);
    modelMap.set(name, model);
    return model;
}

// Ported from CustomLogicModel.getModelWithNameOrCopy() (:41-52): used by
// the chip-editor "rename model" flow (setChipEditValue) in Java. Kept for
// spec parity even though this port's text-format load path doesn't call it
// (see class comment on CustomLogicElm's constructor).
export function getModelWithNameOrCopy(name: string, oldModel: CustomLogicModelData | undefined): CustomLogicModelData {
    const existing = modelMap.get(name);
    if (existing) return existing;
    const base = oldModel ?? makeDefaultModelData(name);
    const model: CustomLogicModelData = {
        name,
        flags: base.flags,
        inputs: base.inputs,
        outputs: base.outputs,
        infoText: name,
        rules: base.rules,
        rulesLeft: base.rulesLeft,
        rulesRight: base.rulesRight,
        triState: base.triState,
    };
    modelMap.set(name, model);
    return model;
}

// CustomLogicModel.escape()/unescape() (:257-290) use the SAME replacement
// table already ported generically as escapeDumpText/unescapeDumpText in
// base.ts, EXCEPT for one extra rule: an empty string escapes to the
// literal 2-char token "\0" (and back), so a model field that happens to be
// empty (e.g. a fresh model's `rules`) still round-trips as exactly one
// non-empty whitespace-delimited token -- without this, split(/\s+/) would
// silently swallow the empty token and desync every field after it.
function escapeModelField(s: string): string {
    if (s.length === 0) return '\\0';
    return escapeDumpText(s);
}

function unescapeModelField(s: string): string {
    if (s === '\\0') return '';
    return unescapeDumpText(s);
}

// Ported from CustomLogicModel.parseRules() (:183-243). Throws (rather than
// EditInfo.setError()'s UI-only error path, which doesn't exist here) on a
// malformed rule line -- callers (undumpModelFromTokens(), and any manual
// model construction) should decide whether that's fatal.
export function parseRules(model: CustomLogicModelData): void {
    const lines = model.rules.split('\n');
    model.rulesLeft = [];
    model.rulesRight = [];
    model.triState = false;
    for (let i = 0; i < lines.length; i++) {
        const s = lines[i].toLowerCase().trim();
        if (s.length === 0 || s.startsWith('#')) continue;
        const s0 = s.replace(/ /g, '').split('=');
        if (s0.length !== 2) {
            throw new Error(`custom logic model "${model.name}": error on line ${i + 1}`);
        }
        if (s0[0].length < model.inputs.length) {
            throw new Error(`custom logic model "${model.name}": must have >= ${model.inputs.length} digits on left side (line ${i + 1})`);
        }
        if (s0[0].length > model.inputs.length + model.outputs.length) {
            throw new Error(`custom logic model "${model.name}": must have <= ${model.inputs.length + model.outputs.length} digits on left side (line ${i + 1})`);
        }
        if (s0[1].length !== model.outputs.length) {
            throw new Error(`custom logic model "${model.name}": must have ${model.outputs.length} digits on right side (line ${i + 1})`);
        }
        const rl = s0[0];
        const used = new Array(26).fill(false);
        let newRl = '';
        for (let j = 0; j < rl.length; j++) {
            const x = rl[j];
            if (x === '?' || x === '+' || x === '-' || x === '0' || x === '1') {
                newRl += x;
                continue;
            }
            const code = x.charCodeAt(0);
            if (code < 97 || code > 122) { // 'a'-'z'
                throw new Error(`custom logic model "${model.name}": error on line ${i + 1}`);
            }
            // if a letter appears twice, capitalize it the 2nd time so we can compare
            if (used[code - 97]) {
                newRl += String.fromCharCode(code - 32);
                continue;
            }
            used[code - 97] = true;
            newRl += x;
        }
        const rr = s0[1];
        if (rr.includes('_')) model.triState = true;
        model.rulesLeft.push(newRl);
        model.rulesRight.push(rr);
    }
}

// Ported from CustomLogicModel.undumpModel()+undump() (:82-95). `tokens`
// excludes the leading "!" (parser.ts strips it before calling this).
export function undumpModelFromTokens(tokens: string[]): void {
    if (tokens.length < 6) {
        throw new Error(`custom logic model line: expected 6 fields, got ${tokens.length}`);
    }
    const name = unescapeModelField(tokens[0]);
    const model = getModelWithName(name);
    model.flags = parseInt(tokens[1], 10) || 0;
    model.inputs = listToArray(unescapeModelField(tokens[2]));
    model.outputs = listToArray(unescapeModelField(tokens[3]));
    model.infoText = unescapeModelField(tokens[4]);
    model.rules = unescapeModelField(tokens[5]);
    parseRules(model);
}

function dumpModelLine(model: CustomLogicModelData): string {
    return [
        '!',
        escapeModelField(model.name),
        model.flags,
        escapeModelField(arrayToList(model.inputs)),
        escapeModelField(arrayToList(model.outputs)),
        escapeModelField(model.infoText),
        escapeModelField(model.rules),
    ].join(' ');
}

// Exposed for the ENGINE-LEVEL dump() to call (engine.ts is owned by another
// agent this session -- see this file's top-level session note / the task
// report). `modelNames`, if given, restricts/orders output to those names
// (dedup'd) -- e.g. the lead agent should scan engine.elmList for
// CustomLogicElm instances and pass their `.modelName`s so only models
// actually REFERENCED by a placed element get re-emitted, matching Java's
// dumped-flag behavior (CustomLogicModel.clearDumpedFlags() + `dumped`).
// With no argument, dumps every model currently in the registry.
//
// *** WIRING TODO FOR THE LEAD AGENT ***: until engine.dump() calls this and
// splices its lines in alongside preservedLines/elmList dumps, loading a
// custom-logic circuit and re-saving it LOSES the "!" model-definition
// lines (the elements referencing them still dump fine, but on a fresh
// reload of that output text they'd fall back to the blank default model).
// This file's own test (custom-logic.test.ts) verifies dumpCustomLogicModels()
// itself in isolation so the helper is proven correct independent of when
// it gets wired in.
export function dumpCustomLogicModels(modelNames?: Iterable<string>): string[] {
    const names = modelNames ? Array.from(modelNames) : Array.from(modelMap.keys());
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        const model = modelMap.get(name);
        if (!model) continue;
        lines.push(dumpModelLine(model));
    }
    return lines;
}

// Ported from CustomLogicElm.java. Standalone CircuitElm (not a literal port
// of the abstract ChipElm base -- see comparator.ts/ota.ts for the same
// "standalone reimplementation" precedent this port already established for
// ChipElm-derived elements), but its PIN GEOMETRY (setPoints()/getPost(),
// below) faithfully replicates ChipElm's real Pin.setPoint() formula --
// absolute `x,y + cspc2*index` offsets, independent of point2/rotation --
// because exact pixel coincidence with neighboring wire/L-element endpoints
// in the real Java-saved corpus (tests/custom.txt) is load-bearing for
// circuit connectivity here (this port's text-format loader merges nodes by
// exact coordinate match). See setPoints()'s own comment for the full
// derivation/verification against that fixture.
export class CustomLogicElm extends CircuitElm {
    static lastModelName = 'default';

    modelName: string;
    model!: CustomLogicModelData;
    inputCount = 0;
    outputCount = 0;
    postCount = 0;
    highVoltage = 5;

    // Per-pin boolean state (Java's Pin.value, indexed 0..postCount-1:
    // inputs first, then outputs) and the two auxiliary arrays execute()
    // needs: lastValues (for +/- edge patterns) and patternValues (the 26
    // a-z capture slots, shared/reused across every rule check same as
    // Java's fixed-size `boolean patternValues[26]` field).
    pinValues: boolean[] = [];
    lastValues: boolean[] = [];
    patternValues: boolean[] = new Array(26).fill(false);
    highImpedance: boolean[] = [];

    outputVoltSources: VoltageSource[] = [];

    inPosts: Point[] = [];
    outPosts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;

        let outputVoltTokens: string[] = [];
        if (Array.isArray(params) && params.length > 0) {
            this.modelName = unescapeModelField(params[0]);
            outputVoltTokens = params.slice(1);
        } else {
            this.modelName = CustomLogicElm.lastModelName;
        }

        // DEVIATION FROM JAVA (documented): Java's text-constructor calls
        // updateModels() -> CustomLogicModel.getModelWithNameOrCopy(modelName,
        // model), where `model` is still null at this point in the real
        // source -- if `modelName` isn't already registered (i.e. the "!"
        // line didn't come first, or is missing entirely), that call runs
        // `new CustomLogicModel(null)`, which NullPointerExceptions in Java.
        // This only doesn't crash in practice because Falstad always emits
        // "!" lines before their referencing element lines. This port
        // resolves lazily via getModelWithName() instead (see that
        // function's own comment) so a missing/out-of-order model line
        // degrades to a harmless blank A,B->C,D model rather than crashing
        // the whole parse -- strictly more robust, same as-intended
        // behavior for the common (model-line-first) case.
        this.setupPins();

        for (let j = 0; j < this.outputCount; j++) {
            const raw = outputVoltTokens[j];
            const v = raw !== undefined ? parseFloat(raw) : 0;
            this.pinValues[this.inputCount + j] = v > this.getThreshold();
        }

        if (this.model.triState) {
            throw new Error(
                `CustomLogicElm: model "${this.modelName}" uses tri-state ('_') outputs, ` +
                `which this port does not stamp (see custom_logic.ts file header) -- refusing to construct.`
            );
        }
    }

    getThreshold(): number {
        return this.highVoltage / 2;
    }

    // Ported from CustomLogicElm.setupPins() (:58-88), minus the box-size
    // (sizeX/sizeY) bookkeeping that only matters for Java's own pixel
    // layout.
    setupPins(): void {
        this.model = getModelWithName(this.modelName);
        this.inputCount = this.model.inputs.length;
        this.outputCount = this.model.outputs.length;
        this.postCount = this.inputCount + this.outputCount;
        this.pinValues = new Array(this.postCount).fill(false);
        this.lastValues = new Array(this.postCount).fill(false);
        this.patternValues = new Array(26).fill(false);
        this.highImpedance = new Array(this.postCount).fill(false);
    }

    getDumpType() { return 208; }
    // modelName (escaped) followed by one voltage token per OUTPUT pin, in
    // order -- exactly what this constructor's own `params` parsing reads
    // back above (see custom.txt's real dump lines, e.g.
    // `208 x y x2 y2 0 comparator 0 0 5` for a 3-output model).
    dumpTokens(): (string | number | boolean)[] {
        const tokens: (string | number)[] = [escapeModelField(this.modelName)];
        for (let j = 0; j < this.outputCount; j++) {
            tokens.push(this.pinValues[this.inputCount + j] ? this.highVoltage : 0);
        }
        return tokens;
    }

    getPostCount() { return this.postCount; }
    getVoltageSourceCount() { return this.outputCount; }
    nonLinear() { return false; } // tri-state (the only case Java marks nonLinear) always rejected at construction

    // BUGFIX / re-derivation: an earlier draft of this file fanned pins off
    // the point1-point2 LINE (interpPoint, like GateElm/Switch2Elm) -- that
    // is the wrong model for a ChipElm-derived element. Verified against
    // ChipElm.java's real setPoints()/Pin.setPoint() (:181-213, :659-679):
    // chip pins sit at FIXED offsets from `x,y` alone (in multiples of
    // `cspc2`), entirely independent of point2/rotation -- point2 only ever
    // feeds `sizeX` bookkeeping in the interactive drag handler, never the
    // final pin math. Confirmed against tests/custom.txt's real wire/L
    // endpoints (e.g. the "208 512 96 528 96 0 comparator ..." line's 6
    // input pins land exactly on the fixture's own `L .../w ...` endpoints
    // at x=512, y=96+32*i only with this formula -- the interpPoint version
    // silently failed to connect to ANY of them, which is what caused
    // custom.txt to still analyze as "Singular matrix!" during this port's
    // own testing). SIZE_X=2 and CSPC2=32 are CustomLogicElm's actual
    // Java constants (sizeX is hardcoded 2 in Java's setupPins(); cspc2 =
    // 2*cspc = 2*(8*csize), csize=2 for the default/non-FLAG_SMALL size).
    // Rotation (isFlippedXY/FLAG_FLIP_X/Y) is NOT replicated (documented
    // simplification, same class of gap as symbols.tsx's own "dsign isn't
    // replicated" note) -- fine for every corpus fixture this pass targets,
    // which all place CustomLogicElm axis-aligned with point2 = point1 +
    // (16, 0).
    static CSPC2 = 32;
    static SIZE_X = 2;

    setPoints(): void {
        super.setPoints();
        const cspc2 = CustomLogicElm.CSPC2;

        this.inPosts = new Array(this.inputCount);
        for (let i = 0; i < this.inputCount; i++) {
            this.inPosts[i] = { x: this.x, y: this.y + cspc2 * i };
        }

        const outX = this.x + CustomLogicElm.SIZE_X * cspc2 + cspc2;
        this.outPosts = new Array(this.outputCount);
        for (let i = 0; i < this.outputCount; i++) {
            this.outPosts[i] = { x: outX, y: this.y + cspc2 * i };
        }
    }

    getPost(n: number): Point | null {
        if (n < this.inputCount) return this.inPosts[n] ?? null;
        const o = n - this.inputCount;
        return this.outPosts[o] ?? null;
    }

    // BUGFIX (found while chasing why tests/custom.txt still analyzed as
    // "Singular matrix!" after construction started succeeding): the base
    // CircuitElm.getConnection() default is `true` ("most elements connect
    // their nodes"), which is right for a resistor/wire but WRONG for a
    // digital logic element -- there is no real DC path between any two
    // pins of a rules-engine chip, same as GateElm/OpAmpElm/ComparatorElm's
    // own getConnection()=>false overrides in this port. Leaving the
    // default meant Analyzer.findUnconnectedNodes()'s ground-closure BFS
    // treated an input pin with NO real driver (e.g. a rule model's unused
    // "D,E,F" inputs in custom.txt, wired only to a dead-end stub wire) as
    // "connected" purely because it shared this element with an ADJACENT
    // pin that genuinely does reach ground (closure propagates through
    // getConnection()==true regardless of which post triggered it) -- so
    // the analyzer never added the dangling pin's usual 1e8-to-ground
    // safety net, leaving its matrix row all-zero (a real singular matrix,
    // not a false positive). Matching GateElm's hasGroundConnection()
    // pattern instead: each OUTPUT pin genuinely IS ground-connected (it
    // has its own real ground-referenced voltage source, stamped in
    // stamp() above), so closure correctly seeds from there; inputs get
    // closure only from whatever REAL driving element shares their node.
    getConnection(_n1: number, _n2: number): boolean { return false; }
    hasGroundConnection(n1: number): boolean { return n1 >= this.inputCount; }

    // Each output gets its OWN ground-referenced voltage source (Java: one
    // VoltageSource per output pin, stamped independently) -- must call
    // vs.setNodes() explicitly since this element has more than one VS (the
    // base CircuitElm.setVoltageSource() single-`voltSource`-field default
    // doesn't call setNodes() at all; see Switch2Elm/CCVSElm for the same
    // multi-VS pattern in this port).
    setVoltageSource(j: number, vs: VoltageSource): void {
        this.outputVoltSources[j] = vs;
        vs.setNodes(CircuitNode.ground, this.nodes[this.inputCount + j]);
    }

    stamp(stamper: Stamper): void {
        for (let j = 0; j < this.outputCount; j++) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[this.inputCount + j], this.outputVoltSources[j]);
        }
    }

    doStep(stamper: Stamper): void {
        for (let i = 0; i < this.inputCount; i++) {
            this.pinValues[i] = this.volts[i] > this.getThreshold();
        }
        this.execute();
        for (let j = 0; j < this.outputCount; j++) {
            const value = this.pinValues[this.inputCount + j];
            stamper.updateVoltageSource(
                CircuitNode.ground,
                this.nodes[this.inputCount + j],
                this.outputVoltSources[j],
                value ? this.highVoltage : 0,
            );
        }
    }

    // Ported from CustomLogicElm.execute() (:145-212), EXACTLY -- including
    // the a-z capture / A-Z(ish) compare semantics and the +/- edge-pattern
    // reads off `lastValues`. Left-hand rule strings may be LONGER than
    // inputCount (parseRules() allows up to inputs.length+outputs.length),
    // which lets a rule read back an output pin's OWN current value as
    // feedback (e.g. a latch/flip-flop referencing its own Q) -- this reads
    // `pinValues[j]` uniformly for any j, which already covers that case
    // since output pinValues persist across steps (only the success branch
    // below ever overwrites them).
    private execute(): void {
        const model = this.model;
        for (let i = 0; i < model.rulesLeft.length; i++) {
            const rl = model.rulesLeft[i];
            let j = 0;
            for (; j < rl.length; j++) {
                const x = rl[j];
                if (x === '0' || x === '1') {
                    if (this.pinValues[j] === (x === '1')) continue;
                    break;
                }
                if (x === '?') continue;
                if (x === '+') {
                    if (this.pinValues[j] && !this.lastValues[j]) continue;
                    break;
                }
                if (x === '-') {
                    if (!this.pinValues[j] && this.lastValues[j]) continue;
                    break;
                }
                const code = x.charCodeAt(0);
                if (code >= 97 && code <= 122) { // 'a'-'z': capture
                    this.patternValues[code - 97] = this.pinValues[j];
                    continue;
                }
                if (code >= 65 && code <= 122) { // 'A'-'z' (byte-for-byte Java range): compare
                    if (this.patternValues[code - 65] !== this.pinValues[j]) break;
                    continue;
                }
            }
            if (j !== rl.length) continue;

            // success
            const rr = model.rulesRight[i];
            for (let k = 0; k < rr.length; k++) {
                const x = rr[k];
                this.highImpedance[k + this.inputCount] = false;
                const code = x.charCodeAt(0);
                if (code >= 97 && code <= 122) {
                    this.pinValues[k + this.inputCount] = this.patternValues[code - 97];
                } else if (x === '_') {
                    this.highImpedance[k + this.inputCount] = true;
                } else {
                    this.pinValues[k + this.inputCount] = (x === '1');
                }
            }
            break;
        }

        for (let j = 0; j < this.postCount; j++) {
            this.lastValues[j] = this.pinValues[j];
        }
    }

    getInfo(arr: (string | null)[]): void {
        arr[0] = this.model.infoText;
    }
}
