// Binding registry: maps a KiCad symbol the user imported to a palette
// element type (or the generic "ExtChip" template), so the canvas can later
// look up "does dumpType X with these flags have a user-bound visual?" and
// draw that symbol instead of the built-in ElementSymbol body.
//
// Persistence: the parsed symbol DATA itself is embedded in each binding
// (not just a file name/path), since a browser has no stable handle back to
// a file the user picked once via <input type=file> -- re-reading it isn't
// possible without asking the user to re-select it. Embedding means a
// binding survives a reload with zero re-import step, at the cost of
// localStorage size (acceptable: a handful of symbols' worth of rectangles/
// pins is a few KB each, nowhere near localStorage's ~5MB/origin ceiling for
// any realistic number of bindings).
//
// Subscribe pattern deliberately mirrors engine/store.ts's EngineStore
// (Set<listener>, subscribe()/notify-all-on-change) so SymbolLibraryPanel
// can plug into React the same way every other store-backed panel in this
// app already does (useSyncExternalStore(bindings.subscribe, ...)), rather
// than introducing a second, different state-sharing idiom.

"use client";

import type { KicadSymbol } from "./kicadSym";

const STORAGE_KEY = "fulgurlab.kicad.bindings";

export type BindingTarget =
    | { kind: "element"; dumpType: string; flags: number; label: string }
    | { kind: "extchip" };

export interface Binding {
    /** Stable id for this binding row itself (not the symbol's own KiCad id) -- lets two different bindings point at the same symbolId (e.g. bound to two different flag variants) without colliding. */
    id: string;
    symbolId: string; // the KiCad "LIBRARY_ID", e.g. "Fixture:R" -- kept for display/debugging, NOT used as the lookup key (see getVisualOverride)
    libFileName: string; // the imported file's name, for display in the bindings list ("from resistors.kicad_sym")
    target: BindingTarget;
    symbolData: KicadSymbol; // the full parsed symbol, embedded so this binding is self-contained (see file header note)
}

function hasWindow(): boolean {
    return typeof window !== "undefined";
}

// Every localStorage touch is guarded the same way (typeof window check,
// try/catch around the actual read/write) since this module is imported by
// client components that CAN run during Next's server-side render pass
// before hydration -- localStorage simply doesn't exist there, and even in
// a real browser a call can throw (private-browsing quota errors, disabled
// storage, etc.) that shouldn't take down the whole panel.
function loadRaw(): Binding[] {
    if (!hasWindow()) return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveRaw(bindings: Binding[]) {
    if (!hasWindow()) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
    } catch {
        // Quota exceeded or storage disabled -- the in-memory `bindings`
        // array (see below) still reflects the change for this session;
        // silently failing to persist is preferable to throwing out of an
        // addBinding() call the user just triggered from a UI button.
    }
}

class BindingStore {
    private bindings: Binding[] = loadRaw();
    private listeners = new Set<() => void>();
    private nextId = 1;
    // Monotonic change counter for useSyncExternalStore (same shape as
    // engineStore.version/getVersion) -- lets the canvas re-render bound
    // symbols on bind/unbind without tracking array identity itself.
    private version = 0;

    private notify() {
        this.version++;
        for (const l of this.listeners) l();
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getVersion = () => this.version;

    listBindings(): Binding[] {
        return this.bindings;
    }

    addBinding(input: Omit<Binding, "id">): Binding {
        const binding: Binding = { ...input, id: `kb${this.nextId++}-${Date.now()}` };
        this.bindings = [...this.bindings, binding];
        saveRaw(this.bindings);
        this.notify();
        return binding;
    }

    removeBinding(id: string) {
        this.bindings = this.bindings.filter((b) => b.id !== id);
        saveRaw(this.bindings);
        this.notify();
    }

    // The lookup the canvas will call per-element-render: "is there a
    // user-bound symbol for this element type?" Keyed on (dumpType, flags)
    // rather than symbolId, since that's exactly the pair ElementSymbol
    // already has on hand for every element (String(elm.getDumpType()) +
    // whatever flags field that element type uses) -- see palette.ts's
    // PaletteItem shape, which is the same (dumpType, flags) pair a binding
    // target was chosen from. Returns the last-added match if more than one
    // binding somehow targets the same (dumpType, flags) pair, so a re-bind
    // (remove old, add new) always wins over a stale duplicate.
    getVisualOverride(dumpType: string, flags: number): KicadSymbol | null {
        for (let i = this.bindings.length - 1; i >= 0; i--) {
            const b = this.bindings[i];
            if (b.target.kind === "element" && b.target.dumpType === dumpType && b.target.flags === flags) {
                return b.symbolData;
            }
        }
        return null;
    }
}

export const bindingStore = new BindingStore();

// Free-function API matching the task brief's exact names, delegating to
// the singleton store -- kept as plain exports (rather than requiring every
// call site to import `bindingStore` itself) since that's the shape
// SymbolLibraryPanel and the lead agent's canvas lookup both expect.
export function listBindings(): Binding[] {
    return bindingStore.listBindings();
}

export function addBinding(input: Omit<Binding, "id">): Binding {
    return bindingStore.addBinding(input);
}

export function removeBinding(id: string): void {
    bindingStore.removeBinding(id);
}

export function getVisualOverride(dumpType: string, flags: number): KicadSymbol | null {
    return bindingStore.getVisualOverride(dumpType, flags);
}

export function subscribe(listener: () => void): () => void {
    return bindingStore.subscribe(listener);
}
