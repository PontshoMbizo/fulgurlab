"use client";

import { useCallback, useRef, useState } from "react";
import { engineStore } from "@/engine/store";

const MIN_STEPS = 1;
const MAX_STEPS = 40;

function stepsToPercent(steps: number): number {
    return ((steps - MIN_STEPS) / (MAX_STEPS - MIN_STEPS)) * 100;
}

function percentToSteps(pct: number): number {
    return Math.round(MIN_STEPS + (pct / 100) * (MAX_STEPS - MIN_STEPS));
}

// Bottom-right compact speed control, transcribed from the reference
// mockup's custom drag-slider (not a native <input type=range>, to match
// its exact thumb/track look). Speed is purely a local-UI concept here --
// it drives engineStore.stepsPerFrame directly and doesn't need to be
// broadcast through the external-store subscribe/bump path, since no other
// chrome piece displays it.
export default function SpeedSlider() {
    const [percent, setPercent] = useState(() => stepsToPercent(engineStore.stepsPerFrame));
    const trackRef = useRef<HTMLDivElement>(null);

    const setFromClientX = useCallback((clientX: number) => {
        const track = trackRef.current;
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
        setPercent(pct);
        engineStore.stepsPerFrame = percentToSteps(pct);
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        setFromClientX(e.clientX);
        const move = (ev: PointerEvent) => setFromClientX(ev.clientX);
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [setFromClientX]);

    return (
        <div
            className="absolute right-[18px] z-[5] flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-white/10 shadow-lg"
            style={{ bottom: "calc(18px + var(--fl-scope-dock, 0px))", background: "rgba(18,18,20,.8)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 8px 24px rgba(0,0,0,.45)" }}
        >
            <span className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">Speed</span>
            <div
                ref={trackRef}
                onPointerDown={onPointerDown}
                className="relative flex items-center cursor-pointer"
                style={{ width: 116, height: 14, touchAction: "none" }}
            >
                <div className="absolute left-0 right-0 h-1 rounded-full bg-white/[0.12]" />
                <div className="absolute left-0 h-1 rounded-full" style={{ background: "#22c55e", width: `${percent}%` }} />
                <div
                    className="absolute rounded-full"
                    style={{
                        width: 15, height: 15, background: "#fff", border: "2px solid #22c55e",
                        boxShadow: "0 1px 5px rgba(0,0,0,.55)", left: `${percent}%`, transform: "translateX(-50%)",
                    }}
                />
            </div>
            <span className="font-mono text-[12px] font-semibold text-neutral-200 min-w-[30px] text-right">
                {Math.round(percent)}%
            </span>
        </div>
    );
}
