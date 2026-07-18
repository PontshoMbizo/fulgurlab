"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, DragEvent as ReactDragEvent } from "react";
import { createElement, CircuitElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import { bindingStore } from "@/kicad/bindings";
import type { PaletteItem } from "@/palette/palette";
import { GRID_SIZE, snap, distanceToElement, distanceToPoint, elementInMarquee, marqueeMode, circuitBounds } from "./draw";
import { ElementSymbol } from "./symbols";
import StatusHint from "./StatusHint";
import {
    BACKGROUND, DOT_GRID_IMAGE, DOT_GRID_SIZE, DOT_GRID_FADE_SCALE_THRESHOLD, DOT_GRID_FADE_OPACITY,
    VIGNETTE_IMAGE, CANVAS_VIGNETTE_SHADOW, SELECT_COLOR,
    MARQUEE_CONTAIN_FILL, MARQUEE_CONTAIN_BORDER, MARQUEE_TOUCH_FILL, MARQUEE_TOUCH_BORDER,
} from "./theme";

const HIT_THRESHOLD = 8; // screen pixels -- divided by viewport.scale before comparing against world-space distances
const ENDPOINT_HANDLE_HIT_RADIUS = 8; // screen pixels -- KiCad-ish grab radius around a rendered endpoint handle
const ENDPOINT_HANDLE_SIZE = 6; // screen pixels -- rendered square handle size, held constant across zoom (see render below)
const DEFAULT_SPAN = GRID_SIZE * 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const HOME_ZOOM_MARGIN = 0.1; // 10% margin around the fitted bbox, each side

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
    // Called whenever the tool should become un-armed -- Esc, switching
    // tools, or probe-mode toggling on (see handleSelectTool in page.tsx).
    // Renamed in spirit from the old onPlaced: placement itself no longer
    // clears the tool (tool persistence, requirement #1), so this now only
    // fires from the keyboard-driven Esc cascade below.
    onDeactivateTool?: () => void;
    // Keyboard-shortcut bridges: activeTool/probeMode/the palette flyout's
    // open state are all owned by page.tsx (and, for the flyout, nested
    // inside FloatingToolbar), not by this component -- but the W/A/P keys
    // and the Esc cascade need to reach all three. Rather than lifting every
    // last bit of that state up through prop drilling for its own sake, this
    // component keeps owning ITS OWN window-level keydown listener (matching
    // the existing gesture-listener pattern/comment below) and simply calls
    // back out through these three setters when a shortcut fires.
    onArmWireTool?: () => void;
    onOpenPalette?: () => void;
    onToggleProbeMode?: () => void;
    // Probe tool (Scopes button): while true, clicking an element toggles a
    // scope channel on it instead of selecting/moving it.
    probeMode?: boolean;
    // Fired after a double-click lands on an element (only outside
    // activeTool/probeMode -- see handleDoubleClick below); the element
    // itself is already selected by the time this fires, so the callback
    // just needs to open whatever UI shows the selected element.
    onElementDoubleClick?: () => void;
}

