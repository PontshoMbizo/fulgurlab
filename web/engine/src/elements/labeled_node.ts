import { CircuitElm, Stamper, Point, escapeDumpText, unescapeDumpText } from './base';
import type { CircuitNode } from '../core/node';

// Ported from LabeledNodeElm.java. Acts like a wire: every LabeledNodeElm
// sharing the same `text` anywhere in the circuit is tied to the same node,
// without needing to actually be wired together on the canvas. Implemented
// via a static text->post registry, exactly like Java's static `labelList`,
// reset once per analysis (see Analyzer.calculateWireClosure(), which calls
// LabeledNodeElm.resetNodeList() before doing the actual closure walk,
// matching SimulationManager.calculateWireClosure()'s exact call order).
//
// SIMPLIFICATION: busWidth is ported (getPostCount()/getPost() scale with
// it) but nothing in this engine yet constructs a multi-bit bus, so it's
// only exercised at busWidth==1 in practice.
class LabelEntry {
    point: Point;
    node: number = -1;
    constructor(point: Point) { this.point = point; }
}

export class LabeledNodeElm extends CircuitElm {
    static FLAG_INTERNAL = 1;
    static FLAG_ESCAPE = 4;
    static FLAG_ROTATE_TEXT = 8;

    text = "label";
    busWidth = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.text = unescapeDumpText(params[0]);
        }
    }

    static labelList: Map<string, LabelEntry> = new Map();
    static resetNodeList() {
        LabeledNodeElm.labelList = new Map();
    }
    static getByName(name: string): number | null {
        const le = LabeledNodeElm.labelList.get(name);
        return le ? le.node : null;
    }

    isInternal() { return (this.flags & LabeledNodeElm.FLAG_INTERNAL) !== 0; }

    getDumpType() { return 207; }
    dumpTokens() { return [escapeDumpText(this.text)]; }
    getPostCount() { return this.busWidth; }
    getBusWidth() { return this.busWidth; }

    getPost(n: number): Point | null {
        if (this.busWidth === 1) return this.point1;
        return this.point1; // bus sub-addressing not modelled; see file note.
    }

    // See file note: first occurrence of a label registers its post and
    // returns null (nothing to connect to yet); every later element sharing
    // the same text returns that first post, which is what actually ties
    // them into one shared node via Analyzer.calculateWireClosure()'s
    // NodeMapEntry merge.
    getConnectedPost(n: number): Point | null {
        const key = this.busWidth > 1 ? `${this.text}:${n}` : this.text;
        const myPost = this.getPost(n);
        if (!myPost) return null;
        const le = LabeledNodeElm.labelList.get(key);
        if (le) return le.point;
        LabeledNodeElm.labelList.set(key, new LabelEntry(myPost));
        return null;
    }

    setNode(p: number, cn: CircuitNode): void {
        super.setNode(p, cn);
        const key = this.busWidth > 1 ? `${this.text}:${p}` : this.text;
        const le = LabeledNodeElm.labelList.get(key);
        if (le) le.node = cn.index;
    }

    isWireEquivalent() { return true; }
    isRemovableWire() { return true; }
    getConnection(n1: number, n2: number): boolean { return n1 === n2; }

    getVoltageDiff() { return this.volts[0]; }
    getCurrentIntoNode(n: number) { return -this.current; }
}
