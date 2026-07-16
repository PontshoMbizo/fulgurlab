import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseSExpr, isTagged, find } from "./sexpr";
import { parseKicadSymbolLibrary, toWorld, MM_TO_WORLD } from "./kicadSym";
import { FIXTURE_RESISTOR, FIXTURE_IC4 } from "./fixtures";

describe("sexpr", () => {
    it("round-trips FIXTURE_RESISTOR without throwing, with the correct top-level shape", () => {
        const roots = parseSExpr(FIXTURE_RESISTOR);
        expect(roots.length).toBe(1);
        expect(isTagged(roots[0], "kicad_symbol_lib")).toBe(true);
        const versionNode = find(roots[0], "version");
        expect(versionNode?.[1]).toBe(20211014);
        const generatorNode = find(roots[0], "generator");
        expect(generatorNode?.[1]).toBe("kicad_symbol_editor");
    });

    it("round-trips FIXTURE_IC4 without throwing, with the correct top-level shape", () => {
        const roots = parseSExpr(FIXTURE_IC4);
        expect(roots.length).toBe(1);
        expect(isTagged(roots[0], "kicad_symbol_lib")).toBe(true);
    });

    it("parses quoted strings with escaped quotes", () => {
        const roots = parseSExpr(`(foo "a \\"quoted\\" value" bar)`);
        expect(roots[0]).toEqual(["foo", 'a "quoted" value', "bar"]);
    });

    it("parses nested lists and numeric atoms", () => {
        const roots = parseSExpr(`(at 1.27 -3.81 270)`);
        expect(roots[0]).toEqual(["at", 1.27, -3.81, 270]);
    });

    it("throws a SExprSyntaxError with line/col on an unterminated list", () => {
        expect(() => parseSExpr(`(kicad_symbol_lib (version 1)`)).toThrowError(/line \d+, col \d+/);
    });

    it("throws with line/col on an unterminated string", () => {
        expect(() => parseSExpr(`(property "unterminated)`)).toThrowError(/line \d+, col \d+/);
    });
});

describe("kicadSym: Fixture:R (resistor)", () => {
    const lib = parseKicadSymbolLibrary(FIXTURE_RESISTOR);
    const r = lib.symbols.find((s) => s.id === "Fixture:R")!;

    it("finds exactly one symbol with the expected id and properties", () => {
        expect(lib.symbols.length).toBe(1);
        expect(r).toBeDefined();
        expect(r.properties.Reference).toBe("R");
        expect(r.properties.Value).toBe("R");
    });

    it("extracts the rectangle body from unit 0", () => {
        const rect = r.unit.items.find((i) => i.kind === "rectangle");
        expect(rect).toBeDefined();
        if (rect?.kind === "rectangle") {
            expect(rect.start).toEqual({ x: -1.27, y: 2.54 });
            expect(rect.end).toEqual({ x: 1.27, y: -2.54 });
        }
    });

    it("extracts exactly 2 pins with correct names/numbers", () => {
        expect(r.unit.pins.length).toBe(2);
        expect(r.unit.pins.map((p) => p.number).sort()).toEqual(["1", "2"]);
        expect(r.unit.pins.every((p) => p.name === "~")).toBe(true);
        expect(r.unit.pins.every((p) => p.electrical === "passive")).toBe(true);
    });

    it("computes exact mm coordinates for pin 1 (at, rotation, length, tip)", () => {
        const pin1 = r.unit.pins.find((p) => p.number === "1")!;
        expect(pin1.at).toEqual({ x: 0, y: 3.81 });
        expect(pin1.rotation).toBe(270);
        expect(pin1.length).toBe(1.27);
        // rot=270 (south, -Y) from (0,3.81) by 1.27mm -> (0, 2.54) --
        // see kicadSym.ts's pinTip() worked-example comment.
        expect(pin1.tip.x).toBeCloseTo(0, 9);
        expect(pin1.tip.y).toBeCloseTo(2.54, 9);
    });

    it("computes exact mm coordinates for pin 2", () => {
        const pin2 = r.unit.pins.find((p) => p.number === "2")!;
        expect(pin2.at).toEqual({ x: 0, y: -3.81 });
        expect(pin2.rotation).toBe(90);
        expect(pin2.tip.x).toBeCloseTo(0, 9);
        expect(pin2.tip.y).toBeCloseTo(-2.54, 9);
    });

    it("MM_TO_WORLD maps 2.54mm to exactly 16 world units", () => {
        expect(MM_TO_WORLD * 2.54).toBeCloseTo(16, 9);
    });

    it("toWorld places pin tips on exact multiples of 16 (flipping Y)", () => {
        const pin1 = r.unit.pins.find((p) => p.number === "1")!;
        const pin2 = r.unit.pins.find((p) => p.number === "2")!;
        const tip1World = toWorld(pin1.tip);
        const tip2World = toWorld(pin2.tip);
        // mm (0, 2.54) -> world (0, -16) -- Y flips because KiCad's Y points
        // up and world/SVG Y points down.
        expect(tip1World.x).toBeCloseTo(0, 6);
        expect(tip1World.y).toBeCloseTo(-16, 6);
        expect(tip2World.x).toBeCloseTo(0, 6);
        expect(tip2World.y).toBeCloseTo(16, 6);
    });

    it("toWorld places pin connection points (at) at the expected world coordinates", () => {
        const pin1 = r.unit.pins.find((p) => p.number === "1")!;
        const atWorld = toWorld(pin1.at);
        // mm (0, 3.81) -> world (0, -3.81 * 16/2.54) = (0, -24)
        expect(atWorld.x).toBeCloseTo(0, 6);
        expect(atWorld.y).toBeCloseTo(-24, 6);
    });
});

