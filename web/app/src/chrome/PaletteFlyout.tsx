"use client";

import { CATEGORIES, PALETTE, PaletteItem } from "@/palette/palette";

interface Props {
    activeTool: PaletteItem | null;
    onSelect: (item: PaletteItem) => void;
}

// The mockup's toolbar only shows a "More tools" chevron -- there's no
// reference for what its dropdown looks like, so this flyout's specific
// layout (categorized chip grid) is this port's own design, built to sit
// consistently inside the same glass-panel language as the rest of the
// chrome (same blur/border/shadow recipe as the status cluster).
export default function PaletteFlyout({ activeTool, onSelect }: Props) {
    return (
        <div
            className="absolute top-[calc(100%+10px)] left-0 w-72 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl"
            style={{
                background: "rgba(18,18,20,.92)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "0 12px 32px rgba(0,0,0,.5)",
            }}
        >
            {CATEGORIES.map((cat) => (
                <div key={cat} className="border-b border-white/[0.06] last:border-b-0">
                    <div className="px-3.5 pt-2.5 pb-1.5 text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">
                        {cat}
                    </div>
                    <div className="px-2 pb-2 flex flex-wrap gap-1.5">
                        {PALETTE.filter((p) => p.category === cat).map((item, i) => {
                            const active = activeTool === item;
                            return (
                                <button
                                    key={`${item.dumpType}-${item.label}-${i}`}
                                    onClick={() => onSelect(item)}
                                    className={
                                        "px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors " +
                                        (active
                                            ? "bg-cyan-400/20 text-cyan-300"
                                            : "text-neutral-300 hover:bg-white/[0.08] hover:text-white")
                                    }
                                >
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
