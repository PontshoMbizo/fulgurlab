import { CircuitElm, Point, pointKey } from '../elements/base';
// Value imports of concrete elements from the generic Analyzer are unusual
// but match Java exactly: SimulationManager.calculateWireClosure() calls
// LabeledNodeElm.resetNodeList() and GroundElm.resetNodeList() directly,
// by name, right at its own top. No runtime import cycle results (neither
// module imports anything as a *value* back from this one).
import { LabeledNodeElm } from '../elements/labeled_node';
import { GroundElm } from '../elements/ground';

export class CircuitNodeLink {
    num: number;
    elm: CircuitElm;
    constructor(num: number, elm: CircuitElm) {
        this.num = num;
        this.elm = elm;
    }
}

export class CircuitNode {
    static ground = new CircuitNode();
    
    links: CircuitNodeLink[] = [];
    internal: boolean = false;
    index: number = -1;
    matrix: CircuitMatrix | null = null;
    row: number = 0; // row in matrix (0 = ground/excluded)
}
CircuitNode.ground.index = 0;

export class VoltageSource {
    index: number = 0;
    elm: CircuitElm | null = null;
    matrix: CircuitMatrix | null = null;
    row: number = 0;
    n1: CircuitNode | null = null;
    n2: CircuitNode | null = null;

    setNodes(n1: CircuitNode, n2: CircuitNode) {
        this.n1 = n1;
        this.n2 = n2;
    }

    assignMatrix() {
        if (this.n1 !== null && this.n1 !== CircuitNode.ground && this.n1.matrix !== null) {
            this.matrix = this.n1.matrix;
        } else if (this.n2 !== null && this.n2 !== CircuitNode.ground && this.n2.matrix !== null) {
            this.matrix = this.n2.matrix;
        } else if (this.elm !== null) {
            const lastNode = this.elm.getNode(this.elm.getPostCount() - 1);
            if (lastNode) {
                this.matrix = lastNode.matrix;
            }
        }
    }
}

export class CircuitMatrix {
    matrix: number[][] = [];
    rightSide: Float64Array = new Float64Array(0);
    origRightSide: Float64Array = new Float64Array(0);
    origMatrix: number[][] = [];
    permute: Int32Array = new Int32Array(0);
    size: number = 0;
    nodeCount: number = 0;
    nonLinear: boolean = false;
    nodeVoltages: Float64Array = new Float64Array(0);
    lastNodeVoltages: Float64Array = new Float64Array(0);
    nodeList: CircuitNode[] = [];
    voltageSourceList: VoltageSource[] = [];
}

export class NodeMapEntry {
    node: CircuitNode | null = null;
    constructor(node?: CircuitNode) {
        this.node = node || null;
    }
}

export class WireSegment {
    wire: CircuitElm;
    bit: number;
    post: number = 0;
    endpoint0: string | null = null;
    endpoint1: string | null = null;
    neighbors: CircuitElm[] = [];
    labelNeighbors: WireSegment[] = [];

    constructor(wire: CircuitElm, bit: number, ep0: string | null, ep1: string | null) {
        this.wire = wire;
        this.bit = bit;
        this.endpoint0 = ep0;
        this.endpoint1 = ep1;
    }
}

export interface AnalysisResult {
    nodeList: CircuitNode[];
    matrices: CircuitMatrix[];
    voltageSources: VoltageSource[];
    nodesWithGroundConnectionCount: number;
    circuitNonLinear: boolean;
    elmList: CircuitElm[];
    unconnectedNodes: number[];
}

export class Analyzer {
    elmList: CircuitElm[];
    nodeList: CircuitNode[] = [];
    nodeMap: Map<string, NodeMapEntry> = new Map();
    voltageSources: VoltageSource[] = [];
    matrices: CircuitMatrix[] = [];
    unconnectedNodes: number[] = [];
    nodesWithGroundConnection: CircuitElm[] = [];
    circuitNonLinear: boolean = false;
    
    // Wire resolution
    wireInfoList: WireSegment[] = [];
    wireInfoElmSet: Set<CircuitElm> = new Set();
    wireInfoResolved: Map<CircuitElm, Set<number>> = new Map();

    constructor(elmList: CircuitElm[]) {
        this.elmList = [...elmList];
    }

