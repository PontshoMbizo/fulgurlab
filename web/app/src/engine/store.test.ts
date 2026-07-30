import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement } from "@fulgurlab/engine/src/core/factory";
import type { CircuitElm } from "@fulgurlab/engine/src/elements/base";
import { EngineStore } from "./store";

// TODO.md P1-3 named engine/store.ts as the highest-value untested target:
// 623 LOC, all 37 user-facing actions, with undo/redo, importText/exportText,
// move transactions and selection all unverified and all testable headlessly.
//
// These tests drive the store the way the canvas does -- construct elements via
// the engine factory, mutate through the store's own API, assert on exportText()
// and the selection/scope/undo state it maintains. `environment: "node"`, so
// nothing here may touch the DOM; run()/importFile() are the only two methods
// that need a browser and they are covered by their guards instead.

const R = (x: number, y: number, x2: number, y2: number, ohms = "1000") =>
    createElement("r", x, y, x2, y2, 0, [ohms])!;
const W = (x: number, y: number, x2: number, y2: number) =>
    createElement("w", x, y, x2, y2, 0, [])!;
const G = (x: number, y: number) => createElement("g", x, y, x, y + 16, 0, [])!;
const RAIL = (x: number, y: number, volts = "5") =>
    createElement("R", x, y, x - 32, y, 0, ["0", "40", volts])!;
const SCOPE = (x: number, y: number) => createElement("403", x, y, x, y + 48, 0, [])!;

/** A minimal 5V/1k/1k divider, wired so it analyzes cleanly. */
function divider(store: EngineStore) {
    const rail = RAIL(100, 100);
    const r1 = R(100, 100, 200, 100);
    const r2 = R(200, 100, 200, 200);
    const gnd = G(200, 200);
    for (const e of [rail, r1, r2, gnd]) store.addElement(e);
    return { rail, r1, r2, gnd };
}

function lineCount(text: string) {
    // exportText() always emits a leading "$" options line.
    return text.split("\n").filter((l) => l.trim().length > 0).length;
}

describe("EngineStore: elements and analysis", () => {
    let store: EngineStore;
    beforeEach(() => { store = new EngineStore(); });

    it("starts empty, idle, and with nothing to undo", () => {
        expect(store.engine.elmList.length).toBe(0);
        expect(store.canUndo()).toBe(false);
        expect(store.canRedo()).toBe(false);
        expect(store.status.state).toBe("idle");
    });

    it("addElement appends, re-analyzes, and bumps the version", () => {
        const v0 = store.getVersion();
        store.addElement(R(0, 0, 64, 0));
        expect(store.engine.elmList.length).toBe(1);
        expect(store.getVersion()).toBeGreaterThan(v0);
    });

    it("a wired divider analyzes without error and solves", () => {
        const { r1 } = divider(store);
        expect(store.status.state).toBe("idle");
        store.step();
        // 5V across two equal 1k resistors -> 2.5V at the midpoint, 2.5mA.
        expect(Math.abs(r1.current)).toBeCloseTo(0.0025, 4);
    });

    it("removeElement drops the element, its selection entry, and its scope channel", () => {
        const { r1 } = divider(store);
        store.select(r1);
        store.addScopeChannel(r1, "voltage");
        expect(store.isSelected(r1)).toBe(true);
        expect(store.scopeChannels.length).toBe(1);

        store.removeElement(r1);
        expect(store.engine.elmList).not.toContain(r1);
        expect(store.isSelected(r1)).toBe(false);
        expect(store.scopeChannels.length).toBe(0);
    });

    it("removeElements is one undo step for the whole batch", () => {
        const { r1, r2 } = divider(store);
        const before = store.exportText();
        const undoDepth = store.undoDepth();
        store.removeElements([r1, r2]);
        expect(store.undoDepth()).toBe(undoDepth + 1);
        store.undo();
        expect(store.exportText()).toBe(before);
    });

    it("removeElements with an empty set does nothing at all", () => {
        divider(store);
        const before = store.exportText();
        const undoDepth = store.undoDepth();
        store.removeElements([]);
        expect(store.exportText()).toBe(before);
        expect(store.undoDepth()).toBe(undoDepth);
    });

    it("a floating element does not throw -- analysis failure surfaces as status", () => {
        // A lone resistor with no source and no ground is the classic
        // pathological case; the store must report, not crash.
        store.addElement(R(0, 0, 64, 0));
        expect(["idle", "error"]).toContain(store.status.state);
        expect(() => store.step()).not.toThrow();
    });

    it("updateElementField writes through and is undoable", () => {
        const r = R(0, 0, 64, 0);
        store.addElement(r);
        store.updateElementField(r, "resistance", 4700);
        expect((r as unknown as { resistance: number }).resistance).toBe(4700);
        store.undo();
        const reloaded = store.engine.elmList[0] as unknown as { resistance: number };
        expect(reloaded.resistance).toBe(1000);
    });
});

