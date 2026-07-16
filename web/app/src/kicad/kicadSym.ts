// .kicad_sym model + parser, built on top of sexpr.ts's generic reader.
//
// LICENSING NOTE: this file parses user-supplied .kicad_sym files at runtime
// -- it does not vendor, embed, or redistribute any of KiCad's own official
// symbol libraries (those are published separately under CC-BY-SA-4.0, with
// KiCad's documented "design exception" permitting symbols placed in a
// user's own schematic without that schematic itself becoming share-alike).
// Only fixtures.ts's two hand-authored fixtures ship with this app, and
// those are original works written for this port's own tests.
//
// Grammar reference: KiCad dev docs, "S-Expression Format" +
// "Symbol Library File Format" (dev-docs.kicad.org/en/file-formats/), which
// documents the format shared by KiCad 6/7/8. Coordinates in a .kicad_sym
// file are always millimeters (KiCad's internal unit is nanometers, but the
// text format is always written in mm -- see that doc's "Coordinates and
// Sizes" section), and pin `at` rotation is one of exactly 0/90/180/270.

import { parseSExpr, isTagged, find, findAll, num, str, type SExpr } from "./sexpr";

// World scale: canvas snap grid is 16 world units (see canvas/draw.ts
// GRID_SIZE) and KiCad's schematic pin grid is 2.54mm (100 mil) -- the
// standard 0.1" pin pitch every real-world symbol is authored on. Mapping
// 2.54mm -> 16 units exactly means a symbol's pins land precisely on the
// canvas's own snap grid with no rounding drift, so a bound symbol's pins
// line up with wires placed anywhere the canvas already snaps to.
export const MM_TO_WORLD = 16 / 2.54;

export interface Point { x: number; y: number; }

export interface KicadStroke {
    width: number; // mm, 0 means "use default"
    type: string; // "default" | "solid" | "dash" | ... (KiCad's stroke type token)
}

export interface KicadFill {
    type: "none" | "outline" | "background";
}

const DEFAULT_STROKE: KicadStroke = { width: 0, type: "default" };
const DEFAULT_FILL: KicadFill = { type: "none" };

export interface RectangleItem { kind: "rectangle"; start: Point; end: Point; stroke: KicadStroke; fill: KicadFill; }
export interface CircleItem { kind: "circle"; center: Point; radius: number; stroke: KicadStroke; fill: KicadFill; }
export interface ArcItem { kind: "arc"; start: Point; mid: Point; end: Point; stroke: KicadStroke; fill: KicadFill; }
export interface PolylineItem { kind: "polyline"; points: Point[]; stroke: KicadStroke; fill: KicadFill; }
export interface TextItem { kind: "text"; text: string; at: Point; rotation: number; }

export type GraphicItem = RectangleItem | CircleItem | ArcItem | PolylineItem | TextItem;

// KiCad's rotation convention for pins: 0=right, 90=up, 180=left, 270=down
// (standard math-style angle, counter-clockwise from +X, in KiCad's own
// Y-up mm space) -- see pinTip()'s comment for the worked-example proof.
// `at` is the pin's CONNECTION point (the wire-end / anchor a wire attaches
// to, per the dev docs' Symbol Pin section: "the connection point of the
// pin"); the pin extends `length` mm from `at` IN THE DIRECTION OF `rot`
// itself (not rot+180) to reach its `tip`, the end that touches the body
// outline. This module computes both `at` (anchor) and the body-touching
// end (`tip`) for each pin so callers never have to redo that trig
// themselves.
export interface KicadPin {
    electrical: string; // "passive" | "input" | "output" | ... (see dev docs table; stored verbatim, not re-validated)
    graphicStyle: string; // "line" | "inverted" | "clock" | ... (stored verbatim)
    at: Point; // mm, the wire-connection anchor point
    rotation: number; // degrees, one of 0/90/180/270
    length: number; // mm
    name: string;
    number: string;
    // tip = the pin's other end, which touches/enters the symbol body outline
    // (at + length in the direction rot+180). Precomputed here since both
    // SymbolPreview (draw the pin leg) and the eventual canvas integration
    // (know where the body ends) need it, and re-deriving trig per call site
    // would be needlessly duplicated.
    tip: Point;
}

