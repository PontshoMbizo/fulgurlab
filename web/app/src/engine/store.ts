"use client";

import { CircuitEngine, CircuitElm, CircuitParser } from "@fulgurlab/engine";

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

class EngineStore {
    engine = new CircuitEngine();
    version = 0;
    status: RunStatus = { state: "idle" };
    selected: CircuitElm | null = null;
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
    private redoStack: string[] = [];
    private pendingSnapshot: string | null = null;

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }

    // Call once BEFORE a mutation (or burst of mutations belonging to one
    // user gesture) that should become a single undo step. Re-entrant-safe:
    // a second nested call while one is already pending is a no-op, so a
    // helper that both begins its own transaction AND calls a mutator that
    // also begins one (e.g. addElement) can't accidentally capture the
    // POST-mutation state as the "undo to" snapshot instead of the pre.
    private beginTransaction() {
        if (this.pendingSnapshot !== null) return;
        this.pendingSnapshot = this.engine.dump();
    }

    // Call once AFTER the mutation/gesture completes. Only pushes an undo
    // entry if the circuit actually changed -- a drag that ends exactly
    // where it started (or an Escape-cancelled drag reverted back to its
    // original geometry) correctly produces no undo entry at all.
    private endTransaction() {
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
        this.selected = null;
        // CircuitParser rebuilds elmList from scratch -- every element is a
        // BRAND NEW instance, so any existing scope channel's `elm` reference
        // is now orphaned (it matches nothing in the live circuit anymore).
        // There's no stable cross-reparse element identity to re-match
        // against yet, so channels can't be preserved across undo/redo/
        // import -- clearing them is more honest than leaving a frozen,
        // silently-dead trace on screen.
        this.scopeChannels = [];
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
        this.endTransaction();
    }

    removeElement(elm: CircuitElm) {
        this.beginTransaction();
        this.engine.elmList = this.engine.elmList.filter(e => e !== elm);
        if (this.selected === elm) this.selected = null;
        this.scopeChannels = this.scopeChannels.filter((c) => c.elm !== elm);
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
    // undo/redo history at all (consistent with how `selected` also isn't).
    isProbed(elm: CircuitElm): ScopeChannel | undefined {
        return this.scopeChannels.find((c) => c.elm === elm);
    }

    addScopeChannel(elm: CircuitElm, mode: ScopeChannel["mode"] = "voltage") {
        const dumpType = String(elm.getDumpType());
        const n = (this.scopeChannelCounts[dumpType] ?? 0) + 1;
        this.scopeChannelCounts[dumpType] = n;
        const channel: ScopeChannel = {
            id: this.nextScopeChannelId++,
            elm,
            mode,
            label: `${dumpType} #${n}`,
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

    clear() {
        this.beginTransaction();
        this.engine.clear();
        this.selected = null;
        this.scopeChannels = [];
        this.status = { state: "idle" };
        this.bump();
        this.endTransaction();
    }

    select(elm: CircuitElm | null) {
        this.selected = elm;
        this.bump();
    }

    stepOnceSafe(): boolean {
        try {
            this.engine.stepOnce();
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
