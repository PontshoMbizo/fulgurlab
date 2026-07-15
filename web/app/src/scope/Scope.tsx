"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { engineStore } from "@/engine/store";
import { drawScopeCanvas } from "./draw";

const MIN_W = 320, MIN_H = 200;
const DEFAULT_POS = { x: 420, y: 90 };
const DEFAULT_SIZE = { w: 480, h: 300 };
const TITLE_H = 30;
const LEGEND_H = 30;

interface Props {
    probeActive: boolean;
}

// Floating, draggable, resizable MATLAB-style scope window -- unlike the
// rest of the chrome (fixed corner pills matching the reference mockup),
// this one has no mockup equivalent and genuinely benefits from being
// user-positioned/resized (a real MATLAB figure window works the same way),
// so it gets its own local position/size state instead of a fixed anchor.
export default function Scope({ probeActive }: Props) {
    const version = useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const [pos, setPos] = useState(DEFAULT_POS);
    const [size, setSize] = useState(DEFAULT_SIZE);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const channels = engineStore.scopeChannels;
    const visible = probeActive || channels.length > 0;

    // Resize the canvas's backing bitmap only when the CSS size actually
    // changes -- assigning canvas.width/height (even to the same value)
    // clears the whole bitmap and resets the 2D context's transform/clip
    // stack, so this must NOT run on every version bump (every rAF frame
    // while the sim is running), only on an actual panel resize.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !visible) return;
        const dpr = window.devicePixelRatio || 1;
        const cssW = size.w, cssH = size.h - TITLE_H - LEGEND_H;
        canvas.width = Math.max(1, Math.round(cssW * dpr));
        canvas.height = Math.max(1, Math.round(cssH * dpr));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
    }, [visible, size.w, size.h]);

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
        const cssW = size.w, cssH = size.h - TITLE_H - LEGEND_H;
        drawScopeCanvas(ctx, channels, cssW, cssH, dpr);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, version, size.w, size.h]);

    if (!visible) return null;

    function startDrag(e: ReactMouseEvent) {
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        const origin = pos;
        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            const maxX = window.innerWidth - 60, maxY = window.innerHeight - 40;
            setPos({
                x: Math.min(Math.max(-size.w + 60, origin.x + dx), maxX),
                y: Math.min(Math.max(0, origin.y + dy), maxY),
            });
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    function startResize(e: ReactMouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const origin = size;
        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            setSize({ w: Math.max(MIN_W, origin.w + dx), h: Math.max(MIN_H, origin.h + dy) });
        };
        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }

    return (
        <div
            ref={containerRef}
            className="absolute z-[6] rounded-2xl border border-white/10 shadow-lg overflow-hidden flex flex-col select-none"
            style={{
                left: pos.x, top: pos.y, width: size.w, height: size.h,
                background: "rgba(18,18,20,.9)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                boxShadow: "0 10px 30px rgba(0,0,0,.5)",
            }}
        >
            <div
                className="flex items-center justify-between px-3 border-b border-white/[0.08] cursor-grab active:cursor-grabbing shrink-0"
                style={{ height: TITLE_H }}
                onMouseDown={startDrag}
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
                className="flex items-center gap-1.5 px-2.5 flex-wrap overflow-y-auto shrink-0"
                style={{ height: LEGEND_H, paddingTop: 4, paddingBottom: 4 }}
            >
                {channels.length === 0 ? (
                    <span className="text-[10.5px] text-neutral-500 italic">Click an element on the canvas to add a channel</span>
                ) : (
                    channels.map((ch) => {
                        const last = ch.history[ch.history.length - 1];
                        const unit = ch.mode === "current" ? "A" : "V";
                        return (
                            <span
                                key={ch.id}
                                className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-[10.5px] font-mono"
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

            <div className="flex-1 min-h-0">
                <canvas ref={canvasRef} />
            </div>

            <div
                className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                onMouseDown={startResize}
                style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,.15) 50%)" }}
            />
        </div>
    );
}
