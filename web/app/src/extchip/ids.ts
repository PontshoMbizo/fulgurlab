import type { CircuitElm } from "@fulgurlab/engine";

// --- Chip identity -----------------------------------------------------
//
// The engine element (ExtChipElm) has no id field of its own -- CircuitElm
// identity is just "the same JS object reference" (see engineStore's own
// comments on why scope channels/selection hold direct elm references
// rather than indices). The ws registry (client.ts) is keyed by a plain
// number, so this module owns the one WeakMap<CircuitElm, number> + counter
// that hands out a stable id per placed element, lazily on first lookup.
//
// This lived in ExtChipDrawer.tsx until the drawer was replaced by
// editor/FirmwareEditorPane.tsx. It was never really a UI concern -- the
// store's per-step bridge glue and canvas/ExtChipBody.tsx both need the
// SAME id for the SAME element -- so it now sits in its own module rather
// than being re-homed into whichever component happens to be current.
//
// NOTE the consequence of keying on object identity: CircuitParser.parse()
// builds FRESH element instances, so every load/undo/import mints new ids
// and strands the old registry records. Callers that replace elmList must
// dispose the outgoing chips first -- see engineStore.disposeExtChips().
let nextExtChipId = 1;
const extChipIds = new WeakMap<CircuitElm, number>();

export function extChipId(elm: CircuitElm): number {
    let id = extChipIds.get(elm);
    if (id === undefined) {
        id = nextExtChipId++;
        extChipIds.set(elm, id);
    }
    return id;
}