    analyze(): AnalysisResult {
        // Expand child elements
        const expanded: CircuitElm[] = [];
        for (const elm of this.elmList) {
            expanded.push(elm);
            const childList = elm.getChildElmList();
            if (childList) {
                this.addChildElms(childList, expanded);
            }
        }
        this.elmList = expanded;

        // Must run before calculateWireClosure(): setPoints() resolves
        // point1/point2 (and any multi-post fields like a wire's endpoints or
        // an op-amp's input posts) from the raw x/y/x2/y2 coordinates. In real
        // Falstad, setPoints() runs at placement/move time in the UI, so by
        // the time analysis runs, geometry is already resolved. This port has
        // no interactive placement step yet, so preStamp() (setPoints() +
        // allocNodes()) is called here, reactively, for every element before
        // any analysis step reads post coordinates — including wire closure,
        // which was silently reading point1/point2 as their uninitialized
        // {x:0,y:0} defaults before this was moved here (verified: caused
        // WireElm.getConnectedPost() to report the wrong endpoint, which
        // collapsed a feedback wire's two nodes onto the wrong pair and left
        // one node with no stamps at all -- an all-zero row / singular matrix).
        for (const ce of this.elmList) {
            ce.preStamp();
        }

        this.calculateWireClosure();
        this.setGroundNode();
        this.makeNodeList();

        // Calculate wire info for currents
        this.calcWireInfo();

        let vscount = 0;
        this.circuitNonLinear = false;

        for (const ce of this.elmList) {
            if (ce.nonLinear()) {
                this.circuitNonLinear = true;
            }
            const ivs = ce.getVoltageSourceCount();
            for (let j = 0; j < ivs; j++) {
                const vs = new VoltageSource();
                vs.index = vscount;
                vs.elm = ce;
                this.voltageSources.push(vs);
                ce.setVoltageSource(j, vs);
                vscount++;
            }
        }

        this.findUnconnectedNodes();
        this.calculateClosures();

        // Validate
        for (const ce of this.elmList) {
            if (!ce.validate()) {
                throw new Error(`Validation failed for element`);
            }
        }

        // Assign matrices to voltage sources
        const vsPerMatrix: number[] = new Array(this.matrices.length).fill(0);
        for (const vs of this.voltageSources) {
            vs.assignMatrix();
        }

        for (const vs of this.voltageSources) {
            const m = vs.matrix;
            if (m) {
                const mi = this.matrices.indexOf(m);
                vsPerMatrix[mi]++;
                vs.row = m.nodeCount + vsPerMatrix[mi];
                m.voltageSourceList.push(vs);
            }
        }

        for (let i = 0; i < this.matrices.length; i++) {
            this.matrices[i].size = this.matrices[i].nodeCount + vsPerMatrix[i];
        }

        return {
            nodeList: this.nodeList,
            matrices: this.matrices,
            voltageSources: this.voltageSources,
            nodesWithGroundConnectionCount: this.nodesWithGroundConnection.length,
            circuitNonLinear: this.circuitNonLinear,
            elmList: this.elmList,
            unconnectedNodes: this.unconnectedNodes
        };
    }

    private addChildElms(list: CircuitElm[], target: CircuitElm[]) {
        for (const ce of list) {
            const childList = ce.getChildElmList();
            if (childList) {
                this.addChildElms(childList, target);
                continue;
            }
            target.push(ce);
            const nodeCount = ce.getNodeCount();
            for (let i = 0; i < nodeCount; i++) {
                const cn = ce.getNode(i);
                if (cn) {
                    cn.links.push(new CircuitNodeLink(i, ce));
                    cn.internal = false;
                    if (cn.index === 0) {
                        ce.setNodeVoltage(i, 0);
                    }
                }
            }
        }
    }

    private calculateWireClosure() {
        // Matches SimulationManager.calculateWireClosure()'s exact top-of-
        // method call order: these two static registries must be reset once
        // per analysis, before the closure walk below reads/writes them via
        // GroundElm/LabeledNodeElm's getConnectedPost() overrides.
        LabeledNodeElm.resetNodeList();
        GroundElm.resetNodeList();

        this.nodeMap.clear();
        this.wireInfoList = [];
        this.wireInfoElmSet = new Set(this.elmList);

        for (const ce of this.elmList) {
            if (!ce.isRemovableWire()) continue;
            ce.getWireSegments(this.wireInfoList);

            const bw = ce.getBusWidth();
            for (let j = 0; j < bw; j++) {
                const p0 = ce.getPost(j);
                if (!p0) continue;
                const p0Key = pointKey(p0);
                let cn = this.nodeMap.get(p0Key);

                const p1 = ce.getConnectedPost(j);
                if (!p1) {
                    if (!cn) {
                        cn = new NodeMapEntry();
                        this.nodeMap.set(p0Key, cn);
                    }
                    continue;
                }

                const p1Key = pointKey(p1);
                const cn2 = this.nodeMap.get(p1Key);

                if (cn && cn2) {
                    // Merge nodes
                    for (const [key, value] of this.nodeMap.entries()) {
                        if (value === cn2) {
                            this.nodeMap.set(key, cn);
                        }
                    }
                } else if (cn) {
                    this.nodeMap.set(p1Key, cn);
                } else if (cn2) {
                    this.nodeMap.set(p0Key, cn2);
                } else {
                    cn = new NodeMapEntry();
                    this.nodeMap.set(p0Key, cn);
                    this.nodeMap.set(p1Key, cn);
                }
            }
        }
    }