export default function CircuitCanvas({
    activeTool, onDeactivateTool, onArmWireTool, onOpenPalette, onToggleProbeMode,
    probeMode = false, onElementDoubleClick,
}: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    // Symbol bind/unbind (Symbol Library panel) changes how elements render
    // without touching the engine -- subscribe separately so those repaint too.
    useSyncExternalStore(bindingStore.subscribe, bindingStore.getVersion, bindingStore.getVersion);
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
    const [hovered, setHovered] = useState<CircuitElm | null>(null);
    // KiCad-style crosshair: full-canvas hairlines through the SNAPPED cursor
    // position (the point a click would actually use), null when the cursor
    // is outside the canvas.
    const [crosshair, setCrosshair] = useState<{ x: number; y: number } | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
    const [spacePressed, setSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [isDragOverFile, setIsDragOverFile] = useState(false);

    // Click-click placement anchor (requirement #2): set once the FIRST
    // click of a two-click placement lands (a mousedown immediately followed
    // by a mouseup at the identical snapped point -- see handlePlaceMouseDown/
    // Up below). While set, dragStart/dragCurrent keep driving the existing
    // rubber-band preview line so the visual doesn't need a second code path;
    // what changes is that mouseup no longer tears the gesture down; a
    // SECOND independent mousedown (not the same continuous gesture) commits
    // instead. Kept separate from moveState/panState (which represent an
    // actively-held mouse button) since between the two clicks, no button is
    // held at all.
    const clickAnchor = useRef<{ x: number; y: number; tool: PaletteItem } | null>(null);
    const [hasClickAnchor, setHasClickAnchor] = useState(false); // mirrors clickAnchor.current for the status hint / render

    // Kept in a ref (not state) since handleMouseDownRef/window listeners
    // read the *latest* value without needing to re-subscribe on every
    // render -- viewportRef mirrors viewport for that same reason.
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    // Single-element body move (existing) OR endpoint-only move (new,
    // `endpoint` set) OR group move (new, `group` set -- every element in
    // the gesture translates by the same delta). Kept as one ref/one gesture
    // rather than three separate move-state refs since exactly one of these
    // shapes is ever active at a time and startMove()/its window listeners
    // are the single place that needs to branch on which.
    const moveState = useRef<{
        elm: CircuitElm; startWorldX: number; startWorldY: number;
        origX: number; origY: number; origX2: number; origY2: number;
        endpoint?: "point1" | "point2";
        group?: { elm: CircuitElm; origX: number; origY: number; origX2: number; origY2: number }[];
    } | null>(null);
    const panState = useRef<{ startScreenX: number; startScreenY: number; startX: number; startY: number } | null>(null);

    // M-key "pickup" move (KiCad's no-button-held move mode): the grabbed
    // element (or whole selection, mirroring moveState's own group-move
    // shape) follows the cursor on plain mousemove -- no button down -- until
    // a left-click drops it or Esc cancels/reverts. Separate from moveState
    // since it isn't driven by mousedown/mouseup at all, but it reuses the
    // same origX/Y bookkeeping so cancel-revert works identically.
    const pickupState = useRef<{
        startWorldX: number; startWorldY: number;
        group: { elm: CircuitElm; origX: number; origY: number; origX2: number; origY2: number }[];
    } | null>(null);

    // Marquee (drag-select) rectangle: mousedown-drag on empty canvas with no
    // tool/probe armed. `shiftHeld` is captured at mousedown (not read live at
    // mouseup) so a Shift key released mid-drag doesn't retroactively change
    // whether the result adds to or replaces the existing selection.
    const marqueeState = useRef<{ startX: number; startY: number; shiftHeld: boolean } | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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

    // Places the new element but deliberately does NOT select it (requirement
    // #2: "Placement must NOT auto-select the new element") -- KiCad's own
    // click-click placement leaves the freshly-placed symbol unselected too,
    // ready for the NEXT placement (tool persistence, requirement #1) rather
    // than showing selection handles on something the user just finished
    // placing and is about to click away from anyway.
    const finalizePlacement = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, tool: PaletteItem) => {
        let { x: x2, y: y2 } = end;
        if (x2 === start.x && y2 === start.y) {
            x2 = start.x + DEFAULT_SPAN;
            y2 = start.y;
        }
        const elm = createElement(tool.dumpType, start.x, start.y, x2, y2, tool.flags, tool.tokens);
        if (elm) {
            engineStore.addElement(elm);
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

    // Endpoint-handle hit test (requirement #5): only elements with exactly
    // 2 posts show handles at all -- getPostCount()===1 elements (ground,
    // labeled nodes, rails) use the documented "x==x2 && y==y2" single-point
    // convention, where point1 and point2 are the same coordinate, so a
    // "grab just this endpoint" affordance would be meaningless (there is no
    // "other end" to leave anchored). >2-post elements (op-amp, gates, ...)
    // also skip handles: their extra posts derive purely from x/y/x2/y2 via
    // setPoints(), so dragging point1/point2 already repositions everything
    // correctly, but exposing every post as an independently-draggable handle
    // would let a drag desync a post from the geometry that's supposed to
    // define it. `p` is in world space (pre-snap, since this needs to compare
    // against the raw endpoint, not the snapped cursor -- rounding trips
    // happen once the drag actually starts).
    const pickEndpointHandle = useCallback((p: { x: number; y: number }): { elm: CircuitElm; which: "point1" | "point2" } | null => {
        const hitRadius = ENDPOINT_HANDLE_HIT_RADIUS / viewportRef.current.scale;
        let best: { elm: CircuitElm; which: "point1" | "point2" } | null = null;
        let bestDist = hitRadius;
        for (const elm of engineStore.engine.elmList) {
            if (elm.getPostCount() !== 2) continue;
            const d1 = distanceToPoint(elm.point1, p.x, p.y);
            if (d1 < bestDist) { bestDist = d1; best = { elm, which: "point1" }; }
            const d2 = distanceToPoint(elm.point2, p.x, p.y);
            if (d2 < bestDist) { bestDist = d2; best = { elm, which: "point2" }; }
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

    // KiCad-style placement gesture (requirement #2), supporting BOTH
    // interaction styles with the same state machine:
    //
    //   - One-motion drag: mousedown at A, drag, mouseup at B != A -> commits
    //     immediately on mouseup, exactly like the old Falstad-ish behavior.
    //   - Click-click: mousedown at A, mouseup at the SAME snapped point A
    //     (i.e. no drag happened) -> instead of committing at the degenerate
    //     DEFAULT_SPAN geometry right away, this leaves clickAnchor set to A
    //     and returns *without* tearing down the rubber-band preview. The
    //     preview line keeps following the cursor via the plain hover
    //     handler (handleMouseMove below) since no button is held between
    //     the two clicks. The SECOND mousedown (handlePrimaryMouseDown,
    //     seeing clickAnchor already set) commits using anchor->that click's
    //     point and clears the anchor -- if that second click also lands on
    //     the identical point, finalizePlacement's own same-point fallback
    //     (DEFAULT_SPAN) kicks in, matching the spec'd "clicking the same
    //     point twice" behavior.
    //
    // Either way the tool stays armed afterward (no onPlaced-clears-tool
    // callback anymore -- see requirement #1 / page.tsx's onDeactivateTool).
    const startPlace = useCallback((start: { x: number; y: number }, tool: PaletteItem) => {
        dragStart.current = start;
        setDragCurrent(start);
        const move = (ev: MouseEvent) => setDragCurrent(toWorldPoint(ev));
        const teardownDragOnly = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
        };
        const teardownAll = () => {
            dragStart.current = null;
            setDragCurrent(null);
            clickAnchor.current = null;
            setHasClickAnchor(false);
            teardownDragOnly();
        };
        const up = (ev: MouseEvent) => {
            const end = toWorldPoint(ev);
            if (end.x === start.x && end.y === start.y) {
                // No drag happened -- this was a single click. Arm the
                // click-click anchor and hand the preview off to the hover
                // handler instead of tearing the gesture down.
                clickAnchor.current = { x: start.x, y: start.y, tool };
                setHasClickAnchor(true);
                teardownDragOnly();
                return;
            }
            finalizePlacement(start, end, tool);
            teardownAll();
        };
        const cancel = () => teardownAll();
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = cancel;
    }, [toWorldPoint, finalizePlacement]);

    // Second click of a click-click placement: commits using the anchor set
    // by startPlace()'s "no drag happened" branch above. Not a window-level
    // gesture at all (it's a single, instantaneous mousedown, not a
    // drag) -- just finalizes and clears the anchor so the NEXT mousedown
    // starts a fresh placement rather than a third leg.
    const commitClickAnchor = useCallback((end: { x: number; y: number }) => {
        const anchor = clickAnchor.current;
        if (!anchor) return false;
        finalizePlacement(anchor, end, anchor.tool);
        clickAnchor.current = null;
        setHasClickAnchor(false);
        dragStart.current = null;
        setDragCurrent(null);
        return true;
    }, [finalizePlacement]);

    // Body move (single element OR whole group, requirement #5's second and
    // third bullets): `groupElms`, when provided, is every OTHER selected
    // element besides `elm` itself -- the grabbed element's own delta is
    // computed the usual way, then the exact same (dx, dy) is applied to
    // every group member too, all inside ONE begin/endMoveTransaction
    // bracket so a 10-element group-drag is still a single undo step (per
    // EngineStore.beginTransaction()'s re-entrant-safe doc comment, the
    // per-element setElementGeometry/moveSelectionBy calls below don't each
    // open their own transaction -- only this outer one does).
    const startMove = useCallback((elm: CircuitElm, start: { x: number; y: number }, groupElms?: CircuitElm[]) => {
        const origX = elm.x, origY = elm.y, origX2 = elm.x2, origY2 = elm.y2;
        const group = groupElms?.map((g) => ({ elm: g, origX: g.x, origY: g.y, origX2: g.x2, origY2: g.y2 }));
        moveState.current = { elm, startWorldX: start.x, startWorldY: start.y, origX, origY, origX2, origY2, group };
        engineStore.beginMoveTransaction();
        const move = (ev: MouseEvent) => {
            const m = moveState.current;
            if (!m) return;
            const p = toWorldPoint(ev);
            const dx = p.x - m.startWorldX, dy = p.y - m.startWorldY;
            engineStore.setElementGeometry(m.elm, m.origX + dx, m.origY + dy, m.origX2 + dx, m.origY2 + dy);
            if (m.group) engineStore.moveSelectionBy(m.group, dx, dy);
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
            if (group) engineStore.moveSelectionBy(group, 0, 0); // dx=dy=0 -- snaps every group member back to its own orig
            teardown();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = cancel;
    }, [toWorldPoint]);

    // Endpoint-only move (requirement #5's first bullet): the OTHER endpoint
    // stays exactly where it is -- only `which` (point1/point2) tracks the
    // cursor. Kept as its own gesture function (rather than folding into
    // startMove above via an "endpoint" flag on every call site) since the
    // math genuinely differs (one point translates by the raw new-minus-
    // orig delta of just that endpoint, not a shared group delta) and the
    // minimum-span guard below only applies here.
    const startEndpointMove = useCallback((elm: CircuitElm, which: "point1" | "point2", start: { x: number; y: number }) => {
        const origX = elm.x, origY = elm.y, origX2 = elm.x2, origY2 = elm.y2;
        moveState.current = { elm, startWorldX: start.x, startWorldY: start.y, origX, origY, origX2, origY2, endpoint: which };
        engineStore.beginMoveTransaction();
        const move = (ev: MouseEvent) => {
            const m = moveState.current;
            if (!m || !m.endpoint) return;
            const p = toWorldPoint(ev);
            // Minimum-span guard: reject a drag that would collapse the
            // element to zero length (the OTHER endpoint, held fixed, is
            // compared against the candidate new point). This does not apply
            // to genuinely single-post elements (pickEndpointHandle already
            // excludes getPostCount()!==2 elements from getting handles at
            // all, so this guard only ever sees real 2-post elements here).
            const anchorX = m.endpoint === "point1" ? m.origX2 : m.origX;
            const anchorY = m.endpoint === "point1" ? m.origY2 : m.origY;
            if (p.x === anchorX && p.y === anchorY) return;
            engineStore.setElementEndpoint(m.elm, m.endpoint, p.x, p.y);
        };
        const teardown = () => {
            moveState.current = null;
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
            engineStore.endMoveTransaction();
        };
        const up = () => teardown();
        const cancel = () => {
            elm.x = origX; elm.y = origY; elm.x2 = origX2; elm.y2 = origY2;
            elm.preStamp();
            engineStore.reanalyze();
            teardown();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        endGesture.current = cancel;
    }, [toWorldPoint]);

    // Marquee (drag-select, requirement #4): mousedown-drag on empty canvas
    // (no tool, no probe, and the mousedown didn't land on an element or
    // endpoint handle -- see handleMouseDown's dispatch order below). Unlike
    // move/place gestures, nothing is committed live here -- the rectangle is
    // pure UI until mouseup, which is when the contain/touch test actually
    // runs and calls into engineStore.select*().
    const startMarquee = useCallback((start: { x: number; y: number }, shiftHeld: boolean) => {
        marqueeState.current = { startX: start.x, startY: start.y, shiftHeld };
        setMarqueeRect({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
        const move = (ev: MouseEvent) => {
            const ms = marqueeState.current;
            if (!ms) return;
            // Unsnapped world point: the marquee rectangle itself is a pure
            // UI overlay, not circuit geometry, so it should track the raw
            // cursor smoothly rather than jump between grid points.
            const p = toWorldPoint(ev, false);
            setMarqueeRect({ x1: ms.startX, y1: ms.startY, x2: p.x, y2: p.y });
        };
        const teardown = () => {
            marqueeState.current = null;
            setMarqueeRect(null);
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            endGesture.current = null;
        };
        const up = (ev: MouseEvent) => {
            const ms = marqueeState.current;
            if (ms) {
                const p = toWorldPoint(ev, false);
                const hits = engineStore.engine.elmList.filter((elm) => elementInMarquee(elm, ms.startX, ms.startY, p.x, p.y));
                if (ms.shiftHeld) {
                    const next = new Set(engineStore.selection);
                    for (const h of hits) next.add(h);
                    engineStore.selectMany(next);
                } else {
                    engineStore.selectMany(hits);
                }
            }
            teardown();
        };
        const cancel = () => teardown();
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
        // M-key pickup mode: a left-click here DROPS the picked-up
        // element(s) exactly where handleMouseMove's live-follow already put
        // them (geometry is committed live on every mousemove while pickup
        // is active, same "live update, mouseup just ends the gesture"
        // convention as every other move gesture in this file) -- it takes
        // priority over every other mousedown branch below, same as
        // activeTool placement does. The undo transaction was opened back
        // when "M" was first pressed (see the keydown handler below), so
        // this only needs to close it out, not re-apply any geometry.
        if (pickupState.current) {
            engineStore.endMoveTransaction();
            pickupState.current = null;
            endGesture.current = null;
            return;
        }
        const p = toWorldPoint(e);
        if (activeTool) {
            // Second click of a click-click placement commits immediately
            // (no drag gesture to start) -- see startPlace's own comment for
            // why this is a plain mousedown branch rather than folded into
            // that function.
            if (commitClickAnchor(p)) return;
            startPlace(p, activeTool);
        } else if (probeMode) {
            const elm = pickElement(p);
            if (elm) engineStore.toggleScopeChannel(elm);
        } else {
            // Endpoint handles take priority over body-grab and marquee --
            // requirement #5's "mousedown within grab radius of an endpoint
            // moves ONLY that endpoint" needs first refusal before the wider
            // body hit-test below, since a handle sits ON the element body
            // it belongs to and would otherwise never be reachable.
            // Deliberately does NOT touch the current selection (grabbing
            // one endpoint shouldn't collapse an existing multi-selection).
            const handle = pickEndpointHandle(toWorldPoint(e, false));
            if (handle) {
                startEndpointMove(handle.elm, handle.which, p);
                return;
            }
            const elm = pickElement(p);
            if (elm) {
                const alreadyGrouped = engineStore.isSelected(elm) && engineStore.selection.size > 1;
                if (e.shiftKey && !alreadyGrouped) {
                    // Shift-click on a single element: add/remove it from the
                    // selection (KiCad's own additive-click convention) --
                    // this is how a multi-selection gets built up one click
                    // at a time as an alternative to the marquee, and is what
                    // makes group-move (below) reachable without a drag-
                    // select first.
                    engineStore.toggleSelect(elm);
                    return; // a plain shift-click adjusts selection but doesn't also start a move
                }
                if (alreadyGrouped) {
                    // Grabbed element is part of a multi-selection -- move
                    // the WHOLE group by the same delta (requirement #5's
                    // group-move bullet), selection itself unchanged.
                    const others = [...engineStore.selection].filter((s) => s !== elm);
                    startMove(elm, p, others);
                } else {
                    engineStore.select(elm);
                    startMove(elm, p);
                }
            } else {
                // Empty canvas: marquee (requirement #4). A plain click here
                // (zero-size drag) naturally clears the selection once the
                // marquee's own mouseup runs elementInMarquee() against a
                // zero-area rect, which matches nothing -- no special-casing
                // needed for "click empty canvas to deselect".
                startMarquee(p, e.shiftKey);
            }
        }
    }, [
        activeTool, probeMode, toWorldPoint, pickElement, pickEndpointHandle, spacePressed,
        startPan, startPlace, startMove, startEndpointMove, startMarquee, commitClickAnchor,
    ]);

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

    // Hover preview (while nothing is being dragged), PLUS two no-button-held
    // cases that piggyback on this same handler since neither has a mouse
    // button down to drive a window-level listener:
    //   - click-click's armed anchor (requirement #2): between the first and
    //     second click, dragCurrent still needs to track the cursor so the
    //     rubber-band preview keeps following it -- startPlace()'s own
    //     window "move" listener already tore itself down once it detected
    //     the no-drag mouseup, so this plain SVG-level move is the only
    //     thing still updating dragCurrent during that window.
    //   - M-key pickup mode (requirement #6): the grabbed element/group
    //     follows the cursor live, committed on the eventual mousedown (see
    //     handleMouseDown's pickupState branch) rather than on mouseup.
    const handleMouseMove = useCallback((e: ReactMouseEvent) => {
        setCrosshair(toWorldPoint(e));
        if (clickAnchor.current) {
            setDragCurrent(toWorldPoint(e));
            return;
        }
        if (pickupState.current) {
            const pu = pickupState.current;
            const p = toWorldPoint(e);
            const dx = p.x - pu.startWorldX, dy = p.y - pu.startWorldY;
            // moveSelectionBy() sets each element's ABSOLUTE position from
            // its own captured orig + this frame's (dx, dy) -- safe to call
            // on every mousemove without compounding (see its own doc
            // comment in store.ts for the bug this shape specifically
            // avoids).
            engineStore.moveSelectionBy(pu.group, dx, dy);
            return;
        }
        if (activeTool || moveState.current || panState.current) return;
        setHovered(pickElement(toWorldPoint(e)));
    }, [activeTool, pickElement, toWorldPoint]);

    // M-key pickup mode (KiCad's "grab and it follows the cursor with no
    // button held" move -- requirement #6's M bullet): arms pickupState for
    // the target element (widened to its whole group if it's part of a
    // multi-selection, same "grabbed member drags the group" rule as a
    // plain body-drag) and opens the undo transaction NOW, since the actual
    // geometry mutation happens continuously in handleMouseMove above, not
    // in one clean start/end pair the way a mousedown-driven gesture gets
    // it for free. Registered through endGesture.current (the SAME slot
    // every mousedown-driven gesture already uses) so the existing "Escape
    // cancels the in-flight gesture" step, below, reverts a pickup exactly
    // like it reverts a drag -- no separate Escape-handling branch needed
    // for this mode specifically.
    const startPickup = useCallback((target: CircuitElm, cursor: { x: number; y: number }) => {
        const isGrouped = engineStore.isSelected(target) && engineStore.selection.size > 1;
        const targets = isGrouped ? [...engineStore.selection] : [target];
        const group = targets.map((g) => ({ elm: g, origX: g.x, origY: g.y, origX2: g.x2, origY2: g.y2 }));
        pickupState.current = { startWorldX: cursor.x, startWorldY: cursor.y, group };
        engineStore.beginMoveTransaction();
        const cancel = () => {
            for (const g of group) {
                g.elm.x = g.origX; g.elm.y = g.origY; g.elm.x2 = g.origX2; g.elm.y2 = g.origY2;
                g.elm.preStamp();
            }
            engineStore.reanalyze();
            engineStore.endMoveTransaction();
            pickupState.current = null;
            endGesture.current = null;
        };
        endGesture.current = cancel;
    }, []);

    useEffect(() => {
        const isTypingTarget = () => {
            const active = document.activeElement;
            return !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
        };
        // Shared "what does this shortcut act on" resolver (requirement #6's
        // E/R/M bullets all phrase their target the same way): the current
        // single-element selection if there is exactly one, else whatever's
        // hovered. Deliberately returns null (rather than an arbitrary pick)
        // when the selection has 2+ members, matching selectedOne()'s own
        // "only when exactly one target" contract -- E/R/M are single-
        // element operations in KiCad too, a multi-selection needs the
        // marquee-selected-count status hint instead, not an ambiguous
        // guess at which one the shortcut should apply to.
        const resolveSingleTarget = (): CircuitElm | null => engineStore.selectedOne() ?? hovered;

        const onKeyDown = (e: KeyboardEvent) => {
            // Escape cascade (requirement #6): exactly ONE of these four
            // steps fires per keypress, in this priority order, whichever is
            // the first one that actually applies. Every step after the
            // first is gated on the previous ones having found nothing to
            // do, via early return -- this is what "one Esc press handles
            // the first applicable step only" means in code.
            if (e.key === "Escape") {
                if (endGesture.current) {
                    endGesture.current();
                    dragStart.current = null;
                    setDragCurrent(null);
                    return;
                }
                if (clickAnchor.current) {
                    clickAnchor.current = null;
                    setHasClickAnchor(false);
                    dragStart.current = null;
                    setDragCurrent(null);
                    return;
                }
                if (activeTool || probeMode) {
                    onDeactivateTool?.();
                    return;
                }
                if (engineStore.selection.size > 0) {
                    engineStore.clearSelection();
                    return;
                }
                return;
            }

            if (isTypingTarget()) return; // every shortcut below is a typing-sensitive single-key or Ctrl-chord

            if (e.key === "Delete" || e.key === "Backspace") {
                if (engineStore.selection.size > 0) {
                    engineStore.removeElements(engineStore.selection);
                    e.preventDefault();
                } else if (hovered) {
                    engineStore.removeElement(hovered);
                    e.preventDefault();
                }
                return;
            }

            if (e.code === "Space") {
                setSpacePressed(true);
                e.preventDefault();
                return;
            }

            // Undo/redo/select-all/duplicate: Ctrl on Windows/Linux, Cmd on
            // Mac -- all gated the same way the pre-existing undo/redo chords
            // already were.
            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === "z" && !e.shiftKey) {
                    engineStore.undo();
                    e.preventDefault();
                } else if ((key === "z" && e.shiftKey) || key === "y") {
                    engineStore.redo();
                    e.preventDefault();
                } else if (key === "a") {
                    // Select all -- every currently-placed element, in one
                    // shot (requirement #6's Ctrl/Cmd+A bullet). preventDefault()
                    // matters here specifically: without it the browser's own
                    // "select all text on the page" fires instead, which is
                    // visually jarring even though it doesn't affect the circuit.
                    engineStore.selectMany(engineStore.engine.elmList);
                    e.preventDefault();
                } else if (key === "d") {
                    // Duplicate: offset by +1 grid unit in both axes so the
                    // copies are visibly distinct from their originals rather
                    // than sitting exactly on top of them, then become the
                    // new selection (matches KiCad's own post-duplicate
                    // selection-follows-copy behavior) so an immediate drag
                    // moves the COPIES, not the originals.
                    if (engineStore.selection.size > 0) {
                        const copies = engineStore.duplicateSelection(engineStore.selection, GRID_SIZE);
                        if (copies.length > 0) engineStore.selectMany(copies);
                    }
                    e.preventDefault();
                }
                return;
            }

            // W: arm the Wire tool (requirement #6). Only one of the several
            // single-key shortcuts below fires per keypress by construction
            // (each is its own distinct key), so no early-return chain is
            // needed among them the way the Ctrl-chord and Escape blocks
            // above need one.
            if (e.key.toLowerCase() === "w") {
                onArmWireTool?.();
                return;
            }
            // A: open the palette flyout.
            if (e.key.toLowerCase() === "a") {
                onOpenPalette?.();
                return;
            }
            // P: toggle probe mode.
            if (e.key.toLowerCase() === "p") {
                onToggleProbeMode?.();
                return;
            }
            // E: open ElementEditModal for the resolved single target
            // (selectedOne(), else hovered) -- selects it first if it was
            // only hovered, so the modal (which reads engineStore.selectedOne()
            // itself) has something to show.
            if (e.key.toLowerCase() === "e") {
                const target = resolveSingleTarget();
                if (target) {
                    if (!engineStore.isSelected(target)) engineStore.select(target);
                    onElementDoubleClick?.(); // same "open the modal" callback double-click already uses
                    e.preventDefault();
                }
                return;
            }
            // R: rotate the resolved single target 90 degrees clockwise
            // about its own midpoint (requirement #6) -- one undo step
            // (rotateElementCW brackets its own transaction).
            if (e.key.toLowerCase() === "r") {
                const target = resolveSingleTarget();
                if (target) {
                    engineStore.rotateElementCW(target, GRID_SIZE);
                    e.preventDefault();
                }
                return;
            }
            // M: pick up the resolved single target (or its whole group, if
            // it's part of a multi-selection) and move it with the cursor,
            // no button held, until a left-click drops it (handleMouseDown's
            // pickupState branch) or Escape cancels/reverts (the Escape
            // cascade's step 1 above, via endGesture.current).
            if (e.key.toLowerCase() === "m") {
                const target = resolveSingleTarget();
                // toWorldPoint needs a PointerLike (clientX/clientY); the
                // keydown event itself carries neither, so the pickup's
                // start-cursor reference point is the target's OWN current
                // position instead -- the first mousemove after "M" is
                // pressed then computes the initial (small) delta from
                // wherever the real cursor already is relative to that,
                // which reads naturally rather than needing a synthetic
                // "cursor position at keypress time" that doesn't exist.
                if (target && !pickupState.current) {
                    startPickup(target, { x: target.x, y: target.y });
                    e.preventDefault();
                }
                return;
            }
            // Home: zoom-to-fit (requirement #6) -- bbox over every placed
            // element's posts, centered with a 10% margin. Guarded against
            // an empty circuit (circuitBounds returns null) so Home on a
            // blank canvas is a no-op rather than zooming to an
            // undefined/infinite rectangle.
            if (e.key === "Home") {
                const bounds = circuitBounds(engineStore.engine.elmList);
                if (bounds) {
                    const w = Math.max(1, bounds.maxX - bounds.minX);
                    const h = Math.max(1, bounds.maxY - bounds.minY);
                    const marginW = w * HOME_ZOOM_MARGIN, marginH = h * HOME_ZOOM_MARGIN;
                    const fitW = w + marginW * 2, fitH = h + marginH * 2;
                    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(size.w / fitW, size.h / fitH)));
                    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
                    setViewport({ scale, x: size.w / 2 - cx * scale, y: size.h / 2 - cy * scale });
                }
                e.preventDefault();
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
    }, [activeTool, probeMode, hovered, size, onDeactivateTool, onArmWireTool, onOpenPalette, onToggleProbeMode, onElementDoubleClick, startPickup]);

    const worldTransform = `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`;
    const cursor = activeTool ? "crosshair" : probeMode ? "pointer" : isPanning ? "grabbing" : spacePressed ? "grab" : "default";
    // Endpoint handles only ever render for a selected OR hovered 2-post
    // element (requirement #5) -- computed once per render rather than
    // inline in the JSX map below so the >2-post/1-post exclusion logic (see
    // pickEndpointHandle's own comment for why) lives in exactly one place.
    const handleTargets = engineStore.engine.elmList.filter(
        (elm) => elm.getPostCount() === 2 && (engineStore.isSelected(elm) || elm === hovered)
    );
    const handleHalfSize = ENDPOINT_HANDLE_SIZE / 2 / viewport.scale;
    // Dot-grid opacity fade (requirement #7): plain conditional style, no
    // extra state -- viewport.scale is already tracked and re-renders this
    // component on every zoom step.
    const dotGridOpacity = viewport.scale < DOT_GRID_FADE_SCALE_THRESHOLD ? DOT_GRID_FADE_OPACITY : 1;

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
                0 0 to match the SVG's own coordinate convention). Spacing is
                GRID_SIZE world units (requirement #7 -- previously a
                mismatched 26px that didn't line up with the real 16-unit
                snap grid at all); opacity fades at deep zoom-out via
                dotGridOpacity so it doesn't turn into visual noise. */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: DOT_GRID_IMAGE, backgroundSize: DOT_GRID_SIZE,
                    transform: worldTransform, transformOrigin: "0 0",
                    opacity: dotGridOpacity,
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
                onMouseLeave={() => { setHovered(null); setCrosshair(null); }}
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
                                    selected={engineStore.isSelected(elm)}
                                    hovered={elm === hovered}
                                    onMouseDown={(e) => {
                                        // Probe composes with an armed draw tool (the user can
                                        // wire and scope at the same time): element clicks toggle
                                        // a channel, empty-canvas clicks (which bubble past this
                                        // handler) still place the armed element.
                                        if (probeMode) {
                                            e.stopPropagation();
                                            engineStore.toggleScopeChannel(elm);
                                            return;
                                        }
                                        if (activeTool) return;
                                        // M-key pickup drop: the picked-up element follows the
                                        // cursor, so the drop click almost always lands ON the
                                        // element itself and would be swallowed here before the
                                        // svg-level pickupState drop branch could run. Let it
                                        // bubble instead of stopPropagation-ing it away.
                                        if (pickupState.current) return;
                                        e.stopPropagation();
                                        // Endpoint handles sit visually on top
                                        // of (and within) the element body
                                        // they belong to, so this per-element
                                        // handler needs the SAME
                                        // handle-first-refusal order the
                                        // top-level handleMouseDown uses for
                                        // clicks that land on empty canvas
                                        // near an element -- otherwise a
                                        // click on a symbol would never be
                                        // able to hit its own endpoint handle
                                        // (this handler would always win first
                                        // via React's more-specific-target
                                        // dispatch).
                                        const pRaw = toWorldPoint(e, false);
                                        const handle = pickEndpointHandle(pRaw);
                                        const p = toWorldPoint(e);
                                        if (handle) {
                                            startEndpointMove(handle.elm, handle.which, p);
                                            return;
                                        }
                                        const alreadyGrouped = engineStore.isSelected(elm) && engineStore.selection.size > 1;
                                        if (e.shiftKey && !alreadyGrouped) {
                                            engineStore.toggleSelect(elm);
                                            return;
                                        }
                                        if (alreadyGrouped) {
                                            const others = [...engineStore.selection].filter((s) => s !== elm);
                                            startMove(elm, p, others);
                                        } else {
                                            engineStore.select(elm);
                                            startMove(elm, p);
                                        }
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

                    {/* Endpoint handles (requirement #5): small screen-constant
                        squares at point1/point2 of any selected/hovered 2-post
                        element. pointerEvents="none" -- the actual hit-testing
                        for grabbing one is pickEndpointHandle()'s own radius
                        check (run from the mousedown handlers above), not a
                        real DOM hit target, so a handle rendered slightly
                        outside the element's own clickable stroke still works
                        and there's no risk of the handle's rect capturing a
                        click meant for something else underneath it. */}
                    {handleTargets.flatMap((elm) => ([
                        <rect
                            key={`h1-${elm === hovered ? "hover" : "sel"}-${elm.x}-${elm.y}`}
                            x={elm.point1.x - handleHalfSize} y={elm.point1.y - handleHalfSize}
                            width={handleHalfSize * 2} height={handleHalfSize * 2}
                            fill={BACKGROUND} stroke={SELECT_COLOR} strokeWidth={1.5 / viewport.scale}
                            pointerEvents="none"
                        />,
                        <rect
                            key={`h2-${elm === hovered ? "hover" : "sel"}-${elm.x2}-${elm.y2}`}
                            x={elm.point2.x - handleHalfSize} y={elm.point2.y - handleHalfSize}
                            width={handleHalfSize * 2} height={handleHalfSize * 2}
                            fill={BACKGROUND} stroke={SELECT_COLOR} strokeWidth={1.5 / viewport.scale}
                            pointerEvents="none"
                        />,
                    ]))}

                    {crosshair && (() => {
                        // World-space extents of the visible viewport so the
                        // hairlines always span the full canvas at any pan/zoom.
                        const v = viewport;
                        const x0 = (0 - v.x) / v.scale, x1 = (size.w - v.x) / v.scale;
                        const y0 = (0 - v.y) / v.scale, y1 = (size.h - v.y) / v.scale;
                        const w = 1 / v.scale;
                        return (
                            <g pointerEvents="none">
                                <line x1={x0} y1={crosshair.y} x2={x1} y2={crosshair.y} stroke="rgba(255,255,255,0.14)" strokeWidth={w} />
                                <line x1={crosshair.x} y1={y0} x2={crosshair.x} y2={y1} stroke="rgba(255,255,255,0.14)" strokeWidth={w} />
                            </g>
                        );
                    })()}
                    {dragStart.current && dragCurrent && (
                        <line
                            x1={dragStart.current.x} y1={dragStart.current.y}
                            x2={dragCurrent.x} y2={dragCurrent.y}
                            stroke={SELECT_COLOR} strokeWidth={1.5 / viewport.scale} strokeDasharray={`${4 / viewport.scale} ${4 / viewport.scale}`}
                        />
                    )}

                    {/* Marquee rectangle (requirement #4): tint depends on
                        drag direction, recomputed every render from the SAME
                        marqueeMode() helper the mouseup handler uses for its
                        actual contain/touch test, so the color on screen
                        always matches what releasing right now would select. */}
                    {marqueeRect && (() => {
                        const contain = marqueeMode(marqueeRect.x1, marqueeRect.x2) === "contain";
                        const x = Math.min(marqueeRect.x1, marqueeRect.x2), y = Math.min(marqueeRect.y1, marqueeRect.y2);
                        const w = Math.abs(marqueeRect.x2 - marqueeRect.x1), h = Math.abs(marqueeRect.y2 - marqueeRect.y1);
                        return (
                            <rect
                                x={x} y={y} width={w} height={h}
                                fill={contain ? MARQUEE_CONTAIN_FILL : MARQUEE_TOUCH_FILL}
                                stroke={contain ? MARQUEE_CONTAIN_BORDER : MARQUEE_TOUCH_BORDER}
                                strokeWidth={1 / viewport.scale}
                                pointerEvents="none"
                            />
                        );
                    })()}
                </g>
            </svg>

            <StatusHint activeTool={activeTool} anchored={hasClickAnchor} selectionCount={engineStore.selection.size} />
        </div>
    );
}
