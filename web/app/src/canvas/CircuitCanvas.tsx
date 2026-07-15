"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, DragEvent as ReactDragEvent } from "react";
import { createElement, CircuitElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import type { PaletteItem } from "@/palette/palette";
import { GRID_SIZE, snap, distanceToElement } from "./draw";
import { ElementSymbol } from "./symbols";
import { BACKGROUND, DOT_GRID_IMAGE, DOT_GRID_SIZE, VIGNETTE_IMAGE, CANVAS_VIGNETTE_SHADOW, SELECT_COLOR } from "./theme";

const HIT_THRESHOLD = 8; // screen pixels -- divided by viewport.scale before comparing against world-space distances
const DEFAULT_SPAN = GRID_SIZE * 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

// Just the bits toWorldPoint/pan math need -- shared between React's
// SyntheticEvent (mousedown, still bound via JSX so it's scoped to the SVG
// element) and native window-level MouseEvents (move/up, deliberately
// window-bound so a fast pan/drag that leaves the SVG's bounding box -- easy
// to do, e.g. dragging past the browser edge or under a floating chrome
// panel -- doesn't get stuck with a gesture that never receives its mouseup).
interface PointerLike { clientX: number; clientY: number; }

interface Viewport {
    x: number; // screen-space pan offset
    y: number;
    scale: number;
}

interface Props {
    activeTool: PaletteItem | null;
    onPlaced?: () => void;
    // Probe tool (Scopes button): while true, clicking an element toggles a
    // scope channel on it instead of selecting/moving it.
    probeMode?: boolean;
    // Fired after a double-click lands on an element (only outside
    // activeTool/probeMode -- see handleDoubleClick below); the element
    // itself is already selected by the time this fires, so the callback
    // just needs to open whatever UI shows the selected element.
    onElementDoubleClick?: () => void;
}

export default function CircuitCanvas({ activeTool, onPlaced, probeMode = false, onElementDoubleClick }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
    const [hovered, setHovered] = useState<CircuitElm | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
    const [spacePressed, setSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [isDragOverFile, setIsDragOverFile] = useState(false);

    // Kept in a ref (not state) since handleMouseDownRef/window listeners
    // read the *latest* value without needing to re-subscribe on every
    // render -- viewportRef mirrors viewport for that same reason.
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    const moveState = useRef<{
        elm: CircuitElm; startWorldX: number; startWorldY: number;
        origX: number; origY: number; origX2: number; origY2: number;
    } | null>(null);
    const panState = useRef<{ startScreenX: number; startScreenY: number; startX: number; startY: number } | null>(null);

    // Size the SVG viewport to its container.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const box = entries[0].contentRect;
            setSize({ w: Math.max(200, box.width), h: Math.max(200, box.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Screen -> world conversion, honoring the current pan/zoom. Grid-snap
    // happens in world space so placement/move behavior is resolution
    // independent of zoom level. Reads viewportRef (not the viewport prop
    // closed over at render time) so it stays correct inside the
    // window-level listeners set up further down, which are attached once
    // per gesture rather than re-attached on every viewport change.
    const toWorldPoint = useCallback((e: PointerLike, doSnap = true) => {
        const rect = svgRef.current!.getBoundingClientRect();
        const v = viewportRef.current;
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const wx = (sx - v.x) / v.scale;
        const wy = (sy - v.y) / v.scale;
        return doSnap ? { x: snap(wx), y: snap(wy) } : { x: wx, y: wy };
    }, []);

    // Wheel-to-zoom, centered on the cursor: registered as a native
    // (non-passive) listener since React attaches wheel handlers passively
    // by default, which would silently ignore preventDefault() and let the
    // page scroll instead of zooming the canvas.
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
            setViewport((v) => {
                const worldX = (sx - v.x) / v.scale;
                const worldY = (sy - v.y) / v.scale;
                const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
                const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
                return { x: sx - worldX * newScale, y: sy - worldY * newScale, scale: newScale };
            });
        };
        svg.addEventListener("wheel", onWheel, { passive: false });
        return () => svg.removeEventListener("wheel", onWheel);
    }, []);

    const finalizePlacement = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, tool: PaletteItem) => {
        let { x: x2, y: y2 } = end;
        if (x2 === start.x && y2 === start.y) {
            x2 = start.x + DEFAULT_SPAN;
            y2 = start.y;
        }
        const elm = createElement(tool.dumpType, start.x, start.y, x2, y2, tool.flags, tool.tokens);
        if (elm) {
            engineStore.addElement(elm);
            engineStore.select(elm);
        }
    }, []);

    const pickElement = useCallback((p: { x: number; y: number }): CircuitElm | null => {
        let best: CircuitElm | null = null;
        let bestDist = HIT_THRESHOLD / viewportRef.current.scale;
        for (const elm of engineStore.engine.elmList) {
            const dist = distanceToElement(elm, p.x, p.y);
            if (dist < bestDist) {
                bestDist = dist;
                best = elm;
            }
        }
        return best;
    }, []);

    // Every active gesture (pan / place-new-element / move-existing-element)
    // is driven by window-level move/up listeners set up fresh at the start
    // of that gesture and torn down at its end -- not React's onMouseMove/
    // onMouseUp props on the SVG, which stop firing the moment the cursor
    // leaves the SVG's bounding box (easy to do mid-drag: past the browser
    // edge, or under one of the floating chrome panels that sit visually on
    // top of the canvas). This mirrors SpeedSlider.tsx's drag pattern.
    //
    // endGesture holds a zero-arg *cancel* callback (used by Escape), kept
    // deliberately distinct from each gesture's mouseup handler: cancelling a
    // placement drag must NOT place the element (unlike a normal mouseup,
    // which does), and cancelling a move reverts to the pre-drag position
    // rather than committing wherever the cursor happened to be.
    const endGesture = useRef<(() => void) | null>(null);

    const startPan = useCallback((e: ReactMouseEvent) => {
        e.preventDefault();
        panState.current = { startScreenX: e.clientX, startScreenY: e.clientY, startX: viewportRef.current.x, startY: viewportRef.current.y };
        setIsPanning(true);
        const move = (ev: MouseEvent) => {
            const ps = panState.current;
            if (!ps) return;
            const dx = ev.clientX - ps.startScreenX, dy = ev.clientY - ps.startScreenY;
            setViewport((v) => ({ ...v, x: ps.startX + dx, y: ps.startY + dy }));
        };
        const stop = () => {
            panState.current = null;
            setIsPanning(false);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
        };
        const up = () => stop();
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = stop;
    }, []);

    const startPlace = useCallback((start: { x: number; y: number }, tool: PaletteItem) => {
        dragStart.current = start;
        setDragCurrent(start);
        const move = (ev: MouseEvent) => setDragCurrent(toWorldPoint(ev));
        const teardown = () => {
            dragStart.current = null;
            setDragCurrent(null);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
        };
        const up = (ev: MouseEvent) => {
            finalizePlacement(start, toWorldPoint(ev), tool);
            teardown();
            onPlaced?.();
        };
        const cancel = () => teardown();
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = cancel;
    }, [toWorldPoint, finalizePlacement, onPlaced]);

    const startMove = useCallback((elm: CircuitElm, start: { x: number; y: number }) => {
        const origX = elm.x, origY = elm.y, origX2 = elm.x2, origY2 = elm.y2;
        moveState.current = { elm, startWorldX: start.x, startWorldY: start.y, origX, origY, origX2, origY2 };
        // Brackets the WHOLE drag (every intermediate setElementGeometry()
        // call below) into a single undo step, rather than one per
        // mousemove -- see EngineStore.beginTransaction()'s doc comment.
        engineStore.beginMoveTransaction();
        const move = (ev: MouseEvent) => {
            const m = moveState.current;
            if (!m) return;
            const p = toWorldPoint(ev);
            const dx = p.x - m.startWorldX, dy = p.y - m.startWorldY;
            engineStore.setElementGeometry(m.elm, m.origX + dx, m.origY + dy, m.origX2 + dx, m.origY2 + dy);
        };
        // Moving is already committed live (setElementGeometry runs on every
        // move above) -- mouseup just ends the gesture and closes out the
        // undo transaction opened above. Escape instead reverts to the
        // pre-drag position first (cancel): since that puts the circuit back
        // to exactly the pendingSnapshot text, endMoveTransaction() sees no
        // net change and correctly pushes no undo entry at all.
        const teardown = () => {
            moveState.current = null;
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
            engineStore.endMoveTransaction();
        };
        const up = () => teardown();
        const cancel = () => {
            engineStore.setElementGeometry(elm, origX, origY, origX2, origY2);
            teardown();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = cancel;
    }, [toWorldPoint]);

    const handleMouseDown = useCallback((e: ReactMouseEvent) => {
        const wantsPan = e.button === 1 || (e.button === 0 && spacePressed);
        if (wantsPan) {
            startPan(e);
            return;
        }
        const p = toWorldPoint(e);
        if (activeTool) {
            startPlace(p, activeTool);
        } else if (probeMode) {
            const elm = pickElement(p);
            if (elm) engineStore.toggleScopeChannel(elm);
        } else {
            const elm = pickElement(p);
            engineStore.select(elm);
            if (elm) startMove(elm, p);
        }
    }, [activeTool, probeMode, toWorldPoint, pickElement, spacePressed, startPan, startPlace, startMove]);

    // Double-click opens the modal edit dialog -- only in the plain select/
    // move mode, not while placing a new element or probing (in probe mode,
    // the two mousedowns of a double-click would just toggle a channel on
    // then immediately back off; opening a modal on top of that would be
    // confusing rather than useful).
    const handleDoubleClick = useCallback((e: ReactMouseEvent) => {
        if (activeTool || probeMode) return;
        const elm = pickElement(toWorldPoint(e));
        if (elm) {
            engineStore.select(elm);
            onElementDoubleClick?.();
        }
    }, [activeTool, probeMode, toWorldPoint, pickElement, onElementDoubleClick]);

    // Hover preview only, while nothing is being dragged -- real drag
    // tracking lives in the window-level listeners started above.
    const handleMouseMove = useCallback((e: ReactMouseEvent) => {
        if (activeTool || moveState.current || panState.current) return;
        setHovered(pickElement(toWorldPoint(e)));
    }, [activeTool, pickElement, toWorldPoint]);

    useEffect(() => {
        const isTypingTarget = () => {
            const active = document.activeElement;
            return !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.key === "Delete" || e.key === "Backspace") && engineStore.selected) {
                if (isTypingTarget()) return;
                engineStore.removeElement(engineStore.selected);
                e.preventDefault();
            }
            if (e.key === "Escape") {
                endGesture.current?.();
                dragStart.current = null;
                setDragCurrent(null);
            }
            if (e.code === "Space" && !isTypingTarget()) {
                setSpacePressed(true);
                e.preventDefault();
            }
            // Undo/redo: skipped while typing so native input-level undo
            // (e.g. inside a future edit dialog's text field) isn't hijacked
            // by the circuit-level history. Ctrl+Y is the common Windows/
            // Linux redo chord; Ctrl+Shift+Z covers Mac and browser-style
            // habits -- both are wired to the same redo() call.
            if ((e.ctrlKey || e.metaKey) && !isTypingTarget()) {
                const key = e.key.toLowerCase();
                if (key === "z" && !e.shiftKey) {
                    engineStore.undo();
                    e.preventDefault();
                } else if ((key === "z" && e.shiftKey) || key === "y") {
                    engineStore.redo();
                    e.preventDefault();
                }
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === "Space") setSpacePressed(false);
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, []);

    const selected = engineStore.selected;
    const worldTransform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
    const cursor = activeTool ? "crosshair" : probeMode ? "pointer" : isPanning ? "grabbing" : spacePressed ? "grab" : "default";

    // Drag-and-drop a circuit .txt file onto the canvas as an alternative to
    // UndoRedoCluster's file-picker button -- both funnel through
    // engineStore.importFile(), which owns the actual FileReader logic.
    const handleDragOver = (e: ReactDragEvent) => {
        e.preventDefault();
        setIsDragOverFile(true);
    };
    const handleDragLeave = () => setIsDragOverFile(false);
    const handleDrop = (e: ReactDragEvent) => {
        e.preventDefault();
        setIsDragOverFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) engineStore.importFile(file);
    };

    return (
        <div
            ref={containerRef}
            className="w-full h-full relative overflow-hidden"
            style={{ background: BACKGROUND }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragOverFile && (
                <div
                    className="absolute inset-2 rounded-2xl pointer-events-none z-10"
                    style={{ border: "2px dashed #22d3ee", background: "rgba(34,211,238,.06)" }}
                />
            )}
            {/* Dot grid lives in world space -- it represents real grid-snap
                positions, so it pans/zooms with the circuit (transform-origin
                0 0 to match the SVG's own coordinate convention). */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: DOT_GRID_IMAGE, backgroundSize: DOT_GRID_SIZE,
                    transform: worldTransform, transformOrigin: "0 0",
                }}
            />
            {/* Vignette is a fixed viewport decoration, deliberately NOT
                transformed -- it should never drift as the user pans. */}
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: VIGNETTE_IMAGE }} />
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: CANVAS_VIGNETTE_SHADOW }} />

            <svg
                ref={svgRef}
                width={size.w}
                height={size.h}
                className="absolute inset-0"
                style={{ cursor, display: "block" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHovered(null)}
                onDoubleClick={handleDoubleClick}
                onContextMenu={(e) => e.preventDefault()}
            >
                <g transform={worldTransform}>
                    {engineStore.engine.elmList.map((elm, i) => {
                        const scopeChannel = engineStore.isProbed(elm);
                        return (
                            <g key={i}>
                                <ElementSymbol
                                    elm={elm}
                                    selected={elm === selected}
                                    hovered={elm === hovered}
                                    onMouseDown={(e) => {
                                        if (activeTool) return;
                                        e.stopPropagation();
                                        if (probeMode) {
                                            engineStore.toggleScopeChannel(elm);
                                            return;
                                        }
                                        const p = toWorldPoint(e);
                                        engineStore.select(elm);
                                        startMove(elm, p);
                                    }}
                                />
                                {scopeChannel && (
                                    <circle
                                        cx={(elm.point1.x + elm.point2.x) / 2}
                                        cy={(elm.point1.y + elm.point2.y) / 2}
                                        r={5 / viewport.scale}
                                        fill={scopeChannel.color}
                                        stroke={BACKGROUND}
                                        strokeWidth={1.5 / viewport.scale}
                                        pointerEvents="none"
                                    />
                                )}
                            </g>
                        );
                    })}

                    {dragStart.current && dragCurrent && (
                        <line
                            x1={dragStart.current.x} y1={dragStart.current.y}
                            x2={dragCurrent.x} y2={dragCurrent.y}
                            stroke={SELECT_COLOR} strokeWidth={1.5 / viewport.scale} strokeDasharray={`${4 / viewport.scale} ${4 / viewport.scale}`}
                        />
                    )}
                </g>
            </svg>
        </div>
    );
}
