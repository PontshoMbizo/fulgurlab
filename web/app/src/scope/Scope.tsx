"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { engineStore } from "@/engine/store";
import { drawScopeCanvas } from "./draw";
import {
    ASSUMED_MAX_SCOPE_SAMPLES,
    DEFAULT_UI_STATE,
    WINDOW_PRESETS_S,
    formatWindowLabel,
    loadScopeUiState,
    saveScopeUiState,
} from "./scopeUi";

const MIN_W = 320, MIN_H = 200;
const TITLE_H = 30;
const HEADER_H = 30; // legend/controls row height, shared by both docked and floating modes.

// Docked mode's resizable-height bounds (dragging the top edge), per the
// task brief: never smaller than 140px, never more than 60% of the viewport.
const DOCK_MIN_H = 140;
const dockMaxH = () => (typeof window === "undefined" ? 600 : window.innerHeight * 0.6);

// Drag thresholds for the dock <-> float transitions -- both read as "the
// cursor is now clearly somewhere else" rather than a minor jiggle, same
// order of magnitude as typical OS window-snap thresholds.
const UNDOCK_DISTANCE = 40; // title-bar drag distance before it detaches into a floating window.
const REDOCK_ZONE = 40; // px from the bottom viewport edge that triggers a re-dock snap while floating.

interface Props {
    probeActive: boolean;
}

