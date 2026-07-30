import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    WINDOW_PRESETS_S, DEFAULT_WINDOW_S, DEFAULT_UI_STATE,
    formatWindowLabel, loadScopeUiState, saveScopeUiState,
} from "./scopeUi";

// TODO.md P1-3: scope/ (495 LOC) had no tests. drawScopeCanvas() needs a real
// 2D context so it stays out of a node-environment suite, but the persistence
// and formatting layer is pure and is where a bad value silently degrades the
// UI -- a corrupt localStorage entry that survives validation would leave the
// scope permanently mis-sized on every reload.

describe("formatWindowLabel", () => {
    it("renders sub-second windows in milliseconds", () => {
        expect(formatWindowLabel(0.001)).toBe("1ms");
        expect(formatWindowLabel(0.02)).toBe("20ms");
        expect(formatWindowLabel(0.5)).toBe("500ms");
    });

    it("renders one second and above in seconds", () => {
        expect(formatWindowLabel(1)).toBe("1s");
        expect(formatWindowLabel(2)).toBe("2s");
    });

    it("labels every preset without producing NaN or empty text", () => {
        for (const s of WINDOW_PRESETS_S) {
            const label = formatWindowLabel(s);
            expect(label).toMatch(/^\d+(ms|s)$/);
        }
    });
});

describe("scope UI presets", () => {
    it("the default window is one of the presets", () => {
        expect(WINDOW_PRESETS_S as readonly number[]).toContain(DEFAULT_WINDOW_S);
        expect(DEFAULT_UI_STATE.windowS).toBe(DEFAULT_WINDOW_S);
    });

    it("presets are sorted ascending and unique", () => {
        const arr = [...WINDOW_PRESETS_S];
        expect(arr).toEqual([...arr].sort((a, b) => a - b));
        expect(new Set(arr).size).toBe(arr.length);
    });

    it("the default state is internally consistent", () => {
        expect(DEFAULT_UI_STATE.mode).toBe("docked");
        expect(DEFAULT_UI_STATE.dockHeight).toBeGreaterThan(0);
        expect(DEFAULT_UI_STATE.floatSize.w).toBeGreaterThan(0);
        expect(DEFAULT_UI_STATE.floatSize.h).toBeGreaterThan(0);
    });
});

describe("scope UI persistence", () => {
    // The module guards on `typeof window === "undefined"`, so a fake window with
    // just localStorage is enough to drive both branches from a node env.
    let storage: Record<string, string>;

    beforeEach(() => {
        storage = {};
        vi.stubGlobal("window", {
            localStorage: {
                getItem: (k: string) => (k in storage ? storage[k] : null),
                setItem: (k: string, v: string) => { storage[k] = v; },
            },
        });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it("returns the defaults when nothing is stored", () => {
        expect(loadScopeUiState()).toEqual(DEFAULT_UI_STATE);
    });

    it("round-trips a saved state", () => {
        const state = {
            mode: "floating" as const,
            floatPos: { x: 11, y: 22 },
            floatSize: { w: 333, h: 444 },
            dockHeight: 180,
            windowS: 0.1,
        };
        saveScopeUiState(state);
        expect(loadScopeUiState()).toEqual(state);
    });

    it("falls back to the defaults on unparseable JSON", () => {
        storage["fulgurlab.scope.ui"] = "{not json";
        expect(loadScopeUiState()).toEqual(DEFAULT_UI_STATE);
    });

    it("replaces non-finite numbers with their defaults, field by field", () => {
        storage["fulgurlab.scope.ui"] = JSON.stringify({
            mode: "floating",
            floatPos: { x: "nope", y: null },
            floatSize: { w: NaN, h: 500 },
            dockHeight: undefined,
            windowS: 0.05,
        });
        const s = loadScopeUiState();
        expect(s.mode).toBe("floating");                          // valid, kept
        expect(s.floatPos).toEqual(DEFAULT_UI_STATE.floatPos);    // both invalid
        expect(s.floatSize.w).toBe(DEFAULT_UI_STATE.floatSize.w); // invalid
        expect(s.floatSize.h).toBe(500);                          // valid, kept
        expect(s.dockHeight).toBe(DEFAULT_UI_STATE.dockHeight);   // missing
        expect(s.windowS).toBe(0.05);                             // a real preset
    });

    it("rejects a stored window that is not one of the presets", () => {
        storage["fulgurlab.scope.ui"] = JSON.stringify({ ...DEFAULT_UI_STATE, windowS: 0.037 });
        expect(loadScopeUiState().windowS).toBe(DEFAULT_WINDOW_S);
    });

    it("treats any unknown mode as docked", () => {
        storage["fulgurlab.scope.ui"] = JSON.stringify({ ...DEFAULT_UI_STATE, mode: "fullscreen" });
        expect(loadScopeUiState().mode).toBe("docked");
    });

    it("a save that throws (quota, private mode) does not propagate", () => {
        vi.stubGlobal("window", {
            localStorage: {
                getItem: () => null,
                setItem: () => { throw new Error("QuotaExceededError"); },
            },
        });
        expect(() => saveScopeUiState(DEFAULT_UI_STATE)).not.toThrow();
    });

    it("is a no-op without a window (server render)", () => {
        vi.unstubAllGlobals();
        // vitest's node environment has no `window` global at all.
        expect(loadScopeUiState()).toEqual(DEFAULT_UI_STATE);
        expect(() => saveScopeUiState(DEFAULT_UI_STATE)).not.toThrow();
    });
});
