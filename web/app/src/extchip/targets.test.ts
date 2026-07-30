import { describe, it, expect } from "vitest";
import { ExtChipElm } from "@fulgurlab/engine";
import { TARGETS, targetById, targetForUrl, DEFAULT_TARGET_ID } from "./targets";

describe("co-simulation target catalogue", () => {
    it("has unique ids and non-empty labels", () => {
        const ids = TARGETS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const t of TARGETS) expect(t.label.length).toBeGreaterThan(0);
    });

    // The pin spec is what gives a freshly-placed chip real posts. If it does
    // not parse through the ELEMENT's own parser (not a lookalike here), the
    // board lands on the canvas with nothing to wire to -- the exact bug the
    // empty palette tokens used to cause.
    it("every defaultPinSpec parses into posts through ExtChipElm itself", () => {
        for (const t of TARGETS) {
            const elm = new ExtChipElm(0, 0, 100, 0, 0, ["ws://x", t.defaultPinSpec, "1000000", "", ""]);
            expect(elm.getPostCount(), `${t.id} produced no posts`).toBeGreaterThan(0);
            expect(elm.pins.length).toBe(elm.getPostCount());
        }
    });

    it("every pin in defaultPinSpec actually appears in defaultSource", () => {
        for (const t of TARGETS) {
            const elm = new ExtChipElm(0, 0, 100, 0, 0, ["ws://x", t.defaultPinSpec, "1000000", "", ""]);
            for (const pin of elm.pins) {
                // leds[0] -> the source declares the vector `leds`, so compare
                // on the base name rather than the exploded per-bit pin name.
                const base = pin.name.replace(/\[\d+\]$/, "");
                expect(t.defaultSource, `${t.id}: ${pin.name} missing from default source`)
                    .toContain(base);
            }
        }
    });

    it("has at least one FPGA and one MCU target, each with a usable url", () => {
        expect(TARGETS.some((t) => t.backend === "fpgasim")).toBe(true);
        expect(TARGETS.some((t) => t.backend === "mcusim")).toBe(true);
        for (const t of TARGETS) expect(t.defaultUrl).toMatch(/^wss?:\/\/.+/);
    });

    it("clock presets include the default clock when the target has one", () => {
        for (const t of TARGETS) {
            if (t.defaultClockHz === 0) {
                expect(t.clockPresets).toEqual([]);
                continue;
            }
            expect(t.clockPresets.map((p) => p.hz)).toContain(t.defaultClockHz);
        }
    });

    it("targetById falls back to the first target for unknown/blank ids", () => {
        expect(targetById(DEFAULT_TARGET_ID).id).toBe(DEFAULT_TARGET_ID);
        expect(targetById("no-such-board").id).toBe(TARGETS[0].id);
        expect(targetById("").id).toBe(TARGETS[0].id);
        expect(targetById(null).id).toBe(TARGETS[0].id);
    });

    // Chips saved before the targetId token existed have only a bridge URL to
    // go on, and the two reference backends live on distinct ports.
    it("targetForUrl recovers the target from a legacy bridge url", () => {
        for (const t of TARGETS) expect(targetForUrl(t.defaultUrl)?.id).toBe(t.id);
        expect(targetForUrl("ws://localhost:9999")).toBeNull();
        expect(targetForUrl("not a url")).toBeNull();
    });
});