// A single drawable unit ("Name_0_1" convention -- see KiCad's Symbol Unit
// Identifier docs: NAME_UNIT_STYLE, unit 0 = common to all units). This
// model only keeps unit 1 (see extractPreviewUnit() below) since preview/
// binding only needs one representative drawing, not the full multi-unit
// graph a real schematic editor would need.
export interface KicadUnit {
    items: GraphicItem[];
    pins: KicadPin[];
}

export interface KicadSymbol {
    id: string; // "LIBRARY_ID", e.g. "Fixture:R" (kept as authored -- includes any library-nickname prefix the file itself used, since a user-imported file has no real library table to resolve it against)
    name: string; // same as id, kept as a separate field for readability at call sites that don't care about ':'-splitting
    properties: Record<string, string>; // at least Reference/Value when present; every (property "KEY" "VALUE" ...) pair is kept, not just the mandatory ones
    extends?: string; // LIBRARY_ID of the parent, if this symbol was `(symbol "..." (extends "Parent") ...)`
    unit: KicadUnit; // the resolved preview-unit drawing (see extractPreviewUnit)
}

export interface KicadLibrary {
    version?: string;
    generator?: string;
    symbols: KicadSymbol[];
}

function readPoint(list: SExpr, tag: string, context: string): Point {
    const node = find(list, tag);
    if (!node) throw new Error(`${context}: missing (${tag} X Y)`);
    return { x: num(node, 1, `${context} ${tag}.x`), y: num(node, 2, `${context} ${tag}.y`) };
}

function readAt(list: SExpr, context: string): { x: number; y: number; rotation: number } {
    const at = find(list, "at");
    if (!at) throw new Error(`${context}: missing (at X Y [ROT])`);
    const x = num(at, 1, `${context} at.x`);
    const y = num(at, 2, `${context} at.y`);
    // Rotation is optional in the grammar (e.g. a property's `at` can omit
    // it); pins in practice always include it, but default to 0 rather than
    // throwing so a symbol authored slightly outside the common case still
    // parses.
    const rotation = at.length > 3 && typeof at[3] === "number" ? at[3] : 0;
    return { x, y, rotation };
}

function readStroke(list: SExpr): KicadStroke {
    const node = find(list, "stroke");
    if (!node) return DEFAULT_STROKE;
    const widthNode = find(node, "width");
    const typeNode = find(node, "type");
    return {
        width: widthNode ? num(widthNode, 1, "stroke.width") : DEFAULT_STROKE.width,
        type: typeNode && typeof typeNode[1] === "string" ? typeNode[1] : DEFAULT_STROKE.type,
    };
}

function readFill(list: SExpr): KicadFill {
    const node = find(list, "fill");
    if (!node) return DEFAULT_FILL;
    const typeNode = find(node, "type");
    const t = typeNode && typeof typeNode[1] === "string" ? typeNode[1] : "none";
    return { type: t === "outline" || t === "background" ? t : "none" };
}

function parseRectangle(node: SExpr): RectangleItem {
    return { kind: "rectangle", start: readPoint(node, "start", "rectangle"), end: readPoint(node, "end", "rectangle"), stroke: readStroke(node), fill: readFill(node) };
}

function parseCircle(node: SExpr): CircleItem {
    const center = readPoint(node, "center", "circle");
    const radiusNode = find(node, "radius");
    if (!radiusNode) throw new Error("circle: missing (radius R)");
    return { kind: "circle", center, radius: num(radiusNode, 1, "circle.radius"), stroke: readStroke(node), fill: readFill(node) };
}

function parseArc(node: SExpr): ArcItem {
    return {
        kind: "arc",
        start: readPoint(node, "start", "arc"),
        mid: readPoint(node, "mid", "arc"),
        end: readPoint(node, "end", "arc"),
        stroke: readStroke(node),
        fill: readFill(node),
    };
}

function parsePolyline(node: SExpr): PolylineItem {
    const ptsNode = find(node, "pts");
    if (!ptsNode) throw new Error("polyline: missing (pts ...)");
    const points = findAll(ptsNode, "xy").map((xy) => ({ x: num(xy, 1, "polyline.xy.x"), y: num(xy, 2, "polyline.xy.y") }));
    if (points.length < 2) throw new Error("polyline: requires at least 2 points");
    return { kind: "polyline", points, stroke: readStroke(node), fill: readFill(node) };
}

