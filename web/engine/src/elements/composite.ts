import { CircuitElm, Stamper, Point, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode, CircuitNodeLink } from '../core/node';

// Ported from CompositeElm.java — the subcircuit mechanism. A CompositeElm
// owns a list of child CircuitElms wired to each other through a private node
// numbering, exposes a chosen subset of those nodes as its own posts, and
// otherwise delegates everything (stamping, stepping, reset) to the children.
//
// The Analyzer already knows how to walk this: analyze() expands
// getChildElmList() into the flat element list, and setNode() below is what
// keeps the children's node references in sync with the global assignment the
// analyzer makes for the parent's posts.
//
// This is the piece TODO.md's P1-1 called "the highest-leverage single item":
// it unlocks 410 CustomComposite plus the five fixed-model composites
// (Darlington, Optocoupler, OpAmpReal, Unijunction, Crystal) at once.

export const FLAG_ESCAPE = 1;

// Element constructors are looked up by CLASS NAME here, not by dump id —
// model strings like "NTransistorElm 1 2 4" name the Java class. The registry
// is populated by core/factory.ts (which imports every element module) to
// avoid an import cycle back into this file.
type AnyElmCtor = new (x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) => CircuitElm;
const classNameMap = new Map<string, AnyElmCtor>();

export function registerElementClasses(entries: Record<string, unknown>): void {
    for (const [name, ctor] of Object.entries(entries)) {
        if (typeof ctor === 'function') classNameMap.set(name, ctor as AnyElmCtor);
    }
}

export function constructElementByClassName(name: string, flags = 0, tokens?: string[]): CircuitElm | null {
    const Ctor = classNameMap.get(name);
    if (!Ctor) {
        console.warn(`CompositeElm: unknown element class "${name}"`);
        return null;
    }
    try {
        return new Ctor(0, 0, 0, 0, flags, tokens);
    } catch (e) {
        console.error(`CompositeElm: failed to construct ${name}:`, e);
        return null;
    }
}

export abstract class CompositeElm extends CircuitElm {
    compElmList: CircuitElm[] = [];
    compNodeList: CircuitNode[] | null = null;
    compNodeInfo: string[] = [];
    extNodeIds: number[] = [];
    numPosts = 0;
    numNodes = 0;
    posts: Point[] = [];

    constructor(x: number, y: number, x2: number, y2: number, flags: number) {
        super(x, y, x2, y2, flags);
    }

    useEscape(): boolean { return (this.flags & FLAG_ESCAPE) !== 0; }

    // Ported from loadComposite(). `model` is a \r-separated list of
    // "<ClassName> <node> <node> ..." lines; `stateTokens`, when present, is
    // one already-escaped "<flags> <tokens...>" blob per child, in the same
    // order (that is how a composite's children carry their own state through
    // a dump).
    loadComposite(stateTokens: string[] | null, model: string, externalNodes: number[]): void {
        this.compElmList = [];
        const nodeInfoList: string[] = [];
        let stateIndex = 0;

        for (const line of model.split('\r')) {
            if (line.length === 0) continue;
            const sp = line.indexOf(' ');
            if (sp < 0) continue;
            const ceType = line.substring(0, sp);
            const nodeStr = line.substring(sp + 1);

            let newce: CircuitElm | null;
            if (stateTokens && stateIndex < stateTokens.length) {
                let dumpedCe = stateTokens[stateIndex++];
                if (this.useEscape()) dumpedCe = unescapeDumpText(dumpedCe);
                const stCe = dumpedCe.split(this.useEscape() ? ' ' : '_').filter(t => t.length > 0);
                const childFlags = parseInt(stCe[0], 10) || 0;
                newce = constructElementByClassName(ceType, childFlags, stCe.slice(1));
            } else {
                newce = constructElementByClassName(ceType);
            }
            if (!newce) continue;
            this.compElmList.push(newce);
            nodeInfoList.push(nodeStr);
        }

        this.compNodeInfo = nodeInfoList;
        this.extNodeIds = externalNodes;
        this.numPosts = this.numNodes = externalNodes.length;
        this.posts = new Array(this.numPosts);
        for (let i = 0; i < this.numPosts; i++) this.posts[i] = { x: this.x, y: this.y };
        this.flags |= FLAG_ESCAPE;
    }