    private setGroundNode() {
        let gotGround = false;
        let gotRail = false;
        let volt: CircuitElm | null = null;

        CircuitNode.ground = new CircuitNode();
        CircuitNode.ground.index = 0;
        this.nodeList.push(CircuitNode.ground);

        for (const ce of this.elmList) {
            if (ce.isGround()) {
                gotGround = true;
                const pt = ce.getPost(0);
                if (pt) {
                    const cln = this.nodeMap.get(pointKey(pt));
                    if (cln) cln.node = CircuitNode.ground;
                    else this.nodeMap.set(pointKey(pt), new NodeMapEntry(CircuitNode.ground));
                }
            }
            if (ce.isRail()) {
                gotRail = true;
            }
            if (!volt && ce.isVoltageSource()) {
                volt = ce;
            }
        }

        // Java: `if (!subcircuit && !gotGround && volt != null && !gotRail)`
        // (SimulationManager.setGroundNode(), :509) -- the fallback must NOT
        // fire when a rail is present, even with no explicit ground element.
        // Missing this `!gotRail` check was a real bug found this session: a
        // circuit with only a RailElm (no GroundElm) had the fallback alias
        // the rail's OWN node onto CircuitNode.ground -- which is deliberately
        // left with matrix=null -- crashing the solver. (subcircuit handling
        // doesn't exist in this engine yet, so that part of the condition
        // is omitted.)
        if (!gotGround && !gotRail && volt) {
            const pt = volt.getPost(0);
            if (pt) {
                const cln = this.nodeMap.get(pointKey(pt));
                if (cln) cln.node = CircuitNode.ground;
                else this.nodeMap.set(pointKey(pt), new NodeMapEntry(CircuitNode.ground));
            }
        }
    }

    private makeNodeList() {
        // preStamp() now runs earlier, in analyze(), before calculateWireClosure().
        for (const ce of this.elmList) {
            const inodes = ce.getInternalNodeCount();
            const posts = ce.getPostCount();

            for (let j = 0; j < posts; j++) {
                const pt = ce.getPost(j);
                if (!pt) continue;
                const ptKey = pointKey(pt);
                let cln = this.nodeMap.get(ptKey);

                if (!cln || !cln.node) {
                    const cn = new CircuitNode();
                    cn.index = this.nodeList.length;
                    cn.links.push(new CircuitNodeLink(j, ce));
                    ce.setNode(j, cn);

                    if (cln) {
                        cln.node = cn;
                    } else {
                        this.nodeMap.set(ptKey, new NodeMapEntry(cn));
                    }
                    this.nodeList.push(cn);
                } else {
                    const cn = cln.node;
                    cn.links.push(new CircuitNodeLink(j, ce));
                    ce.setNode(j, cn);
                    if (cn === CircuitNode.ground) {
                        ce.setNodeVoltage(j, 0);
                    }
                }
            }

            for (let j = 0; j < inodes; j++) {
                const cn = new CircuitNode();
                cn.index = this.nodeList.length;
                cn.internal = true;
                cn.links.push(new CircuitNodeLink(j + posts, ce));
                ce.setNode(j + posts, cn);
                this.nodeList.push(cn);
            }
        }
    }

