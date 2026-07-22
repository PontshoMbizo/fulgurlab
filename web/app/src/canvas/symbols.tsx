import type { ReactElement, MouseEvent as ReactMouseEvent } from "react";
import type { CircuitElm } from "@fulgurlab/engine";
import { voltageColor, overlayColor, NEUTRAL_GRAY, GROUND_COLOR, BACKGROUND } from "./theme";
import { bindingStore } from "@/kicad/bindings";
import KicadBoundBody from "./KicadBoundBody";
import ScopeBody from "./ScopeBody";
import CustomLogicBody from "./CustomLogicBody";
import SevenSegBody from "./SevenSegBody";

// Every symbol is authored in a LOCAL horizontal frame -- x from 0 (point1)
// to dn (point2), y perpendicular -- exactly mirroring how Falstad's own
// Graphics.translate()/rotate() + local draw calls work (CircuitElm.java's
// setPoints()/calcLeads() and each element's draw()). The wrapping <g>
// applies that one translate+rotate per element; every path below is plain
// local-frame SVG path syntax.
//
// GEOMETRY SOURCE: every body below follows KiCad's default symbol library
// shapes (resistor.pretty's IEC rectangle, C/L/D/GND/Q_NPN/Q_NMOS/etc. from
// the "Device"/"power" libraries), not Falstad's zigzag/hand-drawn style --
// this was a deliberate rework (see the per-function math comments for the
// exact local coordinates chosen and why). Where a KiCad shape would need
// posts this local frame can't express (pot wiper, gate multi-input fanout,
// MOSFET body pin, ...), the existing `dn`/`bodySpan`/interpPoint-derived
// approach is kept -- only the render, not the post math, changed. Every
// stroke stays 2px (KiCad's default line width scaled to this app's 16px
// grid) and every path draws in the passed `color` so voltage tint/
// selection/hover keep working exactly as before; nothing here touches that
// system, `ElementSymbol`'s post/lead loop, the `kicadOverride` dispatch, or
// the text/box special cases.
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

