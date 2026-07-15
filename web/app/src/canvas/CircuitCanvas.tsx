"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { createElement, CircuitElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import type { PaletteItem } from "@/palette/palette";
import { GRID_SIZE, snap, distanceToElement } from "./draw";
import { ElementSymbol } from "./symbols";
import { BACKGROUND, GRID_DOT, SELECT_COLOR } from "./theme";

const HIT_THRESHOLD = 8;
const DEFAULT_SPAN = GRID_SIZE * 3;

interface Props {
    activeTool: PaletteItem | null;
    onPlaced?: () => void;
}

// SVG-based renderer: each element is a real <g> (see symbols.tsx) instead
// of an imperative Canvas2D draw call, so components render as proper
// vector symbols (schematic shapes, not the earlier crude approximations)
// and stay crisp at any zoom/DPI. The engine itself still owns all state;
// this component just re-renders the whole elmList from engineStore on
// every version bump (plan Sec 3.2's "canvas reads engine state directly"
// principle, adapted from an imperative rAF loop to a declarative SVG tree).
export default function CircuitCanvas({ activeTool, onPlaced }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
    const [hovered, setHovered] = useState<CircuitElm | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });

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

    const toCanvasPoint = useCallback((e: ReactMouseEvent) => {
        const rect = svgRef.current!.getBoundingClientRect();
        return { x: snap(e.clientX - rect.left), y: snap(e.clientY - rect.top) };
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
        let bestDist = HIT_THRESHOLD;
        for (const elm of engineStore.engine.elmList) {
            const dist = distanceToElement(elm, p.x, p.y);
            if (dist < bestDist) {
                bestDist = dist;
                best = elm;
            }
        }
        return best;
    }, []);

    const handleMouseDown = useCallback((e: ReactMouseEvent) => {
        const p = toCanvasPoint(e);
        if (activeTool) {
            dragStart.current = p;
            setDragCurrent(p);
        } else {
            engineStore.select(pickElement(p));
        }
    }, [activeTool, toCanvasPoint, pickElement]);

    const handleMouseMove = useCallback((e: ReactMouseEvent) => {
        const p = toCanvasPoint(e);
        if (activeTool && dragStart.current) {
            setDragCurrent(p);
        } else if (!activeTool) {
            setHovered(pickElement(p));
        }
    }, [activeTool, toCanvasPoint, pickElement]);

    const handleMouseUp = useCallback((e: ReactMouseEvent) => {
        if (activeTool && dragStart.current) {
            const end = toCanvasPoint(e);
            finalizePlacement(dragStart.current, end, activeTool);
            dragStart.current = null;
            setDragCurrent(null);
            onPlaced?.();
        }
    }, [activeTool, toCanvasPoint, finalizePlacement, onPlaced]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.key === "Delete" || e.key === "Backspace") && engineStore.selected) {
                const active = document.activeElement;
                if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
                engineStore.removeElement(engineStore.selected);
                e.preventDefault();
            }
            if (e.key === "Escape") {
                dragStart.current = null;
                setDragCurrent(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const selected = engineStore.selected;

    return (
        <div ref={containerRef} className="w-full h-full relative">
            <svg
                ref={svgRef}
                width={size.w}
                height={size.h}
                style={{ background: BACKGROUND, cursor: activeTool ? "crosshair" : "default", display: "block" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setHovered(null)}
            >
                <defs>
                    <pattern id="grid-dots" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                        <circle cx={1} cy={1} r={1} fill={GRID_DOT} />
                    </pattern>
                </defs>
                <rect x={0} y={0} width={size.w} height={size.h} fill="url(#grid-dots)" />

                {engineStore.engine.elmList.map((elm, i) => (
                    <ElementSymbol
                        key={i}
                        elm={elm}
                        selected={elm === selected}
                        hovered={elm === hovered}
                        onMouseDown={(e) => {
                            if (activeTool) return;
                            e.stopPropagation();
                            engineStore.select(elm);
                        }}
                    />
                ))}

                {dragStart.current && dragCurrent && (
                    <line
                        x1={dragStart.current.x} y1={dragStart.current.y}
                        x2={dragCurrent.x} y2={dragCurrent.y}
                        stroke={SELECT_COLOR} strokeWidth={1.5} strokeDasharray="4 4"
                    />
                )}
            </svg>
        </div>
    );
}