    // Ported from buildCompNodeList(). Node 0 in a model string means ground.
    // External nodes come first, in extNodeIds order, then the remaining
    // internal nodes, then one extra node per child internal node.
    buildCompNodeList(): void {
        const compNodeHash = new Map<number, CircuitNode>();
        this.compNodeList = [];

        for (let i = 0; i !== this.compElmList.length; i++) {
            const ce = this.compElmList[i];
            const nodes = (this.compNodeInfo[i] ?? '').split(/[ +\t]+/).filter(t => t.length > 0);
            let thisPost = 0;
            for (const tok of nodes) {
                const nodeOfThisPost = parseInt(tok, 10);
                if (nodeOfThisPost === 0) {
                    ce.setNode(thisPost, CircuitNode.ground);
                    ce.setNodeVoltage(thisPost, 0);
                    thisPost++;
                    continue;
                }
                const cnLink = new CircuitNodeLink(thisPost, ce);
                let cn = compNodeHash.get(nodeOfThisPost);
                if (!cn) {
                    cn = new CircuitNode();
                    compNodeHash.set(nodeOfThisPost, cn);
                }
                cn.links.push(cnLink);
                thisPost++;
            }
        }

        for (const id of this.extNodeIds) {
            const cn = compNodeHash.get(id);
            if (!cn) {
                // A model that names an external node no child actually uses
                // is malformed; Java gives up on the whole node list here.
                this.compNodeList = null;
                return;
            }
            this.compNodeList.push(cn);
            compNodeHash.delete(id);
        }
        for (const cn of compNodeHash.values()) this.compNodeList.push(cn);

        for (const ce of this.compElmList) {
            const inodes = ce.getInternalNodeCount();
            for (let j = 0; j !== inodes; j++) {
                const cn = new CircuitNode();
                cn.links.push(new CircuitNodeLink(j + ce.getPostCount(), ce));
                this.compNodeList.push(cn);
            }
        }
        this.numNodes = this.compNodeList.length;
    }

    getChildElmList(): CircuitElm[] | null { return this.compElmList; }

    preStamp(): void {
        this.setPoints();
        for (const ce of this.compElmList) ce.preStamp();
        this.buildCompNodeList();
        this.allocNodes();
    }

    getPostCount() { return this.numPosts; }
    getInternalNodeCount() { return this.numNodes - this.numPosts; }
    getPost(n: number): Point | null { return this.posts[n] ?? null; }
    setPost(n: number, p: Point): void { this.posts[n] = p; }

    getConnection(_n1: number, _n2: number) { return false; }
    hasGroundConnection(_n1: number) { return false; }

    reset(): void {
        for (const ce of this.compElmList) ce.reset();
    }

    getPower(): number {
        let power = 0;
        for (const ce of this.compElmList) power += (ce as unknown as { getPower?: () => number }).getPower?.() ?? 0;
        return power;
    }

    // The load-bearing override: when the analyzer assigns a global node to
    // one of our posts, every child element referencing that private node has
    // to be pointed at the same global node.
    setNode(p: number, n: CircuitNode): void {
        super.setNode(p, n);
        if (!this.compNodeList) return;
        const entry = this.compNodeList[p];
        if (!entry) return;
        for (const link of entry.links) link.elm.setNode(link.num, n);
    }

    // Children stamp themselves — the analyzer visits them directly because
    // they are in the expanded element list.
    stamp(_stamper: Stamper): void {}

    getCurrentIntoNode(n: number): number {
        if (!this.compNodeList) return 0;
        const entry = this.compNodeList[n];
        if (!entry) return 0;
        let c = 0;
        for (const link of entry.links) {
            const f = (link.elm as unknown as { getCurrentIntoNode?: (i: number) => number }).getCurrentIntoNode;
            if (f) c += f.call(link.elm, link.num);
        }
        return c;
    }

