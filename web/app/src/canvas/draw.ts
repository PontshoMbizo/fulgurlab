import type { CircuitElm, Point } from "@fulgurlab/engine";

export const GRID_SIZE = 16;

export function snap(v: number): number {
    return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

// Distance from point to the nearest post-to-post segment of the element --
// used for click hit-testing. Falls back to the point1-point2 segment for
// anything with fewer than 2 usable posts.
export function distanceToElement(elm: CircuitElm, x: number, y: number): number {
    const n = Math.max(elm.getPostCount(), 2);
    const posts: Point[] = [];
    for (let i = 0; i < n; i++) {
        const p = elm.getPost(i);
        if (p) posts.push(p);
    }
    if (posts.length === 0) return Infinity;
    if (posts.length === 1) return Math.hypot(posts[0].x - x, posts[0].y - y);

    let best = Infinity;
    const segs: [Point, Point][] = [[elm.point1, elm.point2]];
    for (let i = 2; i < posts.length; i++) {
        const mid = { x: (elm.point1.x + elm.point2.x) / 2, y: (elm.point1.y + elm.point2.y) / 2 };
        segs.push([mid, posts[i]]);
    }
    for (const [a, b] of segs) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((x - a.x) * dx + (y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + dx * t, py = a.y + dy * t;
        best = Math.min(best, Math.hypot(px - x, py - y));
    }
    return best;
}

export interface Rect { x1: number; y1: number; x2: number; y2: number; } // x1<=x2, y1<=y2 (normalized)
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
    return { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) };
}

// Bounding box over every post the element exposes (point1/point2 PLUS any
// extra posts beyond index 1, e.g. an op-amp's third pin or a pot's wiper) --
// used by both the marquee's inside/touching test and zoom-to-fit. Falls
// back to just point1/point2 for elements that report 0 or 1 posts (ground,
// labeled nodes) so a degenerate single-point element still has a valid
// (zero-area) bbox rather than an empty/NaN one.
export function elementBounds(elm: CircuitElm): Bounds {
    // BUGFIX (found by draw.test.ts): this used to seed from point1/point2 and
    // then only add posts from index 2 up, on the assumption that post 0/1 ARE
    // point1/point2. That holds for a resistor but not for anything that fans
    // its posts off the body line -- a MOSFET's post 1 (source) sits a full
    // 16px off point2, so it fell outside the bounds and marquee selection
    // judged the element by a box that did not contain all of it. Union every
    // post AND both body endpoints.
    const pts: Point[] = [elm.point1, elm.point2];
    const n = elm.getPostCount();
    for (let i = 0; i < n; i++) {
        const p = elm.getPost(i);
        if (p) pts.push(p);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
}

// KiCad marquee semantics: dragging the rectangle so its actual (unnormalized)
// end point is to the RIGHT of the start point is "contain" mode (element
// must be FULLY inside); dragging so the end point is to the LEFT is "touch"
// mode (element merely overlapping counts). Only x matters for the
// direction test -- matches KiCad's own behavior, which keys off horizontal
// drag direction regardless of vertical movement.
export function marqueeMode(startX: number, endX: number): "contain" | "touch" {
    return endX >= startX ? "contain" : "touch";
}

export function rectContainsBounds(rect: Rect, b: Bounds): boolean {
    return b.minX >= rect.x1 && b.maxX <= rect.x2 && b.minY >= rect.y1 && b.maxY <= rect.y2;
}

export function rectIntersectsBounds(rect: Rect, b: Bounds): boolean {
    return b.minX <= rect.x2 && b.maxX >= rect.x1 && b.minY <= rect.y2 && b.maxY >= rect.y1;
}

// Single entry point the marquee-release handler calls: builds the
// normalized rect once, then applies the direction-dependent contain/touch
// test consistently.
export function elementInMarquee(elm: CircuitElm, startX: number, startY: number, endX: number, endY: number): boolean {
    const rect = normalizeRect(startX, startY, endX, endY);
    const bounds = elementBounds(elm);
    return marqueeMode(startX, endX) === "contain"
        ? rectContainsBounds(rect, bounds)
        : rectIntersectsBounds(rect, bounds);
}

// Zoom-to-fit (Home key): bbox over every element's posts, in world space.
// Returns null for an empty circuit so the caller can no-op rather than
// zooming to an undefined/infinite rectangle.
export function circuitBounds(elms: CircuitElm[]): Bounds | null {
    if (elms.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const elm of elms) {
        const b = elementBounds(elm);
        minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    return { minX, minY, maxX, maxY };
}

// Screen-space distance from a point to one of an element's two main
// endpoints (point1/point2) -- used by the endpoint-handle hit test, kept
// separate from distanceToElement() above since a handle grab needs to know
// WHICH endpoint (if any) was hit, not just "how close is the nearest point
// on the whole element".
export function distanceToPoint(p: Point, x: number, y: number): number {
    return Math.hypot(p.x - x, p.y - y);
}