function parseText(node: SExpr): TextItem {
    // (text "TEXT" (at X Y [ROT]) (effects ...)) -- text's own body content
    // is node[1], a quoted string per the grammar's Symbol Text section.
    const text = typeof node[1] === "string" ? node[1] : "";
    const { x, y, rotation } = readAt(node, "text");
    return { kind: "text", text, at: { x, y }, rotation };
}

// Converts a pin's `at`+`rotation`+`length` into its body-touching `tip`.
// The pin extends from its `at` connection point IN THE DIRECTION OF `rot`
// itself (0=+X, 90=+Y, 180=-X, 270=-Y) to reach the body -- confirmed by
// working through a canonical vertical 2-pin symbol (a resistor): the top
// pin's connection point sits ABOVE the body at (0, 3.81) with rot=270
// (south/-Y in KiCad's Y-up space), and its tip must land where the body
// edge is, one grid step in at (0, 2.54) -- i.e. the tip is BELOW (smaller
// Y than) `at`. Moving in the rot=270 (-Y) direction from (0,3.81) by
// length=1.27 gives exactly (0, 3.81-1.27) = (0, 2.54). The bottom pin
// mirrors this: at (0,-3.81) rot=90 (+Y), tip = (0,-3.81+1.27) = (0,-2.54).
// Both check out, so `rot` (not `rot+180`) is confirmed as the tip-ward
// direction -- equivalently: rot=0 pins are LEFT-side pins (wire comes in
// from further left; tip points further right/+X, into the body), and
// rot=180 pins are RIGHT-side pins, matching universal KiCad symbol
// authoring convention (e.g. every left-side IC pin is rot=0).
function pinTip(at: Point, rotationDeg: number, length: number): Point {
    const rad = (rotationDeg * Math.PI) / 180;
    return { x: at.x + length * Math.cos(rad), y: at.y + length * Math.sin(rad) };
}

function parsePin(node: SExpr): KicadPin {
    const electrical = typeof node[1] === "string" ? node[1] : "unspecified";
    const graphicStyle = typeof node[2] === "string" ? node[2] : "line";
    const { x, y, rotation } = readAt(node, "pin");
    const lengthNode = find(node, "length");
    const length = lengthNode ? num(lengthNode, 1, "pin.length") : 0;
    const nameNode = find(node, "name");
    const numberNode = find(node, "number");
    const name = nameNode && typeof nameNode[1] === "string" ? nameNode[1] : "";
    const number = numberNode && typeof numberNode[1] === "string" ? numberNode[1] : "";
    const at = { x, y };
    return { electrical, graphicStyle, at, rotation, length, name, number, tip: pinTip(at, rotation, length) };
}

function parseGraphicItems(unitNode: SExpr): GraphicItem[] {
    const items: GraphicItem[] = [];
    for (const child of unitNode) {
        if (isTagged(child, "rectangle")) items.push(parseRectangle(child));
        else if (isTagged(child, "circle")) items.push(parseCircle(child));
        else if (isTagged(child, "arc")) items.push(parseArc(child));
        else if (isTagged(child, "polyline")) items.push(parsePolyline(child));
        else if (isTagged(child, "text")) items.push(parseText(child));
        // `bezier`/curves are intentionally not extracted -- see the
        // parser-coverage note at the bottom of this file.
    }
    return items;
}

function parsePins(unitNode: SExpr): KicadPin[] {
    return findAll(unitNode, "pin").map(parsePin);
}

// Reads every (property "KEY" "VALUE" ...) directly inside `symbolNode`
// (top-level symbol properties only -- unit sub-symbols cannot have
// properties per the grammar, so this is never called on a unit node).
function parseProperties(symbolNode: SExpr): Record<string, string> {
    const props: Record<string, string> = {};
    for (const propNode of findAll(symbolNode, "property")) {
        const key = str(propNode, 1, "property.key");
        const value = typeof propNode[2] === "string" ? propNode[2] : "";
        props[key] = value;
    }
    return props;
}

