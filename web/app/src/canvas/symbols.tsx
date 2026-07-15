import type { ReactElement, MouseEvent as ReactMouseEvent } from "react";
import type { CircuitElm } from "@fulgurlab/engine";
import { voltageColor, overlayColor, NEUTRAL_GRAY, GROUND_COLOR, BACKGROUND } from "./theme";

// Every symbol is authored in a LOCAL horizontal frame -- x from 0 (point1)
// to dn (point2), y perpendicular -- exactly mirroring how Falstad's own
// Graphics.translate()/rotate() + local draw calls work (CircuitElm.java's
// setPoints()/calcLeads() and each element's draw()). The wrapping <g>
// applies that one translate+rotate per element; every path below is plain
// local-frame SVG path syntax. Pixel constants (hs, body lengths, etc.) are
// taken from the Java source's draw() methods, not guessed.
//
// SIMPLIFICATION: Falstad's `dsign` (a world-orientation sign flip so a
// component drawn right-to-left still reads "right side up") isn't
// replicated -- components may mirror vertically depending on placement
// direction. Cosmetic only, not attempted here.

interface SymbolProps {
    elm: CircuitElm;
    color: string;
}

// Defensive fallback for any dump type not in BODIES below (shouldn't happen
// in practice -- every type the factory can construct has an entry -- but
// keeps an unrecognized element visible as a plain wire rather than
// disappearing silently).
function Leads({ x1, color }: { x1: number; color: string }) {
    return <line x1={0} y1={0} x2={x1} y2={0} stroke={color} strokeWidth={2} />;
}

// Body span centered on the local axis, matching CircuitElm.calcLeads(len).
function bodySpan(dn: number, len: number): [number, number] {
    if (dn < len || len === 0) return [0, dn];
    return [(dn - len) / 2, (dn + len) / 2];
}

function ResistorBody({ elm, color }: SymbolProps) {
    const [l1, l2] = bodySpan(elm.dn, 32);
    const hs = elm.dn < 30 ? 2 : 6;
    const pts: [number, number][] = [[l1, 0]];
    for (let i = 0; i < 4; i++) {
        pts.push([l1 + (1 + 4 * i) * (l2 - l1) / 16, hs]);
        pts.push([l1 + (3 + 4 * i) * (l2 - l1) / 16, -hs]);
    }
    pts.push([l2, 0]);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function CapacitorBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const l1 = dn / 2 - Math.min(4, dn / 2), l2 = dn / 2 + Math.min(4, dn / 2);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <line x1={l1} y1={-12} x2={l1} y2={12} stroke={color} strokeWidth={3} />
            <line x1={l2} y1={-12} x2={l2} y2={12} stroke={color} strokeWidth={3} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function InductorBody({ elm, color }: SymbolProps) {
    const [l1, l2] = bodySpan(elm.dn, 32);
    const bodyLen = l2 - l1;
    const loopCt = Math.max(1, Math.ceil(bodyLen / 11));
    const r = bodyLen / (2 * loopCt);
    let d = `M${l1},0 `;
    for (let i = 0; i < loopCt; i++) {
        const cx = l1 + r * (2 * i + 1);
        d += `A${r},${r} 0 0 1 ${cx + r},0 `;
    }
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function DiodeBody({ elm, color, cathodeColor }: SymbolProps & { cathodeColor?: string }) {
    const [l1, l2] = bodySpan(elm.dn, 16);
    const hs = 8;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs} ${l1},${hs} ${l2},0`} fill={color} />
            <line x1={l2} y1={-hs} x2={l2} y2={hs} stroke={cathodeColor ?? color} strokeWidth={3} />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function BatteryBody({ elm, color, label }: SymbolProps & { label?: string }) {
    const dn = elm.dn;
    const c = dn / 2;
    return (
        <>
            <line x1={0} y1={0} x2={c - 5} y2={0} stroke={color} strokeWidth={2} />
            <line x1={c - 5} y1={-16} x2={c - 5} y2={16} stroke={color} strokeWidth={1.5} />
            <line x1={c + 5} y1={-10} x2={c + 5} y2={10} stroke={color} strokeWidth={4} />
            <line x1={c + 5} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            {label && (
                <text x={c} y={-22} fill={NEUTRAL_GRAY} fontSize={10} textAnchor="middle" fontFamily="monospace">
                    {label}
                </text>
            )}
        </>
    );
}

// Current source: circle with a directional arrow (pointing toward point2,
// the conventional-current-flow direction), distinct from the battery bars
// above -- this is its own symbol in every schematic convention, not a
// variant of the voltage-source symbol.
function CurrentSourceBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const r = Math.min(12, dn / 3);
    const c = dn / 2;
    return (
        <>
            <line x1={0} y1={0} x2={c - r} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={c} cy={0} r={r} fill="none" stroke={color} strokeWidth={2} />
            <line x1={c - r + 4} y1={0} x2={c + r - 5} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${c + r - 5},0 ${c + r - 10},-4 ${c + r - 10},4`} fill={color} />
            <line x1={c + r} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function SwitchBody({ elm, color, closed }: SymbolProps & { closed: boolean }) {
    const [l1, l2] = bodySpan(elm.dn, 32);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={0} r={2.5} fill={color} />
            <circle cx={l2} cy={0} r={2.5} fill={color} />
            <line x1={l1} y1={0} x2={l2} y2={closed ? 0 : -16} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function GroundBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    return (
        <>
            <line x1={0} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            {[10, 6, 2].map((half, i) => (
                <line key={i} x1={dn + i * 5} y1={-half} x2={dn + i * 5} y2={half} stroke={color} strokeWidth={2} />
            ))}
        </>
    );
}

function PotBody({ elm, color }: SymbolProps) {
    // The wiper leg (post 2) can't be expressed in this local frame cleanly
    // since it leaves the point1-point2 axis; ElementSymbol draws it
    // separately in world space using the real getPost(2) coordinate.
    return <ResistorBody elm={elm} color={color} />;
}

function OpAmpBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const opheight = (elm as unknown as { opheight: number }).opheight || 16;
    const opwidth = (elm as unknown as { opwidth: number }).opwidth || 26;
    const ww = Math.min(opwidth, dn / 2);
    const [l1, l2] = bodySpan(dn, ww * 2);
    return (
        <>
            <line x1={0} y1={opheight} x2={l1} y2={opheight} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-opheight} x2={l1} y2={-opheight} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-opheight * 2} ${l1},${opheight * 2} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            <text x={l1 + 4} y={-opheight + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">+</text>
            <text x={l1 + 4} y={opheight + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">-</text>
        </>
    );
}

