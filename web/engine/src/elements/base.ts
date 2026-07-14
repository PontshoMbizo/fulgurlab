export interface Point {
    x: number;
    y: number;
}
export function pointKey(p: Point): string {
    return `${p.x},${p.y}`;
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
}

// Forward declare for typing
import type { CircuitNode, VoltageSource, WireSegment } from '../core/node';

export abstract class CircuitElm {
    x = 0; y = 0; x2 = 0; y2 = 0; flags = 0;
    nodes: CircuitNode[] = [];
    volts: number[] = [];
    current = 0;

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
    setVoltageSource(j: number, vs: VoltageSource): void {}

    isWire(): boolean { return false; }
    isRemovableWire(): boolean { return false; }
    isGround(): boolean { return false; }
    isVoltageSource(): boolean { return false; }
    
    hasGroundConnection(n1: number): boolean { return false; }
    getConnection(n1: number, n2: number): boolean { return true; } // most elements connect their nodes
    getMatrixConnection(n1: number, n2: number): boolean { return this.getConnection(n1, n2); }
    getWireSegments(list: WireSegment[]): void {}
    getBusWidth(): number { return 1; }
    getConnectedPost(j: number): Point | null { return null; }
    getChildElmList(): CircuitElm[] | null { return null; }
    
    preStamp(): void {}
    validate(): boolean { return true; }
    setPoints(): void {}
    stamp(e: Stamper): void {}
    startIteration(): void {}
    doStep(e: Stamper): void {}
    stepFinished(): void {}
    reset(): void {}
    calculateCurrent(): void {}
}
