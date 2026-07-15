"use client";

import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";
import IconButton from "./IconButton";
import { ResetIcon, StopIcon, PlayIcon, FullscreenIcon } from "./icons";

function formatTime(t: number): string {
    if (t < 1) return `${(t * 1000).toFixed(1)} ms`;
    return `${t.toFixed(3)} s`;
}

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        document.documentElement.requestFullscreen().catch(() => { /* not available in this context, ignore */ });
    }
}

// Top-right cluster from the reference mockup: time/LED readout, reset,
// the big run/stop toggle, fullscreen. Deliberately drops the mockup's
// "Submit solution" and "Reset to template" buttons and its "Res·F"
// reading -- those are specific to a graded-assignment context this app
// doesn't have (per Pontsho: "without the grading icons and stuff").
export default function StatusCluster() {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const running = engineStore.isRunning();

    return (
        <div className="absolute top-[18px] right-[18px] z-[5] flex items-center gap-[9px]">
            <div
                className="flex items-center gap-3.5 px-[15px] py-[7px] rounded-[13px] border border-white/10 shadow-lg"
                style={{ background: "rgba(18,18,20,.8)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 6px 22px rgba(0,0,0,.4)" }}
            >
                <div>
                    <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500 mb-0.5">Time</div>
                    <div className="font-mono text-[13px] font-semibold text-neutral-200">{formatTime(engineStore.engine.t)}</div>
                </div>
                {running ? (
                    <span
                        className="w-[9px] h-[9px] rounded-full"
                        style={{ background: "#22c55e", boxShadow: "0 0 9px #22c55e", animation: "led 1.4s ease-in-out infinite" }}
                    />
                ) : (
                    <span className="w-[9px] h-[9px] rounded-full" style={{ background: "#4b5563" }} />
                )}
            </div>

            <IconButton title="Reset simulation" variant="outline" size={40} onClick={() => engineStore.resetTime()}>
                <ResetIcon />
            </IconButton>

            {running ? (
                <button
                    title="Stop"
                    onClick={() => engineStore.stop()}
                    className="status-stop-btn flex items-center justify-center rounded-full border-0 text-white cursor-pointer transition-all duration-150"
                    style={{ width: 42, height: 42, background: "#ef4444", boxShadow: "0 0 0 1px rgba(239,68,68,.5), 0 4px 16px rgba(239,68,68,.5)" }}
                >
                    <StopIcon />
                </button>
            ) : (
                <button
                    title="Run"
                    onClick={() => engineStore.run()}
                    className="status-run-btn flex items-center justify-center rounded-full border-0 text-white cursor-pointer transition-all duration-150"
                    style={{ width: 42, height: 42, background: "#16a34a", boxShadow: "0 0 0 1px rgba(22,163,74,.5), 0 4px 16px rgba(22,163,74,.55)" }}
                >
                    <PlayIcon />
                </button>
            )}

            <div className="w-px h-6 bg-white/[0.14]" />

            <IconButton title="Fullscreen" variant="outline" size={40} onClick={toggleFullscreen}>
                <FullscreenIcon />
            </IconButton>
        </div>
    );
}
