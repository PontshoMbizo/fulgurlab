import { CircuitElm, Stamper, Point } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from ChipElm.java — the abstract base every digital IC-style element
// in Falstad derives from (flip-flops, counters, latches, muxes, shift
// registers, adders, memories, ...). Before this file existed, the two
// ChipElm subclasses this port had (CustomLogicElm, SevenSegElm) were
// standalone reimplementations that each re-derived the pin-geometry formula
// by hand; everything added from here on shares this one implementation.
//
// The load-bearing part is the PIN GEOMETRY. Chip pins do NOT fan off the
// point1->point2 line the way a gate's or op-amp's do — they sit at fixed
// integer offsets from `x,y` alone, in multiples of cspc2, entirely
// independent of point2/rotation (ChipElm.setPoints() :181 + Pin.setPoint()
// :659). Exact pixel coincidence with neighbouring wire endpoints is what
// makes a Java-saved circuit connect at all in this port, since the loader
// merges nodes by exact coordinate match.
//
// Deliberate omissions (drawing-only in Java, no electrical effect): the
// rectPoints/label/bbox bookkeeping, the interactive drag()/getPinPos()
// handlers, and the clock/bubble marker point arrays.

export const SIDE_N = 0;
export const SIDE_S = 1;
export const SIDE_W = 2;
export const SIDE_E = 3;

const sideFlipXY = [SIDE_W, SIDE_E, SIDE_N, SIDE_S];

export const CHIP_FLAG_SMALL = 1;
export const CHIP_FLAG_FLIP_X = 1 << 10;
export const CHIP_FLAG_FLIP_Y = 1 << 11;
export const CHIP_FLAG_FLIP_XY = 1 << 12;
export const CHIP_FLAG_CUSTOM_VOLTAGE = 1 << 13;

export const BIT_ORDER_MSB_FIRST = 0;
export const BIT_ORDER_LSB_FIRST = 1;
export const BIT_ORDER_BUS = 2;

export class Pin {
    pos: number;
    side: number;
    side0: number;
    text: string;
    output = false;
    // `state` marks a pin whose value is persisted across a save/load round
    // trip — it is exactly the set of pins that contribute a volts[] token to
    // the dump line, so it must match Java pin-for-pin or every token after
    // the first mismatch is read into the wrong field.
    state = false;
    value = false;
    bubble = false;
    clock = false;
    lineOver = false;
    busWidth = 1;
    busZ = 0;
    current = 0;
    voltSource: VoltageSource | null = null;
    post: Point = { x: 0, y: 0 };
    stub: Point = { x: 0, y: 0 };

    constructor(pos: number, side: number, text: string) {
        this.pos = pos;
        this.side0 = this.side = side;
        this.text = text;
    }
}

export abstract class ChipElm extends CircuitElm {
    csize = 2;
    cspc = 16;
    cspc2 = 32;
    bits = 0;
    highVoltage = 5;
    bitOrder = BIT_ORDER_MSB_FIRST;
    sizeX = 0;
    sizeY = 0;
    flippedSizeX = 0;
    flippedSizeY = 0;
    pins: Pin[] = [];
    lastClock = false;