function TransistorBody({ elm, color, labels }: SymbolProps & { labels: [string, string, string] }) {
    const dn = elm.dn;
    const baseX = dn - 16;
    return (
        <>
            <line x1={0} y1={0} x2={baseX} y2={0} stroke={color} strokeWidth={2} />
            <line x1={baseX} y1={-16} x2={baseX} y2={16} stroke={color} strokeWidth={3} />
            <line x1={baseX} y1={-10} x2={dn} y2={-16} stroke={color} strokeWidth={2} />
            <line x1={baseX} y1={10} x2={dn} y2={16} stroke={color} strokeWidth={2} />
            <circle cx={(baseX + dn) / 2} cy={0} r={20} fill="none" stroke={NEUTRAL_GRAY} strokeWidth={1} />
            <text x={2} y={-4} fill={NEUTRAL_GRAY} fontSize={9} fontFamily="monospace">{labels[0]}</text>
        </>
    );
}

// Euro/IEC gate convention (plain rectangle + logic symbol), which is what
// the Java oracle falls back to outside "ANSI shapes" mode -- simpler to
// author faithfully than the ANSI curved bodies, and every gate type reads
// consistently. An inversion bubble is added for the NAND/NOR/XNOR/inverter
// (the four flagged "!"-prefixed here).
// Mirrors GateElm.setPoints()'s input-fanout loop exactly (same i0 sequence)
// so the drawn leads land precisely on the real input posts.
function gateInputOffsets(inputCount: number, hs: number): number[] {
    const offsets: number[] = [];
    let i0 = -Math.floor(inputCount / 2);
    for (let i = 0; i < inputCount; i++, i0++) {
        if (i0 === 0 && (inputCount & 1) === 0) i0++;
        offsets.push(hs * i0);
    }
    return offsets;
}

