export interface Stamper {
    stampResistor(n1: number, n2: number, r: number): void;
    stampConductance(n1: number, n2: number, g: number): void;
    stampVoltageSource(n1: number, n2: number, vsIndex: number, v?: number): void;
    stampCurrentSource(n1: number, n2: number, i: number): void;
    stampMatrix(n1: number, n2: number, val: number): void;
    stampRightSide(n: number, val: number): void;
}

export abstract class CircuitElm {
    x = 0; y = 0; x2 = 0; y2 = 0; flags = 0;
    nodes: number[] = []; 
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
    nonLinear(): boolean { return false; }
    setPoints(): void {}
    stamp(e: Stamper): void {}
    startIteration(): void {}
    doStep(e: Stamper): void {}
    stepFinished(): void {}
    reset(): void {}
    calculateCurrent(): void {}
}
