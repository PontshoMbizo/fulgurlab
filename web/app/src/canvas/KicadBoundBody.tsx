"use client";

// Renders a user-bound KiCad symbol as an element's body, replacing the
// built-in BODIES[dumpType] drawing (see symbols.tsx's dispatch). Lives in
// the element's LOCAL frame — the caller has already translated to point1
// and rotated so +x runs toward point2 over a length of elm.dn — so all
// this component decides is how to fit the symbol into that [0..dn] span:
//
//   - 2-pin symbols: mapped pin-to-pin. Pin A's connection point lands on
//     (0,0), pin B's on (dn,0), via translate→rotate→uniform-scale, so the
//     symbol's electrical ends coincide exactly with the element's posts —
//     leads and grid alignment come for free, exactly like KiCad placing a
//     resistor between two 2.54mm-grid wire ends.
//   - anything else: centered at (dn/2, 0) at natural size (the fixed
//     mm→world scale already makes 2.54mm = one grid unit), no stretching.
//     Posts/extra leads keep coming from the engine geometry, drawn by
//     ElementSymbol around this body as usual.
//
// A faint axis line in the element's live color is drawn beneath the symbol
// so voltage tint / selection / hover feedback still reads on elements whose
// bound symbol ignores our color system (KiCad symbols carry no such thing).

import type { CircuitElm } from "@fulgurlab/engine";
import type { KicadSymbol, Point } from "@/kicad/kicadSym";
import { toWorld } from "@/kicad/kicadSym";
import SymbolPreview from "@/kicad/SymbolPreview";

function symbolBBox(symbol: KicadSymbol): { cx: number; cy: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const eat = (p: Point) => {
        const w = toWorld(p);
        if (w.x < minX) minX = w.x;
        if (w.x > maxX) maxX = w.x;
        if (w.y < minY) minY = w.y;
        if (w.y > maxY) maxY = w.y;
    };
    for (const item of symbol.unit.items) {
        switch (item.kind) {
            case "rectangle": eat(item.start); eat(item.end); break;
            case "circle":
                eat({ x: item.center.x - item.radius, y: item.center.y - item.radius });
                eat({ x: item.center.x + item.radius, y: item.center.y + item.radius });
                break;
            case "arc": eat(item.start); eat(item.mid); eat(item.end); break;
            case "polyline": item.points.forEach(eat); break;
            case "text": eat(item.at); break;
        }
    }
    for (const pin of symbol.unit.pins) { eat(pin.at); eat(pin.tip); }
    if (!Number.isFinite(minX)) return { cx: 0, cy: 0 };
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export default function KicadBoundBody({ symbol, elm, color }: { symbol: KicadSymbol; elm: CircuitElm; color: string }) {
    const dn = elm.dn;
    const pins = symbol.unit.pins;

    let transform: string;
    if (pins.length === 2) {
        const a = toWorld(pins[0].at);
        const b = toWorld(pins[1].at);
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d > 1e-6) {
            // Compose right-to-left: translate pin A to the origin, rotate the
            // pin axis onto +x, then uniform-scale so pin B lands on (dn, 0).
            const thetaDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            const k = dn / d;
            transform = `scale(${k}) rotate(${-thetaDeg}) translate(${-a.x} ${-a.y})`;
        } else {
            const { cx, cy } = symbolBBox(symbol);
            transform = `translate(${dn / 2 - cx} ${-cy})`;
        }
    } else {
        const { cx, cy } = symbolBBox(symbol);
        transform = `translate(${dn / 2 - cx} ${-cy})`;
    }

    return (
        <g>
            {/* live-color axis underlay: keeps voltage/selection feedback visible */}
            <line x1={0} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={1.25} opacity={0.35} />
            <g transform={transform}>
                <SymbolPreview symbol={symbol} showPins={false} />
            </g>
        </g>
    );
}