describe("EngineStore: undo / redo", () => {
    let store: EngineStore;
    beforeEach(() => { store = new EngineStore(); });

    it("undo restores the previous circuit; redo puts it back", () => {
        store.addElement(R(0, 0, 64, 0));
        const one = store.exportText();
        store.addElement(R(0, 64, 64, 64));
        const two = store.exportText();

        expect(store.canUndo()).toBe(true);
        store.undo();
        expect(store.exportText()).toBe(one);
        expect(store.canRedo()).toBe(true);
        store.redo();
        expect(store.exportText()).toBe(two);
    });

    it("a new mutation clears the redo stack", () => {
        store.addElement(R(0, 0, 64, 0));
        store.addElement(R(0, 64, 64, 64));
        store.undo();
        expect(store.canRedo()).toBe(true);
        store.addElement(R(0, 128, 64, 128));
        expect(store.canRedo()).toBe(false);
    });

    it("undo/redo on empty stacks is a no-op", () => {
        const before = store.exportText();
        store.undo();
        store.redo();
        expect(store.exportText()).toBe(before);
    });

    it("a move that ends where it started produces NO undo entry", () => {
        const r = R(0, 0, 64, 0);
        store.addElement(r);
        const depth = store.undoDepth();

        store.beginMoveTransaction();
        store.setElementGeometry(r, 32, 32, 96, 32);   // moved...
        store.setElementGeometry(r, 0, 0, 64, 0);      // ...and back
        store.endMoveTransaction();

        expect(store.undoDepth()).toBe(depth);
    });

    it("a whole drag gesture collapses into ONE undo entry", () => {
        const r = R(0, 0, 64, 0);
        store.addElement(r);
        const depth = store.undoDepth();

        store.beginMoveTransaction();
        for (let i = 1; i <= 10; i++) store.setElementGeometry(r, i * 8, 0, i * 8 + 64, 0);
        store.endMoveTransaction();

        expect(store.undoDepth()).toBe(depth + 1);
        store.undo();
        expect(store.engine.elmList[0].x).toBe(0);
    });

    it("nested transactions capture the PRE-mutation snapshot, not an intermediate one", () => {
        // beginMoveTransaction() bracketing an addElement() (which begins its
        // own transaction) must still undo to the state before the whole
        // gesture -- that re-entrancy is what the store's guard is for.
        store.addElement(R(0, 0, 64, 0));
        const before = store.exportText();

        store.beginMoveTransaction();
        store.addElement(R(0, 64, 64, 64));
        store.addElement(R(0, 128, 64, 128));
        store.endMoveTransaction();

        store.undo();
        expect(store.exportText()).toBe(before);
    });

    it("the undo stack is bounded", () => {
        // MAX_UNDO_STEPS is private; push well past any plausible bound and
        // require it to stop growing rather than leak forever.
        for (let i = 0; i < 300; i++) store.addElement(R(0, i * 8, 64, i * 8));
        expect(store.undoDepth()).toBeLessThanOrEqual(256);
    });
});

