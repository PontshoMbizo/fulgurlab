// Scope UI state: window-span presets, dock/float persistence. Split out of
// Scope.tsx because that component is already large (drag/resize/dock state
// machine + legend + header controls) -- the "what does localStorage look
// like, what are the timebase choices" concerns are easier to read/change in
// isolation from the render tree.

// Total-window presets (the FULL visible span, not a per-division value --
// simpler for a first pass than reproducing a real scope's div-count/time-
// per-div split, per the task brief). Ordered so the selector can just map
// over this array; default is index-matched below.
export const WINDOW_PRESETS_S = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1] as const;
export const DEFAULT_WINDOW_S = 0.02; // 20ms, per the task brief.

// Mirrors store.ts's own MAX_SCOPE_SAMPLES -- that constant is module-private
// and store.ts is out of bounds for this pass (owned by another agent), so
// this is a deliberately-duplicated, documented copy used only to warn the
// user when their chosen window can never be fully populated. If store.ts's
// cap ever changes, this constant needs updating alongside it by whoever
// touches that file next.
export const ASSUMED_MAX_SCOPE_SAMPLES = 2000;

export function formatWindowLabel(seconds: number): string {
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
    return `${seconds}s`;
}

// Dock/float state machine -- see Scope.tsx for the drag thresholds that
// drive the transitions between these two modes.
export type ScopeMode = "docked" | "floating";

export interface ScopeUiState {
    mode: ScopeMode;
    floatPos: { x: number; y: number };
    floatSize: { w: number; h: number };
    dockHeight: number;
    windowS: number;
}

export const DEFAULT_UI_STATE: ScopeUiState = {
    mode: "docked",
    floatPos: { x: 420, y: 90 },
    floatSize: { w: 480, h: 300 },
    dockHeight: 240,
    windowS: DEFAULT_WINDOW_S,
};

const STORAGE_KEY = "fulgurlab.scope.ui";

// Loads persisted UI state, falling back field-by-field to defaults so a
// partially-written or older-shape blob (e.g. from before this feature had
// `dockHeight`) still produces a usable state instead of throwing away
// everything else the user had. Any parse/shape error is swallowed -- this
// is view-layer convenience state, not data worth failing the app over.
export function loadScopeUiState(): ScopeUiState {
    if (typeof window === "undefined") return DEFAULT_UI_STATE;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_UI_STATE;
        const parsed = JSON.parse(raw) as Partial<ScopeUiState>;
        return {
            mode: parsed.mode === "floating" ? "floating" : "docked",
            floatPos: {
                x: Number.isFinite(parsed.floatPos?.x) ? parsed.floatPos!.x : DEFAULT_UI_STATE.floatPos.x,
                y: Number.isFinite(parsed.floatPos?.y) ? parsed.floatPos!.y : DEFAULT_UI_STATE.floatPos.y,
            },
            floatSize: {
                w: Number.isFinite(parsed.floatSize?.w) ? parsed.floatSize!.w : DEFAULT_UI_STATE.floatSize.w,
                h: Number.isFinite(parsed.floatSize?.h) ? parsed.floatSize!.h : DEFAULT_UI_STATE.floatSize.h,
            },
            dockHeight: Number.isFinite(parsed.dockHeight) ? parsed.dockHeight! : DEFAULT_UI_STATE.dockHeight,
            windowS: Number.isFinite(parsed.windowS) && (WINDOW_PRESETS_S as readonly number[]).includes(parsed.windowS!)
                ? parsed.windowS!
                : DEFAULT_UI_STATE.windowS,
        };
    } catch {
        return DEFAULT_UI_STATE;
    }
}

// Fire-and-forget save -- called from a debounced effect in Scope.tsx, not
// on every mousemove during a drag (see that file). Swallows quota/private-
// browsing errors for the same reason load does: this is convenience state.
export function saveScopeUiState(state: ScopeUiState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore
    }
}
