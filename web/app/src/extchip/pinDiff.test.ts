import { describe, it, expect } from "vitest";
import { describePinChange, type PinRef } from "./pinDiff";

const p = (name: string, dir: "in" | "out"): PinRef => ({ name, dir });

const TANG: PinRef[] = [
    p("btn1", "in"), p("btn2", "in"),
    p("leds[0]", "out"), p("leds[1]", "out"), p("leds[2]", "out"),
    p("leds[3]", "out"), p("leds[4]", "out"), p("leds[5]", "out"),
];

describe("describePinChange", () => {
    it("reports nothing for an identical pin list", () => {
        const c = describePinChange(TANG, [...TANG]);
        expect(c.added).toEqual([]);
        expect(c.removed).toEqual([]);
        expect(c.reordered).toBe(false);
        expect(c.layoutMoved).toBe(false);
        expect(c.summary).toBe("");
    });

    it("detects added and removed pins", () => {
        const after = [...TANG.slice(0, 7), p("buzzer", "out")];
        const c = describePinChange(TANG, after);
        expect(c.added.map((x) => x.name)).toEqual(["buzzer"]);
        expect(c.removed.map((x) => x.name)).toEqual(["leds[5]"]);
        expect(c.summary).toContain("buzzer");
        expect(c.summary).toContain("leds[5]");
    });

    it("detects a pure reorder -- same names, shifted bit positions", () => {
        const after = [TANG[1], TANG[0], ...TANG.slice(2)];
        const c = describePinChange(TANG, after);
        expect(c.added).toEqual([]);
        expect(c.removed).toEqual([]);
        expect(c.reordered).toBe(true);
        expect(c.summary).toContain("order");
    });

    // Output posts sit at y - LEAD regardless of board size, so they never
    // move. Input posts hang below the board, whose width is
    // max(inCount, outCount, 2) columns -- so wiring is only at risk when THAT
    // maximum changes.
    it("flags layoutMoved only when the column count changes", () => {
        // 6 outputs -> 8 outputs: board widens, input row moves down.
        const wider = [...TANG, p("leds[6]", "out"), p("leds[7]", "out")];
        expect(describePinChange(TANG, wider).layoutMoved).toBe(true);

        // Renaming an output keeps max(2, 6) = 6 columns: nothing moves.
        const renamed = [...TANG.slice(0, 7), p("spare", "out")];
        expect(describePinChange(TANG, renamed).layoutMoved).toBe(false);
    });

    it("respects the 2-column minimum, so tiny pin sets do not move things", () => {
        const one = [p("a", "in")];
        const two = [p("a", "in"), p("b", "in")];
        // max(1,0,2) = 2 and max(2,0,2) = 2 -- both clamp to the minimum.
        expect(describePinChange(one, two).layoutMoved).toBe(false);
    });

    it("does not warn about a moved input row on a first compile", () => {
        const c = describePinChange([], TANG);
        expect(c.summary).not.toContain("check wiring");
    });
});
