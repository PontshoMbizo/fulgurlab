import { CircuitElm, Point, Stamper, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from ExtChipElm.java (dump type 460, xml "extchip") -- the fulgurlab
// lockstep bridge chip (docs/bridge-protocol.md). This is the ENGINE half
// only: a pure CircuitElm with no sockets/timers/app imports. The actual
// async ws exchange with an fpgasim/mcusim backend lives entirely in the
// app's extchip/client.ts (ExtChipRegistry, ported from war/fulgur-bridge.js);
// the lead agent's store glue is the only thing that ever writes
// `outputBits`/reads `inputBits` on an instance of this class.
//
// Electrical model (deliberately NOT ChipElm's usual "one internal model
// drives all outputs" shape -- see custom_logic.ts's own class comment for
// the precedent of a standalone CircuitElm reimplementing ChipElm pin
// geometry rather than extending an abstract ChipElm base that doesn't exist
// in this port): every OUTPUT pin is its own ground-referenced push-pull
// voltage source (0V / HIGH_VOLTAGE), driven each doStep() from whichever
// bit of `outputBits` the app last wrote; every INPUT pin is high-Z,
// sampled at > THRESHOLD each doStep() into `inputBits`. No callbacks, no
// dependency injection -- the app's engineStore glues these two plain
// public fields to the ws client after every completed step (see this
// file's own test suite + the task report for the exact call order:
// setInputs(elm.inputBits) -> onSimTime(t) -> elm.outputBits = getOutputs()).
export interface ExtChipPin {
    name: string;
    dir: 'in' | 'out';
}

// "name:in,name:out,..." -> ordered pins, inputs first (bridge bit order),
// same shape/order as war/fulgur-bridge.js's parsePinSpec() (:31-46) and
// ExtChipElm.java's parsePinSpec() (:73-108) -- EXCEPT this returns an empty
// array on any malformed entry/duplicate/empty spec instead of an error
// object: an ExtChipElm with a bad or blank pin spec is a valid, PLACEABLE
// element (a zero-post inert block), not a construction failure -- the
// bridge client (app-side) is the one that treats "no pins declared" as
// "adopt whatever the backend built" rather than a hard error (see
// client.ts's adopt-pins-when-empty-spec behavior).
// CustomLogicModel.escape()/unescape() (:257-284 in the Java source) add ONE
// rule on top of the generic escapeDumpText/unescapeDumpText table: an empty
// string escapes to the literal 2-char token "\0" (and back). ExtChipElm.java
// calls CustomLogicModel.escape()/unescape() directly for every one of its
// dump fields (bridgeUrl/pinSpec/engine/source can all legitimately be
// empty -- e.g. a fresh unconfigured chip, or fpgasim's blank `engine`
// field), so without this rule an empty middle token (anything before the
// LAST field) would collapse away under a plain whitespace split, silently
// desyncing every token after it -- see this file's own test for the
// concrete failure mode this rule prevents.
function escapeToken(s: string): string {
    if (s.length === 0) return '\\0';
    return escapeDumpText(s);
}

function unescapeToken(s: string): string {
    if (s === '\\0') return '';
    return unescapeDumpText(s);
}

function parseExtChipPinSpec(spec: string): ExtChipPin[] {
    const pins: ExtChipPin[] = [];
    const seen = new Set<string>();
    for (const raw of String(spec ?? '').split(',')) {
        const s = raw.trim();
        if (!s) continue;
        const m = /^([^:\s]+)\s*:\s*(in|out)$/.exec(s);
        if (!m) return [];
        if (seen.has(m[1])) return [];
        seen.add(m[1]);
        pins.push({ name: m[1], dir: m[2] as 'in' | 'out' });
    }
    return pins;
}

export class ExtChipElm extends CircuitElm {
    static DEFAULT_URL = 'ws://localhost:3100';
    static DEFAULT_QUANTUM_NS = 1_000_000;
    // 3.3V push-pull outputs / 1.65V input threshold -- matches
    // docs/bridge-protocol.md's "circuitjs side" section and
    // ExtChipElm.java's setHighVoltage(3.3) constructor call exactly.
    static HIGH_VOLTAGE = 3.3;
    static THRESHOLD = 1.65;

    // Chip geometry constants, ported from CustomLogicElm.ts's own ChipElm
    // port (see that file's setPoints() comment for the full derivation
    // against ChipElm.java's real Pin.setPoint() formula -- absolute
    // `x,y + cspc2*index` offsets, independent of point2/rotation).
    static CSPC2 = 32;
    static SIZE_X = 2;

    bridgeUrl: string;
    pinSpec: string;
    quantumNs: number;
    engineName: string;
    source: string;

    // Plain public fields the app's store glues to the ws client -- see
    // this class's own header comment for the exact per-step call order.
    // inputBits: updated BY THIS ELEMENT every doStep() from its input pins
    // (LSB = first declared "in" pin). outputBits: set EXTERNALLY by the
    // app between steps; doStep() drives the output voltage sources from it
    // (LSB = first declared "out" pin).
    inputBits = 0;
    outputBits = 0;

    private inPins: ExtChipPin[] = [];
    private outPins: ExtChipPin[] = [];
    private outputVoltSources: VoltageSource[] = [];
    private inPosts: Point[] = [];
    private outPosts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        // Constructor tokens (after x y x2 y2 flags): `escape(url)
        // escape(pinSpec) quantum escape(engine) escape(source)` -- SAME
        // order/escaping as ExtChipElm.java's own text-constructor (:51-64)
        // and dump() (:66-70), so a GWT-era-saved "460" line loads here
        // unchanged. Missing trailing tokens (Java's `source` is the only
        // genuinely optional one, via `st.hasMoreTokens()`) fall back to
        // this element's own field defaults rather than throwing -- a
        // fresh/partial dump line degrades to "unconfigured", never a
        // failed construction.
        const p = params ?? [];
        this.bridgeUrl = p.length > 0 ? unescapeToken(p[0]) : ExtChipElm.DEFAULT_URL;
        this.pinSpec = p.length > 1 ? unescapeToken(p[1]) : '';
        this.quantumNs = p.length > 2 ? (parseFloat(p[2]) || ExtChipElm.DEFAULT_QUANTUM_NS) : ExtChipElm.DEFAULT_QUANTUM_NS;
        this.engineName = p.length > 3 ? unescapeToken(p[3]) : '';
        this.source = p.length > 4 ? unescapeToken(p[4]) : '';
        this.derivePins();
    }

    getDumpType() { return '460'; }
    getXmlDumpType() { return 'extchip'; }

    // Emits the SAME 5 tokens, in the SAME order, that the constructor
    // reads back above -- see base.ts's dump() contract comment ("subclasses'
    // dumpTokens() emit exactly what their OWN constructor's `params`
    // parsing reads back").
    dumpTokens(): (string | number)[] {
        return [
            escapeToken(this.bridgeUrl),
            escapeToken(this.pinSpec),
            this.quantumNs,
            escapeToken(this.engineName),
            escapeToken(this.source),
        ];
    }

    private derivePins(): void {
        const all = parseExtChipPinSpec(this.pinSpec);
        this.inPins = all.filter((pin) => pin.dir === 'in');
        this.outPins = all.filter((pin) => pin.dir === 'out');
        this.outputVoltSources = new Array(this.outPins.length);
        // A pin-count change invalidates any bits the app/element were
        // holding for the OLD pin layout -- start clean rather than risk
        // stale bits landing on a differently-shaped pin set. The app is
        // expected to re-`configure()` its bridge client (and so
        // re-populate both fields from scratch) whenever it calls
        // setPinSpec() anyway.
        this.inputBits = 0;
        this.outputBits = 0;
    }

    // UI config-edit entry point (mirrors ExtChipElm.java's
    // setChipEditValue() case 1: `parsePinSpec(); setupPins(); setPoints();`).
    // Safe to call before OR after preStamp() -- re-derives pins, then
    // immediately re-derives geometry/node allocation so a subsequent
    // preStamp() (which the caller must still trigger a reanalyze through,
    // same as every other element's config-edit path -- see
    // engineStore.updateElementField()) sees a fully self-consistent element.
    setPinSpec(spec: string): void {
        this.pinSpec = spec;
        this.derivePins();
        this.setPoints();
        this.allocNodes();
    }

    // Ordered pin metadata (inputs first, bridge bit order) -- the UI drawer
    // reads this to render the pin list; the app's bridge client compares it
    // against the backend's `created.pins`.
    get pins(): ExtChipPin[] {
        return [...this.inPins, ...this.outPins];
    }

    getPostCount() { return this.inPins.length + this.outPins.length; }
    getVoltageSourceCount() { return this.outPins.length; }
    nonLinear() { return false; }

    // No real DC path between any two pins of this element (same reasoning
    // as CustomLogicElm/GateElm's own getConnection()=>false overrides) --
    // each output pin has its own real ground-referenced voltage source
    // (hasGroundConnection() below), inputs get closure only from whatever
    // actually drives them.
    getConnection(_n1: number, _n2: number): boolean { return false; }
    hasGroundConnection(n1: number): boolean { return n1 >= this.inPins.length; }

    setPoints(): void {
        super.setPoints();
        const cspc2 = ExtChipElm.CSPC2;
        this.inPosts = this.inPins.map((_, i) => ({ x: this.x, y: this.y + cspc2 * i }));
        const outX = this.x + ExtChipElm.SIZE_X * cspc2 + cspc2;
        this.outPosts = this.outPins.map((_, i) => ({ x: outX, y: this.y + cspc2 * i }));
    }

    getPost(n: number): Point | null {
        if (n < this.inPins.length) return this.inPosts[n] ?? null;
        const o = n - this.inPins.length;
        return this.outPosts[o] ?? null;
    }

    setVoltageSource(j: number, vs: VoltageSource): void {
        this.outputVoltSources[j] = vs;
        vs.setNodes(CircuitNode.ground, this.nodes[this.inPins.length + j]);
    }

    stamp(stamper: Stamper): void {
        for (let j = 0; j < this.outPins.length; j++) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[this.inPins.length + j], this.outputVoltSources[j]);
        }
    }

    doStep(stamper: Stamper): void {
        let bits = 0;
        for (let i = 0; i < this.inPins.length; i++) {
            if (this.volts[i] > ExtChipElm.THRESHOLD) bits |= (1 << i);
        }
        this.inputBits = bits >>> 0;

        for (let j = 0; j < this.outPins.length; j++) {
            const bit = (this.outputBits >>> j) & 1;
            const v = bit ? ExtChipElm.HIGH_VOLTAGE : 0;
            stamper.updateVoltageSource(CircuitNode.ground, this.nodes[this.inPins.length + j], this.outputVoltSources[j], v);
        }
    }

    getInfo(arr: (string | null)[]): void {
        arr[0] = 'external chip';
        arr[1] = 'bridge: ' + this.bridgeUrl;
        arr[2] = 'quantum: ' + this.quantumNs + ' ns';
    }
}
