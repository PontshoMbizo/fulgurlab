"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createElement, CircuitElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import type { PaletteItem } from "@/palette/palette";
import { GRID_SIZE, snap, drawElement, distanceToElement } from "./draw";

const HIT_THRESHOLD = 8;
const DEFAULT_SPAN = GRID_SIZE * 3;

interface Props {
    activeTool: PaletteItem | null;
    onPlaced?: () => void;
}

export default function CircuitCanvas({ activeTool, onPlaced }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
    const [hovered, setHovered] = useState<CircuitElm | null>(null);
    const [size, setSize] = useState({ w: 800, h: 600 });

    // Size the canvas to its container.
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

    // Continuous draw loop -- reads engine.elmList directly every frame
    // rather than going through React per element (plan §3.2: canvas reads
    // engine state directly in its own rAF loop).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        let raf = 0;

        const frame = () => {
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
                canvas.width = size.w * dpr;
                canvas.height = size.h * dpr;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = "#0a0a0a";
            ctx.fillRect(0, 0, size.w, size.h);

            ctx.fillStyle = "#1f1f1f";
            for (let x = 0; x < size.w; x += GRID_SIZE) {
                for (let y = 0; y < size.h; y += GRID_SIZE) {
                    ctx.fillRect(x, y, 1, 1);
                }
            }

            const selected = engineStore.selected;
            for (const elm of engineStore.engine.elmList) {
                drawElement(ctx, elm, elm === selected, elm === hovered);
            }

            if (dragStart.current && dragCurrent) {
                ctx.strokeStyle = "#22d3ee";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(dragStart.current.x, dragStart.current.y);
                ctx.lineTo(dragCurrent.x, dragCurrent.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [size, hovered, dragCurrent]);

    const toCanvasPoint = useCallback((e: React.MouseEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
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

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const p = toCanvasPoint(e);
        if (activeTool) {
            dragStart.current = p;
            setDragCurrent(p);
        } else {
            // select mode: pick the closest element under the cursor, if any.
            let best: CircuitElm | null = null;
            let bestDist = HIT_THRESHOLD;
            for (const elm of engineStore.engine.elmList) {
                const dist = distanceToElement(elm, p.x, p.y);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = elm;
                }
            }
            engineStore.select(best);
        }
    }, [activeTool, toCanvasPoint]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const p = toCanvasPoint(e);
        if (activeTool && dragStart.current) {
            setDragCurrent(p);
        } else if (!activeTool) {
            let best: CircuitElm | null = null;
            let bestDist = HIT_THRESHOLD;
            for (const elm of engineStore.engine.elmList) {
                const dist = distanceToElement(elm, p.x, p.y);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = elm;
                }
            }
            setHovered(best);
        }
    }, [activeTool, toCanvasPoint]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
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

    return (
        <div ref={containerRef} className="w-full h-full relative">
            <canvas
                ref={canvasRef}
                style={{ width: size.w, height: size.h, cursor: activeTool ? "crosshair" : "default" }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { setHovered(null); }}
            />
        </div>
    );
}