// Picks which embedded `(symbol "Name_UNIT_STYLE" ...)` sub-symbol to use
// for preview, per the task brief: "multi-unit symbols by taking unit 1".
// KiCad's own unit-id convention is NAME_UNIT_STYLE where UNIT=0 means
// "common to all units" (always-shown shared graphics, e.g. many ICs draw
// their outline once in unit 0 and put only pins in unit 1/2/3...) and
// UNIT=1 is the first real, selectable unit. A faithful single-unit preview
// therefore needs BOTH: unit-0's shared graphics (if present) plus unit-1's
// own items, merged -- taking unit 1 alone would silently drop a shared
// outline for any IC that uses the unit-0-common-body pattern.
function extractPreviewUnit(symbolNode: SExpr, symbolId: string): KicadUnit {
    const subSymbols = findAll(symbolNode, "symbol");
    if (subSymbols.length === 0) {
        // No embedded units at all -- graphics/pins are direct children of
        // the top-level symbol node itself (legal per the grammar; simple
        // single-unit symbols are sometimes authored this way, though real
        // KiCad-saved files always emit at least one "_0_1"/"_1_1" pair).
        return { items: parseGraphicItems(symbolNode), pins: parsePins(symbolNode) };
    }

    const items: GraphicItem[] = [];
    const pins: KicadPin[] = [];
    for (const sub of subSymbols) {
        const unitId = typeof sub[1] === "string" ? sub[1] : "";
        // unitId looks like "R_0_1" -- split off the two trailing
        // underscore-delimited integers (UNIT, STYLE) per KiCad's Symbol
        // Unit Identifier convention. Anything that doesn't parse this way
        // (a malformed or hand-edited unit id) is treated as unit 1 so a
        // slightly nonstandard file still contributes SOMETHING to preview
        // rather than being silently skipped.
        const parts = unitId.split("_");
        const unitNum = parts.length >= 3 ? Number(parts[parts.length - 2]) : 1;
        if (unitNum === 0 || unitNum === 1) {
            items.push(...parseGraphicItems(sub));
            pins.push(...parsePins(sub));
        }
    }
    if (items.length === 0 && pins.length === 0) {
        throw new Error(`symbol "${symbolId}": no unit 0 or unit 1 sub-symbol with graphics/pins found`);
    }
    return { items, pins };
}

function parseSymbol(symbolNode: SExpr, allSymbolsById: Map<string, SExpr>): KicadSymbol {
    const id = str(symbolNode, 1, "symbol.id");
    const extendsNode = find(symbolNode, "extends");
    const extendsId = extendsNode && typeof extendsNode[1] === "string" ? extendsNode[1] : undefined;

    let properties = parseProperties(symbolNode);
    let unit: KicadUnit;

    if (extendsId) {
        // Derived symbol: per the grammar, "Extended symbols currently can
        // only have different SYMBOL_PROPERTIES than their parent symbol" --
        // i.e. the CHILD carries no graphics/pins of its own at all; drawing
        // is 100% inherited from the parent. Properties merge child-over-
        // parent (child's own values win) so e.g. a derived "R_Small"
        // variant can override just its footprint/value while still
        // rendering the base "R" body+pins.
        const parentNode = allSymbolsById.get(extendsId);
        if (!parentNode) throw new Error(`symbol "${id}": extends "${extendsId}", but that symbol was not found in this library`);
        const parent = parseSymbol(parentNode, allSymbolsById);
        properties = { ...parent.properties, ...properties };
        unit = parent.unit;
    } else {
        unit = extractPreviewUnit(symbolNode, id);
    }

    return { id, name: id, properties, extends: extendsId, unit };
}

