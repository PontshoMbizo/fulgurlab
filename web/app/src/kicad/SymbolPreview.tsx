"use client";

// SVG renderer for a single parsed KicadSymbol. Deliberately dumb/stateless
// (props in, <g> out) -- no store subscription, no interactivity beyond
// what a caller wires up via onClick on the wrapping element -- so the same
// component works both for the small preview cards in SymbolLibraryPanel
// and (should the lead agent want it) a future canvas overlay.
//
// Styling mirrors canvas/symbols.tsx's resting-state palette (NEUTRAL_GRAY
// body strokes, muted pin/label colors) rather than inventing a new look,
// since a bound symbol is meant to visually belong on the same canvas as
// the built-in element drawings.

import { NEUTRAL_GRAY } from "@/canvas/theme";
import { toWorld, mmLengthToWorld, type KicadSymbol, type GraphicItem, type KicadPin, type Point } from "./kicadSym";

const DEFAULT_STROKE_MM = 0.254; // KiCad's own default line weight when a stroke's width is 0 ("use default")
const PIN_COLOR = "#6b7280"; // slate-500 -- distinct from NEUTRAL_GRAY body outlines so pin legs read as a separate layer, same idea as symbols.tsx's separate post-dot color
const PIN_TEXT_COLOR = "#9ca3af"; // slate-400, for name/number labels

// Converts a 3-point KiCad arc (start/mid/end, all mm) into an SVG elliptical
// arc path command. KiCad stores arcs this way (not center+angles) so the
// center/radius/sweep must be reconstructed geometrically: the circle
// through 3 points is found via the standard circumcenter formula (solving
// the two perpendicular-bisector equations), then radius = distance from
// that center to any of the 3 points. large-arc-flag and sweep-flag are
// derived by checking whether `mid` lies on the shorter or longer of the two
// arcs between `start` and `end`, and which winding direction reaches it --
// signed-area/cross-product test, not just angle subtraction, since the
// three points can be in either winding order depending on how the symbol
// was authored.
function arcToPathD(startMm: Point, midMm: Point, endMm: Point): string {
    const start = toWorld(startMm), mid = toWorld(midMm), end = toWorld(endMm);

    // Circumcenter of (start, mid, end): intersection of the perpendicular
    // bisectors of start-mid and mid-end. Degenerates (near-collinear
    // points, i.e. denominator ~0) fall back to a straight line -- a
    // vanishingly rare malformed-arc case, not worth a curved-path special
    // case for.
    const ax = start.x, ay = start.y, bx = mid.x, by = mid.y, cx = end.x, cy = end.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) {
        return `M${start.x},${start.y} L${end.x},${end.y}`;
    }
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const radius = Math.hypot(start.x - ux, start.y - uy);

    // Sweep direction: does going start -> mid -> end turn clockwise or
    // counter-clockwise around the center (in SVG's Y-down screen space,
    // where a positive cross product = clockwise)? sweep-flag=1 draws the
    // arc in the +angle (clockwise-on-screen) direction from start to end;
    // matching it to the OBSERVED winding through `mid` is what guarantees
    // the drawn arc actually passes through `mid` rather than its
    // complement on the far side of the circle.
    const cross = (mid.x - start.x) * (end.y - start.y) - (mid.y - start.y) * (end.x - start.x);
    const sweepFlag = cross < 0 ? 1 : 0;

    // Large-arc-flag: is the start->mid->end path more or less than half
    // the circle? Compare the angle subtended going THROUGH mid against pi,
    // using the same center -- simplest robust way to tell short-way from
    // long-way without re-deriving start/end angles separately and risking
    // a sign mismatch against the sweep test above.
    const angle = (p: Point) => Math.atan2(p.y - uy, p.x - ux);
    let sweepThroughMid = angle(end) - angle(start);
    // Normalize into the same rotational direction as sweepFlag so the
    // "did we go more than half way" check lines up with the arc SVG will
    // actually draw for that flag.
    if (sweepFlag === 1 && sweepThroughMid < 0) sweepThroughMid += 2 * Math.PI;
    if (sweepFlag === 0 && sweepThroughMid > 0) sweepThroughMid -= 2 * Math.PI;
    const largeArcFlag = Math.abs(sweepThroughMid) > Math.PI ? 1 : 0;

    return `M${start.x},${start.y} A${radius},${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x},${end.y}`;
}

// Shared by every filled graphic-item kind (rectangle/circle/polyline) --
// `text`/`arc` don't carry a KicadFill, so this takes the plain fill shape
// directly rather than `GraphicItem["fill"]` (which doesn't exist as a
// uniform union member).
function fillFor(fill: { type: "none" | "outline" | "background" }, stroke: string): string {
    if (fill.type === "none") return "none";
    // "outline" (fill with the line color) and "background" (fill with the
    // schematic theme's background color) are both mapped to the stroke
    // color here -- this app has no schematic "sheet background" concept of
    // its own to source a distinct background fill from (see kicadSym.ts's
    // parser-coverage note).
    return stroke;
}