    // Children are dumped as escaped "<flags> <tokens...>" blobs, in list
    // order — Java strips the leading "<type> 0 0 0 0 " from each child dump.
    dumpElements(mask?: number): (string | number | boolean)[] {
        const out: string[] = [];
        for (let i = 0; i < this.compElmList.length; i++) {
            if (mask !== undefined && (mask & (1 << i)) === 0) continue;
            const full = this.compElmList[i].dump();
            const stripped = full.replace(/^[A-Za-z0-9]+ 0 0 0 0 /, '');
            out.push(escapeDumpText(stripped));
        }
        return out;
    }

    dumpTokens(): (string | number | boolean)[] { return this.dumpElements(); }
}

// ------------------------------------------------------------------ subclasses

// A composite whose model string is fixed at compile time.
abstract class FixedCompositeElm extends CompositeElm {
    protected initModel(model: string, externalNodes: number[], tokens?: string[], stateMask?: number): void {
        // Java passes the *whole* remaining token stream as the per-child
        // state list; an absent/short list just means "use defaults".
        const state = Array.isArray(tokens) && tokens.length > 0 ? tokens : null;
        this.loadComposite(state, model, externalNodes);
        this.buildCompNodeList();
        this.allocNodes();
        this.stateMask = stateMask;
    }
    protected stateMask: number | undefined;
    dumpTokens(): (string | number | boolean)[] { return this.dumpElements(this.stateMask); }
}

// 400: two NPN transistors in the classic Darlington pair.
export class DarlingtonElm extends FixedCompositeElm {
    static modelString = 'NTransistorElm 1 2 4\rNTransistorElm 4 2 3';
    static modelExternalNodes = [1, 2, 3];
    pnp = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // The trailing `pnp` token is Darlington's own, after the child blobs.
        let childTokens = tokens;
        if (Array.isArray(tokens) && tokens.length > 0) {
            const last = parseInt(tokens[tokens.length - 1], 10);
            if (last === 1 || last === -1) {
                this.pnp = last;
                childTokens = tokens.slice(0, -1);
            }
        }
        const model = this.pnp === -1
            ? 'PTransistorElm 1 2 4\rPTransistorElm 4 2 3'
            : DarlingtonElm.modelString;
        this.initModel(model, DarlingtonElm.modelExternalNodes, childTokens);
    }

    getDumpType() { return 400; }
    dumpTokens(): (string | number | boolean)[] { return [...super.dumpTokens(), this.pnp]; }
}

// 407: LED + current-controlled current source + phototransistor.
export class OptocouplerElm extends FixedCompositeElm {
    static modelString = 'DiodeElm 6 1\rCCCSElm 1 2 3 4\rNTransistorElm 3 4 5';
    static modelExternalNodes = [6, 2, 4, 5];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // Java passes `null` for the state stream here — the optocoupler's
        // children are always rebuilt from defaults.
        this.initModel(OptocouplerElm.modelString, OptocouplerElm.modelExternalNodes);
    }

    getDumpType() { return 407; }
}

// 409: a real op-amp macromodel. Only the 741 model is wired up here; Java
// also ships two LM324 variants selected through the edit dialog, which need
// the per-child state dumps those variants carry.
export class OpAmpRealElm extends FixedCompositeElm {
    static model741String =
        'TransistorElm 1 2 3\rTransistorElm 4 5 6\rCurrentElm 7 8\r' +
        'CapacitorElm 13 20\r' +
        'ResistorElm 15 6\rResistorElm 6 25\r' +
        'ResistorElm 4 1\rResistorElm 4 14\rResistorElm 4 5\rResistorElm 4 16\rResistorElm 4 24\rResistorElm 4 23\rResistorElm 17 18\r' +
        'ResistorElm 22 21\rResistorElm 21 20\r';
    static model741ExternalNodes = [2, 3, 6, 7, 4];

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        this.initModel(OpAmpRealElm.model741String, OpAmpRealElm.model741ExternalNodes, tokens);
    }

    getDumpType() { return 409; }
}

