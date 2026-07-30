import { CircuitElm, Point, Stamper, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode } from '../core/node';

// Ported from ExtChipElm.java (dump type 460, xml "extchip") -- the fulgurlab
// lockstep bridge chip (docs/bridge-protocol.md). This is the ENGINE half
// only: a pure CircuitElm with no sockets/timers/app imports. The actual
// async ws exchange with an fpgasim/mcusim backend lives entirely in the
// app's extchip/client.ts (ExtChipRegistry; the GWT-era war/fulgur-bridge.js it
// was ported from has since been removed with the rest of the Java host);
// the lead agent's store glue is the only thing that ever writes
// `outputBits`/reads `inputBits` on an instance of this class.
//
// Electrical model (deliberately NOT ChipElm's usual "one internal model
// drives all outputs" shape -- see custom_logic.ts's own class comment for
// the precedent of a standalone CircuitElm reimplementing ChipElm pin
// geometry rather than extending an abstract ChipElm base that doesn't exist
// in this port): every OUTPUT pin is a ground-referenced push-pull driver
// (0V / HIGH_VOLTAGE behind OUTPUT_RESISTANCE, stamped as a Norton pair so
// it needs no voltage-source row), driven each doStep() from whichever bit
// of `outputBits` the app last wrote; every INPUT pin is high-Z unless the
// pin spec gives it a pull resistor, and is sampled at > THRESHOLD each
// doStep() into `inputBits`. No callbacks, no
// dependency injection -- the app's engineStore glues these two plain
// public fields to the ws client after every completed step (see this
// file's own test suite + the task report for the exact call order:
// setInputs(elm.inputBits) -> onSimTime(t) -> elm.outputBits = getOutputs()).
export interface ExtChipPin {
    name: string;
    dir: 'in' | 'out';
    /**
     * Optional passive pull on an INPUT pin, in ohms, toward HIGH_VOLTAGE
     * ('pu') or ground ('pd'). null = the true high-Z of a bare input.
     *
     * Without this a button is unusable. Wire an input to a switch to ground
     * -- the obvious way to build one -- and with the switch OPEN the node is
     * driven by nothing at all; the Analyzer's unconnected-node handling ties
     * it to ground through 1e8 ohm, so the pin reads LOW whether the button is
     * pressed or not. Real boards solve this with a pull resistor (the Tang
     * Nano's own buttons have 10K pull-ups); so does this.
     */
    pull: { dir: 'up' | 'down'; r: number } | null;
}

// "name:in,name:out,..." -> ordered pins, inputs first (bridge bit order),
// same shape/order as the removed war/fulgur-bridge.js's parsePinSpec() and
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

// Resistance shorthand: "10k" / "4k7" / "330" / "1M". The 4k7 form (value
// letter used as the decimal point) is standard on schematics and is what
// someone typing a pull-up value will reach for.
function parseResistance(text: string): number | null {
    const m = /^(\d+)(?:([kKmMrR])(\d*))?$/.exec(text);
    if (!m) return null;
    const mult = m[2] ? ({ k: 1e3, m: 1e6, r: 1 })[m[2].toLowerCase() as 'k' | 'm' | 'r'] : 1;
    const whole = Number(m[1]);
    const frac = m[3] ? Number(`0.${m[3]}`) : 0;
    const r = (whole + frac) * mult;
    return r > 0 ? r : null;
}

/**
 * Pin spec grammar: `name:dir` with optional colon-separated options.
 *
 *     btn1:in            plain high-Z input (unchanged, and still the default)
 *     btn1:in:pu10k      10k pull-up to 3.3V
 *     sw:in:pd4k7        4k7 pull-down to ground
 *
 * Options use ':' rather than '=' because escapeDumpText() rewrites '=' to
 * '\q' -- correct but unreadable in a saved file -- while ':' passes through
 * untouched. The name grammar is [^:\s]+, so there is no ambiguity.
 *
 * Backward compatible in both directions: an option-free spec parses exactly
 * as before, and an unknown option is a parse failure rather than a silent
 * misread (the whole spec returns [], the element's existing "bad spec means
 * an inert zero-post block" contract).
 */
