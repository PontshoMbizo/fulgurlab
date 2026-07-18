import type { CircuitElm } from "@fulgurlab/engine";
import { CircuitNode } from "@fulgurlab/engine";

// Simulink-style "Scope block" body for the placeable oscilloscope element
// (dump type 403 -- see engine/src/elements/scope.ts). Drawn in the same
// LOCAL frame every other symbols.tsx body uses: x from 0 (point1) to dn
// (point2), y perpendicular, wrapped by ElementSymbol's own translate+rotate
// <g> (see symbols.tsx's file header comment) -- this file is a STANDALONE
// component precisely so it can be dropped into that file's BODIES map
// (`"403": ScopeBody`) without editing symbols.tsx itself.
//
// This intentionally mirrors symbols.tsx's own local SymbolProps shape
// (which isn't exported, so it's redeclared here) rather than importing it,
// keeping this file a self-contained drop-in.
interface ScopeBodyProps {
    elm: CircuitElm;
    color: string;
}

const BODY_HALF_WIDTH = 18; // 36 wide, centered on the axis
const BODY_HALF_HEIGHT = 14; // 28 tall
const SCREEN_INSET = 5;
const SCREEN_STROKE_OPACITY = 0.55; // "dimmer" inner screen stroke, see spec
const GROUND_GLYPH_OPACITY = 0.5; // "dim variant of `color`" for the dangling glyph

// Fixed 2-cycle square/sine hint drawn inside the screen -- purely
// decorative (a static trace suggestion, not live data; the app's real
// scope trace lives in scope/Scope.tsx, out of this component's scope).
// Coordinates are fractions of the screen's own half-width/half-height so
// the hint rescales cleanly if BODY_HALF_WIDTH/HEIGHT above ever change.
function traceHintPoints(screenHalfW: number, screenHalfH: number): string {
    const w = screenHalfW * 2;
    const h = screenHalfH * 0.7;
    const xs = [0, 0.125, 0.125, 0.375, 0.375, 0.625, 0.625, 0.875, 0.875, 1].map((f) => -screenHalfW + f * w);
    const ys = [0, 0, -h, -h, h, h, -h, -h, 0, 0];
    return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
}

// --- Dangling-terminal detection ---------------------------------------
//
// ROUTE TAKEN: the analyzer's own node/link structures, reached via each
// element's cached `getNode(j)` (populated by Analyzer.makeNodeList() during
// the last analyzeAndStamp() -- see core/node.ts and core/engine.ts). This
// reads the SAME CircuitNode object the solver itself stamped against --
// there is no need to separately reach into engineStore.engine.nodeList,
// since elm.getNode(j) already IS that analyzed structure, cached on the
// element by the analyzer. `@fulgurlab/engine`'s public index re-exports
// `core/node` in full (`export * from './core/node'`), so CircuitNode is a
// real, supported import here, not a reach into a private module -- this is
// the "preferred" route the spec asks for, and it WAS cleanly reachable, so
// the geometric (elmList post-coincidence scan) fallback described in the
// spec is not needed/implemented.
//
// A post's node has exactly one CircuitNodeLink (itself) when nothing else
// in the circuit ties into that node -- i.e. it is floating. The one
// exception is CircuitNode.ground itself: every GroundElm instance (and any
// node the analyzer aliases to ground, e.g. a lone RailElm's fallback) is
// definitionally connected to the whole rest of the circuit regardless of
// its own link count, so a terminal wired directly to true ground must NOT
// read as dangling even though nothing else may share that exact node.
//
// Note: the ANALYZER already ties any genuinely floating node to ground
// through a large resistor (CircuitEngine.connectUnconnectedNodes(), 1e8ohm
// -- see core/engine.ts), so this glyph is a faithful READOUT of that real
// electrical behavior (a dangling terminal really does measure ~0V against
// ground once stamped), not a special-cased visual invented independently
// of what the solver actually does.
export function isPostDangling(elm: CircuitElm, postIndex: number): boolean {
    const node = elm.getNode(postIndex);
    if (!node) return true; // no analyzed node at all (e.g. never stamped) -- treat as floating
    if (node === CircuitNode.ground) return false; // real ground is never "dangling"
    return node.links.length <= 1;
}

export default function ScopeBody({ elm, color }: ScopeBodyProps) {
    const dn = elm.dn;
    const bodyLen = BODY_HALF_WIDTH * 2;
    // Body centered mid-axis (matches CircuitElm.calcLeads()'s centering,
    // same helper shape as symbols.tsx's own bodySpan()) -- right edge sits
    // at `dn` per the spec (the body's far edge meets terminal 2's lead).
    const [l1, l2] = dn < bodyLen ? [0, dn] : [(dn - bodyLen) / 2, (dn + bodyLen) / 2];
    const cx = (l1 + l2) / 2;

    const screenHalfW = Math.max(0, BODY_HALF_WIDTH - SCREEN_INSET);
    const screenHalfH = Math.max(0, BODY_HALF_HEIGHT - SCREEN_INSET);
    const tracePath = traceHintPoints(screenHalfW, screenHalfH);

    // Post 2 is elm.getPost(1) / local (dn, 0) -- see this component's own
    // header note on why the body sits BETWEEN the two leads rather than at
    // one end: lead 1 runs (0,0)->l1, lead 2 runs l2->dn.
    const dangling = isPostDangling(elm, 1);

    return (
        <>
            {/* Lead from terminal 1 (local origin) to the body's left edge. */}
            <line x1={0} y1={0} x2={l1} y2={0} stroke={color} strokeWidth={2} />
            {/* Lead from the body's right edge to terminal 2 (local (dn,0)). */}
            <line x1={l2} y1={0} x2={dn} y2={0} stroke={color} strokeWidth={2} />

            {/* Outer block body. */}
            <rect
                x={l1} y={-BODY_HALF_HEIGHT} width={l2 - l1} height={BODY_HALF_HEIGHT * 2}
                rx={3} ry={3} fill="none" stroke={color} strokeWidth={2}
            />
            {/* Inner rounded-rect "screen", inset ~5 from the body edges. */}
            <rect
                x={cx - screenHalfW} y={-screenHalfH} width={screenHalfW * 2} height={screenHalfH * 2}
                rx={2} ry={2} fill="none" stroke={color} strokeOpacity={SCREEN_STROKE_OPACITY} strokeWidth={1.5}
            />
            {/* Fixed trace hint (2-cycle square/sine suggestion) inside the screen. */}
            <path d={tracePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

            {/* Dangling-ground glyph: terminal 2 has nothing else tied to its
                node, so it electrically floats to ground through the
                analyzer's large-resistor fallback -- drawn at local (dn,0),
                a dim variant of `color`, KiCad-style: short stub + 3
                shrinking horizontal bars (same visual vocabulary as
                symbols.tsx's own GroundBody). */}
            {dangling && (
                <g strokeOpacity={GROUND_GLYPH_OPACITY}>
                    <line x1={dn} y1={0} x2={dn + 8} y2={0} stroke={color} strokeWidth={1.5} />
                    {[7, 4.5, 2].map((half, i) => (
                        <line key={i} x1={dn + 8 + i * 3.5} y1={-half} x2={dn + 8 + i * 3.5} y2={half} stroke={color} strokeWidth={1.5} />
                    ))}
                </g>
            )}
        </>
    );
}
