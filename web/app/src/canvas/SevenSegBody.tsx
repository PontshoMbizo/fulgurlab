import type { CircuitElm } from "@fulgurlab/engine";

// Body for SevenSegElm (dump type 157 -- engine/src/elements/seven_seg.ts).
// Drawn in the same LOCAL frame every other symbols.tsx body uses (see that
// file's header comment); a STANDALONE component so it can be dropped into
// symbols.tsx's BODIES map (`"157": SevenSegBody`) without editing that file.
//
// Segment layout mirrors SevenSegElm.java's own `display7` coordinate table
// (a unit-square path per segment, scaled here to SEG px) -- lit segments
// (per elm.segmentLit(i), engine-side) draw in the full `color` prop; unlit
// segments draw a DIM variant of it (same "bright vs dim" convention
// ScopeBody/GateBody already use for state-dependent glyphs elsewhere in
// this file set). Only the 7-segment (baseSegmentCount===7) case is drawn --
// this port's own corpus target (tests/7seg.txt) is exactly that case; a
// 14/16-segment or decimal-point/colon display (extraSegment>0) falls back
// to plain lit/unlit dots at each segment's approximate position rather than
// a hand-authored 14/16-segment glyph (documented simplification, no real
// fixture in this pass's scope exercises those).
interface SevenSegBodyProps {
    elm: CircuitElm;
    color: string;
}

const SEG = 12; // segment length in local px (display7's unit square, scaled)
const THICK = 3;
const DIM_OPACITY = 0.25;

// Same [x1,y1,x2,y2] unit-square segment table as SevenSegElm.java's
// `display7` static array (a-g, matching segmentLit's index order).
const DISPLAY7: [number, number, number, number][] = [
    [0, 0, 2, 0],
    [2, 0, 2, 1],
    [2, 1, 2, 2],
    [0, 2, 2, 2],
    [0, 1, 0, 2],
    [0, 0, 0, 1],
    [0, 1, 2, 1],
];

function segmentPath(x1: number, y1: number, x2: number, y2: number, thick: number): string {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const t = thick / 2;
    const inset = thick; // pull each end in slightly so segments meet at a point, not a full-thickness overlap
    const ax = x1 + ux * inset, ay = y1 + uy * inset;
    const bx = x2 - ux * inset, by = y2 - uy * inset;
    return [
        `M${x1},${y1}`,
        `L${ax + px * t},${ay + py * t}`,
        `L${bx + px * t},${by + py * t}`,
        `L${x2},${y2}`,
        `L${bx - px * t},${by - py * t}`,
        `L${ax - px * t},${ay - py * t}`,
        `Z`,
    ].join(" ");
}

export default function SevenSegBody({ elm, color }: SevenSegBodyProps) {
    const e = elm as unknown as {
        segmentCount?: number;
        baseSegmentCount?: number;
        extraSegment?: number;
        segmentLit?: (i: number) => boolean;
    };
    const baseSegmentCount = e.baseSegmentCount ?? 7;
    const segmentCount = e.segmentCount ?? 7;
    const lit = (i: number) => (e.segmentLit ? e.segmentLit(i) : false);

    // Local origin sits at the first west pin (segment 'a'); offset the
    // glyph to the right of the pin column, roughly centered in the chip's
    // own box footprint (see CustomLogicBody.tsx for the same CSPC2/SIZE_X
    // constants -- SevenSegElm's real footprint is wider, so this offset is
    // a purely cosmetic placement choice, not derived from engine geometry).
    const ox = 24;
    const oy = 8;

    if (baseSegmentCount !== 7) {
        // 14/16-segment fallback: plain lit/unlit dots, evenly spaced.
        return (
            <>
                {Array.from({ length: segmentCount }, (_, i) => (
                    <circle
                        key={i} cx={ox} cy={oy + i * 10} r={3}
                        fill={lit(i) ? color : "none"} stroke={color} strokeOpacity={lit(i) ? 1 : DIM_OPACITY} strokeWidth={1.5}
                    />
                ))}
            </>
        );
    }

    return (
        <g transform={`translate(${ox} ${oy}) scale(${SEG})`}>
            {DISPLAY7.map(([x1, y1, x2, y2], i) => (
                <path
                    key={i}
                    d={segmentPath(x1, y1, x2, y2, THICK / SEG)}
                    fill={color}
                    fillOpacity={lit(i) ? 1 : DIM_OPACITY}
                />
            ))}
        </g>
    );
}
