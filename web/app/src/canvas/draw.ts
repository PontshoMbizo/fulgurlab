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
