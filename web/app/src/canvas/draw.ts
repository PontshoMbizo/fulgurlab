import type { CircuitElm, Point } from "@fulgurlab/engine";

export const GRID_SIZE = 16;

export function snap(v: number): number {
    return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

// Simplified stand-in for Java's CircuitElm.setVoltageColor() gradient
// (blue -> gray -> red), clamped to a fixed +-20V full scale rather than
// porting the exact HSB curve -- good enough to make current flow direction
// and rough magnitude readable at a glance.
export function voltageColor(v: number): string {
    const scale = 20;
    const t = Math.max(-1, Math.min(1, v / scale));
    if (t >= 0) {
        const g = Math.round(210 * (1 - t));
        return `rgb(255, ${g}, ${g})`;
    }
    const g = Math.round(210 * (1 + t));
    return `rgb(${g}, ${g}, 255)`;
}

function lerp(a: Point, b: Point, f: number): Point {
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

interface DrawCtx {
    ctx: CanvasRenderingContext2D;
    selected: boolean;
    hovered: boolean;
}

function strokeColorFor(d: DrawCtx, base: string) {
    if (d.selected) return "#22d3ee";
    if (d.hovered) return "#a78bfa";
    return base;
}

function drawPosts(d: DrawCtx, elm: CircuitElm) {
    const n = elm.getPostCount();
    d.ctx.fillStyle = "#888";
    for (let i = 0; i < n; i++) {
        const p = elm.getPost(i);
        if (!p) continue;
        d.ctx.beginPath();
        d.ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        d.ctx.fill();
    }
}

function line(d: DrawCtx, a: Point, b: Point, color: string, width = 2) {
    d.ctx.strokeStyle = color;
    d.ctx.lineWidth = width;
    d.ctx.beginPath();
    d.ctx.moveTo(a.x, a.y);
    d.ctx.lineTo(b.x, b.y);
    d.ctx.stroke();
}

function label(d: DrawCtx, text: string, at: Point, color = "#ddd") {
    d.ctx.fillStyle = color;
    d.ctx.font = "10px monospace";
    d.ctx.textAlign = "center";
    d.ctx.textBaseline = "middle";
    d.ctx.fillText(text, at.x, at.y);
}

// Two-terminal elements: plain leads from each post to a body of `bodyLen`
// centered on the point1-point2 line, then a caller-supplied body drawer.
// Mirrors Java's own pattern of calling calcLeads() at draw time (only the
// six multi-post elements compute leads in setPoints(); everything else
// computes them lazily here, same as e.g. ProbeElm.java's draw()).
function twoTerminal(
    d: DrawCtx, elm: CircuitElm, bodyLen: number, vColor: string,
    drawBody: (lead1: Point, lead2: Point) => void,
) {
    elm.calcLeads(bodyLen);
    line(d, elm.point1, elm.lead1, vColor);
    line(d, elm.lead2, elm.point2, vColor);
    drawBody(elm.lead1, elm.lead2);
    drawPosts(d, elm);
}

function drawResistor(d: DrawCtx, elm: CircuitElm) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 32, vColor, (l1, l2) => {
        const segs = 8;
        d.ctx.strokeStyle = strokeColorFor(d, vColor);
        d.ctx.lineWidth = 2;
        d.ctx.beginPath();
        for (let i = 0; i <= segs; i++) {
            const f = i / segs;
            const base = lerp(l1, l2, f);
            const zig = (i === 0 || i === segs) ? 0 : (i % 2 === 1 ? 6 : -6);
            const px = base.x + elm.dpx1 * zig;
            const py = base.y + elm.dpy1 * zig;
            if (i === 0) d.ctx.moveTo(px, py); else d.ctx.lineTo(px, py);
        }
        d.ctx.stroke();
    });
}

function drawCapacitor(d: DrawCtx, elm: CircuitElm) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 12, vColor, (l1, l2) => {
        d.ctx.strokeStyle = strokeColorFor(d, vColor);
        d.ctx.lineWidth = 3;
        for (const p of [l1, l2]) {
            d.ctx.beginPath();
            d.ctx.moveTo(p.x + elm.dpx1 * 10, p.y + elm.dpy1 * 10);
            d.ctx.lineTo(p.x - elm.dpx1 * 10, p.y - elm.dpy1 * 10);
            d.ctx.stroke();
        }
    });
}

