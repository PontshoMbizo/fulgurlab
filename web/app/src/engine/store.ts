"use client";

import { CircuitEngine, CircuitElm, CircuitParser, createElement } from "@fulgurlab/engine";
import { extChipRegistry } from "@/extchip/client";
import { extChipId } from "@/extchip/ids";

// Bounded so a very long editing session can't grow this without limit --
// 100 steps is generous for a circuit editor (Falstad's own app has no
// visible cap either, but this is a deliberate, documented choice rather
// than an oversight).
const MAX_UNDO_STEPS = 100;

// Rolling window per scope channel -- a real oscilloscope/DAQ trace, not an
// unbounded log. 2000 samples is generous for a "last few seconds" MATLAB-
// style rolling plot without the array ever growing unbounded during a long
// run. push()+shift() is O(n) per sample, but n is small and stepsPerFrame
// tops out at 40 (SpeedSlider's own MAX_STEPS) -- comfortably cheap per
// 16ms frame; revisit with a true circular buffer only if profiling ever
// shows this hot.
const MAX_SCOPE_SAMPLES = 2000;

// MATLAB's default axes color order, loosely -- picked to stay visually
// distinct from this app's OWN semantic colors (theme.ts's SELECT_COLOR
// cyan-400, HOVER_COLOR violet-400, GROUND_COLOR green-600) so a scope trace
// is never confusable with a selection/hover highlight on the canvas itself.
const SCOPE_COLORS = ["#38bdf8", "#fb923c", "#facc15", "#e879f9", "#34d399", "#f472b6", "#60a5fa", "#fca5a5"];

export interface ScopeSample { t: number; value: number; }

export interface ScopeChannel {
    id: number;
    elm: CircuitElm;
    label: string;
    color: string;
    mode: "voltage" | "current";
    history: ScopeSample[];
}

// Single engine instance owned outside React state (plan §3.2: "the React
// app owns a single engine instance outside React state"). React components
// subscribe via useSyncExternalStore against `version`, which bumps on every
// completed step or circuit mutation. The canvas itself does NOT go through
// React per frame -- it reads engine.elmList directly in its own rAF loop;
// `version` is only for UI chrome (toolbar/inspector) that needs a re-render.
export type RunStatus =
    | { state: "idle" }
    | { state: "running" }
    | { state: "error"; message: string };

// Exported (alongside the `engineStore` singleton at the bottom) so tests can
// drive a FRESH store per case instead of sharing global state -- see
// store.test.ts.
export class EngineStore {
    engine = new CircuitEngine();
    version = 0;
    status: RunStatus = { state: "idle" };
    // Multi-select (KiCad-style), replacing the old single `selected` field.
    // A Set rather than an array so toggleSelect()/isSelected() are O(1) and
    // adding the same element twice (e.g. a marquee re-drag that re-includes
    // an already-selected element) is naturally idempotent. Element identity
    // is stable across reanalyze() -- Analyzer.analyze() only reorders/
    // expands engine.elmList, it never clones or reconstructs existing
    // element instances (see node.ts's addChildElms) -- so holding direct
    // CircuitElm references here (rather than e.g. array indices) stays
    // correct even after a move/add/remove triggers reanalysis.
    selection: Set<CircuitElm> = new Set();
    scopeChannels: ScopeChannel[] = [];
    private nextScopeChannelId = 1;
    private scopeChannelCounts: Record<string, number> = {};

    private listeners = new Set<() => void>();
    private rafHandle: number | null = null;
    stepsPerFrame = 4;