// 417: unijunction transistor. Node 0 = E, 1 = B1, 2 = B2.
export class UnijunctionElm extends FixedCompositeElm {
    static FLAG_FLIP = 2;
    static modelString =
        'DiodeElm 1 4\rVoltageElm 4 5\rCCVSElm 4 5 6 0\rResistorElm 0 6\r' +
        'VCCSElm 5 7 5 7 6 7 5\rCapacitorElm 5 7\rResistorElm 7 2\rResistorElm 3 5';
    static modelExternalNodes = [1, 2, 3];
    // The 2N2646 parameter set Java hard-codes, "/"-separated per child.
    static modelDump =
        '2 x2n2646-emitter/0 0 0 0 0 0 0/2 2 1000*a/0 1000000/0 5 0.00028*(a-b)\\p0.00575*(c-d)*e/2 3.5e-11 0 0/0 38.15/0 2518';

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        this.flags |= FLAG_ESCAPE;
        this.initModel(UnijunctionElm.modelString, UnijunctionElm.modelExternalNodes,
            UnijunctionElm.modelDump.split('/'), 0);
    }

    getDumpType() { return 417; }
    getPostCount() { return 3; }
    // Java: dumpWithMask(0) — "don't want model details dumped, takes up space
    // and will make it hard to change".
    dumpTokens(): (string | number | boolean)[] { return []; }
}

// 412: quartz crystal — the standard Butterworth-Van Dyke equivalent circuit.
export class CrystalElm extends FixedCompositeElm {
    static FLAG_SHOW_FREQ = 1;
    static modelString = 'CapacitorElm 1 2\rCapacitorElm 1 3\rInductorElm 3 4\rResistorElm 4 2';
    static modelExternalNodes = [1, 2];

    parallelCapacitance = 28.7e-12;
    seriesCapacitance = 0.1e-12;
    inductance = 2.5e-3;
    resistance = 6.4;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.initModel(CrystalElm.modelString, CrystalElm.modelExternalNodes, tokens);
        if (Array.isArray(tokens) && tokens.length >= 4) {
            // Read the values back off the constructed children, exactly as
            // Java does, so a dumped crystal keeps its tuning.
            const [c1, c2, l1, r1] = this.compElmList as unknown as [
                { capacitance: number }, { capacitance: number },
                { inductance: number }, { resistance: number },
            ];
            if (c1) this.parallelCapacitance = c1.capacitance;
            if (c2) this.seriesCapacitance = c2.capacitance;
            if (l1) this.inductance = l1.inductance;
            if (r1) this.resistance = r1.resistance;
        }
        this.initCrystal();
    }

    private initCrystal(): void {
        const [c1, c2, l1, r1] = this.compElmList as unknown as [
            { capacitance: number }, { capacitance: number },
            { inductance: number }, { resistance: number },
        ];
        if (c1) c1.capacitance = this.parallelCapacitance;
        if (c2) c2.capacitance = this.seriesCapacitance;
        if (l1) l1.inductance = this.inductance;
        if (r1) r1.resistance = this.resistance;
    }

    getDumpType() { return 412; }
    // Series resonance of the motional arm.
    getSeriesResonance(): number {
        return 1 / (2 * Math.PI * Math.sqrt(this.inductance * this.seriesCapacitance));
    }
}

// ---------------------------------------------------- CustomComposite (410)

export interface ExtListEntry {
    name: string;
    node: number;
    pos: number;
    side: number;
}

// Ported from CustomCompositeModel.java. Models arrive on "." lines ahead of
// the 410 element lines that reference them, and are keyed by name in a
// module-level registry (Java uses a pair of static HashMaps; a single map is
// enough here since this port has no browser-local-storage model library).
export class CustomCompositeModel {
    name = '';
    flags = 0;
    sizeX = 0;
    sizeY = 0;
    extList: ExtListEntry[] = [];
    nodeList = '';   // \r-separated "<ClassName> <node>..." lines
    elmDump = '';    // space-separated escaped per-child state blobs
}

const compositeModelMap = new Map<string, CustomCompositeModel>();

export function getCompositeModel(name: string): CustomCompositeModel | undefined {
    return compositeModelMap.get(name);
}