function drawInductor(d: DrawCtx, elm: CircuitElm) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 36, vColor, (l1, l2) => {
        const loops = 4;
        const r = Math.hypot(l2.x - l1.x, l2.y - l1.y) / (loops * 2);
        d.ctx.strokeStyle = strokeColorFor(d, vColor);
        d.ctx.lineWidth = 2;
        for (let i = 0; i < loops; i++) {
            const c = lerp(l1, l2, (i + 0.5) / loops);
            const angle = Math.atan2(l2.y - l1.y, l2.x - l1.x);
            d.ctx.beginPath();
            d.ctx.arc(c.x, c.y, r, angle + Math.PI, angle, false);
            d.ctx.stroke();
        }
    });
}

function drawDiodeLike(d: DrawCtx, elm: CircuitElm, fillCathode: string) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 16, vColor, (l1, l2) => {
        const perp1 = { x: l1.x + elm.dpx1 * 8, y: l1.y + elm.dpy1 * 8 };
        const perp2 = { x: l1.x - elm.dpx1 * 8, y: l1.y - elm.dpy1 * 8 };
        d.ctx.fillStyle = strokeColorFor(d, vColor);
        d.ctx.beginPath();
        d.ctx.moveTo(perp1.x, perp1.y);
        d.ctx.lineTo(perp2.x, perp2.y);
        d.ctx.lineTo(l2.x, l2.y);
        d.ctx.closePath();
        d.ctx.fill();
        d.ctx.strokeStyle = fillCathode;
        d.ctx.lineWidth = 3;
        d.ctx.beginPath();
        d.ctx.moveTo(l2.x + elm.dpx1 * 8, l2.y + elm.dpy1 * 8);
        d.ctx.lineTo(l2.x - elm.dpx1 * 8, l2.y - elm.dpy1 * 8);
        d.ctx.stroke();
    });
}

function drawBattery(d: DrawCtx, elm: CircuitElm, text: string) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 12, vColor, (l1, l2) => {
        d.ctx.strokeStyle = strokeColorFor(d, vColor);
        d.ctx.lineWidth = 3;
        d.ctx.beginPath();
        d.ctx.moveTo(l1.x + elm.dpx1 * 10, l1.y + elm.dpy1 * 10);
        d.ctx.lineTo(l1.x - elm.dpx1 * 10, l1.y - elm.dpy1 * 10);
        d.ctx.stroke();
        d.ctx.lineWidth = 1.5;
        d.ctx.beginPath();
        d.ctx.moveTo(l2.x + elm.dpx1 * 6, l2.y + elm.dpy1 * 6);
        d.ctx.lineTo(l2.x - elm.dpx1 * 6, l2.y - elm.dpy1 * 6);
        d.ctx.stroke();
    });
    label(d, text, { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 - 12 });
}

function drawOnePost(d: DrawCtx, elm: CircuitElm, text: string, color = "#9ca3af") {
    const p = elm.getPost(0) ?? elm.point1;
    d.ctx.strokeStyle = strokeColorFor(d, color);
    d.ctx.lineWidth = 2;
    d.ctx.beginPath();
    d.ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
    d.ctx.stroke();
    label(d, text, p, color);
    drawPosts(d, elm);
}

function drawSwitchLike(d: DrawCtx, elm: CircuitElm, closed: boolean) {
    const vColor = voltageColor(elm.getVoltageDiff());
    twoTerminal(d, elm, 24, vColor, (l1, l2) => {
        if (closed) {
            line(d, l1, l2, strokeColorFor(d, vColor), 2);
        } else {
            d.ctx.strokeStyle = strokeColorFor(d, vColor);
            d.ctx.lineWidth = 2;
            d.ctx.beginPath();
            d.ctx.moveTo(l1.x, l1.y);
            d.ctx.lineTo(l2.x + (l1.x - l2.x) * 0.15, l2.y + (l1.y - l2.y) * 0.15 - 8);
            d.ctx.stroke();
        }
    });
}