describe("kicadSym: Fixture:IC4 (4-pin IC)", () => {
    const lib = parseKicadSymbolLibrary(FIXTURE_IC4);
    const ic = lib.symbols.find((s) => s.id === "Fixture:IC4")!;

    it("extracts exactly 4 pins with correct names/numbers/order", () => {
        expect(ic.unit.pins.length).toBe(4);
        const byNumber = Object.fromEntries(ic.unit.pins.map((p) => [p.number, p]));
        expect(byNumber["1"].name).toBe("VIN");
        expect(byNumber["2"].name).toBe("GND");
        expect(byNumber["3"].name).toBe("VOUT");
        expect(byNumber["4"].name).toBe("EN");
    });

    it("left-side pins (rot 0) have tips pointing toward +X (into the body)", () => {
        const lib2 = ic.unit.pins.find((p) => p.number === "1")!;
        expect(lib2.at).toEqual({ x: -7.62, y: 1.27 });
        expect(lib2.rotation).toBe(0);
        expect(lib2.tip.x).toBeCloseTo(-5.08, 9);
        expect(lib2.tip.y).toBeCloseTo(1.27, 9);
    });

    it("right-side pins (rot 180) have tips pointing toward -X (into the body)", () => {
        const pin3 = ic.unit.pins.find((p) => p.number === "3")!;
        expect(pin3.at).toEqual({ x: 7.62, y: 1.27 });
        expect(pin3.rotation).toBe(180);
        expect(pin3.tip.x).toBeCloseTo(5.08, 9);
        expect(pin3.tip.y).toBeCloseTo(1.27, 9);
    });

    it("all 4 pin tips land on exact multiples of 8 world units after toWorld (2.54-grid geometry)", () => {
        // toBeCloseTo (not Number.isInteger) because 16/2.54 is not exactly
        // representable in floating point -- e.g. 5.08 * (16/2.54) evaluates
        // to 31.999999999999996, not a bit-exact 32. The GEOMETRY is exact
        // (2mm-grid steps map to exact multiples of 8 world units); only
        // IEEE 754 rounding is inexact, which toBeCloseTo's tolerance
        // absorbs the same way every other coordinate assertion in this
        // file already does.
        for (const pin of ic.unit.pins) {
            const w = toWorld(pin.tip);
            expect(Math.round(w.x / 8)).toBeCloseTo(w.x / 8, 6);
            expect(Math.round(w.y / 8)).toBeCloseTo(w.y / 8, 6);
        }
    });

    it("extracts the body rectangle", () => {
        const rect = ic.unit.items.find((i) => i.kind === "rectangle");
        expect(rect).toBeDefined();
        if (rect?.kind === "rectangle") {
            expect(rect.start).toEqual({ x: -5.08, y: 2.54 });
            expect(rect.end).toEqual({ x: 5.08, y: -2.54 });
            expect(rect.fill.type).toBe("background");
        }
    });
});