    private calcWireInfo() {
        this.wireInfoResolved.clear();
        let moved = 0;

        for (let i = 0; i < this.wireInfoList.length; i++) {
            const ws = this.wireInfoList[i];
            const wire = ws.wire;
            const cn1 = wire.getNode(ws.bit);
            if (!cn1) continue;

            const neighbors0: CircuitElm[] = [];
            const neighbors1: CircuitElm[] = [];
            let isReady0 = true;
            let isReady1 = !wire.isGround();

            for (const cnl of cn1.links) {
                const ce = cnl.elm;
                if (ce === wire) continue;
                if (!this.wireInfoElmSet.has(ce)) continue;
                if (cnl.num >= ce.getPostCount()) continue;

                const pt = ce.getPost(cnl.num);
                if (!pt) continue;
                const ptKey = pointKey(pt);
                const neighborBit = cnl.num % ce.getBusWidth();
                const notReady = (ce.isRemovableWire() && !this.isWireInfoResolved(ce, neighborBit));

                if (ws.endpoint0 === ptKey) {
                    neighbors0.push(ce);
                    if (notReady) isReady0 = false;
                } else if (ws.endpoint1 === ptKey) {
                    neighbors1.push(ce);
                    if (notReady) isReady1 = false;
                }
            }

            if (isReady0) {
                ws.neighbors = neighbors0;
                ws.post = 0;
                this.setWireInfoResolved(wire, ws.bit);
                moved = 0;
            } else if (isReady1 && (ws.endpoint1 || !wire.isGround())) {
                ws.neighbors = neighbors1;
                ws.post = 1;
                this.setWireInfoResolved(wire, ws.bit);
                moved = 0;
            } else {
                this.wireInfoList.push(this.wireInfoList.splice(i--, 1)[0]);
                moved++;
                if (moved > this.wireInfoList.length * 2) {
                    throw new Error("Wire loop detected");
                }
            }
        }
    }

    private isWireInfoResolved(ce: CircuitElm, bit: number): boolean {
        const bits = this.wireInfoResolved.get(ce);
        return bits !== undefined && bits.has(bit);
    }

    private setWireInfoResolved(ce: CircuitElm, bit: number) {
        let bits = this.wireInfoResolved.get(ce);
        if (!bits) {
            bits = new Set();
            this.wireInfoResolved.set(ce, bits);
        }
        bits.add(bit);
    }

    private findUnconnectedNodes() {
        const closure = new Array(this.nodeList.length).fill(false);
        let changed = true;
        this.unconnectedNodes = [];
        this.nodesWithGroundConnection = [];
        closure[0] = true;

        while (changed) {
            changed = false;
            for (const ce of this.elmList) {
                if (ce.isWire()) continue;

                let hasGround = false;
                for (let j = 0; j < ce.getPostCount(); j++) {
                    const hg = ce.hasGroundConnection(j);
                    if (hg) hasGround = true;

                    const node = ce.getNode(j);
                    if (!node) continue;
                    const jn = node.index;

                    if (!closure[jn]) {
                        if (hg) {
                            closure[jn] = true;
                            changed = true;
                        }
                        continue;
                    }

                    for (let k = 0; k < ce.getPostCount(); k++) {
                        if (j === k) continue;
                        const nodeK = ce.getNode(k);
                        if (!nodeK) continue;
                        const kn = nodeK.index;

                        if (ce.getConnection(j, k) && !closure[kn]) {
                            closure[kn] = true;
                            changed = true;
                        }
                    }
                }
                if (hasGround && this.nodesWithGroundConnection.indexOf(ce) === -1) {
                    this.nodesWithGroundConnection.push(ce);
                }
            }
            if (changed) continue;

            for (let i = 0; i < this.nodeList.length; i++) {
                if (!closure[i] && !this.nodeList[i].internal) {
                    this.unconnectedNodes.push(i);
                    closure[i] = true;
                    changed = true;
                    break;
                }
            }
        }
    }

    private calculateClosures() {
        const totalNodes = this.nodeList.length;
        const closureIndex = new Array(totalNodes).fill(-1);

        let closureCount = 0;
        for (let i = 1; i < totalNodes; i++) {
            if (closureIndex[i] >= 0) continue;

            const stack: number[] = [i];
            closureIndex[i] = closureCount;

            while (stack.length > 0) {
                const n = stack.pop()!;
                const cn = this.nodeList[n];

                for (const cnl of cn.links) {
                    const ce = cnl.elm;
                    const post1 = cnl.num;
                    for (let k = 0; k < ce.getNodeCount(); k++) {
                        if (k === post1) continue;
                        if (!ce.getMatrixConnection(post1, k)) continue;

                        const nodeK = ce.getNode(k);
                        if (!nodeK) continue;
                        const kn = nodeK.index;

                        if (kn === 0) continue;
                        if (closureIndex[kn] < 0) {
                            closureIndex[kn] = closureCount;
                            stack.push(kn);
                        }
                    }
                }
            }
            closureCount++;
        }

        if (closureCount === 0) closureCount = 1;
        this.matrices = Array.from({ length: closureCount }, () => new CircuitMatrix());

        for (let i = 1; i < totalNodes; i++) {
            const ci = closureIndex[i];
            if (ci < 0) continue;
            const cn = this.nodeList[i];
            const m = this.matrices[ci];
            m.nodeCount++;
            cn.row = m.nodeCount; // 1-based
            cn.matrix = m;
            m.nodeList.push(cn);
        }

        CircuitNode.ground.row = 0;
        CircuitNode.ground.matrix = null;
    }
}