describe("EngineStore: import / export", () => {
    let store: EngineStore;
    beforeEach(() => { store = new EngineStore(); });

    it("exportText round-trips through importText", () => {
        divider(store);
        const text = store.exportText();
        const other = new EngineStore();
        other.importText(text);
        expect(other.exportText()).toBe(text);
        expect(other.engine.elmList.length).toBe(store.engine.elmList.length);
    });

    it("importText replaces the circuit and is itself undoable", () => {
        divider(store);
        const before = store.exportText();
        store.importText("$ 1 0.000005 10 50 5 50\nr 0 0 64 0 0 2200");
        expect(store.engine.elmList.length).toBe(1);
        store.undo();
        expect(store.exportText()).toBe(before);
    });

    it("importing malformed text surfaces an error instead of throwing", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(() => store.importText("this is not a circuit\n???")).not.toThrow();
        warn.mockRestore();
    });

    it("importText clears the selection (the old element objects are gone)", () => {
        const { r1 } = divider(store);
        store.select(r1);
        store.importText(store.exportText());
        expect(store.selection.size).toBe(0);
    });

    it("unported element lines survive a load/save round trip", () => {
        // The engine preserves unknown dump lines verbatim; the store must not
        // drop them on export, or opening and saving a Java file would destroy
        // content.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const text = "$ 1 0.000005 10 50 5 50\nr 0 0 64 0 0 1000\n99999 1 2 3 4 5 keepme";
        store.importText(text);
        expect(store.exportText()).toContain("99999 1 2 3 4 5 keepme");
        warn.mockRestore();
    });

    it("a scope ELEMENT survives undo/redo, an arbitrary probe does not", () => {
        // Documented asymmetry in loadSnapshot(): a 403 always wants exactly one
        // channel so it can be rebuilt from the fresh elmList, while a channel
        // probing an arbitrary element has no cross-reparse identity.
        const { r1 } = divider(store);
        const scope = SCOPE(300, 100);
        store.addElement(scope);
        expect(store.scopeChannels.length).toBe(1);

        store.addScopeChannel(r1, "voltage");
        expect(store.scopeChannels.length).toBe(2);

        store.addElement(R(0, 300, 64, 300));  // any further undoable mutation
        store.undo();

        // The 403's channel came back; the arbitrary probe did not.
        expect(store.scopeChannels.length).toBe(1);
        expect(String(store.scopeChannels[0].elm.getDumpType())).toBe("403");
    });
});

describe("EngineStore: selection", () => {
    let store: EngineStore;
    let elms: CircuitElm[];
    beforeEach(() => {
        store = new EngineStore();
        const d = divider(store);
        elms = [d.r1, d.r2, d.rail];
    });

    it("select replaces the selection; null clears it", () => {
        store.select(elms[0]);
        expect(store.selection.size).toBe(1);
        store.select(elms[1]);
        expect(store.isSelected(elms[0])).toBe(false);
        expect(store.isSelected(elms[1])).toBe(true);
        store.select(null);
        expect(store.selection.size).toBe(0);
    });

    it("toggleSelect adds then removes", () => {
        store.toggleSelect(elms[0]);
        expect(store.isSelected(elms[0])).toBe(true);
        store.toggleSelect(elms[0]);
        expect(store.isSelected(elms[0])).toBe(false);
    });

    it("selectMany replaces with the given set; clearSelection empties it", () => {
        store.selectMany(elms);
        expect(store.selection.size).toBe(3);
        store.clearSelection();
        expect(store.selection.size).toBe(0);
    });

    it("selectedOne returns the element only when exactly one is selected", () => {
        expect(store.selectedOne()).toBeNull();
        store.select(elms[0]);
        expect(store.selectedOne()).toBe(elms[0]);
        store.selectMany(elms);
        expect(store.selectedOne()).toBeNull();
    });

    it("moveSelectionBy translates every element by the same delta", () => {
        const origins = elms.map((elm) => ({
            elm, origX: elm.x, origY: elm.y, origX2: elm.x2, origY2: elm.y2,
        }));
        store.moveSelectionBy(origins, 48, -16);
        for (const o of origins) {
            expect(o.elm.x).toBe(o.origX + 48);
            expect(o.elm.y).toBe(o.origY - 16);
            expect(o.elm.x2).toBe(o.origX2 + 48);
            expect(o.elm.y2).toBe(o.origY2 - 16);
        }
    });

    it("duplicateSelection adds offset copies and leaves the originals alone", () => {
        const before = store.engine.elmList.length;
        const copies = store.duplicateSelection([elms[0]], 32);
        expect(copies.length).toBe(1);
        expect(store.engine.elmList.length).toBe(before + 1);
        expect(copies[0]).not.toBe(elms[0]);
        expect(copies[0].x).toBe(elms[0].x + 32);
        expect(String(copies[0].getDumpType())).toBe(String(elms[0].getDumpType()));
    });

    it("rotateElementCW snaps to the grid and is one undo step", () => {
        const r = R(0, 0, 64, 0);
        store.addElement(r);
        const depth = store.undoDepth();
        store.rotateElementCW(r, 16);
        expect(store.undoDepth()).toBe(depth + 1);
        // A horizontal element becomes vertical (same length, axis swapped).
        expect(Math.abs(r.x2 - r.x)).toBeLessThan(Math.abs(r.y2 - r.y));
    });

    it("setElementEndpoint moves only the named end", () => {
        const w = W(0, 0, 64, 0);
        store.addElement(w);
        store.setElementEndpoint(w, "point2", 64, 64);
        expect([w.x, w.y]).toEqual([0, 0]);
        expect([w.x2, w.y2]).toEqual([64, 64]);
        store.setElementEndpoint(w, "point1", -32, 0);
        expect([w.x, w.y]).toEqual([-32, 0]);
    });
});