describe("kicadSym: malformed input handling", () => {
    it("throws a descriptive error (not a silent NaN) for a non-.kicad_sym file", () => {
        expect(() => parseKicadSymbolLibrary(`(not_a_symbol_lib (foo 1))`)).toThrow(/kicad_symbol_lib/);
    });

    it("throws when extends references a symbol that doesn't exist in the library", () => {
        const src = `(kicad_symbol_lib (version 1) (generator test)
            (symbol "Lib:Child" (extends "Lib:Missing")
                (property "Reference" "U" (at 0 0 0))
                (property "Value" "Child" (at 0 0 0))
            )
        )`;
        expect(() => parseKicadSymbolLibrary(src)).toThrow(/Lib:Missing/);
    });
});

describe("kicadSym: extends inheritance", () => {
    it("a derived symbol inherits the parent's graphics/pins and merges properties child-over-parent", () => {
        const src = `(kicad_symbol_lib (version 1) (generator test)
            (symbol "Lib:Base"
                (property "Reference" "R" (at 0 0 0))
                (property "Value" "Base" (at 0 0 0))
                (symbol "Base_0_1"
                    (rectangle (start -1 1) (end 1 -1) (stroke (width 0.254) (type default)) (fill (type none)))
                )
                (symbol "Base_1_1"
                    (pin passive line (at 0 2 270) (length 1)
                        (name "~" (effects (font (size 1 1))))
                        (number "1" (effects (font (size 1 1))))
                    )
                )
            )
            (symbol "Lib:Derived" (extends "Lib:Base")
                (property "Reference" "R" (at 0 0 0))
                (property "Value" "Derived" (at 0 0 0))
            )
        )`;
        const lib = parseKicadSymbolLibrary(src);
        const derived = lib.symbols.find((s) => s.id === "Lib:Derived")!;
        expect(derived).toBeDefined();
        expect(derived.properties.Value).toBe("Derived"); // child's own value wins
        expect(derived.unit.pins.length).toBe(1); // inherited from parent
        expect(derived.unit.items.length).toBe(1); // inherited from parent
        expect(derived.unit.pins[0].number).toBe("1");
    });
});

describe("arc-to-path (via SymbolPreview's geometry, re-derived here for a unit test with no DOM)", () => {
    // SymbolPreview.tsx is a component (skipped per the task's test-scope
    // note), but its arcToPathD() helper is pure geometry with no React/DOM
    // dependency -- re-implementing the same circumcenter math here keeps
    // this test independent of importing a .tsx file into a node-environment
    // vitest run, while still proving the underlying formula is sound for a
    // known arc.
    function arcToPathD(start: { x: number; y: number }, mid: { x: number; y: number }, end: { x: number; y: number }): string {
        const { x: ax, y: ay } = start, { x: bx, y: by } = mid, { x: cx, y: cy } = end;
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
        if (Math.abs(d) < 1e-9) return `M${ax},${ay} L${cx},${cy}`;
        const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
        const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
        const radius = Math.hypot(ax - ux, ay - uy);
        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const sweepFlag = cross < 0 ? 1 : 0;
        return `M${ax},${ay} A${radius},${radius} 0 ${sweepFlag === 1 ? 1 : 0} ${sweepFlag} ${cx},${cy}`;
    }

    it("returns a finite, well-formed path for a known quarter-circle arc", () => {
        // Quarter circle of radius 10 centered at origin: start at (10,0),
        // mid at 45deg (~7.07,7.07), end at (0,10).
        const d = arcToPathD({ x: 10, y: 0 }, { x: 7.0710678, y: 7.0710678 }, { x: 0, y: 10 });
        expect(d).toMatch(/^M10,0 A/);
        const radiusMatch = d.match(/A([\d.]+),([\d.]+)/);
        expect(radiusMatch).not.toBeNull();
        const radius = Number(radiusMatch![1]);
        expect(radius).toBeCloseTo(10, 3);
        expect(Number.isFinite(radius)).toBe(true);
    });
});