// Parses a "." line's tokens (the leading "." already stripped):
//   name flags sizeX sizeY extCount (extName extNode extPos extSide)* nodeList elmDump
export function undumpCompositeModel(tokens: string[]): CustomCompositeModel {
    let i = 0;
    const model = new CustomCompositeModel();
    model.name = unescapeDumpText(tokens[i++]);
    model.flags = parseInt(tokens[i++], 10) || 0;
    model.sizeX = parseInt(tokens[i++], 10) || 0;
    model.sizeY = parseInt(tokens[i++], 10) || 0;
    const extCount = parseInt(tokens[i++], 10) || 0;
    model.extList = [];
    for (let j = 0; j !== extCount; j++) {
        const name = unescapeDumpText(tokens[i++]);
        const node = parseInt(tokens[i++], 10) || 0;
        const pos = parseInt(tokens[i++], 10) || 0;
        const side = parseInt(tokens[i++], 10) || 0;
        model.extList.push({ name, node, pos, side });
    }
    model.nodeList = unescapeDumpText(tokens[i++] ?? '');
    model.elmDump = unescapeDumpText(tokens[i++] ?? '');
    compositeModelMap.set(model.name, model);
    return model;
}

export function dumpCompositeModels(names?: Iterable<string>): string[] {
    const wanted = names ? Array.from(new Set(names)) : Array.from(compositeModelMap.keys());
    const lines: string[] = [];
    for (const name of wanted) {
        const m = compositeModelMap.get(name);
        if (!m) continue;
        const parts: (string | number)[] = ['.', escapeDumpText(m.name), m.flags, m.sizeX, m.sizeY, m.extList.length];
        for (const e of m.extList) parts.push(escapeDumpText(e.name), e.node, e.pos, e.side);
        parts.push(escapeDumpText(m.nodeList), escapeDumpText(m.elmDump));
        lines.push(parts.join(' '));
    }
    return lines;
}

// 410: an instance of a named subcircuit model.
export class CustomCompositeElm extends CompositeElm {
    modelName: string;
    model: CustomCompositeModel | undefined;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, tokens?: string[]) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
        // Java's dump is "<type> x y x2 y2 flags <modelName> <child blobs...>".
        const params = Array.isArray(tokens) ? tokens : [];
        this.modelName = params.length > 0 ? unescapeDumpText(params[0]) : 'default';
        const stateTokens = params.slice(1);

        this.model = compositeModelMap.get(this.modelName);
        if (!this.model) {
            throw new Error(
                `CustomCompositeElm: no subcircuit model named "${this.modelName}" has been defined ` +
                `(its "." line must be parsed first) -- refusing to construct so the line is preserved verbatim.`);
        }
        const externalNodes = this.model.extList.map(e => e.node);
        this.loadComposite(stateTokens.length > 0 ? stateTokens : null, this.model.nodeList, externalNodes);
        this.buildCompNodeList();
        this.allocNodes();
    }

    getDumpType() { return 410; }
    dumpTokens(): (string | number | boolean)[] {
        return [escapeDumpText(this.modelName), ...this.dumpElements()];
    }

    // Pins follow ChipElm's grid convention (the model stores each external
    // node's pos/side), so a subcircuit lines up with wires the same way a
    // chip does.
    static CSPC2 = 32;

    setPoints(): void {
        super.setPoints();
        if (!this.model) return;
        const cspc2 = CustomCompositeElm.CSPC2;
        const sizeX = this.model.sizeX || 2;
        const sizeY = this.model.sizeY || 2;
        this.posts = this.model.extList.map(e => {
            switch (e.side) {
                case 0: return { x: this.x + cspc2 * (1 + e.pos), y: this.y - cspc2 };            // N
                case 1: return { x: this.x + cspc2 * (1 + e.pos), y: this.y + sizeY * cspc2 };    // S
                case 3: return { x: this.x + cspc2 * (1 + sizeX), y: this.y + cspc2 * e.pos };    // E
                default: return { x: this.x, y: this.y + cspc2 * e.pos };                          // W
            }
        });
    }
}
