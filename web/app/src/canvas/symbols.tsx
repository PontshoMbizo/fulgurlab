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

// Sweep/AM/FM sources: unlike the Rail family (battery-bar symbol, an
// already-established simplification of Java's real per-waveform icon
// system), Java draws these three with an actual CIRCLE (drawThickCircle)
// containing a short text glyph -- circleSize=17 in the oracle. This port
// always shows the text glyph (no dynamic wall-clock idle-spin animation --
// Java only shows that while paused anyway, a cosmetic effect not worth
// replicating for a static SVG symbol).
function CircleGlyphBody({ elm, color, text }: SymbolProps & { text: string }) {
    const dn = elm.dn;
    const r = Math.min(17, dn / 3);
    const c = dn - r - 2;
    return (
        <>
            <line x1={0} y1={0} x2={c - r} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={c} cy={0} r={r} fill="none" stroke={color} strokeWidth={2} />
            <text x={c} y={3} fill={color} fontSize={8.5} textAnchor="middle" fontFamily="monospace">{text}</text>
        </>
    );
}

// --- Analog Active Building Blocks group (batches 1-3) -----------------
//
// Geometry note: every multi-post element below computes its extra posts
// via interpPoint/interpPoint2 in LOCAL frame terms (fraction f along
// point1->point2 gives local x=f*dn; perpendicular offset g gives local
// y=+g for the first of an interpPoint2 pair, -g for the second -- see
// base.ts). Since ElementSymbol's wrapper <g> already translates to point1
// and rotates by the point1->point2 angle, these bodies can use the exact
// same local (x,y) numbers the engine's own setPoints() computed -- no
// separate world-space math needed, same trick OpAmpBody/PotBody already
// rely on for their own posts beyond point1/point2.

// Dependent sources (VCCS/VCVS/CCVS/CCCS): classic "controlled source"
// rectangle (not a circle, to read as visually distinct from the
// independent CurrentSourceBody/BatteryBody above) with 2 fanned leads on
// each side (control pair at x=0, output pair at x=dn, both split ±12 --
// matches DependentSourceElm.DEFAULT_HS exactly).
function DependentSourceBody({ elm, color, label }: SymbolProps & { label: string }) {
    const dn = elm.dn;
    const hs = 12;
    const ww = Math.min(24, Math.max(dn / 2 - 4, 10));
    const [l1, l2] = bodySpan(dn, ww * 2);
    return (
        <>
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={2} />
            <rect x={l1} y={-hs} width={l2 - l1} height={hs * 2} fill="none" stroke={color} strokeWidth={2} />
            <text x={(l1 + l2) / 2} y={4} fill={NEUTRAL_GRAY} fontSize={9} textAnchor="middle" fontFamily="monospace">{label}</text>
            {/* ctrlP ("+", post 0) sits at local y=-hs, ctrlM ("-", post 1) at
                y=+hs -- interpPoint2(a,b,f,g)'s FIRST point is local y=-g, not
                +g (verified against the rotation math + cross-checked against
                OpAmpBody's own in1p/in2p convention below). */}
            <text x={l1 + 3} y={-hs + 8} fill={NEUTRAL_GRAY} fontSize={7} fontFamily="monospace">+</text>
            <text x={l1 + 3} y={hs - 2} fill={NEUTRAL_GRAY} fontSize={7} fontFamily="monospace">-</text>
            <line x1={l2} y1={hs} x2={dn} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={-hs} x2={dn} y2={-hs} stroke={color} strokeWidth={2} />
        </>
    );
}