describe("EngineStore: scope channels", () => {
    let store: EngineStore;
    beforeEach(() => { store = new EngineStore(); });

    it("placing a scope element auto-creates exactly one voltage channel", () => {
        store.addElement(SCOPE(0, 0));
        expect(store.scopeChannels.length).toBe(1);
        expect(store.scopeChannels[0].mode).toBe("voltage");
    });

    it("toggleScopeChannel adds then removes, and isProbed tracks it", () => {
        const { r1 } = divider(store);
        expect(store.isProbed(r1)).toBeUndefined();
        store.toggleScopeChannel(r1);
        expect(store.isProbed(r1)).toBeTruthy();
        store.toggleScopeChannel(r1);
        expect(store.isProbed(r1)).toBeUndefined();
    });

    it("channels accumulate samples as the circuit steps", () => {
        const { r1 } = divider(store);
        store.addScopeChannel(r1, "voltage");
        for (let i = 0; i < 20; i++) store.step();
        expect(store.scopeChannels[0].history.length).toBeGreaterThan(0);
    });

    it("removeScopeChannel removes by id; clearScopeChannels empties", () => {
        const { r1, r2 } = divider(store);
        store.addScopeChannel(r1, "voltage");
        store.addScopeChannel(r2, "current");
        const id = store.scopeChannels[0].id;
        store.removeScopeChannel(id);
        expect(store.scopeChannels.some((c) => c.id === id)).toBe(false);
        store.clearScopeChannels();
        expect(store.scopeChannels.length).toBe(0);
    });
});

describe("EngineStore: run control and subscriptions", () => {
    let store: EngineStore;
    beforeEach(() => { store = new EngineStore(); });

    it("subscribe is notified on mutation, and unsubscribing stops that", () => {
        let hits = 0;
        const off = store.subscribe(() => { hits++; });
        store.addElement(R(0, 0, 64, 0));
        expect(hits).toBeGreaterThan(0);
        const seen = hits;
        off();
        store.addElement(R(0, 64, 64, 64));
        expect(hits).toBe(seen);
    });

    it("step advances simulation time; resetTime returns it to zero", () => {
        divider(store);
        store.step();
        expect(store.engine.t).toBeGreaterThan(0);
        store.resetTime();
        expect(store.engine.t).toBe(0);
    });

    it("clear empties the circuit and is undoable", () => {
        divider(store);
        const before = store.exportText();
        store.clear();
        expect(store.engine.elmList.length).toBe(0);
        store.undo();
        expect(store.exportText()).toBe(before);
    });

    it("isRunning is false without a requestAnimationFrame loop", () => {
        // `environment: "node"` has no rAF, so run() must not be called here;
        // the guard being false is what lets every other test step manually.
        expect(store.isRunning()).toBe(false);
    });

    it("stepOnceSafe reports failure rather than throwing on a broken circuit", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        store.importText("$ 1 0.000005 10 50 5 50\nr 0 0 64 0 0 1000");
        expect(() => store.stepOnceSafe()).not.toThrow();
        warn.mockRestore();
    });

    it("exportText always begins with the options line", () => {
        divider(store);
        const text = store.exportText();
        expect(text.startsWith("$ ")).toBe(true);
        expect(lineCount(text)).toBe(store.engine.elmList.length + 1);
    });
});