    // Undo/redo: snapshots are this port's own extended dump text (see
    // engine.dump()/CircuitParser), not object clones -- restoring is just
    // "parse this text", which already correctly rebuilds every element's
    // fields, geometry (via preStamp() inside setup()/analyzeAndStamp()) and
    // the analyzed node/matrix state in one call. `pendingSnapshot` is the
    // "undo to" text captured by beginTransaction(), used to coalesce a
    // whole gesture (e.g. a full drag, not one snapshot per mousemove) into
    // a single undo step -- see CircuitCanvas's startMove()/startPlace().
    private undoStack: string[] = [];
    // Nesting depth for begin/endTransaction (see endTransaction's comment).
    private transactionDepth = 0;
    private redoStack: string[] = [];
    private pendingSnapshot: string | null = null;

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
    // Depths, not the stacks themselves: enough for a test (or a future UI
    // affordance) to assert "this gesture was one undo step" without exposing
    // the snapshot strings.
    undoDepth() { return this.undoStack.length; }
    redoDepth() { return this.redoStack.length; }

    // Call once BEFORE a mutation (or burst of mutations belonging to one
    // user gesture) that should become a single undo step. Re-entrant-safe:
    // a second nested call while one is already pending is a no-op, so a
    // helper that both begins its own transaction AND calls a mutator that
    // also begins one (e.g. addElement) can't accidentally capture the
    // POST-mutation state as the "undo to" snapshot instead of the pre.
    private beginTransaction() {
        this.transactionDepth++;
        if (this.pendingSnapshot !== null) return;
        this.pendingSnapshot = this.engine.dump();
    }

    // Call once AFTER the mutation/gesture completes. Only pushes an undo
    // entry if the circuit actually changed -- a drag that ends exactly
    // where it started (or an Escape-cancelled drag reverted back to its
    // original geometry) correctly produces no undo entry at all.
    private endTransaction() {
        // BUGFIX (found by store.test.ts's nested-transaction case): begin was
        // re-entrancy-guarded but end was not, so the FIRST inner mutation
        // committed the outer gesture's snapshot and every later one became its
        // own undo entry. A gesture that brackets a mutator which transacts
        // internally -- beginMoveTransaction() around addElement(), or the
        // canvas's paste path around duplicateSelection() -- therefore took
        // several undos to unwind instead of one. Depth-counted now, so only
        // the outermost end commits.
        if (this.transactionDepth > 0) this.transactionDepth--;
        if (this.transactionDepth > 0) return;
        const snapshot = this.pendingSnapshot;
        this.pendingSnapshot = null;
        if (snapshot === null) return;
        if (snapshot === this.engine.dump()) return;
        this.undoStack.push(snapshot);
        if (this.undoStack.length > MAX_UNDO_STEPS) this.undoStack.shift();
        this.redoStack = [];
    }

    // Exposed so CircuitCanvas can bracket a whole drag gesture (many
    // setElementGeometry() calls) in one undo step instead of one per
    // mousemove -- see startMove()'s up/cancel handlers.
    beginMoveTransaction() { this.beginTransaction(); }
    endMoveTransaction() { this.endTransaction(); }