// KiCad/IDE-style bottom-dockable oscilloscope panel. Two mutually exclusive
// layout modes share one canvas + legend + header-controls tree:
//  - "docked": full-width strip pinned to the bottom of the app, height
//    resizable by dragging its top edge (like a docked IDE panel).
//  - "floating": the original MATLAB-style user-positioned/resized window.
// Dragging the title bar transitions between them (see startTitleDrag and
// attachFloatDragListeners below); mode + geometry + selected timebase
// persist to localStorage so a reload keeps the layout the user set up.
export default function Scope({ probeActive }: Props) {
    const version = useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);

    // Loaded once, lazily, from localStorage -- guards its own parse errors
    // (see scopeUi.ts) so a corrupt/older-shape blob can't crash the app.
    const [ui, setUi] = useState(() => (typeof window === "undefined" ? DEFAULT_UI_STATE : loadScopeUiState()));
    const [dropHint, setDropHint] = useState(false); // bottom-edge highlight shown mid-drag while floating.

    // Freezing the display: `pausedTEnd` snapshots the sweep's right edge at
    // the moment Pause is pressed. The sim (engineStore.run()/stop(), a
    // completely separate concept from this) keeps stepping and recording
    // samples the whole time -- only the SCOPE'S OWN redraw stops advancing
    // its window, exactly like a real scope's "hold" button, not the sim's
    // run/stop toggle.
    const [pausedTEnd, setPausedTEnd] = useState<number | null>(null);
    const paused = pausedTEnd !== null;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const channels = engineStore.scopeChannels;
    const visible = probeActive || channels.length > 0;

    // Publish the docked strip's height as a CSS custom property so the
    // bottom-anchored chrome (SpeedSlider, StatusHint) can lift itself above
    // the dock via calc(18px + var(--fl-scope-dock)) instead of being
    // covered by it. Cleared when floating/hidden so the chrome settles back
    // to its normal corner position.
    useEffect(() => {
        const root = document.documentElement;
        if (visible && ui.mode === "docked") {
            root.style.setProperty("--fl-scope-dock", `${ui.dockHeight}px`);
        } else {
            root.style.setProperty("--fl-scope-dock", "0px");
        }
        return () => { root.style.setProperty("--fl-scope-dock", "0px"); };
    }, [visible, ui.mode, ui.dockHeight]);

    // Docked mode is full-width, so unlike the floating window (whose width
    // is only ever user-resized, never viewport-driven) it needs to track
    // browser window resizes directly -- otherwise dragging the OS window
    // narrower would leave the canvas bitmap sized to a stale innerWidth
    // until some unrelated state change happened to force a re-render.
    const [viewportW, setViewportW] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
    useEffect(() => {
        if (ui.mode !== "docked") return;
        const onResize = () => {
            setViewportW(window.innerWidth);
            // Re-clamp a persisted dockHeight that no longer fits (e.g. a
            // tall-monitor height restored on a shorter window) against the
            // SAME 140..60vh bounds startDockResize enforces during a drag.
            setUi((prev) => ({ ...prev, dockHeight: Math.min(Math.max(DOCK_MIN_H, prev.dockHeight), dockMaxH()) }));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [ui.mode]);

    // Persist UI state, debounced -- called from drag handlers on every
    // mousemove would otherwise thrash localStorage; a short debounce
    // coalesces a whole drag/resize gesture into one write after it settles.
    useEffect(() => {
        const handle = setTimeout(() => saveScopeUiState(ui), 300);
        return () => clearTimeout(handle);
    }, [ui]);

    // The panel's own CSS content box (excludes title bar + header row) --
    // computed once here so both the bitmap-resize effect and the redraw
    // effect below read the exact same numbers, docked or floating.
    const contentW = ui.mode === "docked" ? viewportW : ui.floatSize.w;
    const contentH = (ui.mode === "docked" ? ui.dockHeight : ui.floatSize.h) - TITLE_H - HEADER_H;

    // Resize the canvas's backing bitmap only when the CSS size actually
    // changes -- assigning canvas.width/height (even to the same value)
    // clears the whole bitmap and resets the 2D context's transform/clip
    // stack, so this must NOT run on every version bump (every rAF frame
    // while the sim is running), only on an actual panel resize.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !visible) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(contentW * dpr));
        canvas.height = Math.max(1, Math.round(contentH * dpr));
        canvas.style.width = `${contentW}px`;
        canvas.style.height = `${contentH}px`;
    }, [visible, contentW, contentH]);

    // Redraw imperatively whenever the store bumps (every rAF frame while
    // running, and on every channel add/remove) -- a cheap clearRect+repaint
    // via drawScopeCanvas's own internal ctx.save()/restore(), not a bitmap
    // reallocation. Canvas is an imperative API, not something React's
    // render can drive declaratively the way the SVG circuit view is.
    useEffect(() => {
        if (!visible) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        // The sweep's right edge: frozen at the pause snapshot, or the sim's
        // live clock otherwise. engine.t is always >= every channel's latest
        // sample time (samples are recorded AT engine.t each step), so it's
        // a correct "tLatest" without having to scan every channel's history.
        const tEnd = paused ? pausedTEnd! : engineStore.engine.t;
        drawScopeCanvas(ctx, channels, contentW, contentH, dpr, { tEnd, span: ui.windowS });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, version, contentW, contentH, ui.windowS, paused, pausedTEnd]);

    if (!visible) return null;

    // Whether the selected window can ever be fully populated by the
    // rolling sample buffer. Mirrors the same "8ms window, only 5ms of
    // history exists yet" reality drawScopeCanvas already renders correctly
    // (the trace just doesn't reach the left edge) -- this is purely an
    // UP-FRONT hint so the user understands WHY before they see it, using
    // the live dt (engineStore.engine.timeStep, not a hardcoded guess) since
    // dt can change with the circuit's own timestep. store.ts's sampling
    // itself is untouched -- this only reads its public engine field.
    const dt = engineStore.engine.timeStep;
    const maxBufferedSpan = ASSUMED_MAX_SCOPE_SAMPLES * dt;
    const windowExceedsBuffer = ui.windowS > maxBufferedSpan;

    function setWindowS(windowS: number) {
        setUi((prev) => ({ ...prev, windowS }));
    }

    function togglePause() {
        setPausedTEnd((prev) => (prev === null ? engineStore.engine.t : null));
    }

    // ---- Floating drag/resize (unchanged behavior from the original
    // always-floating window, just now gated to ui.mode === "floating"). ----

    function startFloatDrag(e: ReactMouseEvent) {
        e.preventDefault();
        attachFloatDragListeners({ x: e.clientX, y: e.clientY }, ui.floatPos);
    }

    // Shared by startFloatDrag (normal move-while-floating) AND the docked
    // undock handoff below -- both are "track the cursor, move floatPos by
    // the delta from some starting point, clamp to the viewport, and watch
    // for a release inside the bottom re-dock zone." Factored out so that
    // clamping/re-dock math exists in exactly one place.
    function attachFloatDragListeners(start: { x: number; y: number }, origin: { x: number; y: number }) {
        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
            const maxX = window.innerWidth - 60, maxY = window.innerHeight - 40;
            setUi((prev) => ({
                ...prev,
                floatPos: {
                    x: Math.min(Math.max(-prev.floatSize.w + 60, origin.x + dx), maxX),
                    y: Math.min(Math.max(0, origin.y + dy), maxY),
                },
            }));
            // Re-dock snap zone: hovering within REDOCK_ZONE px of the
            // bottom viewport edge while floating shows the drop hint, and
            // releasing there snaps back to docked (see the `up` handler).
            setDropHint(window.innerHeight - ev.clientY < REDOCK_ZONE);
        };
        const up = (ev: MouseEvent) => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            if (window.innerHeight - ev.clientY < REDOCK_ZONE) {
                setUi((prev) => ({ ...prev, mode: "docked" }));
            }
            setDropHint(false);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    function startFloatResize(e: ReactMouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const origin = ui.floatSize;
        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            setUi((prev) => ({
                ...prev,
                floatSize: { w: Math.max(MIN_W, origin.w + dx), h: Math.max(MIN_H, origin.h + dy) },
            }));
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    // ---- Docked mode's own top-edge resize (drag the strip taller/shorter). ----

    function startDockResize(e: ReactMouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const originH = ui.dockHeight;
        const move = (ev: MouseEvent) => {
            // Dragging UP (negative dy) grows the dock, since its height is
            // measured from the bottom edge upward -- same sense as any
            // bottom-docked IDE panel (Console/Terminal panels behave the
            // same way).
            const dy = startY - ev.clientY;
            setUi((prev) => ({ ...prev, dockHeight: Math.min(Math.max(DOCK_MIN_H, originH + dy), dockMaxH()) }));
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    // ---- Title bar drag: docked -> floating undock, or floating's normal
    // move (which can itself re-dock, see startFloatDrag above). ----

    function startTitleDrag(e: ReactMouseEvent) {
        if (ui.mode === "floating") { startFloatDrag(e); return; }

        // Docked: watch for the drag exceeding UNDOCK_DISTANCE before doing
        // anything -- a click or tiny jiggle on the title bar must NOT
        // undock the panel, only a deliberate drag-away gesture should.
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const move = (ev: MouseEvent) => {
            const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
            if (dist <= UNDOCK_DISTANCE) return;
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            // Detach into the floating window centered under the cursor's
            // current position, so the undock feels like "picking the panel
            // up" rather than it jumping to some unrelated fixed spot. Then
            // hand off the REST of this same gesture to the shared float-
            // drag listeners (origin = the position we just set, start =
            // here) so the panel continues tracking the cursor with no dead
            // frame in between.
            const newPos = { x: ev.clientX - ui.floatSize.w / 2, y: Math.max(0, ev.clientY - TITLE_H / 2) };
            setUi((prev) => ({ ...prev, mode: "floating", floatPos: newPos }));
            attachFloatDragListeners({ x: ev.clientX, y: ev.clientY }, newPos);
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    const legend = (
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto">
            {channels.length === 0 ? null : (
                channels.map((ch) => {
                    const last = ch.history[ch.history.length - 1];
                    const unit = ch.mode === "current" ? "A" : "V";
                    return (
                        <span
                            key={ch.id}
                            className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-[10.5px] font-mono shrink-0"
                            style={{ background: "rgba(255,255,255,.06)", color: ch.color }}
                        >
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ch.color }} />
                            <span>{ch.label}</span>
                            <span className="text-neutral-400">{last ? `${last.value.toFixed(3)}${unit}` : "--"}</span>
                            <button
                                onClick={() => engineStore.removeScopeChannel(ch.id)}
                                className="text-neutral-500 hover:text-neutral-200 cursor-pointer px-1 leading-none"
                                title="Remove this channel"
                            >
                                ×
                            </button>
                        </span>
                    );
                })
            )}
        </div>
    );

    const windowSelect = (
        <select
            value={ui.windowS}
            onChange={(e) => setWindowS(Number(e.target.value))}
            title={windowExceedsBuffer ? `Window exceeds buffer -- only ~${formatWindowLabel(maxBufferedSpan)} of history is ever kept at the current timestep` : "Visible time window"}
            className="text-[10px] font-mono rounded px-1 py-0.5 border cursor-pointer outline-none"
            style={{
                background: windowExceedsBuffer ? "rgba(250,204,21,.12)" : "rgba(255,255,255,.06)",
                borderColor: windowExceedsBuffer ? "rgba(250,204,21,.4)" : "rgba(255,255,255,.1)",
                color: windowExceedsBuffer ? "#facc15" : "#d4d4d8",
            }}
        >
            {WINDOW_PRESETS_S.map((s) => (
                <option key={s} value={s} style={{ background: "#18181b", color: "#d4d4d8" }}>
                    {formatWindowLabel(s)}
                </option>
            ))}
        </select>
    );

    // Pause/window-span live here, separate from the title bar's Clear --
    // Clear is a destructive "remove everything" action and stays paired
    // with the title bar in both modes (unchanged from the original
    // always-floating layout); these are non-destructive view controls.
    const headerControls = (
        <div className="flex items-center gap-2 shrink-0">
            {windowSelect}
            <button
                onClick={togglePause}
                title={paused ? "Resume the scope display (the simulation itself never stopped)" : "Freeze the scope display (the simulation keeps running)"}
                className="text-[10px] px-1.5 py-0.5 rounded border cursor-pointer"
                style={{
                    background: paused ? "rgba(250,204,21,.15)" : "rgba(255,255,255,.06)",
                    borderColor: paused ? "rgba(250,204,21,.4)" : "rgba(255,255,255,.1)",
                    color: paused ? "#facc15" : "#a1a1aa",
                }}
            >
                {paused ? "Resume" : "Pause"}
            </button>
        </div>
    );

    const canvasBox = (
        <div className="flex-1 min-h-0">
            <canvas ref={canvasRef} />
        </div>
    );

    if (ui.mode === "docked") {
        return (
            <>
                {/* Drop-hint strip: only meaningful while floating-dragging, but
                    kept mounted here (opacity-gated) so it's always the same
                    full-width element sitting at the bottom, matching where the
                    panel will actually land. */}
                {dropHint && (
                    <div
                        className="fixed left-0 right-0 bottom-0 z-[5] pointer-events-none"
                        style={{ height: DOCK_MIN_H, background: "linear-gradient(to top, rgba(56,189,248,.18), transparent)", borderTop: "2px solid rgba(56,189,248,.6)" }}
                    />
                )}
                <div
                    ref={containerRef}
                    className="fixed left-0 right-0 bottom-0 z-[6] border-t border-white/10 shadow-lg overflow-hidden flex flex-col select-none"
                    style={{
                        height: ui.dockHeight,
                        background: "rgba(18,18,20,.92)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                        boxShadow: "0 -10px 30px rgba(0,0,0,.5)",
                    }}
                >
                    {/* Top-edge drag handle -- resizes dock height (140..60vh). */}
                    <div
                        className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize"
                        onMouseDown={startDockResize}
                    />
                    <div
                        className="flex items-center justify-between px-3 border-b border-white/[0.08] cursor-grab active:cursor-grabbing shrink-0"
                        style={{ height: TITLE_H }}
                        onMouseDown={startTitleDrag}
                        title="Drag up to undock into a floating window"
                    >
                        <span className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500 shrink-0">Scope</span>
                        {/* Docked mode folds the legend + controls into the title
                            bar row itself to save vertical space (task brief).
                            stopPropagation on this wrapper keeps clicks on the
                            select/buttons/chips from also being seen by the
                            title bar's own onMouseDown (which starts the
                            undock-drag watch) -- otherwise every click here
                            would attach a throwaway set of drag listeners. */}
                        <div
                            className="flex items-center flex-1 min-w-0 mx-3 gap-2"
                            onMouseDown={(e) => {
                                // Only swallow mousedowns that actually target an
                                // interactive control (select/button/input) -- the
                                // wrapper spans nearly the whole title bar (legend is
                                // flex-1), and stopping propagation unconditionally
                                // made the undock-drag unreachable from anywhere but
                                // the tiny "Scope" label (the reported "can't undock"
                                // bug). Empty legend space now drags like the title.
                                const t = e.target as HTMLElement;
                                if (t.closest("button, select, input")) e.stopPropagation();
                            }}
                        >
                            {legend}
                            {headerControls}
                            {channels.length > 0 && (
                                <button
                                    onClick={() => engineStore.clearScopeChannels()}
                                    className="text-[10px] text-neutral-500 hover:text-neutral-200 cursor-pointer shrink-0"
                                    title="Remove every channel"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    {canvasBox}
                </div>
            </>
        );
    }

    return (
        <>
            {dropHint && (
                <div
                    className="fixed left-0 right-0 bottom-0 z-[5] pointer-events-none"
                    style={{ height: DOCK_MIN_H, background: "linear-gradient(to top, rgba(56,189,248,.18), transparent)", borderTop: "2px solid rgba(56,189,248,.6)" }}
                />
            )}
            <div
                ref={containerRef}
                className="absolute z-[6] rounded-2xl border border-white/10 shadow-lg overflow-hidden flex flex-col select-none"
                style={{
                    left: ui.floatPos.x, top: ui.floatPos.y, width: ui.floatSize.w, height: ui.floatSize.h,
                    background: "rgba(18,18,20,.9)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                    boxShadow: "0 10px 30px rgba(0,0,0,.5)",
                }}
            >
                <div
                    className="flex items-center justify-between px-3 border-b border-white/[0.08] cursor-grab active:cursor-grabbing shrink-0"
                    style={{ height: TITLE_H }}
                    onMouseDown={startTitleDrag}
                    title="Drag to the bottom edge to re-dock"
                >
                    <span className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">Scope</span>
                    {channels.length > 0 && (
                        <button
                            onClick={() => engineStore.clearScopeChannels()}
                            className="text-[10px] text-neutral-500 hover:text-neutral-200 cursor-pointer"
                            title="Remove every channel"
                        >
                            Clear
                        </button>
                    )}
                </div>

                <div
                    className="flex items-center gap-1.5 px-2.5 shrink-0"
                    style={{ height: HEADER_H, paddingTop: 4, paddingBottom: 4 }}
                >
                    {legend}
                    {headerControls}
                </div>

                {canvasBox}

                <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                    onMouseDown={startFloatResize}
                    style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,.15) 50%)" }}
                />
            </div>
        </>
    );
}
