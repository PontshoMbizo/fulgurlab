"use client";

import type { PaletteItem } from "@/palette/palette";

interface Props {
    activeTool: PaletteItem | null;
    // True once the click-click anchor point has been placed (first click
    // landed, waiting on the second) -- lets the hint distinguish "tool
    // armed, nothing anchored yet" from "anchor set, move to size it" so the
    // Esc-cancels-anchor-first cascade (see CircuitCanvas's keydown handler)
    // has a visible on-screen counterpart.
    anchored: boolean;
    selectionCount: number;
}

// Bottom-left floating pill -- same glass-panel recipe as the rest of the
// chrome (see IconButton/StatusCluster's own rgba+blur values), deliberately
// tiny and non-interactive: this is a passive status readout, not a control,
// so it has no buttons and never captures pointer events away from the
// canvas beneath it.
export default function StatusHint({ activeTool, anchored, selectionCount }: Props) {
    let text: string | null = null;
    if (activeTool) {
        text = anchored
            ? `${activeTool.label} -- click to place · Esc to cancel`
            : `${activeTool.label} armed -- click-click to place · Esc to cancel`;
    } else if (selectionCount > 1) {
        text = `${selectionCount} elements selected`;
    }

    if (!text) return null;

    return (
        <div
            className="absolute left-[18px] z-[5] px-3 py-1.5 rounded-full border border-white/10 shadow-lg text-[11px] font-medium text-neutral-300 pointer-events-none select-none"
            style={{ bottom: "calc(18px + var(--fl-scope-dock, 0px))", background: "rgba(18,18,20,.8)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 6px 22px rgba(0,0,0,.4)" }}
        >
            {text}
        </div>
    );
}
