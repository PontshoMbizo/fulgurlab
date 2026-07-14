import { CircuitElm, Stamper, Point, interpPoint } from './base';

// Ported from PotElm.java. Three-terminal element: nodes[0]/nodes[1] are the
// track ends, nodes[2] is the wiper. Modelled as two resistors meeting at the
// wiper node, split by `position` (0..1) of `maxResistance`.
//
// SIMPLIFICATION: Java's setPoints() also grid-snaps point2 itself (rounding
// the body length to a multiple of 2*gridSize) before placing the wiper post,
// which is a UI/editing nicety that needs `app.gridSize` — not something the
// engine should reach for. The wiper offset direction below (+-gridSize,
// perpendicular to point1->point2, chosen by FLAG_FLIP_OFFSET) is the
// electrically load-bearing part and is ported; the point2 re-snap is not.
export class PotElm extends CircuitElm {
    static FLAG_SHOW_VALUES = 1;
    static FLAG_FLIP = 2;
    static FLAG_FLIP_OFFSET = 4;
    static GRID_SIZE = 16; // matches Falstad's default app.gridSize

    position = 0.5;
    maxResistance = 1000;
    resistance1 = 500;
    resistance2 = 500;
    current1 = 0;
    current2 = 0;
    current3 = 0;
    sliderText = "Resistance";
    post3: Point = { x: 0, y: 0 };

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.maxResistance = parseFloat(params[0]) || 1000;
            this.position = params.length > 1 ? parseFloat(params[1]) : 0.5;
            if (params.length > 2) {
                this.sliderText = params.slice(2).join(" ");
            }
        }
        this.flags = flags | PotElm.FLAG_SHOW_VALUES;
    }

    setPoints() {
        super.setPoints();
        const offset = (this.flags & PotElm.FLAG_FLIP_OFFSET) !== 0 ? -PotElm.GRID_SIZE : PotElm.GRID_SIZE;
        this.post3 = interpPoint(this.point1, this.point2, 0.5, offset);
    }

    getPost(n: number): Point | null {
        if (n === 0) return this.point1;
        if (n === 1) return this.point2;
        return this.post3;
    }

    getPostCount() { return 3; }
    getDumpType() { return '174'; }
    getXmlDumpType() { return "pt"; }

    calculateCurrent() {
        if (this.resistance1 === 0) return; // avoid NaN
        this.current1 = (this.volts[0] - this.volts[2]) / this.resistance1;
        this.current2 = (this.volts[1] - this.volts[2]) / this.resistance2;
        this.current3 = -this.current1 - this.current2;
        this.current = this.current1; // for UI compat
    }

    getCurrentIntoNode(n: number) {
        if (n === 0) return -this.current1;
        if (n === 1) return -this.current2;
        return -this.current3;
    }

    stamp(stamper: Stamper) {
        this.resistance1 = this.maxResistance * this.position;
        this.resistance2 = this.maxResistance * (1 - this.position);
        stamper.stampResistor(this.nodes[0], this.nodes[2], this.resistance1);
        stamper.stampResistor(this.nodes[2], this.nodes[1], this.resistance2);
    }
}
