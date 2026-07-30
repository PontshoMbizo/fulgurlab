// What changed about a chip's pins across a recompile, and does it matter to
// the user's existing wiring?
//
// Post geometry (ext_chip.ts setPoints()) makes this answerable precisely:
//   - OUTPUT posts sit at `y - LEAD`, independent of the board size, so they
//     never move; only the count of them can change.
//   - INPUT posts sit below the board, whose width is
//     `max(inCount, outCount, SIZE_X)` columns -- so the input row moves only
//     when THAT maximum changes.
// A recompile that keeps the same column count therefore leaves every
// still-existing post exactly where it was, and attached wires stay attached.

export interface PinRef {
    name: string;
    dir: "in" | "out";
}

export interface PinChange {
    added: PinRef[];
    removed: PinRef[];
    /** Same set of names, different order -- bit positions shift, so it matters. */
    reordered: boolean;
    /** Board column count before/after; if these differ the input row moves. */
    colsBefore: number;
    colsAfter: number;
    /** True when some surviving post has moved, i.e. wiring may be stranded. */
    layoutMoved: boolean;
    /** Empty when nothing changed at all. */
    summary: string;
}

// Mirrors ExtChipElm.SIZE_X -- the minimum board width in pin columns.
const MIN_COLS = 2;

function cols(pins: PinRef[]): number {
    const ins = pins.filter((p) => p.dir === "in").length;
    const outs = pins.filter((p) => p.dir === "out").length;
    return Math.max(ins, outs, MIN_COLS);
}

function key(p: PinRef) { return `${p.name}:${p.dir}`; }

export function describePinChange(before: PinRef[], after: PinRef[]): PinChange {
    const beforeKeys = new Set(before.map(key));
    const afterKeys = new Set(after.map(key));

    const added = after.filter((p) => !beforeKeys.has(key(p)));
    const removed = before.filter((p) => !afterKeys.has(key(p)));

    const sameSet = added.length === 0 && removed.length === 0;
    const reordered = sameSet && before.some((p, i) => key(p) !== key(after[i]));

    const colsBefore = cols(before);
    const colsAfter = cols(after);
    const layoutMoved = colsBefore !== colsAfter;

    const parts: string[] = [];
    if (added.length) parts.push(`+${added.length} pin${added.length > 1 ? "s" : ""} (${added.map((p) => p.name).join(", ")})`);
    if (removed.length) parts.push(`-${removed.length} pin${removed.length > 1 ? "s" : ""} (${removed.map((p) => p.name).join(", ")})`);
    if (reordered) parts.push("pin order changed");
    if (layoutMoved && before.length > 0) parts.push("the input row moved — check wiring");

    return { added, removed, reordered, colsBefore, colsAfter, layoutMoved, summary: parts.join("; ") };
}