function GraphicItemView({ item, stroke, strokeWidth }: { item: GraphicItem; stroke: string; strokeWidth: number }) {
    switch (item.kind) {
        case "rectangle": {
            const a = toWorld(item.start), b = toWorld(item.end);
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            return (
                <rect
                    x={x} y={y} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
                    fill={fillFor(item.fill, stroke)} stroke={stroke} strokeWidth={strokeWidth}
                />
            );
        }
        case "circle": {
            const c = toWorld(item.center);
            return (
                <circle
                    cx={c.x} cy={c.y} r={mmLengthToWorld(item.radius)}
                    fill={fillFor(item.fill, stroke)} stroke={stroke} strokeWidth={strokeWidth}
                />
            );
        }
        case "arc":
            return <path d={arcToPathD(item.start, item.mid, item.end)} fill="none" stroke={stroke} strokeWidth={strokeWidth} />;
        case "polyline": {
            const pts = item.points.map(toWorld);
            const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            // A polyline whose first and last point coincide is how KiCad
            // authors a closed polygon (there's no separate "polygon" node
            // in the grammar -- see the dev docs' Symbol Line section) --
            // fillFor()'s "none" default still renders correctly either way,
            // since an open polyline with fill=none is just a line strip.
            return <path d={d} fill={fillFor(item.fill, stroke)} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />;
        }
        case "text": {
            const p = toWorld(item.at);
            return (
                <text x={p.x} y={p.y} fill={stroke} fontSize={12} textAnchor="middle" fontFamily="monospace">
                    {item.text}
                </text>
            );
        }
    }
}

function PinView({ pin, showPins }: { pin: KicadPin; showPins: boolean }) {
    const at = toWorld(pin.at), tip = toWorld(pin.tip);
    return (
        <g>
            <line x1={at.x} y1={at.y} x2={tip.x} y2={tip.y} stroke={PIN_COLOR} strokeWidth={1.5} />
            {/* Connection-point dot at the wire end (`at`, not `tip`) -- this
                is where a wire will actually attach once the canvas
                integration lands, so it's the more useful of the two ends
                to mark visually in a preview. */}
            <circle cx={at.x} cy={at.y} r={2} fill={PIN_COLOR} />
            {showPins && (pin.name !== "~" ? pin.name : "") && (
                <text
                    x={at.x} y={at.y}
                    fill={PIN_TEXT_COLOR} fontSize={9} fontFamily="monospace" textAnchor="middle"
                    transform={`translate(0 ${at.y < tip.y ? -6 : 12})`}
                >
                    {pin.name}
                </text>
            )}
            {showPins && pin.number && (
                <text
                    x={(at.x + tip.x) / 2} y={(at.y + tip.y) / 2 - 4}
                    fill={PIN_TEXT_COLOR} fontSize={8} fontFamily="monospace" textAnchor="middle"
                >
                    {pin.number}
                </text>
            )}
        </g>
    );
}

export interface SymbolPreviewProps {
    symbol: KicadSymbol;
    /** Extra multiplier on top of the fixed mm->world scale, for fitting a
     * symbol into a fixed-size preview card regardless of its physical size. */
    scale?: number;
    showPins?: boolean;
}

// `text` items carry no KicadStroke of their own (KiCad text has no
// adjustable outline weight) -- unlike rectangle/circle/arc/polyline, which
// all share the same STROKE_DEFINITION per the dev docs. This narrows
// safely instead of assuming every GraphicItem has `.stroke`.
function strokeWidthMmFor(item: GraphicItem): number {
    return item.kind === "text" ? 0 : item.stroke.width;
}

export default function SymbolPreview({ symbol, scale = 1, showPins = true }: SymbolPreviewProps) {
    const strokeWidthWorld = mmLengthToWorld(DEFAULT_STROKE_MM) * scale;
    return (
        <g transform={scale !== 1 ? `scale(${scale})` : undefined}>
            {symbol.unit.items.map((item, i) => {
                const mmWidth = strokeWidthMmFor(item);
                return (
                    <GraphicItemView key={i} item={item} stroke={NEUTRAL_GRAY} strokeWidth={mmWidth > 0 ? mmLengthToWorld(mmWidth) : strokeWidthWorld} />
                );
            })}
            {symbol.unit.pins.map((pin, i) => (
                <PinView key={i} pin={pin} showPins={showPins} />
            ))}
        </g>
    );
}
