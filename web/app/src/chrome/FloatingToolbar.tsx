"use client";

import { useEffect, useRef, useState } from "react";
import type { PaletteItem } from "@/palette/palette";
import { PALETTE } from "@/palette/palette";
import IconButton from "./IconButton";
import PaletteFlyout from "./PaletteFlyout";
import { PencilIcon, WaveformIcon, CursorIcon, ChevronDownIcon } from "./icons";

const WIRE_TOOL = PALETTE.find((p) => p.dumpType === "w")!;

interface Props {
    activeTool: PaletteItem | null;
    onSelect: (item: PaletteItem | null) => void;
    probeActive: boolean;
    onToggleProbe: () => void;
}

// Top-left floating pill, transcribed from the reference mockup: Draw /
// Scopes / Edit-select / More-tools, one glass pill, circular icon buttons.
// "Scopes" now toggles the real probe tool (click a wire/element on the
// canvas to add it as a MATLAB-style scope channel) -- kept in the exact
// same button slot the mockup reserved for it, so no new UI had to be
// invented for this piece.
export default function FloatingToolbar({ activeTool, onSelect, probeActive, onToggleProbe }: Props) {
    const [flyoutOpen, setFlyoutOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!flyoutOpen) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setFlyoutOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        return () => window.removeEventListener("mousedown", onDown);
    }, [flyoutOpen]);

    const isWire = activeTool === WIRE_TOOL;
    const isSelect = activeTool === null && !probeActive;
    const isOther = activeTool !== null && !isWire;

    return (
        <div ref={rootRef} className="absolute top-[18px] left-[18px] z-[5]">
            <div
                className="flex items-center gap-[3px] p-1 rounded-full border border-white/10 shadow-lg"
                style={{ background: "rgba(255,255,255,.05)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 6px 22px rgba(0,0,0,.4)" }}
            >
                <IconButton
                    title="Draw wire"
                    active={isWire}
                    activeBg="rgba(22,163,74,.2)"
                    activeColor="#4ade80"
                    onClick={() => { onSelect(isWire ? null : WIRE_TOOL); setFlyoutOpen(false); }}
                >
                    <PencilIcon />
                </IconButton>
                <IconButton
                    title="Scopes: click an element to watch its voltage"
                    active={probeActive}
                    activeBg="rgba(56,189,248,.2)"
                    activeColor="#38bdf8"
                    onClick={() => { onToggleProbe(); setFlyoutOpen(false); }}
                >
                    <WaveformIcon />
                </IconButton>
                <IconButton
                    title="Edit / select"
                    active={isSelect}
                    activeBg="rgba(255,255,255,.12)"
                    activeColor="#fff"
                    onClick={() => { onSelect(null); setFlyoutOpen(false); }}
                >
                    <CursorIcon />
                </IconButton>
                <div className="w-px h-5 bg-white/[0.12]" />
                <IconButton
                    title="More tools"
                    active={isOther || flyoutOpen}
                    activeBg="rgba(255,255,255,.12)"
                    activeColor="#fff"
                    onClick={() => setFlyoutOpen((v) => !v)}
                >
                    <ChevronDownIcon />
                </IconButton>
            </div>
            {flyoutOpen && (
                <PaletteFlyout
                    activeTool={activeTool}
                    onSelect={(item) => { onSelect(item); setFlyoutOpen(false); }}
                />
            )}
        </div>
    );
}