function drawGate(d: DrawCtx, elm: CircuitElm, text: string) {
    const n = elm.getPostCount();
    const out = elm.getPost(n - 1) ?? elm.point2;
    const inputs: Point[] = [];
    for (let i = 0; i < n - 1; i++) {
        const p = elm.getPost(i);
        if (p) inputs.push(p);
    }
    const cx = (inputs.reduce((s, p) => s + p.x, 0) / Math.max(1, inputs.length) + out.x) / 2;
    const cy = (inputs.reduce((s, p) => s + p.y, 0) / Math.max(1, inputs.length) + out.y) / 2;
    const w = 26, h = Math.max(20, (inputs.length - 1) * 12 + 16);
    d.ctx.strokeStyle = strokeColorFor(d, "#e5e7eb");
    d.ctx.lineWidth = 2;
    d.ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    label(d, text, { x: cx, y: cy });
    for (const p of inputs) line(d, p, { x: cx - w / 2, y: p.y }, "#6b7280");
    line(d, { x: cx + w / 2, y: cy }, out, voltageColor(elm.volts[n - 1] ?? 0));
    drawPosts(d, elm);
}

function drawOpAmp(d: DrawCtx, elm: CircuitElm) {
    const vPlus = elm.getPost(0)!, vMinus = elm.getPost(1)!, out = elm.getPost(2)!;
    d.ctx.strokeStyle = strokeColorFor(d, "#e5e7eb");
    d.ctx.lineWidth = 2;
    d.ctx.beginPath();
    d.ctx.moveTo(vPlus.x, vPlus.y);
    d.ctx.lineTo(vMinus.x, vMinus.y);
    d.ctx.lineTo(elm.point2.x, elm.point2.y);
    d.ctx.closePath();
    d.ctx.stroke();
    label(d, "+", { x: vPlus.x + 8, y: vPlus.y });
    label(d, "-", { x: vMinus.x + 8, y: vMinus.y });
    line(d, elm.point2, out, voltageColor(elm.volts[2] ?? 0));
    drawPosts(d, elm);
}

function drawTransistorLike(d: DrawCtx, elm: CircuitElm, labels: [string, string, string]) {
    const n = elm.getPostCount();
    d.ctx.strokeStyle = strokeColorFor(d, "#e5e7eb");
    d.ctx.lineWidth = 2;
    d.ctx.beginPath();
    d.ctx.arc(elm.point1.x, elm.point1.y, 11, 0, Math.PI * 2);
    d.ctx.stroke();
    for (let i = 0; i < Math.min(n, 3); i++) {
        const p = elm.getPost(i);
        if (p) label(d, labels[i], p);
    }
    drawPosts(d, elm);
}

function drawText(d: DrawCtx, elm: CircuitElm) {
    const size = (elm as unknown as { size?: number }).size ?? 16;
    const text = (elm as unknown as { text?: string }).text ?? "";
    d.ctx.fillStyle = d.selected ? "#22d3ee" : "#e5e7eb";
    d.ctx.font = `${Math.min(size, 24)}px sans-serif`;
    d.ctx.textAlign = "left";
    d.ctx.textBaseline = "top";
    d.ctx.fillText(text, elm.point1.x, elm.point1.y);
}

function drawBox(d: DrawCtx, elm: CircuitElm) {
    d.ctx.strokeStyle = strokeColorFor(d, "#6b7280");
    d.ctx.lineWidth = 1.5;
    d.ctx.setLineDash([6, 4]);
    const x = Math.min(elm.point1.x, elm.point2.x), y = Math.min(elm.point1.y, elm.point2.y);
    d.ctx.strokeRect(x, y, Math.abs(elm.point2.x - elm.point1.x), Math.abs(elm.point2.y - elm.point1.y));
    d.ctx.setLineDash([]);
}

function drawGround(d: DrawCtx, elm: CircuitElm) {
    const p = elm.getPost(0) ?? elm.point1;
    line(d, elm.point1, elm.point2, strokeColorFor(d, "#9ca3af"));
    for (let i = 0; i < 3; i++) {
        const w = 10 - i * 3;
        const yy = p.y + 6 + i * 4;
        line(d, { x: p.x - w, y: yy }, { x: p.x + w, y: yy }, "#9ca3af", 1.5);
    }
    drawPosts(d, elm);
}

function drawPot(d: DrawCtx, elm: CircuitElm) {
    drawResistor(d, elm);
    const wiper = elm.getPost(2);
    if (wiper) {
        line(d, { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 }, wiper, "#facc15", 1.5);
        d.ctx.fillStyle = "#facc15";
        d.ctx.beginPath();
        d.ctx.arc(wiper.x, wiper.y, 2.5, 0, Math.PI * 2);
        d.ctx.fill();
    }
}