function GateBody({ elm, color, text, bubble }: SymbolProps & { text: string; bubble: boolean }) {
    const dn = elm.dn;
    const g = elm as unknown as { inputCount: number; gheight: number; gwidth2: number };
    const inputCount = g.inputCount ?? 2;
    const hs = g.gheight || 16;
    const gwidth2 = g.gwidth2 || 28;
    const bubbleR = 3;
    let ww = Math.min(gwidth2, dn / 2);
    if (bubble && ww + 8 > dn / 2) ww = dn / 2 - 8;
    const [bodyStart, bodyEnd] = bodySpan(dn, ww * 2);
    const offsets = gateInputOffsets(inputCount, hs);
    const gheight = Math.max(...offsets.map(Math.abs)) * 2 + 12;
    return (
        <>
            {offsets.map((y, i) => (
                <line key={i} x1={0} y1={y} x2={bodyStart} y2={y} stroke={color} strokeWidth={2} />
            ))}
            <rect x={bodyStart} y={-gheight / 2} width={bodyEnd - bodyStart} height={gheight} fill="none" stroke={color} strokeWidth={2} />
            <text x={(bodyStart + bodyEnd) / 2} y={4} fill={NEUTRAL_GRAY} fontSize={9} textAnchor="middle" fontFamily="monospace">
                {text}
            </text>
            {bubble && <circle cx={bodyEnd + bubbleR} cy={0} r={bubbleR} fill="none" stroke={color} strokeWidth={1.5} />}
            <line x1={bubble ? bodyEnd + bubbleR * 2 : bodyEnd} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Ammeter/Probe: an in-line 2-post meter -- wire with a circled label at the
// midpoint, matching Falstad's FLAG_CIRCLE draw style for both.
function InlineMeterBody({ elm, color, label, labelColor }: SymbolProps & { label: string; labelColor: string }) {
    const dn = elm.dn;
    const c = dn / 2;
    const r = 11;
    const [l1, l2] = bodySpan(dn, r * 2);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={c} cy={0} r={r} fill={BACKGROUND} stroke={color} strokeWidth={2} />
            <text x={c} y={4} fill={labelColor} fontSize={11} textAnchor="middle" fontFamily="monospace">{label}</text>
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

function OnePostBody({ elm, color, text }: SymbolProps & { text: string }) {
    return (
        <>
            <line x1={0} y1={0} x2={elm.dn - 10} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={elm.dn - 2} cy={0} r={9} fill="none" stroke={color} strokeWidth={2} />
            <text x={elm.dn - 2} y={4} fill={color} fontSize={9} textAnchor="middle" fontFamily="monospace">{text}</text>
        </>
    );
}

// LabeledNodeElm's `text` is an arbitrary user-chosen name (not a single
// glyph like the L/H/V/A markers above), so it's set above the post marker
// rather than crammed inside a 9px-radius circle where anything longer than
// one character overflows badly.
function LabeledNodeBody({ elm, color, text }: SymbolProps & { text: string }) {
    return (
        <>
            <line x1={0} y1={0} x2={elm.dn - 6} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={elm.dn - 3} cy={0} r={4} fill="none" stroke={color} strokeWidth={2} />
            <text x={elm.dn - 3} y={-10} fill={color} fontSize={10} textAnchor="middle" fontFamily="monospace">{text}</text>
        </>
    );
}

function angleDeg(elm: CircuitElm): number {
    return (Math.atan2(elm.point2.y - elm.point1.y, elm.point2.x - elm.point1.x) * 180) / Math.PI;
}

type BodyRenderer = (props: SymbolProps) => ReactElement;

function switchPosition(elm: CircuitElm): number {
    return (elm as unknown as { position: number }).position;
}

const BODIES: Record<string, BodyRenderer> = {
    w: ({ elm, color }) => <line x1={0} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />,
    g: GroundBody,
    r: ResistorBody,
    c: CapacitorBody,
    l: InductorBody,
    "174": PotBody,
    s: ({ elm, color }) => <SwitchBody elm={elm} color={color} closed={switchPosition(elm) === 0} />,
    S: ({ elm, color }) => <SwitchBody elm={elm} color={color} closed={switchPosition(elm) === 0} />,
    v: ({ elm, color }) => <BatteryBody elm={elm} color={color} />,
    R: ({ elm, color }) => <BatteryBody elm={elm} color={color} label="V" />,
    "164": ({ elm, color }) => <BatteryBody elm={elm} color={color} label="CLK" />,
    i: CurrentSourceBody,
    O: ({ elm, color }) => <OnePostBody elm={elm} color={color} text="V" />,
    p: ({ elm, color }) => <InlineMeterBody elm={elm} color={color} label="V" labelColor={color} />,
    "370": ({ elm, color }) => <InlineMeterBody elm={elm} color={color} label="A" labelColor={color} />,
    d: ({ elm, color }) => <DiodeBody elm={elm} color={color} />,
    z: ({ elm, color }) => <DiodeBody elm={elm} color={color} cathodeColor="#f59e0b" />,
    "162": ({ elm, color }) => <DiodeBody elm={elm} color={color} cathodeColor="#22c55e" />,
    t: ({ elm, color }) => <TransistorBody elm={elm} color={color} labels={["B", "C", "E"]} />,
    f: ({ elm, color }) => <TransistorBody elm={elm} color={color} labels={["G", "D", "S"]} />,
    a: OpAmpBody,
    "150": ({ elm, color }) => <GateBody elm={elm} color={color} text="&" bubble={false} />,
    "151": ({ elm, color }) => <GateBody elm={elm} color={color} text="&" bubble={true} />,
    "152": ({ elm, color }) => <GateBody elm={elm} color={color} text="≥1" bubble={false} />,
    "153": ({ elm, color }) => <GateBody elm={elm} color={color} text="≥1" bubble={true} />,
    "154": ({ elm, color }) => <GateBody elm={elm} color={color} text="=1" bubble={false} />,
    "431": ({ elm, color }) => <GateBody elm={elm} color={color} text="=1" bubble={true} />,
    I: ({ elm, color }) => <GateBody elm={elm} color={color} text="1" bubble={true} />,
    L: ({ elm, color }) => <OnePostBody elm={elm} color={color} text={switchPosition(elm) === 0 ? "L" : "H"} />,
    M: ({ elm, color }) => <OnePostBody elm={elm} color={color} text={(elm as unknown as { value?: string }).value || "?"} />,
    "207": ({ elm, color }) => <LabeledNodeBody elm={elm} color={color} text={(elm as unknown as { text?: string }).text ?? ""} />,
};

// Ground and labeled nodes have a fixed resting accent (not the voltage
// gradient every other element uses) -- ground is always the mockup's
// green, labeled nodes a distinct indigo so free-text node names read as a
// different "kind" of marker at a glance. Selected/hovered still override
// either, same as everything else.
const FIXED_BASE_COLOR: Partial<Record<string, string>> = {
    g: GROUND_COLOR,
    "207": "#818cf8",
};

export function ElementSymbol({
    elm, selected, hovered, onMouseDown,
}: {
    elm: CircuitElm;
    selected: boolean;
    hovered: boolean;
    onMouseDown?: (e: ReactMouseEvent) => void;
}) {
    const dumpType = String(elm.getDumpType());

    if (dumpType === "x") {
        const text = (elm as unknown as { text?: string }).text ?? "";
        const size = (elm as unknown as { size?: number }).size ?? 16;
        return (
            <text
                x={elm.point1.x} y={elm.point1.y + size}
                fill={overlayColor("#e5e7eb", selected, hovered)} fontSize={Math.min(size, 24)}
                fontFamily="sans-serif" onMouseDown={onMouseDown} style={{ cursor: "pointer" }}
            >
                {text}
            </text>
        );
    }
    if (dumpType === "b") {
        const x = Math.min(elm.point1.x, elm.point2.x), y = Math.min(elm.point1.y, elm.point2.y);
        return (
            <rect
                x={x} y={y} width={Math.abs(elm.point2.x - elm.point1.x)} height={Math.abs(elm.point2.y - elm.point1.y)}
                fill="none" stroke={overlayColor(NEUTRAL_GRAY, selected, hovered)} strokeWidth={1.5} strokeDasharray="6 4"
                onMouseDown={onMouseDown} style={{ cursor: "pointer" }}
            />
        );
    }

    const baseColor = FIXED_BASE_COLOR[dumpType] ?? voltageColor(safeVoltageDiff(elm));
    const color = overlayColor(baseColor, selected, hovered);
    const Body = BODIES[dumpType];
    const n = elm.getPostCount();
    const extraPosts: ReactElement[] = [];
    for (let i = 0; i < n; i++) {
        const p = elm.getPost(i);
        if (!p) continue;
        extraPosts.push(<circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#888" />);
    }
    // Wiper leg for pots and any other posts beyond point1/point2, drawn in
    // world space directly (simpler than inverting the local rotation for a
    // handful of one-off extra leads -- see file header note).
    const extraLeads: ReactElement[] = [];
    if (dumpType === "174") {
        const wiper = elm.getPost(2);
        const mid = { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 };
        if (wiper) extraLeads.push(<line key="wiper" x1={mid.x} y1={mid.y} x2={wiper.x} y2={wiper.y} stroke="#facc15" strokeWidth={1.5} />);
    }

    return (
        <g onMouseDown={onMouseDown} style={{ cursor: onMouseDown ? "pointer" : undefined }}>
            <g transform={`translate(${elm.point1.x} ${elm.point1.y}) rotate(${angleDeg(elm)})`}>
                {Body ? <Body elm={elm} color={color} /> : <Leads x1={elm.dn} color={color} />}
            </g>
            {extraLeads}
            {extraPosts}
        </g>
    );
}

function safeVoltageDiff(elm: CircuitElm): number {
    try {
        return elm.getVoltageDiff();
    } catch {
        return 0;
    }
}
