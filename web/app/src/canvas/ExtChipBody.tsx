import type { CircuitElm } from "@fulgurlab/engine";
import { extChipRegistry } from "@/extchip/client";
import { extChipId } from "@/extchip/ExtChipDrawer";
import type { ExtChipStatus } from "@/extchip/client";

// Body for ExtChipElm (dump type 460 -- engine/src/elements/ext_chip.ts, the
// fpgasim lockstep bridge chip). Drawn in the same LOCAL frame every other
// symbols.tsx body uses (translate to point1, rotate toward point2 -- see
// that file's header comment); a STANDALONE component, same convention as
// ScopeBody.tsx/CustomLogicBody.tsx, so it drops into symbols.tsx's BODIES
// map (`"460": ExtChipBody`) without editing that file. Like
// CustomLogicBody.tsx's own pin math, ExtChipElm's posts are NOT
// rotation-aware (documented in that file) -- this body's leads only land on
// the real posts for axis-aligned placements; the real pin dots (drawn by
// ElementSymbol's own extraPosts loop) stay correct regardless.
//
// GEOMETRY: mirrors ext_chip.ts's own setPoints() exactly -- outputs in a
// north row (above the board, y<0), inputs in a south row (below it,
// y>boardHeight), both cspc2-spaced along x. `boardWidth`/`boardHeight` are
// read directly off the element instance (public getters on ExtChipElm)
// instead of being recomputed here, so the drawn board photo and the real
// posts can never drift out of sync.
interface ExtChipBodyProps {
    elm: CircuitElm;
    color: string;
}

const CSPC2 = 32; // ExtChipElm.CSPC2
const LEAD = 16;  // ExtChipElm.LEAD
const DIM_OPACITY = 0.85;

// Same status color vocabulary as ExtChipDrawer.tsx's STATUS_STYLE (kept as
// its own small local table rather than importing that module's internal
// map, since only `extChipId` is a contractual cross-file export here).
const STATUS_RING_COLOR: Record<ExtChipStatus, string> = {
    unconfigured: "rgba(255,255,255,.35)",
    connecting: "#facc15",
    compiling: "#facc15",
    running: "#34d399",
    ended: "#60a5fa",
    error: "#f87171",
};

type ExtChipLike = {
    pins?: { name: string; dir: "in" | "out" }[];
    boardWidth?: number;
    boardHeight?: number;
};

export default function ExtChipBody({ elm, color }: ExtChipBodyProps) {
    const chip = elm as unknown as ExtChipLike;
    const pins = chip.pins ?? [];
    const inPins = pins.filter((p) => p.dir === "in");
    const outPins = pins.filter((p) => p.dir === "out");

    // Fall back to the same minimum-footprint formula ext_chip.ts uses
    // (SIZE_X columns wide, ASPECT-derived height) if the instance doesn't
    // expose the getters for some reason (e.g. an older/mocked elm).
    const boardWidth = chip.boardWidth ?? 64;
    const boardHeight = chip.boardHeight ?? boardWidth / 2.71;

    const status = extChipRegistry.getStatus(extChipId(elm)).status;
    const ringColor = STATUS_RING_COLOR[status];

    return (
        <>
            {/* Output leads: board top edge (y=0) -> post (north row, y=-LEAD). */}
            {outPins.map((pin, i) => {
                const px = CSPC2 * (i + 0.5);
                return (
                    <g key={`out${i}`}>
                        <line x1={px} y1={0} x2={px} y2={-LEAD} stroke={color} strokeWidth={2} />
                        <text
                            x={px} y={-LEAD - 3}
                            fill={color} fillOpacity={DIM_OPACITY} fontSize={7} fontFamily="monospace"
                            textAnchor="middle"
                        >
                            {pin.name}
                        </text>
                    </g>
                );
            })}
            {/* Input leads: post (south row, y=boardHeight+LEAD) -> board bottom edge. */}
            {inPins.map((pin, i) => {
                const px = CSPC2 * (i + 0.5);
                return (
                    <g key={`in${i}`}>
                        <line x1={px} y1={boardHeight} x2={px} y2={boardHeight + LEAD} stroke={color} strokeWidth={2} />
                        <text
                            x={px} y={boardHeight + LEAD + 9}
                            fill={color} fillOpacity={DIM_OPACITY} fontSize={7} fontFamily="monospace"
                            textAnchor="middle"
                        >
                            {pin.name}
                        </text>
                    </g>
                );
            })}

            {/* The actual Tang Nano 9K board photo (cropped to just the PCB, see
                public/images/tang-nano-9k.png), scaled to exactly fill the
                board footprint -- its source aspect ratio already matches
                ExtChipElm.ASPECT, so "none" doesn't distort it. */}
            <image
                href="/images/tang-nano-9k.png"
                x={0} y={0} width={boardWidth} height={boardHeight}
                preserveAspectRatio="none"
            />

            {/* Selection/hover outline over the photo. */}
            <rect
                x={0} y={0} width={boardWidth} height={boardHeight}
                rx={3} ry={3} fill="none" stroke={color} strokeWidth={2}
            />
            {/* Thin status-tinted ring, inset just inside the outline -- a quiet
                "this chip is live/erroring/etc" indicator that never competes
                with the main outline's own selection/hover color. */}
            <rect
                x={2} y={2} width={boardWidth - 4} height={boardHeight - 4}
                rx={2} ry={2} fill="none" stroke={ringColor} strokeWidth={1.5}
            />
        </>
    );
}