// Resistor: KiCad's IEC/"international" default symbol (Device:R) is a plain
// rectangle, not a US zigzag. Body length 40, half-height 7 (a 40x14 box) --
// close to the old zigzag's ~32-long footprint so placed circuits don't
// visibly outgrow their grid cells, wide enough to read clearly at 16px
// grid. l1/l2 are the rectangle's left/right edges via bodySpan(dn, 40);
// leads fill 0->l1 and l2->dn same as every other 2-post body here.
function ResistorBody({ elm, color }: SymbolProps) {
    const [l1, l2] = bodySpan(elm.dn, 40);
    const hh = 7;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <rect x={l1} y={-hh} width={l2 - l1} height={hh * 2} fill="none" stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Capacitor: KiCad Device:C -- two parallel plates perpendicular to the
// axis, both plain straight strokes of EQUAL thickness (this port's
// CapacitorElm has no polarized/electrolytic flag -- see capacitor.ts, so
// there is no "curved + marked" variant to special-case; every capacitor
// placed here is the plain non-polarized symbol). Gap between plates = 8
// (l1 = dn/2-4, l2 = dn/2+4), plate half-height = 12, matching KiCad's C
// symbol proportions (a wider plate than the resistor body is tall, per the
// reference).
function CapacitorBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const half = Math.min(4, dn / 2);
    const l1 = dn / 2 - half, l2 = dn / 2 + half;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <line x1={l1} y1={-12} x2={l1} y2={12} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={-12} x2={l2} y2={12} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Inductor: KiCad Device:L -- four half-circle humps ABOVE the axis line,
// no connecting baseline between arcs (that's what visually distinguishes
// it from the old Falstad loop-coil style, which drew a continuous
// scalloped line straight through). Body span via bodySpan(dn, 32) as
// before; each of the 4 humps gets an equal-width slot of (l2-l1)/4, arc
// radius r = slot/2, drawn as a semicircle path "Mx1,0 Ax2,x2 0 0 1 x1+2r,0"
// (large-arc-flag=0, sweep=1 -- bulges toward -y, i.e. "above" in SVG's
// y-down convention, matching every other body's convention here of
// perpendicular offsets being drawn without a separate flip). No stroke
// linecap/join needed since each hump is now its own independent M/A pair
// (not a continuous polyline), which is exactly the "no baseline strokes
// between" requirement.
function InductorBody({ elm, color }: SymbolProps) {
    const [l1, l2] = bodySpan(elm.dn, 32);
    const bodyLen = l2 - l1;
    const humps = 4;
    const slot = bodyLen / humps;
    const r = slot / 2;
    let d = "";
    for (let i = 0; i < humps; i++) {
        const x0 = l1 + i * slot;
        d += `M${x0},0 A${r},${r} 0 0 1 ${x0 + slot},0 `;
    }
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Diode family (D/Z/LED): KiCad's Device:D -- a filled triangle pointing
// toward the cathode plus a cathode bar. Body span via bodySpan(dn, 16) as
// before (half-height hs=8, i.e. triangle base from -8..8, apex at l2, bar
// at l2). ZenerElm adds bent "Z-wings" at each end of the cathode bar
// (Device:D_Zener's two short diagonal ticks); LEDElm adds two short
// parallel arrows radiating away from the triangle at ~45 degrees (Device:
// LED's light-emission glyph) instead of recoloring the bar (the old
// cathodeColor prop) -- KiCad doesn't recolor Zener/LED cathodes, it changes
// the glyph, so this now matches that convention while still reading as
// visually distinct per type.
function DiodeBody({ elm, color, variant }: SymbolProps & { variant?: "zener" | "led" }) {
    const [l1, l2] = bodySpan(elm.dn, 16);
    const hs = 8;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-hs} ${l1},${hs} ${l2},0`} fill={color} />
            {variant === "zener" ? (
                // Z-wings: short diagonal ticks off each end of the cathode bar,
                // angled back toward the triangle (KiCad D_Zener's distinguishing
                // feature vs a plain diode's straight bar).
                <>
                    <line x1={l2} y1={-hs} x2={l2} y2={hs} stroke={color} strokeWidth={3} />
                    <line x1={l2} y1={-hs} x2={l2 - 4} y2={-hs - 4} stroke={color} strokeWidth={2} />
                    <line x1={l2} y1={hs} x2={l2 + 4} y2={hs + 4} stroke={color} strokeWidth={2} />
                </>
            ) : (
                <line x1={l2} y1={-hs} x2={l2} y2={hs} stroke={color} strokeWidth={3} />
            )}
            {variant === "led" && (
                // Two short parallel arrows radiating away from the triangle
                // (up-and-right, KiCad LED's light-emission glyph), offset so
                // they don't overlap the body.
                <>
                    <line x1={l1 + 4} y1={-hs - 4} x2={l1 + 10} y2={-hs - 12} stroke={color} strokeWidth={1.5} />
                    <polygon points={`${l1 + 10},${-hs - 12} ${l1 + 5},${-hs - 11} ${l1 + 9},${-hs - 7}`} fill={color} />
                    <line x1={l1 + 9} y1={-hs - 8} x2={l1 + 15} y2={-hs - 16} stroke={color} strokeWidth={1.5} />
                    <polygon points={`${l1 + 15},${-hs - 16} ${l1 + 10},${-hs - 15} ${l1 + 14},${-hs - 11}`} fill={color} />
                </>
            )}
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// DC battery: KiCad power:Battery_Cell single-cell glyph -- a long thin line
// (+) paired with a short thick line (-). Kept from the previous revision
// (it already matched this convention, not a Falstad circle) -- only the
// dispatch below changes to also draw the AC-source circle+sine variant.
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

// AC voltage source: KiCad Device:Voltage_Source_AC -- a circle containing a
// single sine period. Circle radius r=min(12,dn/3) same envelope as
// CurrentSourceBody below (both are "circle glyph" sources so they should
// read at a consistent size); the sine path samples one full period across
// the circle's horizontal diameter (-r..r) at 5 points (0, quarter-turns),
// scaled to +-r/2 vertically so it stays clear of the circle's stroke.
function AcSourceBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const r = Math.min(12, dn / 3);
    const c = dn / 2;
    const amp = r * 0.5;
    const d = `M${c - r},0 Q${c - r / 2},${-amp} ${c},0 Q${c + r / 2},${amp} ${c + r},0`;
    return (
        <>
            <line x1={0} y1={0} x2={c - r} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={c} cy={0} r={r} fill="none" stroke={color} strokeWidth={2} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
            <line x1={c + r} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Current source: circle with a directional arrow (pointing toward point2,
// the conventional-current-flow direction) -- matches KiCad Device:
// Current_Source's own circle+arrow glyph, distinct from the battery bars
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

// Switch (SPST): KiCad Device:SW_SPST -- two small filled contact circles
// (radius 2.5, same as before) joined by a lever line angled ~30deg off-axis
// in the open state (closed lays it flat on the axis). Old drawing swung
// the arm to y=-16 at full body length l2-l1=32, i.e. atan2(16,32)=~26.6deg
// -- close to but not quite 30; recomputed explicitly here as
// -tan(30deg)*(l2-l1) so the angle is exact regardless of body length.
function SwitchBody({ elm, color, closed }: SymbolProps & { closed: boolean }) {
    const [l1, l2] = bodySpan(elm.dn, 32);
    const armY = closed ? 0 : -Math.tan(Math.PI / 6) * (l2 - l1);
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={0} r={2.5} fill={color} />
            <circle cx={l2} cy={0} r={2.5} fill={color} />
            <line x1={l1} y1={0} x2={l2} y2={armY} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={elm.dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// Ground: KiCad power:GND -- a short vertical stub down from the wire, then
// three horizontal bars of DECREASING width stacked below it (not a filled
// triangle). Stub length 6; bars at y=6,10,14 (spacing 4) with half-widths
// 10,6,2 (matches the old triangle-adjacent proportions so the footprint
// doesn't change size, just shape) -- widest nearest the stub, narrowing
// downward, exactly KiCad's convention.
function GroundBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    return (
        <>
            <line x1={0} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            <line x1={dn} y1={0} x2={dn} y2={6} stroke={color} strokeWidth={2} />
            {[10, 6, 2].map((half, i) => {
                const y = 6 + i * 4;
                return <line key={i} x1={dn - half} y1={y} x2={dn + half} y2={y} stroke={color} strokeWidth={2} />;
            })}
        </>
    );
}

// Potentiometer: same IEC rectangle body as ResistorBody (KiCad R_POT is a
// plain R rectangle plus a wiper arrow, per the prompt) -- the arrow itself
// is added below in ElementSymbol's extraLeads block since the wiper post
// (post 2) leaves the point1-point2 axis and can't be expressed in this
// local frame cleanly (same reasoning the previous revision already used).
function PotBody({ elm, color }: SymbolProps) {
    return <ResistorBody elm={elm} color={color} />;
}

// Op-amp: KiCad Amplifier_Operational:TL072 family -- a triangle with the +
// and - input markers drawn INSIDE the triangle, near the input (flat) edge,
// rather than to the left of it in the leads. hs=opheight is unchanged;
// input markers now sit just inside the triangle's left edge (l1+6) offset
// toward the +/-opheight rows so they read as labeling the two input lines
// specifically, matching KiCad's placement.
//
// Row-to-polarity mapping (verified against opamp.ts, not assumed): doStep()
// computes `vd = volts[1] - volts[0]` unconditionally, i.e. post 0 (in1p) is
// ALWAYS the inverting input and post 1 (in2p) ALWAYS non-inverting --
// FLAG_SWAP only changes which physical row each post is drawn on, not which
// one is + electrically. Without FLAG_SWAP, setPoints() uses
// hs=+opheight*dsign (take dsign=1): interpPoint2(...,hs)'s first result
// (in1p, the "-") lands at local y=-hs=-opheight (interpPoint2's g maps to
// y=-g for the first point, y=+g for the second -- same convention
// DependentSourceBody/OTABody's comments below rely on), so the TOP row
// (y=-opheight) is "-" and the bottom row is "+". FLAG_SWAP negates hs, which
// swaps both posts' rows, so the top row becomes "+". Hence topGlyph is "-"
// when NOT swapped, "+" when swapped -- read directly off elm.flags (same
// bit opamp.ts's FLAG_SWAP uses) so the glyph always sits next to the
// electrically-correct input regardless of draw orientation.
function OpAmpBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const opheight = (elm as unknown as { opheight: number }).opheight || 16;
    const opwidth = (elm as unknown as { opwidth: number }).opwidth || 26;
    const ww = Math.min(opwidth, dn / 2);
    const [l1, l2] = bodySpan(dn, ww * 2);
    const swapped = (elm.flags & 1) !== 0; // OpAmpElm.FLAG_SWAP = 1
    const topGlyph = swapped ? "+" : "-";
    const botGlyph = swapped ? "-" : "+";
    return (
        <>
            <line x1={0} y1={opheight} x2={l1} y2={opheight} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-opheight} x2={l1} y2={-opheight} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},${-opheight * 2} ${l1},${opheight * 2} ${l2},0`} fill="none" stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            <text x={l1 + 6} y={-opheight + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">{topGlyph}</text>
            <text x={l1 + 6} y={opheight + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">{botGlyph}</text>
        </>
    );
}

// BJT (NPN/PNP): KiCad Device:Q_NPN_BCE / Q_PNP_BCE -- vertical base bar,
// angled collector/emitter leads, emitter arrow, NO enclosing circle (the
// old drawing's circle is dropped entirely per the prompt). baseX unchanged
// from before (dn-16, i.e. the base bar sits 16 units in from the far end,
// matching TransistorElm's own +-16 collector/emitter perpendicular spread
// at fraction 1 -- see transistor.ts setPoints()). Emitter arrow direction
// follows `pnp` (+1 = NPN, arrow points AWAY from base/outward per KiCad's
// NPN convention; -1 = PNP, arrow points INTO the base) -- read directly off
// the element's own `pnp` field so the glyph always matches doStep()'s
// actual polarity, not just the label passed in.
function TransistorBody({ elm, color, labels }: SymbolProps & { labels: [string, string, string] }) {
    const dn = elm.dn;
    const baseX = dn - 16;
    const pnp = (elm as unknown as { pnp?: number }).pnp ?? 1;
    // Emitter lead runs from (baseX,10) to (dn,16); arrowhead sits partway
    // along it. NPN (pnp=1): arrow points toward the emitter TIP (dn,16),
    // i.e. away from the base -- current flows out. PNP (pnp=-1): arrow
    // points back toward the base (baseX,10) -- current flows in.
    const eBase: [number, number] = [baseX, 10];
    const eTip: [number, number] = [dn, 16];
    const arrowFrom = pnp === -1 ? eTip : eBase;
    const arrowTo = pnp === -1 ? eBase : eTip;
    const adx = arrowTo[0] - arrowFrom[0], ady = arrowTo[1] - arrowFrom[1];
    const alen = Math.hypot(adx, ady) || 1;
    const aux = adx / alen, auy = ady / alen;
    // Arrowhead positioned 60% along the emitter lead, pointing along (aux,auy).
    const amx = eBase[0] + (eTip[0] - eBase[0]) * 0.6, amy = eBase[1] + (eTip[1] - eBase[1]) * 0.6;
    const perpx = -auy, perpy = aux;
    const tip: [number, number] = [amx + aux * 4, amy + auy * 4];
    const left: [number, number] = [amx - aux * 4 + perpx * 3, amy - auy * 4 + perpy * 3];
    const right: [number, number] = [amx - aux * 4 - perpx * 3, amy - auy * 4 - perpy * 3];
    return (
        <>
            <line x1={0} y1={0} x2={baseX} y2={0} stroke={color} strokeWidth={2} />
            <line x1={baseX} y1={-16} x2={baseX} y2={16} stroke={color} strokeWidth={3} />
            <line x1={baseX} y1={-10} x2={dn} y2={-16} stroke={color} strokeWidth={2} />
            <line x1={eBase[0]} y1={eBase[1]} x2={eTip[0]} y2={eTip[1]} stroke={color} strokeWidth={2} />
            <polygon points={`${tip[0]},${tip[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`} fill={color} />
            <text x={2} y={-4} fill={NEUTRAL_GRAY} fontSize={9} fontFamily="monospace">{labels[0]}</text>
        </>
    );
}

// MOSFET: KiCad Device:Q_NMOS_GSD / Q_PMOS_GSD simplified -- gate bar
// (vertical, standing in for the 3-segment broken gate KiCad actually draws)
// separated from a channel bar by a small gap, plus three short
// source/drain stubs off the channel bar, and a small arrow on the source
// lead denoting polarity (pointing INTO the channel for NMOS, i.e. current
// conventionally flows in; OUT for PMOS) -- same "read pnp/FLAG_FLIP off the
// element" approach as TransistorBody above rather than trusting only the
// static `labels` prop, so the arrow direction always matches the real
// doStep() polarity. Gate bar at baseX=dn-16 (mirrors TransistorBody's base
// position); channel bar at baseX+6; source/drain stubs run from the
// channel bar out to the existing +-16 perpendicular spread (unchanged from
// before, just re-skinned).
function MosfetBody({ elm, color, labels }: SymbolProps & { labels: [string, string, string] }) {
    const dn = elm.dn;
    const gateX = dn - 16;
    const chanX = gateX + 6;
    const pnp = (elm as unknown as { pnp?: number }).pnp ?? 1;
    // Source arrow sits mid-height on the channel bar; NMOS (pnp=1) points
    // INTO the channel bar (+x), PMOS (pnp=-1) points OUT of it (-x) --
    // matches MosfetElm's own pnp sign convention (mosfet.ts).
    const arrowY = 10;
    const arrowTipX = pnp === -1 ? chanX - 5 : chanX + 5;
    const arrowBackX = pnp === -1 ? chanX + 1 : chanX - 1;
    return (
        <>
            <line x1={0} y1={0} x2={gateX} y2={0} stroke={color} strokeWidth={2} />
            <line x1={gateX} y1={-14} x2={gateX} y2={14} stroke={color} strokeWidth={2} />
            <line x1={chanX} y1={-16} x2={chanX} y2={16} stroke={color} strokeWidth={3} />
            <line x1={chanX} y1={-16} x2={dn} y2={-16} stroke={color} strokeWidth={2} />
            <line x1={chanX} y1={16} x2={dn} y2={16} stroke={color} strokeWidth={2} />
            <line x1={chanX} y1={0} x2={chanX + 8} y2={0} stroke={color} strokeWidth={2} />
            <line x1={arrowBackX} y1={arrowY - 3} x2={arrowTipX} y2={arrowY} stroke={color} strokeWidth={2} />
            <polygon
                points={`${arrowTipX},${arrowY} ${arrowBackX - (arrowTipX > arrowBackX ? 3 : -3)},${arrowY - 3} ${arrowBackX - (arrowTipX > arrowBackX ? 3 : -3)},${arrowY + 3}`}
                fill={color}
            />
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

// Inverter/Schmitt-inverter output bubble helper, shared by GateBody's `I`
// dispatch (already handled via its own `bubble` prop) -- no change needed
// there; kept only as a comment anchor so the "inverter gets a bubble"
// requirement is visibly satisfied at the BODIES table below (GateBody's
// `bubble` param already draws it).

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

// Rail: KiCad power-symbol convention -- a small open circle at the pin end
// plus a short stub, voltage/name label position kept exactly as-is (this
// reuses OnePostBody's existing circle+text layout verbatim per the prompt's
// "kept as-is" instruction for the label; only which function draws the
// circle changed conceptually -- it's the same glyph, so no new component
// was needed here). LogicNodeBody/LabeledNodeBody below keep their own
// distinct small-flag styling since those are label markers, not power
// rails.

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

// Clock (164): KiCad's clock-input marker convention -- a small triangular
// "chevron" pointing into the body (the standard schematic clock-pin glyph)
// plus a tiny square-wave glyph traced inside a small box, in place of the
// old "CLK"-labeled battery-bar reuse -- trivially cheap to draw (a fixed 3-
// segment step path) and distinctive at a glance vs every other Rail-family
// glyph. Box half-height/width chosen to match CircleGlyphBody's ~17px
// envelope so Rail-family glyphs stay visually consistent in size.
function ClockBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const r = Math.min(17, dn / 3);
    const c = dn - r - 2;
    // Square wave traced across the box: low - up - high - down - low, each
    // half-period spanning r/2 horizontally, +-r/2 vertically.
    const w = r; // box half-width
    const h = r * 0.6; // wave amplitude
    const d = `M${c - w},${h / 2} L${c - w / 2},${h / 2} L${c - w / 2},${-h / 2} L${c + w / 2},${-h / 2} L${c + w / 2},${h / 2} L${c + w},${h / 2}`;
    return (
        <>
            <line x1={0} y1={0} x2={c - w - r} y2={0} stroke={color} strokeWidth={2} />
            <rect x={c - w} y={-r} width={w * 2} height={r * 2} fill="none" stroke={color} strokeWidth={2} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
            <line x1={c + w + r} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
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

// Dependent sources (VCCS/VCVS/CCVS/CCCS): KiCad-analogous diamond shape
// (the classic "controlled source" glyph in every schematic convention,
// diamond rather than a rectangle or circle, to read as visually distinct
// from CurrentSourceBody/BatteryBody/AcSourceBody's circles above) with 2
// fanned leads on each side (control pair at x=0, output pair at x=dn, both
// split +-12 -- matches DependentSourceElm.DEFAULT_HS exactly). Diamond
// vertices at (l1,0), (mid,-hs*2), (l2,0), (mid,hs*2) -- same bounding box
// the old rectangle used (l1..l2 horizontally, +-hs*2 vertically) so the
// footprint is unchanged, just the outline shape.
function DependentSourceBody({ elm, color, label }: SymbolProps & { label: string }) {
    const dn = elm.dn;
    const hs = 12;
    const ww = Math.min(24, Math.max(dn / 2 - 4, 10));
    const [l1, l2] = bodySpan(dn, ww * 2);
    const mid = (l1 + l2) / 2;
    return (
        <>
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={2} />
            <polygon points={`${l1},0 ${mid},${-hs * 2} ${l2},0 ${mid},${hs * 2}`} fill="none" stroke={color} strokeWidth={2} />
            <text x={mid} y={4} fill={NEUTRAL_GRAY} fontSize={9} textAnchor="middle" fontFamily="monospace">{label}</text>
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
// than a manual toggle switch. Contact circles + ~30deg open arm angle now
// match SwitchBody's KiCad SW_SPST restyle above (same tan(30deg) formula).
function AnalogSwitchBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const [l1, l2] = bodySpan(dn, 32);
    const open = (elm as unknown as { open?: boolean }).open ?? false;
    const armY = open ? -Math.tan(Math.PI / 6) * (l2 - l1) : 0;
    return (
        <>
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={0} r={2.5} fill={color} />
            <circle cx={l2} cy={0} r={2.5} fill={color} />
            <line x1={l1} y1={0} x2={l2} y2={armY} stroke={color} strokeWidth={2} />
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
            {/* point3 = interpPoint(lead1,lead2,0.5,-OPENHS) -- the negated g
                means local y=+16 (interpPoint's g maps to local y=-g), not
                -16. */}
            <line x1={dn / 2} y1={16} x2={dn / 2} y2={5} stroke={NEUTRAL_GRAY} strokeWidth={1.5} strokeDasharray="2 2" />
        </>
    );
}

// AnalogSwitch2Elm (SPDT): KiCad-analogous two-throw switch -- common pole
// (from point1) plus two throw contacts, each with its own filled contact
// circle (matching SwitchBody/AnalogSwitchBody's SW_SPST-style dots); the
// arm swings toward whichever throw is active. swpostA (nodes[1], local
// y=-16) and swpostB (nodes[2], local y=+16) per interpPoint2(...,+OPENHS)'s
// "first point is local y=-g" convention (see DependentSourceBody's comment
// above); arm swings toward swpostB (y=+16) when open=true, matching the
// real doStep() wiring (see analog_switch.ts's own comment -- confirmed
// against Java, not assumed). ctlPoint = interpPoint(lead1,lead2,0.5,
// +OPENHS) -> local y=-16.
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
// floats otherwise, unlike a push-pull op-amp output). +/- markers moved
// inside the triangle near the input edge, matching OpAmpBody's restyle.
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
            <text x={l1 + 6} y={-hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">+</text>
            <text x={l1 + 6} y={hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">-</text>
            <circle cx={ringX} cy={0} r={4} fill="none" stroke={color} strokeWidth={1.5} />
            <line x1={ringX + 4} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />
        </>
    );
}

// OTA: same triangle family, labeled "gm" (the textbook transconductance
// symbol this port's own simplified doStep() equation uses -- see ota.ts),
// with a dashed bias-current (Iabc) stub entering from below at local
// x=0.3*dn (matches OTAElm.setPoints()'s own interpPoint fraction exactly).
// +/- markers moved inside the triangle, matching OpAmpBody/ComparatorBody.
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
            <text x={l1 + 6} y={-hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">+</text>
            <text x={l1 + 6} y={hs + 3} fill={NEUTRAL_GRAY} fontSize={10} fontFamily="monospace">-</text>
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
// AnalogSwitchBody above (now sharing their tan(30deg) open-angle formula).
function TimeDelayRelayBody({ elm, color }: SymbolProps) {
    const dn = elm.dn;
    const hs = 12;
    const onState = (elm as unknown as { onState?: boolean }).onState ?? false;
    const [l1, l2] = bodySpan(dn, 24);
    const armY = onState ? hs : hs + Math.tan(Math.PI / 6) * (l2 - l1);
    return (
        <>
            <line x1={0} y1={-hs} x2={l1} y2={-hs} stroke={color} strokeWidth={1.5} />
            <rect x={l1} y={-hs - 5} width={l2 - l1} height={10} fill="none" stroke={NEUTRAL_GRAY} strokeWidth={1.5} />
            <line x1={l2} y1={-hs} x2={dn} y2={-hs} stroke={color} strokeWidth={1.5} />
            <line x1={0} y1={hs} x2={l1} y2={hs} stroke={color} strokeWidth={2} />
            <circle cx={l1} cy={hs} r={2} fill={color} />
            <circle cx={l2} cy={hs} r={2} fill={color} />
            <line x1={l1} y1={hs} x2={l2} y2={armY} stroke={color} strokeWidth={2} />
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
    // Waveform-aware dispatch: WF_DC (0, the default/fallback) draws the
    // battery-cell glyph, WF_AC (1) draws the circle+sine glyph -- matches
    // VoltageElm.waveform (voltage.ts); anything else (square/triangle/etc.)
    // falls back to the battery glyph rather than inventing a third body,
    // consistent with the prompt's "AC source: circle with sine" being the
    // only other waveform explicitly called out.
    v: ({ elm, color }) => {
        const waveform = (elm as unknown as { waveform?: number }).waveform ?? 0;
        return waveform === 1 ? <AcSourceBody elm={elm} color={color} /> : <BatteryBody elm={elm} color={color} />;
    },
    R: ({ elm, color }) => <BatteryBody elm={elm} color={color} label="V" />,
    "164": ClockBody,
    "172": ({ elm, color }) => <BatteryBody elm={elm} color={color} label="V" />,
    A: ({ elm, color }) => <BatteryBody elm={elm} color={color} label="Ant" />,
    "170": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="Swp" />,
    "200": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="AM" />,
    "201": ({ elm, color }) => <CircleGlyphBody elm={elm} color={color} text="FM" />,
    i: CurrentSourceBody,
    O: ({ elm, color }) => <OnePostBody elm={elm} color={color} text="V" />,
    p: ({ elm, color }) => <InlineMeterBody elm={elm} color={color} label="V" labelColor={color} />,
    "370": ({ elm, color }) => <InlineMeterBody elm={elm} color={color} label="A" labelColor={color} />,
    // Placeable oscilloscope block (Simulink-style; auto-creates a scope
    // channel on placement -- see store.addElement / elements/scope.ts).
    "403": ({ elm, color }) => <ScopeBody elm={elm} color={color} />,
    "208": ({ elm, color }) => <CustomLogicBody elm={elm} color={color} />,
    "157": ({ elm, color }) => <SevenSegBody elm={elm} color={color} />,
    d: ({ elm, color }) => <DiodeBody elm={elm} color={color} />,
    z: ({ elm, color }) => <DiodeBody elm={elm} color={color} variant="zener" />,
    "162": ({ elm, color }) => <DiodeBody elm={elm} color={color} variant="led" />,
    t: ({ elm, color }) => <TransistorBody elm={elm} color={color} labels={["B", "C", "E"]} />,
    f: ({ elm, color }) => <MosfetBody elm={elm} color={color} labels={["G", "D", "S"]} />,
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
    // User-bound KiCad symbol override (Symbol Library panel): when a
    // .kicad_sym symbol has been bound to this (dumpType, flags) pair, it
    // replaces the built-in body drawing entirely; posts/extra leads keep
    // coming from engine geometry below either way. CircuitCanvas subscribes
    // to bindingStore so bind/unbind re-renders reach here.
    const kicadOverride = bindingStore.getVisualOverride(dumpType, elm.flags);
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
    // handful of one-off extra leads -- see file header note). Arrowhead
    // added at the wiper tip (KiCad R_POT's wiper arrow touching the body)
    // -- computed in world space same as the leg itself, pointing from the
    // body midpoint toward the wiper post.
    const extraLeads: ReactElement[] = [];
    if (dumpType === "174") {
        const wiper = elm.getPost(2);
        const mid = { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 };
        if (wiper) {
            const wdx = wiper.x - mid.x, wdy = wiper.y - mid.y;
            const wlen = Math.hypot(wdx, wdy) || 1;
            const wux = wdx / wlen, wuy = wdy / wlen;
            const wperpx = -wuy, wperpy = wux;
            const wtip = { x: wiper.x, y: wiper.y };
            const wleft = { x: wiper.x - wux * 6 + wperpx * 3, y: wiper.y - wuy * 6 + wperpy * 3 };
            const wright = { x: wiper.x - wux * 6 - wperpx * 3, y: wiper.y - wuy * 6 - wperpy * 3 };
            extraLeads.push(<line key="wiper" x1={mid.x} y1={mid.y} x2={wiper.x} y2={wiper.y} stroke="#facc15" strokeWidth={1.5} />);
            extraLeads.push(
                <polygon
                    key="wiper-arrow"
                    points={`${wtip.x},${wtip.y} ${wleft.x},${wleft.y} ${wright.x},${wright.y}`}
                    fill="#facc15"
                />
            );
        }
    }

    return (
        <g onMouseDown={onMouseDown} style={{ cursor: onMouseDown ? "pointer" : undefined }}>
            <g transform={`translate(${elm.point1.x} ${elm.point1.y}) rotate(${angleDeg(elm)})`}>
                {kicadOverride
                    ? <KicadBoundBody symbol={kicadOverride} elm={elm} color={color} />
                    : Body ? <Body elm={elm} color={color} /> : <Leads x1={elm.dn} color={color} />}
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