export function parseExtChipPinSpec(spec: string): ExtChipPin[] {
    const pins: ExtChipPin[] = [];
    const seen = new Set<string>();
    for (const raw of String(spec ?? '').split(',')) {
        const s = raw.trim();
        if (!s) continue;
        const parts = s.split(':').map((t) => t.trim());
        if (parts.length < 2) return [];
        const [name, dir, ...opts] = parts;
        if (!name || /\s/.test(name)) return [];
        if (dir !== 'in' && dir !== 'out') return [];
        if (seen.has(name)) return [];
        seen.add(name);

        let pull: ExtChipPin['pull'] = null;
        for (const opt of opts) {
            const om = /^(pu|pd)(.+)$/.exec(opt);
            if (!om) return [];
            // A pull on an output would fight its own driver; reject rather
            // than silently ignore, so a typo surfaces.
            if (dir !== 'in') return [];
            const r = parseResistance(om[2]);
            if (r === null) return [];
            pull = { dir: om[1] === 'pu' ? 'up' : 'down', r };
        }
        pins.push({ name, dir, pull });
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
    /**
     * Output driver impedance, ohms. Real 3.3V CMOS GPIO is roughly 25-50 ohm;
     * an FPGA pad with the Tang Nano's default 8 mA drive is in that band.
     *
     * Non-zero matters more than its exact value. As an IDEAL source a pin
     * would deliver unbounded current, so the single most common beginner
     * circuit -- an LED straight from a pin to ground -- produced a physically
     * meaningless answer instead of the "that would burn out the LED" one.
     * Into any sane load the difference is under a percent (3.3V through 33
     * ohm into 1k reads 3.19V), so this costs nothing where it does not matter.
     */
    static OUTPUT_RESISTANCE = 33;

    // Chip geometry constants. UNLIKE CustomLogicElm's two-column (west
    // in / east out) layout, this element's pins run in two HORIZONTAL rows
    // -- north (outputs) / south (inputs) -- spaced cspc2 apart along x,
    // matching the real Tang Nano 9K's two 20-pin header rows along its
    // long edges (see ExtChipBody.tsx, which draws the actual board photo
    // between the rows). Still absolute `x,y + offset` posts independent of
    // point2/rotation, same non-rotating-block convention as before.
    //
    // EVERY POST MUST LAND ON THE 16px GRID. This is not cosmetic: node
    // merging in core/node.ts keys the node map on pointKey(p) =
    // `${p.x},${p.y}`, an EXACT STRING MATCH with no tolerance, and the app
    // snaps wire endpoints to the grid (canvas/draw.ts's GRID_SIZE, mirrored
    // by GRID below). A post that lands off-grid is therefore not merely
    // ugly -- it is UNREACHABLE BY WIRE, permanently.
    //
    // CSPC2/LEAD are 5x the original size (160/80, was 32/16) per an
    // explicit "make it 5x larger" request; both are multiples of GRID, so
    // the x coordinates (x + 80 + 160i) and the north row (y - 80) are
    // on-grid by construction. The SOUTH row is not: it is offset by
    // _boardHeight, which is derived from the photographed ASPECT ratio and
    // is a multiple of nothing. setPoints() quantizes it for exactly this
    // reason -- an earlier version of this comment claimed the invariant
    // held while the code silently broke it for every input pin.
    // ExtChipBody.tsx mirrors CSPC2/LEAD and reads boardWidth/boardHeight
    // off the instance, so the drawn board follows the quantization for
    // free. SIZE_X is a column count, ASPECT a ratio; neither is a length.
    static CSPC2 = 160;
    // Mirror of web/app/src/canvas/draw.ts's GRID_SIZE. Duplicated rather
    // than imported because the engine package is headless and must not
    // depend on the app -- same duplication convention as CSPC2/LEAD above.
    static GRID = 16;
    // Minimum row length in pin-columns, so a chip with few/no pins still
    // shows a board at roughly the real part's proportions instead of a
    // sliver.
    static SIZE_X = 2;
    // Real board's photographed aspect ratio (width/height of the cropped
    // PCB art in ExtChipBody.tsx's tang-nano-9k.png) -- keeps the decorative
    // board rectangle's proportions true to the actual part regardless of
    // pin count.
    static ASPECT = 2.71;
    // Lead-stub length from the board's north/south edge to the actual post.
    static LEAD = 80;

    // Board clock the backend should synthesize, in Hz. fulgurlab's addition
    // to proto v1's `create.config` (docs/bridge-protocol.md) -- optional and
    // ignorable, so a backend that predates it just runs its own default.
    // This is THE performance lever for co-simulation: fpgasim's harness
    // otherwise hardcodes the real Tang Nano's 27 MHz, and a 1 ms quantum at
    // 27 MHz is 54,000 clock-edge events for vvp to chew through before the
    // design does any work of its own. 0 means "backend's choice".
    static DEFAULT_CLOCK_HZ = 1_000_000;

    bridgeUrl: string;
    pinSpec: string;
    quantumNs: number;
    engineName: string;
    source: string;
    clockHz: number;
    // Which entry in the app's extchip/targets.ts this chip was placed from
    // (board art, Monaco language, default source, wiring notes). Purely an
    // app-layer key -- the engine never interprets it, it just has to survive
    // a dump/load round trip like every other config field.
    targetId: string;

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
    private inPosts: Point[] = [];
    private outPosts: Point[] = [];
    // Decorative board footprint (world-space size, not position) -- computed
    // once per setPoints() from the pin count and ASPECT, and read directly
    // by ExtChipBody.tsx so the drawn board photo and the real posts can
    // never drift out of sync with each other (single source of truth,
    // rather than duplicating the sizing formula in the app layer).
    private _boardWidth = ExtChipElm.SIZE_X * ExtChipElm.CSPC2;
    private _boardHeight = this._boardWidth / ExtChipElm.ASPECT;

    get boardWidth(): number { return this._boardWidth; }
    get boardHeight(): number { return this._boardHeight; }

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
        // Tokens 6-7 postdate the original Java element. Same positional
        // fallback rule as `source` above, so a GWT-era or pre-editor 5-token
        // "460" line still loads and simply picks up today's defaults.
        this.clockHz = p.length > 5 ? (parseFloat(p[5]) || ExtChipElm.DEFAULT_CLOCK_HZ) : ExtChipElm.DEFAULT_CLOCK_HZ;
        this.targetId = p.length > 6 ? unescapeToken(p[6]) : '';
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
            this.clockHz,
            escapeToken(this.targetId),
        ];
    }

    private derivePins(): void {
        const all = parseExtChipPinSpec(this.pinSpec);
        this.inPins = all.filter((pin) => pin.dir === 'in');
        this.outPins = all.filter((pin) => pin.dir === 'out');
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
    // Zero: outputs are Norton pairs (conductance + current source) rather
    // than ideal voltage sources, so they consume no matrix voltage-source
    // rows. See OUTPUT_RESISTANCE and stamp()/doStep().
    getVoltageSourceCount() { return 0; }
    nonLinear() { return false; }

    // No real DC path between any two pins of this element (same reasoning
    // as CustomLogicElm/GateElm's own getConnection()=>false overrides) --
    // each output pin has its own real ground-referenced voltage source
    // (hasGroundConnection() below), inputs get closure only from whatever
    // actually drives them.
    getConnection(_n1: number, _n2: number): boolean { return false; }
    // Outputs are ground-referenced sources; a PULLED input now genuinely has
    // a DC path to ground too (through its pull resistor, in either
    // direction), and the Analyzer has to know or it will treat an otherwise
    // unconnected pulled pin as floating and shunt it to ground itself.
    hasGroundConnection(n1: number): boolean {
        if (n1 >= this.inPins.length) return true;
        return this.inPins[n1]?.pull != null;
    }

    setPoints(): void {
        super.setPoints();
        const cspc2 = ExtChipElm.CSPC2;
        const cols = Math.max(this.inPins.length, this.outPins.length, ExtChipElm.SIZE_X);
        this._boardWidth = cols * cspc2;
        // Quantized to the grid so `southY` below stays on-grid and the input
        // row is reachable by a snapped wire endpoint -- see the class comment
        // on GRID for why an off-grid post can never be connected at all.
        // Rounding (not flooring) keeps the drawn board closest to the real
        // part's ASPECT; the residual error is at most half a grid cell.
        const grid = ExtChipElm.GRID;
        this._boardHeight = Math.max(grid, Math.round(this._boardWidth / ExtChipElm.ASPECT / grid) * grid);
        // South row: inputs, below the board. North row: outputs, above it.
        // Both rows are column-indexed independently (a lopsided pin count,
        // e.g. 3 in / 1 out, just leaves unused columns on the shorter row --
        // same "occupies fewer slots" behavior the old two-column layout had).
        const southY = this.y + this._boardHeight + ExtChipElm.LEAD;
        const northY = this.y - ExtChipElm.LEAD;
        this.inPosts = this.inPins.map((_, i) => ({ x: this.x + cspc2 * (i + 0.5), y: southY }));
        this.outPosts = this.outPins.map((_, i) => ({ x: this.x + cspc2 * (i + 0.5), y: northY }));
    }

    getPost(n: number): Point | null {
        if (n < this.inPins.length) return this.inPosts[n] ?? null;
        const o = n - this.inPins.length;
        return this.outPosts[o] ?? null;
    }

    stamp(stamper: Stamper): void {
        // Output drivers: the resistive half of a Thevenin source
        // (HIGH_VOLTAGE or 0 behind OUTPUT_RESISTANCE), transformed to Norton.
        // The current half is driven per-step in doStep() from outputBits.
        for (let j = 0; j < this.outPins.length; j++) {
            stamper.stampResistor(CircuitNode.ground, this.nodes[this.inPins.length + j], ExtChipElm.OUTPUT_RESISTANCE);
        }
        // Input pull resistors, as a Norton pair: the resistor to ground plus,
        // for a pull-UP, a current source of V/R into the node. That is the
        // Thevenin source (HIGH_VOLTAGE behind R) transformed, so it needs no
        // internal node and no extra voltage source -- getVoltageSourceCount()
        // and the node count are both untouched.
        //
        // Both halves belong HERE and not in doStep(): analyzeAndStamp() snapshots
        // rightSide into origRightSide AFTER every element has stamped, and the
        // Newton loop restores from that snapshot before each iteration, so a
        // stamp-time current source persists correctly across all sub-iterations.
        for (let i = 0; i < this.inPins.length; i++) {
            const pull = this.inPins[i].pull;
            if (!pull) continue;
            stamper.stampResistor(CircuitNode.ground, this.nodes[i], pull.r);
            if (pull.dir === 'up') {
                stamper.stampCurrentSource(CircuitNode.ground, this.nodes[i], ExtChipElm.HIGH_VOLTAGE / pull.r);
            }
        }
    }

    doStep(stamper: Stamper): void {
        let bits = 0;
        for (let i = 0; i < this.inPins.length; i++) {
            if (this.volts[i] > ExtChipElm.THRESHOLD) bits |= (1 << i);
        }
        this.inputBits = bits >>> 0;

        // Norton current for each output's drive level. In doStep() rather
        // than stamp() because it changes every quantum: the Newton loop
        // restores rightSide from origRightSide before each sub-iteration, so
        // a value stamped here is re-applied every iteration, which is exactly
        // what a per-step source needs.
        for (let j = 0; j < this.outPins.length; j++) {
            const bit = (this.outputBits >>> j) & 1;
            const v = bit ? ExtChipElm.HIGH_VOLTAGE : 0;
            stamper.stampCurrentSource(CircuitNode.ground, this.nodes[this.inPins.length + j],
                                       v / ExtChipElm.OUTPUT_RESISTANCE);
        }
    }

    getInfo(arr: (string | null)[]): void {
        arr[0] = 'external chip';
        arr[1] = 'bridge: ' + this.bridgeUrl;
        arr[2] = 'quantum: ' + this.quantumNs + ' ns';
    }
}