// Schmitt triggers: a buffer triangle (same family as the logic Inverter's
// GateBody, but a plain triangle rather than a boxed gate -- these are
// analog-threshold elements, not boolean gates) with a small hysteresis-loop
// glyph, and an inversion bubble only for the inverting variant.
function SchmittBody({ elm, color, inverting }: SymbolProps & { inverting: boolean }) {
    const dn = elm.dn;
    const hs = 12;
    const [l1, l2] = bodySpan(dn, 28);
    const bubbleR = 3;
    const tipX = inverting ? l2 - bubbleR * 2 : l2;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs} ${l1},${hs} ${tipX},0`} fill="none" stroke={color} strokeWidth={2} />
            <path d={`M${l1 + 5},4 L${l1 + 10},4 L${l1 + 10},-4 L${l1 + 15},-4`} fill="none" stroke={NEUTRAL_GRAY} strokeWidth={1} />
            {inverting && <circle cx={l2 - bubbleR} cy={0} r={bubbleR} fill="none" stroke={color} strokeWidth={1.5} />}
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// AnalogSwitchElm: same lifting-arm mechanic as SwitchBody, plus a dashed
// control stub dropping down from the control post (post2, local
// (dn/2,-16) -- exact, since calcLeads()'s midpoint is invariant regardless
// of body-length shrinking) to visually mark it as voltage-gated rather
// than a manual toggle switch.
function AnalogSwitchBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const [l1, l2] = bodySpan(dn, 32);
    const open = (elm as unknown as { open?: boolean }).open ?? false;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={0} r={2.5} fill={color} />
            <circle cx={l2} cy={0} r={2.5} fill={color} />
            <line x1={l1} y1={0} x2={l2} y2={open ? -14 : 0} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            {/* point3 = interpPoint(lead1,lead2,0.5,-OPENHS) -- the negated g
                means local y=+16 (interpPoint's g maps to local y=-g), not
                -16. */}
            <line x1={dn / 2} y1={16} x2={dn / 2} y2={5} stroke={NEUTRAL_GRAY} strokeWidth={1.5} strokeDasharray="2 2" />
        </>
    );
}

// AnalogSwitch2Elm (SPDT): common comes in from point1, throws fan out at
// point2's end. swpostA (nodes[1], local y=-16) and swpostB (nodes[2], local
// y=+16) per interpPoint2(...,+OPENHS)'s "first point is local y=-g"
// convention (see DependentSourceBody's comment above); arm swings toward
// swpostB (y=+16) when open=true, matching the real doStep() wiring (see
// analog_switch.ts's own comment -- confirmed against Java, not assumed).
// ctlPoint = interpPoint(lead1,lead2,0.5,+OPENHS) -> local y=-16.
function AnalogSwitch2Body({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 16;
    const pivotX = dn * 0.6;
    const open = (elm as unknown as { open?: boolean }).open ?? false;
    return (
        <>
            <line x1={0} y1={0} x2={pivotX} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={pivotX} cy={0} r={2.5} fill={color} />
            <circle cx={dn} cy={hs} r={2.5} fill={color} />
            <circle cx={dn} cy={-hs} r={2.5} fill={color} />
            <line x1={pivotX} y1={0} x2={dn - 6} y2={open ? hs : -hs} stroke={color} strokeWidth={2} />
            <line x1={dn - 6} y1={hs} x2={dn} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={dn - 6} y1={-hs} x2={dn} y2={-hs} stroke={color} strokeWidth={2} />
            <line x1={dn / 2} y1={-16} x2={dn / 2} y2={-4} stroke={NEUTRAL_GRAY} strokeWidth={1.5} strokeDasharray="2 2" />
        </>
    );
}

// Comparator: same triangle family as OpAmpBody, own fixed hs=16 (matches
// ComparatorElm.HS) rather than reading opheight/opwidth (which this class
// doesn't have), plus a small ring at the output denoting its open-drain
// behavior (see comparator.ts's header comment -- sinks when + > -,
// floats otherwise, unlike a push-pull op-amp output).
function ComparatorBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 16;
    const ww = Math.min(26, dn / 2);
    const [l1, l2] = bodySpan(dn, ww * 2);
    const ringX = Math.min(l2 + 5, dn - 2);
    return (
        <>
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs * 2} ${l1},${hs * 2} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            <text x={l1 + 4} y={-hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">+</text>
            <text x={l1 + 4} y={hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">-</text>
            <circle cx={ringX} cy={0} r={4} fill="none" stroke={color} strokeWidth={1.5} />
            <line x1={ringX + 4} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// OTA: same triangle family, labeled "gm" (the textbook transconductance
// symbol this port's own simplified doStep() equation uses -- see ota.ts),
// with a dashed bias-current (Iabc) stub entering from below at local
// x=0.3*dn (matches OTAElm.setPoints()'s own interpPoint fraction exactly).
function OTABody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 16;
    const ww = Math.min(26, dn / 2);
    const [l1, l2] = bodySpan(dn, ww * 2);
    const iabcX = dn * 0.3;
    return (
        <>
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs * 2} ${l1},${hs * 2} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            <text x={l1 + 4} y={-hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">+</text>
            <text x={l1 + 4} y={hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">-</text>
            <text x={(l1 + l2) / 2} y={4} fill={NEUTRAL_GRAY} fontSize={9} textAnchor="middle" fontFamily="monospace">gm</text>
            {/* iabcPost = interpPoint(point1,point2,0.3,hs*2) -> local y=-32
                (interpPoint's g maps to local y=-g), drawn in from the dot
                toward the triangle's underside. */}
            <line x1={iabcX} y1={-hs * 2} x2={iabcX} y2={-hs} stroke={NEUTRAL_GRAY} strokeWidth={1.5} strokeDasharray="2 2" />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Tri-state buffer: plain buffer triangle with an enable pin entering the
// underside at local x=dn/2 (exact, same calcLeads-midpoint-invariant
// reasoning as AnalogSwitchElm's control post) -- the standard tri-state
// symbol convention (a buffer with a bottom-center enable input).
function TriStateBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 12;
    const [l1, l2] = bodySpan(dn, 28);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs} ${l1},${hs} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            {/* point3 = interpPoint(lead1,lead2,0.5,-HS) -> local y=+16 (same
                sign rule as AnalogSwitchBody's control post above). */}
            <line x1={dn / 2} y1={16} x2={dn / 2} y2={7} stroke={NEUTRAL_GRAY} strokeWidth={1.5} strokeDasharray="2 2" />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Delay buffer: plain buffer triangle labeled with a "Δt" glyph -- this is
// a propagation-delay buffer (see delay.ts), not a tri-state (no enable
// pin), so it's kept visually distinct from TriStateBody above.
function DelayBufferBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 12;
    const [l1, l2] = bodySpan(dn, 28);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs} ${l1},${hs} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            <text x={l1 + (l2 - l1) * 0.35} y={4} fill={NEUTRAL_GRAY} fontSize={7} textAnchor="middle" fontFamily="monospace">{"Δt"}</text>
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Time-delay relay: two independent horizontal branches (see
// TimeDelayRelayElm's own getConnection()/post-layout comment) -- a coil
// sense row (vinP/gndP, local y=-12: interpPoint2(...,0,+hs)'s FIRST point
// is local y=-hs, not +hs -- same sign rule as DependentSourceBody's ctrlP
// above) drawn as a plain box standing in for the fixed sense resistor, and
// a switched contact row (inP/outP, local y=+12) with a lifting-arm switch
// that closes once onState is true, same arm mechanic as SwitchBody/
// AnalogSwitchBody above.
function TimeDelayRelayBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 12;
    const onState = (elm as unknown as { onState?: boolean }).onState ?? false;
    const [l1, l2] = bodySpan(dn, 24);
    return (
        <>
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={1.5} />
            <rect x={l1} y={-hs - 5} width={l2 - l1} height={10} fill="none" stroke={NEUTRAL_GRAY} strokeWidth={1.5} />
            <line x1={l2} y1={-hs} x2={dn} y2={-hs} stroke={color} strokeWidth={1.5} />
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={hs} r={2} fill={color} />
            <circle cx={l2} cy={hs} r={2} fill={color} />
            <line x1={l1} y1={hs} x2={l2} y2={onState ? hs : hs + 10} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={hs} x2={dn} y2={hs} stroke={color} strokeWidth={2} />
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
    "172": ({ elm, color }) => <BatteryBody elm={elm} color={color} label="V" />,
    A: ({ elm, color }) => <BatteryBody elm={elm} color={color} label="Ant" />,
    "170": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="Swp" />,
    "200": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="AM" />,
    "201": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="FM" />,
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
    // Analog Active Building Blocks group (batches 1-3).
    "213": ({ elm, color }) => <DependentSourceBody elm={elm} color={color} label="VCCS" />,
    "212": ({ elm, color }) => <DependentSourceBody elm={elm} color={color} label="VCVS" />,
    "214": ({ elm, color }) => <DependentSourceBody elm={elm} color={color} label="CCVS" />,
    "215": ({ elm, color }) => <DependentSourceBody elm={elm} color={color} label="CCCS" />,
    "183": ({ elm, color }) => <SchmittBody elm={elm} color={color} inverting={true} />,
    "182": ({ elm, color }) => <SchmittBody elm={elm} color={color} inverting={false} />,
    "159": AnalogSwitchBody,
    "160": AnalogSwitch2Body,
    "401": ComparatorBody,
    "402": OTABody,
    "180": TriStateBody,
    "422": DelayBufferBody,
    "414": TimeDelayRelayBody,
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