describe("bindings (with a mocked localStorage)", () => {
    // Simple in-memory shim assigned to globalThis.localStorage, per the
    // task's exact instruction -- this is NOT jsdom's localStorage (there is
    // no DOM in this vitest config, by design; SymbolPreview needs no
    // component test, and bindings.ts's own guards only need
    // `typeof window` + a `localStorage`-shaped object to exist).
    class MemoryStorage {
        private store = new Map<string, string>();
        getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
        setItem(key: string, value: string) { this.store.set(key, value); }
        removeItem(key: string) { this.store.delete(key); }
        clear() { this.store.clear(); }
    }

    beforeEach(() => {
        (globalThis as unknown as { window: unknown }).window = globalThis;
        (globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();
    });

    it("addBinding/listBindings/removeBinding/getVisualOverride round-trip through the mocked localStorage", async () => {
        // vi.resetModules() + a plain dynamic import (same specifier every
        // time -- fully type-checks, unlike a fake "?query-string" suffix
        // that Vite's dev-server resolver understands but tsc does not) so
        // each test gets its own fresh BindingStore module instance -- the
        // store is a module-level singleton that reads localStorage once at
        // construction, so re-import-without-reset would silently reuse
        // whatever the FIRST test's construction already loaded.
        vi.resetModules();
        const { addBinding: add, listBindings: list, removeBinding: remove, getVisualOverride: getOverride } = await import("./bindings");
        const lib = parseKicadSymbolLibrary(FIXTURE_RESISTOR);
        const symbol = lib.symbols[0];

        expect(list()).toEqual([]);

        const binding = add({
            symbolId: symbol.id,
            libFileName: "fixture.kicad_sym",
            target: { kind: "element", dumpType: "r", flags: 0, label: "Resistor" },
            symbolData: symbol,
        });

        expect(list().length).toBe(1);
        expect(list()[0].id).toBe(binding.id);

        const override = getOverride("r", 0);
        expect(override).not.toBeNull();
        expect(override?.id).toBe("Fixture:R");

        expect(getOverride("r", 1)).toBeNull(); // different flags, no match
        expect(getOverride("c", 0)).toBeNull(); // different dumpType, no match

        remove(binding.id);
        expect(list()).toEqual([]);
        expect(getOverride("r", 0)).toBeNull();
    });

    it("persists bindings across a fresh module load reading the same mocked localStorage", async () => {
        vi.resetModules();
        const first = await import("./bindings");
        const lib = parseKicadSymbolLibrary(FIXTURE_IC4);
        const symbol = lib.symbols[0];
        first.addBinding({
            symbolId: symbol.id,
            libFileName: "ic4.kicad_sym",
            target: { kind: "extchip" },
            symbolData: symbol,
        });

        // vi.resetModules() again + re-importing the SAME specifier forces
        // vitest to evaluate the module fresh (new BindingStore instance,
        // discarding `first`'s in-memory state), simulating a page reload
        // that re-constructs the singleton and reads whatever's already in
        // the mocked localStorage -- proving persistence isn't just an
        // artifact of reusing the same in-memory instance.
        vi.resetModules();
        const second = await import("./bindings");
        const persisted = second.listBindings();
        expect(persisted.length).toBe(1);
        expect(persisted[0].symbolId).toBe("Fixture:IC4");
        expect(persisted[0].target).toEqual({ kind: "extchip" });
    });
});
