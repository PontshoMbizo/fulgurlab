import type { CircuitElm } from "@fulgurlab/engine";
import { extChipRegistry } from "@/extchip/client";
import { extChipId } from "@/extchip/ExtChipDrawer";
import type { ExtChipStatus } from "@/extchip/client";

// Body for ExtChipElm (dump type 460 -- engine/src/elements/ext_chip.ts, the
// fpgasim lockstep bridge chip). Drawn in the same LOCAL frame every other
// symbols.tsx body uses (translate to point1, rotate toward point2 -- see
// that file's header comment); a STANDALONE component, same convention as
// ScopeBody.tsx/CustomLogicBody.tsx, so it drops into symbols.tsx's BODIES
// map (`"460": ExtChipBody`) without editing that file.
//
// GEOMETRY: mirrors CustomLogicBody.tsx's own layout almost exactly, since
// ext_chip.ts's own header comment documents its geometry constants
// (CSPC2=32, SIZE_X=2) as deliberately matching CustomLogicElm's -- inputs
// hang off the left edge at local (0, cspc2*i), outputs off the right edge
// at local (SIZE_X*cspc2 + cspc2, cspc2*i), same as ExtChipElm.setPoints()'s
// real inPosts/outPosts. The real pin dots (world-space, via elm.getPost())
// are already drawn generically by ElementSymbol's own extraPosts loop --
// this component only draws the decorative outline + lead stubs + label +
// status ring, using those SAME constants so the drawn leads land exactly on
// the real posts.
interface ExtChipBodyProps {
    elm: CircuitElm;
    color: string;
}

const CSPC2 = 32; // ExtChipElm.CSPC2
const SIZE_X = 2; // ExtChipElm.SIZE_X
const CSPC = CSPC2 / 2; // 16 -- lead-stub length from a post to the box edge, same ratio CustomLogicBody uses
const DIM_OPACITY = 0.55;

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

export default function ExtChipBody({ elm, color }: ExtChipBodyProps) {
    const chip = elm as unknown as { pins?: { name: string; dir: "in" | "out" }[] };
    const pins = chip.pins ?? [];
    const inputCount = Math.max(1, pins.filter((p) => p.dir === "in").length || 0);
    const outputCount = Math.max(1, pins.filter((p) => p.dir === "out").length || 0);

    const xs = SIZE_X * CSPC2; // 64 -- chip body width
    const sizeY = Math.max(inputCount, outputCount, 1);
    const boxLeft = CSPC; // 16
    const boxRight = CSPC + xs; // 80
    const boxTop = -CSPC; // -16
    const boxBottom = -CSPC + sizeY * CSPC2;
    const outputX = SIZE_X * CSPC2 + CSPC2; // 96 -- matches ExtChipElm's outPosts x

    const status = extChipRegistry.getStatus(extChipId(elm)).status;
    const ringColor = STATUS_RING_COLOR[status];

    return (
        <>
            {/* Input leads: post (local 0, cspc2*i) -> box left edge. */}
            {Array.from({ length: inputCount }, (_, i) => {
                const py = CSPC2 * i;
                return <line key={`in${i}`} x1={0} y1={py} x2={boxLeft} y2={py} stroke={color} strokeWidth={2} />;
            })}
            {/* Output leads: box right edge -> post (local outputX, cspc2*i). */}
            {Array.from({ length: outputCount }, (_, i) => {
                const py = CSPC2 * i;
                return <line key={`out${i}`} x1={boxRight} y1={py} x2={outputX} y2={py} stroke={color} strokeWidth={2} />;
            })}

            <rect
                x={boxLeft} y={boxTop} width={boxRight - boxLeft} height={boxBottom - boxTop}
                rx={2} ry={2} fill="none" stroke={color} strokeWidth={2}
            />
            {/* Thin status-tinted ring, inset just inside the main outline --
                a quiet "this chip is live/erroring/etc" indicator that never
                competes with the main outline's own selection/hover color. */}
            <rect
                x={boxLeft + 2} y={boxTop + 2} width={boxRight - boxLeft - 4} height={boxBottom - boxTop - 4}
                rx={2} ry={2} fill="none" stroke={ringColor} strokeWidth={1}
            />

            <text
                x={(boxLeft + boxRight) / 2} y={(boxTop + boxBottom) / 2}
                fill={color} fillOpacity={DIM_OPACITY} fontSize={8} fontFamily="monospace"
                textAnchor="middle" dominantBaseline="middle"
                transform={`rotate(90 ${(boxLeft + boxRight) / 2} ${(boxTop + boxBottom) / 2})`}
            >
                FPGA
            </text>
        </>
    );
}
