import { describe, it, expect } from "vitest";
import { createElement } from "@fulgurlab/engine/src/core/factory";
import type { CircuitElm } from "@fulgurlab/engine/src/elements/base";
import {
    GRID_SIZE, snap, distanceToElement, elementBounds, marqueeMode,
    rectContainsBounds, rectIntersectsBounds, elementInMarquee, circuitBounds,
    distanceToPoint,
} from "./draw";

// TODO.md P1-3: canvas/ was the largest untested area in the app (1,095 + 984
// LOC). CircuitCanvas.tsx itself is a React component with a rAF loop and is out
// of scope for a `environment: "node"` suite, but draw.ts is all pure geometry --
// hit-testing, marquee selection, bounds -- and it is exactly the part whose
// bugs are invisible until someone can't select a component.

function elm(type: string, x: number, y: number, x2: number, y2: number, tokens: string[] = []): CircuitElm {
    const e = createElement(type, x, y, x2, y2, 0, tokens)!;
    e.preStamp();
    return e;
}

describe("snap / grid", () => {
    it("rounds to the nearest grid multiple", () => {
        expect(snap(0)).toBe(0);
        expect(snap(GRID_SIZE / 2 - 1)).toBe(0);
        expect(snap(GRID_SIZE / 2 + 1)).toBe(GRID_SIZE);
        expect(snap(GRID_SIZE * 3 + 2)).toBe(GRID_SIZE * 3);
    });

    it("handles negatives symmetrically", () => {
        expect(snap(-GRID_SIZE * 2 - 1)).toBe(-GRID_SIZE * 2);
        expect(snap(-GRID_SIZE * 2 + 1)).toBe(-GRID_SIZE * 2);
    });
});

describe("distanceToPoint", () => {
    it("is the euclidean distance", () => {
        expect(distanceToPoint({ x: 0, y: 0 }, 3, 4)).toBeCloseTo(5);
        expect(distanceToPoint({ x: 10, y: 10 }, 10, 10)).toBe(0);
    });
});

describe("distanceToElement", () => {
    it("is zero on the body and grows with perpendicular offset", () => {
        const r = elm("r", 0, 0, 64, 0, ["1000"]);
        expect(distanceToElement(r, 32, 0)).toBeCloseTo(0);
        expect(distanceToElement(r, 32, 10)).toBeCloseTo(10);
        expect(distanceToElement(r, 32, -10)).toBeCloseTo(10);
    });

    it("clamps to the segment ends rather than extending the line", () => {
        const r = elm("r", 0, 0, 64, 0, ["1000"]);
        // 20px beyond the far end: the nearest point is the endpoint itself.
        expect(distanceToElement(r, 84, 0)).toBeCloseTo(20);
    });

    it("hit-tests a 1-post element along its drawn stem, not just its post", () => {
        // GroundElm reports one post but is DRAWN from point1 to point2, and
        // distanceToElement measures against that segment -- so clicking
        // anywhere on the stem selects it, which is what a user expects.
        const g = elm("g", 100, 100, 100, 116);
        expect(distanceToElement(g, 100, 100)).toBeCloseTo(0);
        expect(distanceToElement(g, 100, 110)).toBeCloseTo(0);
        expect(distanceToElement(g, 120, 108)).toBeCloseTo(20);
    });

    it("reaches the extra posts of a multi-post element", () => {
        // A transistor's 3rd post sits off the point1->point2 line; a click near
        // it must register as near the element.
        const t = elm("t", 100, 100, 164, 100, ["1"]);
        const p2 = t.getPost(2)!;
        expect(distanceToElement(t, p2.x, p2.y)).toBeLessThan(GRID_SIZE);
    });

    it("still hit-tests a zero-post annotation by its own extent", () => {
        // TextElm/BoxElm report 0 posts (GraphicElm), but they are placed and
        // must be clickable, so the point1->point2 segment is what gets
        // measured. The function's `posts.length === 0 -> Infinity` guard is
        // therefore unreachable in practice -- kept as a defensive default.
        const box = elm("b", 0, 0, 64, 64);
        expect(distanceToElement(box, 0, 0)).toBeCloseTo(0);
        expect(distanceToElement(box, 500, 500)).toBeGreaterThan(100);
    });
});

describe("elementBounds / circuitBounds", () => {
    it("covers both endpoints of a 2-post element", () => {
        const r = elm("r", 10, 20, 74, 20, ["1000"]);
        expect(elementBounds(r)).toEqual({ minX: 10, minY: 20, maxX: 74, maxY: 20 });
    });

    it("includes EVERY post, including ones that are not point1/point2", () => {
        const t = elm("f", 100, 100, 164, 100);
        const b = elementBounds(t);
        for (let i = 0; i < t.getPostCount(); i++) {
            const p = t.getPost(i)!;
            expect(p.x).toBeGreaterThanOrEqual(b.minX);
            expect(p.x).toBeLessThanOrEqual(b.maxX);
            expect(p.y).toBeGreaterThanOrEqual(b.minY);
            expect(p.y).toBeLessThanOrEqual(b.maxY);
        }
    });

    it("circuitBounds unions every element, and is null when empty", () => {
        expect(circuitBounds([])).toBeNull();
        const a = elm("r", 0, 0, 64, 0, ["1000"]);
        const b = elm("r", 100, 200, 164, 200, ["1000"]);
        expect(circuitBounds([a, b])).toEqual({ minX: 0, minY: 0, maxX: 164, maxY: 200 });
    });
});

describe("marquee selection", () => {
    const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };

    it("drag direction chooses contain vs touch mode", () => {
        // Left-to-right = fully-contained (KiCad's convention); right-to-left
        // = anything the box touches.
        expect(marqueeMode(0, 50)).toBe("contain");
        expect(marqueeMode(50, 0)).toBe("touch");
        expect(marqueeMode(10, 10)).toBe("contain");
    });

    it("rectContainsBounds requires the whole element inside", () => {
        expect(rectContainsBounds(rect, { minX: 10, minY: 10, maxX: 90, maxY: 90 })).toBe(true);
        expect(rectContainsBounds(rect, { minX: 10, minY: 10, maxX: 110, maxY: 90 })).toBe(false);
    });

    it("rectIntersectsBounds accepts a partial overlap and rejects a gap", () => {
        expect(rectIntersectsBounds(rect, { minX: 90, minY: 90, maxX: 200, maxY: 200 })).toBe(true);
        expect(rectIntersectsBounds(rect, { minX: 101, minY: 0, maxX: 200, maxY: 100 })).toBe(false);
    });

    it("a left-to-right drag selects only fully-enclosed elements", () => {
        const inside = elm("r", 16, 16, 80, 16, ["1000"]);
        const straddling = elm("r", 80, 48, 160, 48, ["1000"]);
        expect(elementInMarquee(inside, 0, 0, 100, 100)).toBe(true);
        expect(elementInMarquee(straddling, 0, 0, 100, 100)).toBe(false);
    });

    it("a right-to-left drag also selects elements it merely touches", () => {
        const straddling = elm("r", 80, 48, 160, 48, ["1000"]);
        expect(elementInMarquee(straddling, 100, 100, 0, 0)).toBe(true);
    });

    it("an element entirely outside is never selected, either way", () => {
        const far = elm("r", 500, 500, 564, 500, ["1000"]);
        expect(elementInMarquee(far, 0, 0, 100, 100)).toBe(false);
        expect(elementInMarquee(far, 100, 100, 0, 0)).toBe(false);
    });
});
