import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    clampEditorHeight, defaultEditorHeight, loadEditorUiState, saveEditorUiState,
    DEFAULT_EDITOR_UI, EDITOR_MIN_H, SANDBOX_MIN_H,
} from "./editorUi";

describe("clampEditorHeight", () => {
    const VIEW = 1000;

    it("passes a comfortable height through unchanged", () => {
        expect(clampEditorHeight(400, VIEW)).toBe(400);
    });

    it("clamps to the editor minimum", () => {
        expect(clampEditorHeight(10, VIEW)).toBe(EDITOR_MIN_H);
        expect(clampEditorHeight(-500, VIEW)).toBe(EDITOR_MIN_H);
    });

    it("always leaves the sandbox its minimum", () => {
        expect(clampEditorHeight(VIEW, VIEW)).toBe(VIEW - SANDBOX_MIN_H);
        expect(clampEditorHeight(99999, VIEW)).toBe(VIEW - SANDBOX_MIN_H);
    });

    // When both minimums cannot be honoured the editor yields, not the canvas:
    // the circuit is the thing being simulated.
    it("degrades sanely on a viewport too short for both minimums", () => {
        const tiny = EDITOR_MIN_H + SANDBOX_MIN_H - 50;
        const h = clampEditorHeight(500, tiny);
        expect(h).toBeLessThanOrEqual(EDITOR_MIN_H);
        expect(h).toBeGreaterThanOrEqual(0);
    });

    it("never returns a negative height, even for a zero viewport", () => {
        expect(clampEditorHeight(300, 0)).toBe(0);
    });

    it("survives NaN", () => {
        expect(clampEditorHeight(NaN, VIEW)).toBe(EDITOR_MIN_H);
    });

    it("defaultEditorHeight is half the viewport, clamped", () => {
        expect(defaultEditorHeight(1000)).toBe(500);
        expect(defaultEditorHeight(300)).toBe(Math.max(0, Math.min(EDITOR_MIN_H, 300)));
    });
});

describe("editor UI persistence", () => {
    const store = new Map<string, string>();

    beforeEach(() => {
        store.clear();
        vi.stubGlobal("window", {
            localStorage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => void store.set(k, v),
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("round-trips a saved state", () => {
        const state = { open: true, height: 421, targetId: "bluepill" };
        saveEditorUiState(state);
        expect(loadEditorUiState()).toEqual(state);
    });

    it("returns defaults when nothing is stored", () => {
        expect(loadEditorUiState()).toEqual(DEFAULT_EDITOR_UI);
    });

    it("returns defaults on malformed JSON rather than throwing", () => {
        store.set("fulgurlab.editor.ui", "{not json");
        expect(() => loadEditorUiState()).not.toThrow();
        expect(loadEditorUiState()).toEqual(DEFAULT_EDITOR_UI);
    });

    // An older blob written before a field existed must not discard the rest.
    it("defaults field-by-field for a partial blob", () => {
        store.set("fulgurlab.editor.ui", JSON.stringify({ open: true }));
        expect(loadEditorUiState()).toEqual({
            open: true,
            height: DEFAULT_EDITOR_UI.height,
            targetId: DEFAULT_EDITOR_UI.targetId,
        });
    });

    it("coerces a non-boolean `open` rather than trusting it", () => {
        store.set("fulgurlab.editor.ui", JSON.stringify({ open: "yes", height: 200 }));
        expect(loadEditorUiState().open).toBe(false);
    });
});
