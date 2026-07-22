import type { CircuitElm } from "@fulgurlab/engine";

// Body for CustomLogicElm (dump type 208 -- engine/src/elements/custom_logic.ts).
// Drawn in the same LOCAL frame every other symbols.tsx body uses (translate
// to point1, rotate toward point2 -- see that file's header comment); this is
// a STANDALONE component so it can be dropped into symbols.tsx's BODIES map
// (`"208": CustomLogicBody`) without editing that file.
//
// GEOMETRY NOTE: the real pin dots (world-space, via elm.getPost()) are
// already drawn generically by ElementSymbol's own extraPosts loop -- this
// component only draws the decorative chip outline + lead stubs + model-name
// label, using the SAME constants CustomLogicElm's own setPoints() uses
// (CSPC2=32, SIZE_X=2 -- see that file for the derivation/verification
// against tests/custom.txt's real fixture coordinates), so the drawn leads
// land exactly on the real pins for every placement this port's corpus
// actually uses (axis-aligned, point2 = point1 + (16,0)). CustomLogicElm's
// pin math is intentionally NOT rotation-aware (documented simplification in
// that file); if a circuit ever placed one of these rotated, this body's
// leads would visually diverge from the real (still axis-aligned) pins --
// the real pin dots stay correct regardless, since those come from
// elm.getPost() directly, not from this component.
interface CustomLogicBodyProps {
    elm: CircuitElm;
    color: string;
}

const CSPC = 16;
const CSPC2 = CSPC * 2; // mirrors CustomLogicElm.CSPC2
const SIZE_X = 2; // mirrors CustomLogicElm.SIZE_X
const DIM_OPACITY = 0.55;

export default function CustomLogicBody({ elm, color }: CustomLogicBodyProps) {
    const e = elm as unknown as { inputCount?: number; outputCount?: number; modelName?: string };
    const inputCount = Math.max(1, e.inputCount ?? 2);
    const outputCount = Math.max(1, e.outputCount ?? 2);
    const modelName = e.modelName ?? "";

    const xs = SIZE_X * CSPC2; // 64 -- chip body width (Java's `xs`)
    const sizeY = Math.max(inputCount, outputCount, 1);
    const boxLeft = CSPC; // 16
    const boxRight = CSPC + xs; // 80
    const boxTop = -CSPC; // -16
    const boxBottom = -CSPC + sizeY * CSPC2;
    const outputX = SIZE_X * CSPC2 + CSPC2; // 96 -- matches CustomLogicElm's outX

    return (
        <>
            {/* Input leads: pin (local 0, cspc2*i) -> box left edge. */}
            {Array.from({ length: inputCount }, (_, i) => {
                const py = CSPC2 * i;
                return <line key={`in${i}`} x1={0} y1={py} x2={boxLeft} y2={py} stroke={color} strokeWidth={2} />;
            })}
            {/* Output leads: box right edge -> pin (local outputX, cspc2*i). */}
            {Array.from({ length: outputCount }, (_, i) => {
                const py = CSPC2 * i;
                return <line key={`out${i}`} x1={boxRight} y1={py} x2={outputX} y2={py} stroke={color} strokeWidth={2} />;
            })}

            <rect
                x={boxLeft} y={boxTop} width={boxRight - boxLeft} height={boxBottom - boxTop}
                rx={2} ry={2} fill="none" stroke={color} strokeWidth={2}
            />

            <text
                x={(boxLeft + boxRight) / 2} y={(boxTop + boxBottom) / 2}
                fill={color} fillOpacity={DIM_OPACITY} fontSize={8} fontFamily="monospace"
                textAnchor="middle" dominantBaseline="middle"
                transform={`rotate(90 ${(boxLeft + boxRight) / 2} ${(boxTop + boxBottom) / 2})`}
            >
                {modelName}
            </text>
        </>
    );
}