    // Cursor into the dump line's trailing tokens. initChip() consumes the
    // base-class fields (bits, highVoltage, per-pin state voltages) and leaves
    // this pointing at the first subclass-specific token — mirroring the way
    // Java's StringTokenizer is threaded through super() and then read further
    // by the subclass constructor.
    protected tokens: string[] = [];
    protected tokenIndex = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number) {
        super(x, y, x2, y2, flags);
        this.noDiagonal = true;
    }

    // MUST be called at the end of every concrete subclass constructor, in
    // place of Java's "super() calls setupPins()" pattern. TS/JS run subclass
    // field initializers *after* super() returns, so a setupPins() invoked
    // from the base constructor would read every subclass field back as
    // undefined and then have its results silently clobbered. Making the call
    // explicit and last is the only ordering that works.
    protected initChip(tokens: string[] | undefined): void {
        this.tokens = Array.isArray(tokens) ? tokens : [];
        this.tokenIndex = 0;

        if (this.needsBits()) {
            const t = this.tokens[this.tokenIndex];
            const n = t !== undefined ? parseInt(t, 10) : NaN;
            if (Number.isFinite(n)) {
                this.bits = n;
                this.tokenIndex++;
            } else {
                this.bits = this.defaultBitCount();
            }
        }
        this.highVoltage = this.hasCustomVoltage() ? this.nextNumber(5) : 5;

        this.setupPins();
        this.setSize((this.flags & CHIP_FLAG_SMALL) !== 0 ? 1 : 2);
        this.allocNodes();

        const n = this.getPostCount();
        for (let i = 0; i < n; i++) {
            const p = this.pins[i];
            if (!p || !p.state) continue;
            const v = this.nextNumber(NaN);
            if (!Number.isFinite(v)) break;
            this.volts[i] = v;
            p.value = v > this.getThreshold();
        }
        this.setPoints();
    }

    protected nextToken(): string | undefined {
        return this.tokens[this.tokenIndex++];
    }
    protected nextNumber(fallback: number): number {
        const t = this.tokens[this.tokenIndex];
        if (t === undefined) return fallback;
        const v = parseFloat(t);
        if (!Number.isFinite(v)) return fallback;
        this.tokenIndex++;
        return v;
    }
    protected nextInt(fallback: number): number {
        const t = this.tokens[this.tokenIndex];
        if (t === undefined) return fallback;
        const v = parseInt(t, 10);
        if (!Number.isFinite(v)) return fallback;
        this.tokenIndex++;
        return v;
    }
    protected nextBoolean(fallback: boolean): boolean {
        const t = this.tokens[this.tokenIndex];
        if (t === undefined) return fallback;
        if (t !== 'true' && t !== 'false') return fallback;
        this.tokenIndex++;
        return t === 'true';
    }

    abstract setupPins(): void;

    needsBits(): boolean { return false; }
    allowBus(): boolean { return false; }
    isDigitalChip(): boolean { return true; }
    defaultBitCount(): number { return 4; }
    getChipName(): string { return 'chip'; }
    hasCustomVoltage(): boolean { return (this.flags & CHIP_FLAG_CUSTOM_VOLTAGE) !== 0; }
    useBus(): boolean { return this.bitOrder === BIT_ORDER_BUS; }
    getThreshold(): number { return this.highVoltage / 2; }
    isFlippedX(): boolean { return (this.flags & CHIP_FLAG_FLIP_X) !== 0; }
    isFlippedY(): boolean { return (this.flags & CHIP_FLAG_FLIP_Y) !== 0; }
    isFlippedXY(): boolean { return (this.flags & CHIP_FLAG_FLIP_XY) !== 0; }

    setSize(s: number): void {
        this.csize = s;
        this.cspc = 8 * s;
        this.cspc2 = this.cspc * 2;
        this.flags &= ~CHIP_FLAG_SMALL;
        this.flags |= (s === 1) ? CHIP_FLAG_SMALL : 0;
    }

    // ChipElm.makeBitPins() (:610) — lays out a `count`-wide bit field of pins
    // honouring the three bit orders. `reversed` flips which end of the pins[]
    // slice bit 0 lands in; it is NOT the same knob as bitOrder.
    makeBitPins(count: number, pos: number, side: number, offset: number, name: string,
                output: boolean, state: boolean, reversed: boolean): void {
        for (let i = 0; i !== count; i++) {
            const ii = reversed ? offset + count - 1 - i : offset + i;
            let p: Pin;
            if (this.useBus()) {
                p = new Pin(pos, side, name);
                p.busWidth = count;
                p.busZ = i;
            } else if (this.bitOrder === BIT_ORDER_LSB_FIRST) {
                p = new Pin(pos + i, side, name + i);
            } else {
                p = new Pin(pos + (count - 1 - i), side, name + i);
            }
            p.output = output;
            p.state = state;
            this.pins[ii] = p;
        }
    }

    // ChipElm.setPoints() :181 + Pin.setPoint() :659, inlined. Every pin's
    // post is derived from `x,y` and its (pos, side) slot; point2 never enters
    // the calculation.
    setPoints(): void {
        super.setPoints();
        if (this.pins.length === 0) return;

        const cspc = this.cspc, cspc2 = this.cspc2;
        const x0 = this.x + cspc2;
        const y0 = this.y;
        this.flippedSizeX = this.sizeX;
        this.flippedSizeY = this.sizeY;
        if (this.isFlippedXY()) {
            this.flippedSizeX = this.sizeY;
            this.flippedSizeY = this.sizeX;
        }
        const xs = this.flippedSizeX * cspc2;
        const ys = this.flippedSizeY * cspc2;

        const n = this.getPostCount();
        for (let i = 0; i < n; i++) {
            const p = this.pins[i];
            if (!p) continue;
            p.side = p.side0;
            if ((this.flags & CHIP_FLAG_FLIP_XY) !== 0) p.side = sideFlipXY[p.side];
            switch (p.side) {
                case SIDE_N: this.setPinPoint(p, x0, y0, 1, 0, 0, -1, 0, 0); break;
                case SIDE_S: this.setPinPoint(p, x0, y0, 1, 0, 0, 1, 0, ys - cspc2); break;
                case SIDE_W: this.setPinPoint(p, x0, y0, 0, 1, -1, 0, 0, 0); break;
                case SIDE_E: this.setPinPoint(p, x0, y0, 0, 1, 1, 0, xs - cspc2, 0); break;
            }
        }
    }

    private setPinPoint(p: Pin, px: number, py: number, dx: number, dy: number,
                        dax: number, day: number, sx: number, sy: number): void {
        const cspc = this.cspc, cspc2 = this.cspc2;
        if (this.isFlippedX()) {
            dx = -dx; dax = -dax;
            px += cspc2 * (this.flippedSizeX - 1);
            sx = -sx;
        }
        if (this.isFlippedY()) {
            dy = -dy; day = -day;
            py += cspc2 * (this.flippedSizeY - 1);
            sy = -sy;
        }
        const xa = px + cspc2 * dx * p.pos + sx;
        const ya = py + cspc2 * dy * p.pos + sy;
        p.post = { x: xa + dax * cspc2, y: ya + day * cspc2 };
        const busExtra = p.busWidth > 1 ? 2 : 0;
        p.stub = { x: xa + dax * (cspc + busExtra), y: ya + day * (cspc + busExtra) };
    }

    getPost(n: number): Point | null {
        const p = this.pins[n];
        return p ? p.post : null;
    }

    // ChipElm.setVoltageSource() (:283): the j'th voltage source belongs to
    // the j'th *output* pin in pin order — not the j'th pin.
    setVoltageSource(j: number, vs: VoltageSource): void {
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && p.output && j-- === 0) {
                p.voltSource = vs;
                vs.setNodes(CircuitNode.ground, this.nodes[i]);
                return;
            }
        }
    }

    stamp(stamper: Stamper): void {
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && p.output && p.voltSource) {
                stamper.stampVoltageSource(CircuitNode.ground, this.nodes[i], p.voltSource);
            }
        }
    }

    doStep(stamper: Stamper): void {
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && !p.output) p.value = this.volts[i] > this.getThreshold();
        }
        this.execute();
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && p.output && p.voltSource) {
                stamper.updateVoltageSource(CircuitNode.ground, this.nodes[i], p.voltSource,
                    p.value ? this.highVoltage : 0);
            }
        }
    }

    execute(): void {}

    writeOutput(n: number, value: boolean): void {
        const p = this.pins[n];
        if (p) p.value = value;
    }

    reset(): void {
        for (let i = 0; i !== this.getPostCount(); i++) {
            if (this.pins[i]) this.pins[i].value = false;
            this.volts[i] = 0;
        }
        this.lastClock = false;
    }

    setCurrent(vs: VoltageSource, c: number): void {
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && p.output && p.voltSource === vs) p.current = c;
        }
    }

    getConnection(_n1: number, _n2: number): boolean { return false; }
    hasGroundConnection(n1: number): boolean {
        const p = this.pins[n1];
        return !!p && p.output;
    }
    getBusWidth(): number {
        const p = this.pins[0];
        return p ? p.busWidth : 1;
    }

    // Java sets/clears FLAG_CUSTOM_VOLTAGE inside dump() before serializing
    // flags, so it has to happen before the base dump() reads this.flags.
    dump(): string {
        if (this.highVoltage === 5) this.flags &= ~CHIP_FLAG_CUSTOM_VOLTAGE;
        else this.flags |= CHIP_FLAG_CUSTOM_VOLTAGE;
        return super.dump();
    }

    dumpTokens(): (string | number | boolean)[] {
        const out: (string | number | boolean)[] = [];
        if (this.needsBits()) out.push(this.bits);
        if (this.hasCustomVoltage()) out.push(this.highVoltage);
        for (let i = 0; i !== this.getPostCount(); i++) {
            const p = this.pins[i];
            if (p && p.state) out.push(this.volts[i] ?? 0);
        }
        return out;
    }

    getInfo(arr: (string | null)[]): void {
        arr[0] = this.getChipName();
    }
}