function drawGeneric(d: DrawCtx, elm: CircuitElm) {
    const vColor = voltageColor(elm.getVoltageDiff());
    if (elm.getPostCount() >= 2) {
        line(d, elm.point1, elm.point2, strokeColorFor(d, vColor));
    }
    label(d, String(elm.getDumpType()), {
        x: (elm.point1.x + elm.point2.x) / 2,
        y: (elm.point1.y + elm.point2.y) / 2 - 8,
    });
    drawPosts(d, elm);
}

type Drawer = (d: DrawCtx, elm: CircuitElm) => void;

const DRAWERS: Record<string, Drawer> = {
    'w': (d, e) => {
        line(d, e.point1, e.point2, strokeColorFor(d, voltageColor(e.getVoltageDiff())), 2);
        drawPosts(d, e);
    },
    'g': drawGround,
    'r': drawResistor,
    'c': drawCapacitor,
    'l': drawInductor,
    '174': drawPot,
    's': (d, e) => drawSwitchLike(d, e, (e as unknown as { position: number }).position === 0),
    'S': (d, e) => drawSwitchLike(d, e, false),
    'v': (d, e) => drawBattery(d, e, "~"),
    'R': (d, e) => drawBattery(d, e, "V"),
    '164': (d, e) => drawBattery(d, e, "CLK"),
    'i': (d, e) => drawBattery(d, e, "I"),
    'O': (d, e) => drawOnePost(d, e, "V"),
    'p': drawResistor,
    '370': (d, e) => drawSwitchLike(d, e, true),
    'd': (d, e) => drawDiodeLike(d, e, "#e5e7eb"),
    'z': (d, e) => drawDiodeLike(d, e, "#f59e0b"),
    '162': (d, e) => drawDiodeLike(d, e, "#22c55e"),
    't': (d, e) => drawTransistorLike(d, e, ["B", "C", "E"]),
    'f': (d, e) => drawTransistorLike(d, e, ["G", "D", "S"]),
    'a': drawOpAmp,
    '150': (d, e) => drawGate(d, e, "AND"),
    '151': (d, e) => drawGate(d, e, "NAND"),
    '152': (d, e) => drawGate(d, e, "OR"),
    '153': (d, e) => drawGate(d, e, "NOR"),
    '154': (d, e) => drawGate(d, e, "XOR"),
    '431': (d, e) => drawGate(d, e, "XNOR"),
    'I': (d, e) => drawGate(d, e, "NOT"),
    'L': (d, e) => drawOnePost(d, e, (e as unknown as { position: number }).position === 0 ? "L" : "H"),
    'M': (d, e) => drawOnePost(d, e, (e as unknown as { value?: string }).value || "?"),
    '207': (d, e) => {
        drawOnePost(d, e, "", "#818cf8");
        label(d, (e as unknown as { text: string }).text, { x: e.point1.x, y: e.point1.y - 14 }, "#818cf8");
    },
    'x': drawText,
    'b': drawBox,
};

export function drawElement(ctx: CanvasRenderingContext2D, elm: CircuitElm, selected: boolean, hovered: boolean) {
    const d: DrawCtx = { ctx, selected, hovered };
    const key = String(elm.getDumpType());
    const fn = DRAWERS[key] ?? drawGeneric;
    fn(d, elm);
}

// Distance from point to the nearest post-to-post segment of the element --
// used for click hit-testing. Falls back to the point1-point2 segment for
// anything with fewer than 2 usable posts.
export function distanceToElement(elm: CircuitElm, x: number, y: number): number {
    const n = Math.max(elm.getPostCount(), 2);
    const posts: Point[] = [];
    for (let i = 0; i < n; i++) {
        const p = elm.getPost(i);
        if (p) posts.push(p);
    }
    if (posts.length === 0) return Infinity;
    if (posts.length === 1) return Math.hypot(posts[0].x - x, posts[0].y - y);

    let best = Infinity;
    const segs: [Point, Point][] = [[elm.point1, elm.point2]];
    for (let i = 2; i < posts.length; i++) {
        const mid = { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 };
        segs.push([mid, posts[i]]);
    }
    for (const [a, b] of segs) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + dx * t, py = a.y + dy * t;
        best = Math.min(best, Math.hypot(px - x, py - y));
    }
    return best;
}