// Parses a full `.kicad_sym` file's text. Throws (with the underlying
// SExprSyntaxError's line/col if the failure was tokenizing/parsing, or a
// plain Error for a structurally-invalid-but-syntactically-fine tree, e.g.
// a `pin` missing its `at`) -- callers (SymbolLibraryPanel) are expected to
// catch and display this inline rather than letting it propagate, per the
// task brief ("errors shown inline, not thrown" -- that's a UI-layer
// concern, not this parser's; this function itself throws on purpose so
// there's exactly one place callers need a try/catch).
export function parseKicadSymbolLibrary(src: string): KicadLibrary {
    const roots = parseSExpr(src);
    const lib = roots.find((r) => isTagged(r, "kicad_symbol_lib"));
    if (!lib) throw new Error('not a .kicad_sym file: missing top-level "(kicad_symbol_lib ...)"');

    const versionNode = find(lib, "version");
    const generatorNode = find(lib, "generator");

    // Two passes: first collect every top-level `(symbol "Id" ...)` node by
    // id (so `extends` can look sideways/forwards to a symbol defined later
    // in the same file -- KiCad doesn't guarantee derived symbols appear
    // after their parent), then parse each one for real.
    const topLevelSymbolNodes = findAll(lib, "symbol");
    const byId = new Map<string, SExpr>();
    for (const node of topLevelSymbolNodes) {
        const id = typeof node[1] === "string" ? node[1] : undefined;
        if (id) byId.set(id, node);
    }

    const symbols = topLevelSymbolNodes.map((node) => parseSymbol(node, byId));
    return {
        version: versionNode && typeof versionNode[1] === "number" ? String(versionNode[1]) : (versionNode && typeof versionNode[1] === "string" ? versionNode[1] : undefined),
        generator: generatorNode && typeof generatorNode[1] === "string" ? generatorNode[1] : undefined,
        symbols,
    };
}

// mm -> world-unit conversion, with the Y flip: KiCad symbol space has Y
// pointing UP (increasing Y = up the page, standard math convention); this
// app's canvas/SVG space has Y pointing DOWN (increasing Y = down the
// screen, standard screen convention). Every coordinate pulled out of a
// parsed symbol (graphic item points, pin anchors/tips, text positions) must
// go through this single helper before it's usable in world space, so the
// flip is applied in exactly one place rather than risking a missed spot.
export function toWorld(p: Point): Point {
    return { x: p.x * MM_TO_WORLD, y: -p.y * MM_TO_WORLD };
}

// Lengths (radius, stroke width, pin length) have no sign/direction, so they
// only need the scale factor, never the Y flip.
export function mmLengthToWorld(mm: number): number {
    return mm * MM_TO_WORLD;
}

// --- Parser coverage / limitations (see also the top-of-file comment) ----
//
// Extracted: symbol id/name, `extends` (graphics+pins inherited from
// parent, properties merged child-over-parent), all `property` KEY/VALUE
// pairs (not just Reference/Value -- callers can read Footprint/Datasheet/
// custom fields too), rectangle/circle/arc/polyline/text graphic items,
// full pin data (electrical type, graphic style, at/rotation/length,
// name/number, derived tip). Unit selection takes unit 0 (shared-body
// convention) merged with unit 1, per KiCad's own NAME_UNIT_STYLE scheme.
//
// Ignored/simplified (each is a deliberate scope cut, not an oversight):
// - Units 2+ and alternate body styles ("de Morgan" STYLE=2) are dropped --
//   only one representative drawing is kept, since preview/binding only
//   ever shows ONE static image of a symbol.
// - `pin_names`/`pin_numbers` visibility flags (hide, offset) are not
//   tracked -- SymbolPreview's `showPins` prop is a single on/off toggle,
//   not a per-symbol-authored default.
// - Pin `alternate` definitions (KiCad 7+ "alternate function" pins) are
//   not extracted -- only the pin's own primary electrical/graphical type.
// - Text `effects` (font face/size/thickness/bold/italic/justify/hide) are
//   discarded beyond the bare text string + position -- SymbolPreview draws
//   all text at one fixed size.
// - `bezier` (curve) graphic items are not extracted -- no SVG cubic-path
//   support was built for a shape genuinely rare outside hand-drawn logos.
// - Non-Reference/Value properties (Footprint, Datasheet, custom fields)
//   ARE captured in `properties` but SymbolPreview does not render them.
// - `fill` type "background" is tracked but SymbolPreview treats it the
//   same as "outline" (both filled with the stroke color) since this app
//   has no schematic theme "background color" concept of its own to
//   delegate to.
// - Symbol-level `unit_name`, `in_bom`, `on_board`, and the library header's
//   arbitrary trailing content are parsed-through but not surfaced.