    // Unlike reanalyze(), CircuitParser.parse() itself can throw (it calls
    // engine.setup() -> analyzeAndStamp() directly, uncaught) -- guarded here
    // the same way reanalyze() guards analyzeAndStamp(), so a pathological
    // snapshot can't take down undo/redo with an unhandled exception.
    private loadSnapshot(text: string) {
        try {
            new CircuitParser(this.engine).parse(text);
            this.status = { state: "idle" };
        } catch (e) {
            this.status = { state: "error", message: e instanceof Error ? e.message : String(e) };
        }
        this.selection = new Set();
        // CircuitParser rebuilds elmList from scratch -- every element is a
        // BRAND NEW instance, so any existing scope channel's `elm` reference
        // is now orphaned (it matches nothing in the live circuit anymore).
        // There's no stable cross-reparse element identity to re-match
        // against, so a channel probing an ARBITRARY element (added via
        // toggleScopeChannel()) still can't be preserved across undo/redo/
        // import -- dropping those is more honest than leaving a frozen,
        // silently-dead trace on screen.
        //
        // Oscilloscope ELEMENTS (dump type 403) are the one case that CAN be
        // preserved, though: unlike an arbitrary probed element, a 403 in the
        // fresh elmList always wants exactly one voltage channel (that's the
        // whole "placing one auto-creates a channel" contract from
        // addElement()), so rebuilding the channel list from the new
        // elmList's own 403 elements -- rather than trying to match against
        // the old, now-dangling references -- makes scope elements survive
        // undo/redo/import for free, with no cross-reparse identity needed at
        // all.
        this.scopeChannels = [];
        for (const elm of this.engine.elmList) {
            if (String(elm.getDumpType()) === "403") {
                this.addScopeChannel(elm, "voltage");
            }
        }
        // Falstad `o` scope lines (parsed into engine.scopeHints as elmList
        // indices): recreate those scopes so a Java circuit opens with its
        // scopes attached, same as the GWT build. Skip indices already
        // covered by a 403 scope element channel or out of range.
        for (const idx of this.engine.scopeHints ?? []) {
            const elm = this.engine.elmList[idx];
            if (elm && !this.isProbed(elm)) this.addScopeChannel(elm, "voltage");
        }
        this.bump();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this.engine.dump());
        const snapshot = this.undoStack.pop()!;
        this.loadSnapshot(snapshot);
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this.engine.dump());
        const snapshot = this.redoStack.pop()!;
        this.loadSnapshot(snapshot);
    }

    // Save/load: text produced by exportText() is exactly what dump()/parse()
    // round-trip through (task #34's format), so a saved-then-reopened file
    // reconstructs the same circuit byte-for-byte-equivalent (see the
    // idempotency test in web/engine/test/dump-roundtrip.test.ts).
    exportText(): string {
        return this.engine.dump();
    }

    // Replacing the whole circuit from a file is itself one undoable action
    // -- an accidental "open" doesn't strand the user without their previous
    // work, same reasoning as clear(). loadSnapshot() already guards against
    // a malformed/corrupt file throwing during parse (surfaced via `status`,
    // same as any other analysis failure) rather than crashing the app.
    importText(text: string) {
        this.beginTransaction();
        this.loadSnapshot(text);
        this.endTransaction();
    }

    // Shared File-reading helper for both the file-picker input (UndoRedoCluster)
    // and drag-and-drop onto the canvas (CircuitCanvas) -- kept in one place so
    // neither UI call site needs to know FileReader is even involved.
    importFile(file: File) {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") this.importText(reader.result);
        };
        reader.readAsText(file);
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getVersion = () => this.version;

    private bump() {
        this.version++;
        for (const l of this.listeners) l();
    }

    // Re-run analysis after any circuit-shape mutation (add/remove/move
    // element). Safe to call on an incomplete circuit -- the Analyzer's
    // unconnected-node handling (a large resistor to ground) means a
    // dangling half-built circuit just reads ~0V rather than crashing.
    reanalyze() {
        try {
            this.engine.analyzeAndStamp();
            if (this.status.state === "error") this.status = { state: "idle" };
        } catch (e) {
            this.status = { state: "error", message: e instanceof Error ? e.message : String(e) };
        }
        this.bump();
    }

    addElement(elm: CircuitElm) {
        this.beginTransaction();
        elm.preStamp();
        this.engine.elmList = [...this.engine.elmList, elm];
        this.reanalyze();
        // Placing an oscilloscope (dump type 403 -- see engine/elements/
        // scope.ts) auto-creates its scope channel, Simulink-Scope-block
        // style: the element IS the channel's source from the moment it
        // lands, no separate "probe this" click needed. Deliberately called
        // OUTSIDE the begin/endTransaction bracket (both above and via
        // addScopeChannel() itself, which never brackets one at all) --
        // scope channels are a viewing concern, not a circuit edit, so they
        // stay out of undo/redo history the same way `selection` does (see
        // addScopeChannel()'s own comment).
        if (String(elm.getDumpType()) === "403") {
            this.addScopeChannel(elm, "voltage");
        }
        this.endTransaction();
    }

    removeElement(elm: CircuitElm) {
        this.beginTransaction();
        if (String(elm.getDumpType()) === "460") extChipRegistry.dispose(extChipId(elm));
        this.engine.elmList = this.engine.elmList.filter(e => e !== elm);
        if (this.selection.has(elm)) {
            const next = new Set(this.selection);
            next.delete(elm);
            this.selection = next;
        }
        this.scopeChannels = this.scopeChannels.filter((c) => c.elm !== elm);
        this.reanalyze();
        this.endTransaction();
    }

    // Bulk delete for Del/Backspace on a multi-selection -- one undo step for
    // the whole batch, not one per element (mirrors addElement/removeElement's
    // own single-mutation transaction shape, just widened to a set).
    removeElements(elms: Iterable<CircuitElm>) {
        const toRemove = new Set(elms);
        if (toRemove.size === 0) return;
        this.beginTransaction();
        for (const e of toRemove)
            if (String(e.getDumpType()) === "460") extChipRegistry.dispose(extChipId(e));
        this.engine.elmList = this.engine.elmList.filter(e => !toRemove.has(e));
        if (this.selection.size > 0) {
            const next = new Set(this.selection);
            for (const e of toRemove) next.delete(e);
            this.selection = next;
        }
        this.scopeChannels = this.scopeChannels.filter((c) => !toRemove.has(c.elm));
        this.reanalyze();
        this.endTransaction();
    }

    // Backs the schema-driven edit dialog (Inspector/schema.ts): sets ONE
    // field (possibly nested, e.g. "ind.inductance") by property path and
    // re-analyzes. Each call is its own undo step -- unlike drag-move,
    // field edits are already discrete, single-shot commits (the dialog
    // commits on blur/Enter/change, not per keystroke), so no caller-side
    // begin/endMoveTransaction bracketing is needed here.
    updateElementField(elm: CircuitElm, key: string, value: unknown) {
        this.beginTransaction();
        const parts = key.split(".");
        let obj = elm as unknown as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]] as Record<string, unknown>;
        }
        obj[parts[parts.length - 1]] = value;
        elm.preStamp();
        this.reanalyze();
        this.endTransaction();
    }

    // Scope channels -- MATLAB-style probe: toggleScopeChannel() is what the
    // canvas's probe-tool click calls (add if not already probed, remove if
    // it is). Deliberately NOT wrapped in begin/endTransaction: watching a
    // signal is a viewing concern, not a circuit edit, so it isn't part of
    // undo/redo history at all (consistent with how `selection` also isn't).
    isProbed(elm: CircuitElm): ScopeChannel | undefined {
        return this.scopeChannels.find((c) => c.elm === elm);
    }

    addScopeChannel(elm: CircuitElm, mode: ScopeChannel["mode"] = "voltage") {
        const dumpType = String(elm.getDumpType());
        const n = (this.scopeChannelCounts[dumpType] ?? 0) + 1;
        this.scopeChannelCounts[dumpType] = n;
        // Placed oscilloscope elements (403) get a friendly "scope #n" label
        // instead of the raw dump-type id -- they're the one element that
        // both IS a channel's source AND reads like a labeled instrument to
        // the user, unlike toggleScopeChannel()'s "probe any element" case
        // where the raw dump type (e.g. "r #2") is the more useful hint of
        // what's actually being watched.
        const label = dumpType === "403" ? `scope #${n}` : `${dumpType} #${n}`;
        const channel: ScopeChannel = {
            id: this.nextScopeChannelId++,
            elm,
            mode,
            label,
            color: SCOPE_COLORS[(this.scopeChannels.length) % SCOPE_COLORS.length],
            history: [],
        };
        this.scopeChannels = [...this.scopeChannels, channel];
        this.bump();
    }

    removeScopeChannel(id: number) {
        this.scopeChannels = this.scopeChannels.filter((c) => c.id !== id);
        this.bump();
    }

    toggleScopeChannel(elm: CircuitElm) {
        const existing = this.isProbed(elm);
        if (existing) this.removeScopeChannel(existing.id);
        else this.addScopeChannel(elm);
    }

    clearScopeChannels() {
        this.scopeChannels = [];
        this.bump();
    }

    // Called once per completed simulation step (see stepOnceSafe()) --
    // covers both the continuous run() loop and single-step step(), with no
    // duplicated sampling logic between them.
    private recordScopeSamples() {
        if (this.scopeChannels.length === 0) return;
        const t = this.engine.t;
        for (const ch of this.scopeChannels) {
            let value: number;
            try {
                value = ch.mode === "current" ? ch.elm.current : ch.elm.getVoltageDiff();
            } catch {
                value = 0;
            }
            ch.history.push({ t, value });
            if (ch.history.length > MAX_SCOPE_SAMPLES) ch.history.shift();
        }
    }

    // Drag-to-move: called on every pointer move while dragging a placed
    // element (CircuitCanvas does the delta math and passes absolute
    // coordinates). Mutates the same raw x/y/x2/y2 fields the constructor
    // sets, then preStamp() re-derives point1/point2/dn/etc, same as any
    // freshly-placed element -- moving is just "placing again" from the
    // engine's point of view. Reanalyzing on every intermediate move (not
    // just on drop) is deliberate: it mirrors Falstad's own live-updating
    // drag feel, and circuits at this scale are cheap enough that it's not
    // worth the complexity of a separate "preview" path.
    setElementGeometry(elm: CircuitElm, x: number, y: number, x2: number, y2: number) {
        elm.x = x; elm.y = y; elm.x2 = x2; elm.y2 = y2;
        elm.preStamp();
        this.reanalyze();
    }

    // Single-endpoint drag (KiCad's "grab just this handle" move): unlike
    // setElementGeometry() above, this only ever touches ONE end of the
    // element, leaving the other exactly where it was. `which` selects x/y
    // vs x2/y2 -- kept as a discriminated pair rather than four separate
    // setters so callers can't accidentally pass a partial/inconsistent
    // update (e.g. new x without a matching new y).
    setElementEndpoint(elm: CircuitElm, which: "point1" | "point2", x: number, y: number) {
        if (which === "point1") { elm.x = x; elm.y = y; }
        else { elm.x2 = x; elm.y2 = y; }
        elm.preStamp();
        this.reanalyze();
    }

    // Group move: set every element's ABSOLUTE geometry to its own
    // pre-gesture origin plus the SAME (dx, dy) -- used for both the
    // "grabbed element is part of a multi-selection" body-move case and the
    // M-key pickup mode's live cursor-follow. Deliberately takes each
    // element's origin snapshot (captured once, at gesture start) rather
    // than mutating relative to wherever the element currently sits: this
    // method is called on EVERY mousemove of a drag, so an incremental
    // `elm.x += dx` here would compound across frames and send the group
    // flying (a real bug caught while wiring up the M-key pickup mode's
    // live-follow, which calls this on every mousemove -- see
    // CircuitCanvas's pickupState handling). Callers are responsible for
    // their own begin/endMoveTransaction bracketing (same convention as
    // setElementGeometry, which also assumes its caller brackets the whole
    // gesture) so a multi-element drag still collapses to one undo step
    // regardless of how many elements moved.
    moveSelectionBy(origins: { elm: CircuitElm; origX: number; origY: number; origX2: number; origY2: number }[], dx: number, dy: number) {
        for (const o of origins) {
            o.elm.x = o.origX + dx; o.elm.y = o.origY + dy;
            o.elm.x2 = o.origX2 + dx; o.elm.y2 = o.origY2 + dy;
            o.elm.preStamp();
        }
        this.reanalyze();
    }

    // Rotate one element 90 degrees clockwise about its own midpoint.
    // Screen-space Y grows downward, so a clockwise rotation on-screen is
    // (x,y) -> (cx - (y-cy), cy + (x-cx)) -- i.e. what would be "counter-
    // clockwise" in standard math-y-up convention. Both endpoints rotate
    // about the SAME center (the pre-rotation midpoint) so the element spins
    // in place rather than translating. Coordinates are re-snapped to the
    // grid afterward since a diagonal element's rotated endpoints can land
    // on fractional grid positions otherwise (e.g. an odd-length diagonal
    // run), and off-grid geometry would silently break future snap-drags.
    rotateElementCW(elm: CircuitElm, gridSize: number) {
        this.beginTransaction();
        const cx = (elm.x + elm.x2) / 2, cy = (elm.y + elm.y2) / 2;
        const rot = (px: number, py: number) => {
            const rx = cx - (py - cy);
            const ry = cy + (px - cx);
            return { x: Math.round(rx / gridSize) * gridSize, y: Math.round(ry / gridSize) * gridSize };
        };
        const p1 = rot(elm.x, elm.y);
        const p2 = rot(elm.x2, elm.y2);
        elm.x = p1.x; elm.y = p1.y; elm.x2 = p2.x; elm.y2 = p2.y;
        elm.preStamp();
        this.reanalyze();
        this.endTransaction();
    }

    // Ctrl/Cmd+D duplicate: clone via the element's OWN dump() line rather
    // than hand-copying fields, so duplication automatically stays correct
    // for every element type's tokens (resistance, gate input count,
    // waveform params, ...) without this store needing per-type knowledge --
    // exactly the same "one source of truth" createElement() factory path
    // CircuitParser.parse() and CircuitCanvas's finalizePlacement() both
    // already go through. dump() format is `<dumpType> x y x2 y2 flags
    // <tokens...>` (base.ts), so tokens[0..5] are geometry/flags and [6:]
    // are the type-specific extra tokens createElement() expects.
    duplicateSelection(elms: Iterable<CircuitElm>, offset: number): CircuitElm[] {
        const copies: CircuitElm[] = [];
        this.beginTransaction();
        for (const elm of elms) {
            const tokens = elm.dump().split(/\s+/);
            const dumpType = tokens[0];
            const x = parseFloat(tokens[1]) + offset;
            const y = parseFloat(tokens[2]) + offset;
            const x2 = parseFloat(tokens[3]) + offset;
            const y2 = parseFloat(tokens[4]) + offset;
            const flags = parseInt(tokens[5], 10);
            const extraTokens = tokens.slice(6);
            const copy = createElement(dumpType, x, y, x2, y2, flags, extraTokens);
            if (copy) copies.push(copy);
        }
        if (copies.length > 0) {
            for (const c of copies) c.preStamp();
            this.engine.elmList = [...this.engine.elmList, ...copies];
            this.reanalyze();
        }
        this.endTransaction();
        return copies;
    }

    clear() {
        this.beginTransaction();
        this.engine.clear();
        this.selection = new Set();
        this.scopeChannels = [];
        this.status = { state: "idle" };
        this.bump();
        this.endTransaction();
    }

    // --- Selection API (multi-select, KiCad-style) --------------------
    //
    // select(): replace the whole selection with a single element (or clear
    // it with null) -- the common case for a plain click.
    // toggleSelect(): flip one element's membership without disturbing the
    // rest -- Shift-click add/remove and Shift-drag marquee both use this.
    // selectMany(): replace the whole selection with a given set -- a plain
    // (non-Shift) marquee release, and Ctrl/Cmd+A "select all".
    // selectedOne(): the single-element convenience read ElementEditModal/
    // the E-key/R-key shortcuts need ("is there exactly one thing selected,
    // and if so what is it") -- returns null both when nothing AND when
    // multiple things are selected, so callers can't accidentally operate on
    // an arbitrary pick from a multi-selection.
    select(elm: CircuitElm | null) {
        this.selection = elm ? new Set([elm]) : new Set();
        this.bump();
    }

    toggleSelect(elm: CircuitElm) {
        const next = new Set(this.selection);
        if (next.has(elm)) next.delete(elm);
        else next.add(elm);
        this.selection = next;
        this.bump();
    }

    selectMany(elms: Iterable<CircuitElm>) {
        this.selection = new Set(elms);
        this.bump();
    }

    clearSelection() {
        if (this.selection.size === 0) return;
        this.selection = new Set();
        this.bump();
    }

    isSelected(elm: CircuitElm): boolean {
        return this.selection.has(elm);
    }

    selectedOne(): CircuitElm | null {
        if (this.selection.size !== 1) return null;
        // Sets preserve insertion order but have no direct index access;
        // for a size-1 set this loop runs exactly once.
        for (const elm of this.selection) return elm;
        return null;
    }

    stepOnceSafe(): boolean {
        try {
            this.engine.stepOnce();
            // FPGA/MCU co-simulation exchange (bridge-protocol v1): after each
            // engine step, push every ExtChip's freshly-sampled input bits to
            // its ws session, let the client pace quantum steps against the
            // circuit clock (pausing the sim if the backend lags a full
            // quantum), and pull the latest quantum-boundary outputs for the
            // NEXT step's voltage-source drives. Order per the client's
            // contract: setInputs -> onSimTime -> getOutputs.
            for (const elm of this.engine.elmList) {
                if (String(elm.getDumpType()) !== "460") continue;
                const chip = elm as unknown as { inputBits: number; outputBits: number };
                const id = extChipId(elm);
                extChipRegistry.setInputs(id, chip.inputBits);
                extChipRegistry.onSimTime(id, this.engine.t * 1e9);
                chip.outputBits = extChipRegistry.getOutputs(id);
            }
            this.recordScopeSamples();
            return true;
        } catch (e) {
            this.status = { state: "error", message: e instanceof Error ? e.message : String(e) };
            this.stop();
            return false;
        }
    }

    isRunning() { return this.rafHandle !== null; }

    run() {
        if (this.rafHandle !== null) return;
        this.status = { state: "running" };
        const loop = () => {
            for (let i = 0; i < this.stepsPerFrame; i++) {
                if (!this.stepOnceSafe()) break;
            }
            this.bump();
            if (this.rafHandle !== null) {
                this.rafHandle = requestAnimationFrame(loop);
            }
        };
        this.rafHandle = requestAnimationFrame(loop);
        this.bump();
    }

    stop() {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.status.state === "running") this.status = { state: "idle" };
        this.bump();
    }

    step() {
        this.stop();
        this.stepOnceSafe();
        this.bump();
    }

    // "Reset simulation" (the floating status cluster's reset button) --
    // rewinds time and re-stamps fresh matrices without touching the
    // circuit's topology, unlike clear() which deletes every element. This
    // matches Falstad's own Reset button: same circuit, t back to 0, any
    // accumulated capacitor/inductor state reinitialized by the fresh
    // analyzeAndStamp() (new zeroed lastNodeVoltages/nodeVoltages).
    resetTime() {
        this.stop();
        this.engine.t = 0;
        this.engine.timeStepAccum = 0;
        // Same circuit, same probed elements -- but old samples were taken
        // at times that no longer make sense once t rewinds to 0, so the
        // scope's history (not its channel list) resets alongside the sim.
        for (const ch of this.scopeChannels) ch.history = [];
        this.reanalyze();
    }
}

// One instance for the whole app (module singletons are per-tab in Next's
// client bundle, which is exactly the single-circuit-editor scope we want).
export const engineStore = new EngineStore();
