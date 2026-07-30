// Firmware editor pane UI state: open/closed, split height, which chip is
// being edited. Split out of FirmwareEditorPane.tsx for the same reason
// scope/scopeUi.ts is split out of Scope.tsx -- the persistence shape and the
// clamping arithmetic are the parts worth testing, and the app's vitest setup
// covers .ts only (components are deliberately out of scope).

/**
 * Smallest useful editor pane: roughly a header plus a few lines of code.
 * Below this the pane is just chrome and the user should collapse it instead.
 */
export const EDITOR_MIN_H = 120;

/**
 * Smallest useful circuit sandbox. Not arbitrary: the floating chrome
 * (toolbar ~58px at the top, speed slider and the scope dock at the bottom)
 * already claims most of a short pane, so anything less shows no circuit at
 * all. This is why the split is stored in PIXELS rather than fpgasim's
 * percentages -- on a 700px laptop a 60% editor leaves 280px, which the
 * chrome alone consumes, and a percentage split cannot express "the sandbox
 * needs at least this many pixels" without re-deriving it on every resize.
 * The scope dock is pixel-based for the same reason (scopeUi's DOCK_MIN_H).
 */
export const SANDBOX_MIN_H = 240;

/** Fraction of the viewport the editor takes when first opened. */
const DEFAULT_SPLIT_FRACTION = 0.5;

export interface EditorUiState {
    open: boolean;
    /** Editor pane height in px. Meaningless while `open` is false, but kept
     *  so reopening restores the user's last split rather than the default. */
    height: number;
    /** targetId (extchip/targets.ts) last selected in the pane's picker. */
    targetId: string;
}

export const DEFAULT_EDITOR_UI: EditorUiState = {
    open: false,
    height: 360,
    targetId: "",
};

const STORAGE_KEY = "fulgurlab.editor.ui";

/**
 * Clamp a proposed editor height to what the viewport can actually show.
 *
 * When the viewport is too short to satisfy both minimums, the editor yields:
 * the circuit is the thing being simulated, and an editor that squeezes the
 * canvas to nothing is worse than a cramped editor. Never returns < 0.
 */
export function clampEditorHeight(px: number, viewportH: number): number {
    if (!Number.isFinite(px)) return EDITOR_MIN_H;
    const maxH = viewportH - SANDBOX_MIN_H;
    if (maxH <= EDITOR_MIN_H) return Math.max(0, Math.min(EDITOR_MIN_H, viewportH));
    return Math.round(Math.min(Math.max(px, EDITOR_MIN_H), maxH));
}

/** Height to open at when the user has no persisted preference yet. */
export function defaultEditorHeight(viewportH: number): number {
    return clampEditorHeight(Math.round(viewportH * DEFAULT_SPLIT_FRACTION), viewportH);
}

// Field-by-field defaulting so a partially-written or older-shape blob still
// produces a usable state instead of discarding everything else the user had.
// Parse/shape errors are swallowed: this is view-layer convenience state, not
// data worth failing the app over. Same contract as loadScopeUiState().
export function loadEditorUiState(): EditorUiState {
    if (typeof window === "undefined") return DEFAULT_EDITOR_UI;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_EDITOR_UI;
        const parsed = JSON.parse(raw) as Partial<EditorUiState>;
        return {
            open: parsed.open === true,
            height: Number.isFinite(parsed.height) ? parsed.height! : DEFAULT_EDITOR_UI.height,
            targetId: typeof parsed.targetId === "string" ? parsed.targetId : DEFAULT_EDITOR_UI.targetId,
        };
    } catch {
        return DEFAULT_EDITOR_UI;
    }
}

export function saveEditorUiState(state: EditorUiState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore (quota / private browsing)
    }
}
