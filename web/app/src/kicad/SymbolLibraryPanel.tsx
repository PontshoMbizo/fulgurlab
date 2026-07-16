"use client";

// Floating panel: import a .kicad_sym file, preview its symbols, and bind
// one to a palette element type (or the generic ExtChip template) so the
// canvas can later draw that symbol instead of the built-in body. This
// panel owns parsing/binding UI only -- it does not touch the canvas or
// engine at all; the lead agent wires ElementSymbol to call
// getVisualOverride() separately (see bindings.ts's header comment).
//
// Styling: same glass-dark modal recipe as inspector/ElementEditModal.tsx
// (fixed inset-0 dim backdrop, centered rounded-2xl panel at
// rgba(20,20,23,.96) + blur, uppercase-label header with a bare "×" close
// button) rather than inventing a new chrome language for one more panel.

import { useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { PALETTE, type PaletteItem } from "@/palette/palette";
import { parseKicadSymbolLibrary, type KicadLibrary, type KicadSymbol } from "./kicadSym";
import SymbolPreview from "./SymbolPreview";
import { addBinding, listBindings, removeBinding, subscribe, type Binding, type BindingTarget } from "./bindings";

interface Props {
    open: boolean;
    onClose: () => void;
}

// Fits an arbitrary-size mm symbol into a fixed preview card viewBox by
// scaling to the larger of the symbol's world-space width/height, with a
// small margin -- a simple "contain" fit, recomputed per symbol rather than
// assuming every imported symbol is roughly resistor-sized.
const CARD_VIEWBOX = 120; // world units, both axes -- generous enough for a small-to-medium IC body + pin legs
const CARD_MARGIN = 0.82; // leave ~18% breathing room so pin/label text isn't clipped at the card edge

function fitScale(symbol: KicadSymbol): number {
    let maxExtent = 1; // avoid division by zero for a degenerate (no-geometry) symbol
    const consider = (x: number, y: number) => {
        maxExtent = Math.max(maxExtent, Math.abs(x) * 2, Math.abs(y) * 2);
    };
    // Coordinates here are already mm (pre-toWorld); scanning them directly
    // and multiplying the fit factor by MM_TO_WORLD inside SymbolPreview's
    // own transform would double-apply the scale, so this measures in the
    // SAME world units SymbolPreview's <g scale=...> wraps -- i.e. call
    // toWorld conceptually by just using the mm numbers times the same
    // constant SymbolPreview itself uses via kicadSym's MM_TO_WORLD.
    const MM_TO_WORLD = 16 / 2.54;
    for (const item of symbol.unit.items) {
        if (item.kind === "rectangle") { consider(item.start.x * MM_TO_WORLD, item.start.y * MM_TO_WORLD); consider(item.end.x * MM_TO_WORLD, item.end.y * MM_TO_WORLD); }
        else if (item.kind === "circle") { consider((item.center.x + item.radius) * MM_TO_WORLD, (item.center.y + item.radius) * MM_TO_WORLD); }
        else if (item.kind === "arc") { consider(item.start.x * MM_TO_WORLD, item.start.y * MM_TO_WORLD); consider(item.end.x * MM_TO_WORLD, item.end.y * MM_TO_WORLD); }
        else if (item.kind === "polyline") { for (const p of item.points) consider(p.x * MM_TO_WORLD, p.y * MM_TO_WORLD); }
    }
    for (const pin of symbol.unit.pins) {
        consider(pin.at.x * MM_TO_WORLD, pin.at.y * MM_TO_WORLD);
        consider(pin.tip.x * MM_TO_WORLD, pin.tip.y * MM_TO_WORLD);
    }
    return (CARD_VIEWBOX * CARD_MARGIN) / maxExtent;
}

function SymbolCard({ symbol, onBind }: { symbol: KicadSymbol; onBind: () => void }) {
    const scale = useMemo(() => fitScale(symbol), [symbol]);
    return (
        <button
            onClick={onBind}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 hover:bg-white/[0.07] hover:border-white/[0.15] transition-colors cursor-pointer"
        >
            <svg viewBox={`${-CARD_VIEWBOX / 2} ${-CARD_VIEWBOX / 2} ${CARD_VIEWBOX} ${CARD_VIEWBOX}`} width={104} height={104}>
                <SymbolPreview symbol={symbol} scale={scale} showPins={false} />
            </svg>
            <div className="text-[11px] font-mono text-neutral-300 truncate max-w-[100px]" title={symbol.name}>
                {symbol.name}
            </div>
        </button>
    );
}

// Bind form: shown for whichever symbol the user just clicked in the grid.
// Target choice is either a PaletteItem (element dumpType+flags+label) or
// the generic ExtChip template -- matching BindingTarget's two variants
// exactly.
function BindForm({
    symbol, libFileName, onSaved, onCancel,
}: {
    symbol: KicadSymbol; libFileName: string; onSaved: () => void; onCancel: () => void;
}) {
    // Encode each PaletteItem as a stable string key for the <select> --
    // dumpType alone isn't unique (e.g. 'v' appears twice for DC/AC preset,
    // 'R' four times for the Rail family, each with different flags/labels/
    // tokens), so the index into PALETTE is the only reliably unique key.
    const [choice, setChoice] = useState<string>("extchip");

    function handleSave() {
        let target: BindingTarget;
        if (choice === "extchip") {
            target = { kind: "extchip" };
        } else {
            const idx = Number(choice);
            const item: PaletteItem | undefined = PALETTE[idx];
            if (!item) return;
            target = { kind: "element", dumpType: item.dumpType, flags: item.flags, label: item.label };
        }
        addBinding({ symbolId: symbol.id, libFileName, target, symbolData: symbol });
        onSaved();
    }

    return (
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-3 flex flex-col gap-2.5">
            <div className="text-[9px] font-black uppercase tracking-[.14em] text-cyan-400/80">
                Bind &quot;{symbol.name}&quot; to
            </div>
            <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                className="w-full rounded-lg bg-black/40 border border-white/10 text-[12.5px] text-neutral-200 px-2 py-1.5 outline-none focus:border-cyan-400/40"
            >
                <option value="extchip">ExtChip template (FPGA/MCU)</option>
                {PALETTE.map((item, i) => (
                    <option key={`${item.dumpType}-${item.label}-${i}`} value={i}>
                        {item.label} ({item.dumpType}{item.flags ? `, flags=${item.flags}` : ""})
                    </option>
                ))}
            </select>
            <div className="flex gap-2 justify-end">
                <button onClick={onCancel} className="px-2.5 py-1 rounded-lg text-[12px] text-neutral-400 hover:text-neutral-100 cursor-pointer">
                    Cancel
                </button>
                <button onClick={handleSave} className="px-2.5 py-1 rounded-lg text-[12px] bg-cyan-400/20 text-cyan-300 hover:bg-cyan-400/30 cursor-pointer">
                    Save binding
                </button>
            </div>
        </div>
    );
}

function BindingsList() {
    const bindings = useSyncExternalStore(subscribe, listBindings, () => [] as Binding[]);
    if (bindings.length === 0) {
        return <div className="text-[12px] text-neutral-600 px-1 py-2">No bindings yet.</div>;
    }
    return (
        <div className="flex flex-col gap-1.5">
            {bindings.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                    <div className="min-w-0">
                        <div className="text-[12px] font-mono text-neutral-200 truncate">{b.symbolId}</div>
                        <div className="text-[10.5px] text-neutral-500 truncate">
                            {b.target.kind === "extchip" ? "ExtChip template" : `${b.target.label} (${b.target.dumpType})`}
                            {" -- "}{b.libFileName}
                        </div>
                    </div>
                    <button
                        onClick={() => removeBinding(b.id)}
                        className="shrink-0 text-neutral-500 hover:text-red-400 cursor-pointer text-base leading-none px-1"
                        title="Remove binding"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}

export default function SymbolLibraryPanel({ open, onClose }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [library, setLibrary] = useState<KicadLibrary | null>(null);
    const [libFileName, setLibFileName] = useState<string>("");
    const [parseError, setParseError] = useState<string | null>(null);
    const [bindingSymbol, setBindingSymbol] = useState<KicadSymbol | null>(null);

    if (!open) return null;

    function handleFile(file: File) {
        setParseError(null);
        setBindingSymbol(null);
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== "string") return;
            // Parsing errors are caught HERE, at the UI boundary, per the
            // task brief ("errors shown inline, not thrown") -- kicadSym.ts
            // itself throws on purpose so there's exactly one try/catch
            // needed for the whole parse+extract pipeline.
            try {
                const lib = parseKicadSymbolLibrary(reader.result);
                setLibrary(lib);
                setLibFileName(file.name);
            } catch (e) {
                setLibrary(null);
                setParseError(e instanceof Error ? e.message : String(e));
            }
        };
        reader.onerror = () => setParseError("could not read file");
        reader.readAsText(file);
    }

    return (
        <div
            className="fixed inset-0 z-[20] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,.5)" }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-[520px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl text-neutral-200 text-sm"
                style={{ background: "rgba(20,20,23,.96)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">KiCad Symbol Library</div>
                        <div className="font-mono text-[13px] text-neutral-200 mt-0.5">{libFileName || "no file imported"}</div>
                    </div>
                    <button onClick={onClose} className="text-neutral-500 hover:text-neutral-100 cursor-pointer text-lg leading-none px-1" title="Close">
                        ×
                    </button>
                </div>

                <div className="p-4 flex flex-col gap-4">
                    <div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".kicad_sym"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full rounded-xl border border-dashed border-white/15 hover:border-cyan-400/40 hover:bg-cyan-400/[0.04] text-neutral-400 hover:text-cyan-300 text-[12.5px] py-3 cursor-pointer transition-colors"
                        >
                            Import .kicad_sym file
                        </button>
                        {parseError && (
                            <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[12px] px-3 py-2">
                                Failed to parse: {parseError}
                            </div>
                        )}
                    </div>

                    {library && (
                        <div>
                            <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500 mb-2">
                                Symbols ({library.symbols.length})
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {library.symbols.map((sym) => (
                                    <SymbolCard key={sym.id} symbol={sym} onBind={() => setBindingSymbol(sym)} />
                                ))}
                            </div>
                        </div>
                    )}

                    {bindingSymbol && (
                        <BindForm
                            symbol={bindingSymbol}
                            libFileName={libFileName}
                            onSaved={() => setBindingSymbol(null)}
                            onCancel={() => setBindingSymbol(null)}
                        />
                    )}

                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500 mb-2">
                            Existing bindings
                        </div>
                        <BindingsList />
                    </div>
                </div>
            </div>
        </div>
    );
}
