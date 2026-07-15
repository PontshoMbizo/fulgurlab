"use client";

// SUPERSEDED (2026-07-15): the always-visible sidebar this component built
// is replaced by src/chrome/PaletteFlyout.tsx, opened from the floating
// toolbar's "More tools" button, matching Pontsho's reference mockup style
// (which has no persistent palette panel). Not imported anywhere anymore;
// kept rather than deleted only because this sandbox can't remove files
// from mounted folders -- see docs/react-rewrite-plan.md's 2026-07-15
// session note.
import { CATEGORIES, PALETTE, PaletteItem } from "./palette";

interface Props {
    activeTool: PaletteItem | null;
    onSelect: (item: PaletteItem | null) => void;
}

export default function PaletteSidebar({ activeTool, onSelect }: Props) {
    return (
        <div className="w-56 shrink-0 h-full overflow-y-auto border-r border-neutral-800 bg-neutral-950 text-neutral-200 text-sm">
            <div className="px-3 py-2 font-semibold text-neutral-400 sticky top-0 bg-neutral-950 border-b border-neutral-800">
                Components
            </div>
            {CATEGORIES.map((cat) => (
                <div key={cat} className="border-b border-neutral-900">
                    <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-neutral-500">{cat}</div>
                    <div className="pb-2">
                        {PALETTE.filter((p) => p.category === cat).map((item, i) => {
                            const active = activeTool === item;
                            return (
                                <button
                                    key={`${item.dumpType}-${item.label}-${i}`}
                                    onClick={() => onSelect(active ? null : item)}
                                    className={`w-full text-left px-3 py-1.5 hover:bg-neutral-800 ${active ? "bg-cyan-900/50 text-cyan-300" : ""}`}
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
