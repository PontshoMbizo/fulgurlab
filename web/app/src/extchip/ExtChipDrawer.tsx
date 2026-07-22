"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { CircuitElm } from "@fulgurlab/engine";
import type { ExtChipElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import { extChipRegistry } from "./client";
import type { ExtChipStatus } from "./client";
import { DEFAULT_FPGA_CONFIG, DEFAULT_FPGA_SOURCE } from "./preset";

// Monaco itself reaches for browser-only globals (`self`, `window`) the
// instant its module evaluates, so it can never be part of any server-
// rendered pass -- next/dynamic's `ssr: false` is the standard escape hatch
// for exactly this ("use the default lazy loader" per the task brief: no
// custom @monaco-editor/react `loader.config()` CDN override, just the
// package's own default AMD-from-CDN loader, deferred behind this dynamic
// import so it only ever runs client-side, after hydration, the moment an
// ExtChipElm is actually selected). This also keeps the (sizeable) monaco
// bundle out of every route's initial chunk -- it only loads the first time
// this drawer actually mounts an elm.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// --- Chip identity -----------------------------------------------------
//
// The engine element (ExtChipElm) has no id field of its own -- CircuitElm
// identity is just "the same JS object reference" (see engineStore's own
// comments on why scope channels/selection hold direct elm references
// rather than indices). The ws registry (client.ts) is keyed by a plain
// number, so this module owns the one WeakMap<CircuitElm, number> + counter
// that hands out a stable id per placed element, lazily on first lookup.
// Exported so the lead agent's store/canvas glue (and ExtChipBody.tsx, this
// panel's sibling body-drawing module) can look up the SAME id for the SAME
// element without either side needing to invent its own id scheme.
let nextExtChipId = 1;
const extChipIds = new WeakMap<CircuitElm, number>();

export function extChipId(elm: CircuitElm): number {
    let id = extChipIds.get(elm);
    if (id === undefined) {
        id = nextExtChipId++;
        extChipIds.set(elm, id);
    }
    return id;
}

interface Props {
    elm: CircuitElm | null;
    onClose: () => void;
}

const STATUS_STYLE: Record<ExtChipStatus, { label: string; bg: string; fg: string }> = {
    unconfigured: { label: "unconfigured", bg: "rgba(255,255,255,.08)", fg: "#a1a1aa" },
    connecting: { label: "connecting", bg: "rgba(250,204,21,.15)", fg: "#facc15" },
    compiling: { label: "compiling", bg: "rgba(250,204,21,.15)", fg: "#facc15" },
    running: { label: "running", bg: "rgba(52,211,153,.15)", fg: "#34d399" },
    ended: { label: "ended", bg: "rgba(96,165,250,.15)", fg: "#60a5fa" },
    error: { label: "error", bg: "rgba(248,113,113,.15)", fg: "#f87171" },
};

const inputClass =
    "w-full bg-transparent font-mono text-[12.5px] text-neutral-100 outline-none border border-white/10 focus:border-white/25 rounded px-2 py-1";
const labelClass = "text-[9px] font-black uppercase tracking-[.14em] text-neutral-500 mb-1";

// Right-docked panel for editing an ExtChipElm's Verilog source + bridge
// settings (fpgasim co-simulation). Mounted unconditionally by the lead
// agent's page-level glue and driven entirely by `elm` -- renders nothing
// when null (nothing selected, or the selection isn't a 460), and resyncs
// its local field state from the elm's own dump fields every time `elm`
// itself changes identity (switching between two placed chips, or from
// none to one).
export default function ExtChipDrawer({ elm, onClose }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    useSyncExternalStore(extChipRegistry.subscribe, extChipRegistry.getVersion, extChipRegistry.getVersion);

    const chip = elm && String(elm.getDumpType()) === "460" ? (elm as unknown as ExtChipElm) : null;

    const [bridgeUrl, setBridgeUrl] = useState("");
    const [quantumNsText, setQuantumNsText] = useState("");
    const [pinSpec, setPinSpec] = useState("");
    const [source, setSource] = useState("");

    // Resync local editing state from the elm whenever the SELECTED elm
    // itself changes -- not on every store/registry version bump, or every
    // Apply-triggered reanalyze would clobber in-progress typing (same
    // reasoning as EditableField.tsx's own text/actualValue split).
    useEffect(() => {
        if (!chip) return;
        setBridgeUrl(chip.bridgeUrl || DEFAULT_FPGA_CONFIG.url);
        setQuantumNsText(String(chip.quantumNs || DEFAULT_FPGA_CONFIG.quantumNs));
        setPinSpec(chip.pinSpec ?? DEFAULT_FPGA_CONFIG.pinSpec);
        setSource(chip.source && chip.source.length > 0 ? chip.source : DEFAULT_FPGA_SOURCE);
    }, [chip]);

    if (!chip) return null;

    const id = extChipId(chip);
    const { status, detail } = extChipRegistry.getStatus(id);
    const pins = extChipRegistry.getPins(id);
    const style = STATUS_STYLE[status];
    const detailFirstLine = detail.split("\n")[0] ?? "";

    // Writes `spec` onto the element via BOTH paths: elm.setPinSpec() is the
    // element's own config-edit entry point (re-derives inPins/outPins,
    // setPoints(), allocNodes() -- see ext_chip.ts's own comment on why a
    // plain field assignment can't do this), and updateElementField() is
    // what actually threads the change through undo/redo + a fresh
    // engine-wide reanalyze(). Order matters: setPinSpec() first so the
    // element's own post count is already correct by the time
    // updateElementField()'s preStamp()+reanalyze() runs.
    function commitPinSpec(spec: string) {
        if (!chip) return;
        chip.setPinSpec(spec);
        engineStore.updateElementField(chip, "pinSpec", spec);
    }

    function doApply(pinSpecOverride?: string) {
        if (!chip) return;
        const finalPinSpec = pinSpecOverride ?? pinSpec;
        const quantumNs = parseFloat(quantumNsText) || DEFAULT_FPGA_CONFIG.quantumNs;
        commitPinSpec(finalPinSpec);
        engineStore.updateElementField(chip, "bridgeUrl", bridgeUrl);
        engineStore.updateElementField(chip, "quantumNs", quantumNs);
        engineStore.updateElementField(chip, "source", source);
        extChipRegistry.configure(id, {
            url: bridgeUrl,
            source,
            pinSpec: finalPinSpec,
            quantumNs,
            engine: chip.engineName,
        });
    }

    function handleAdoptPins() {
        const adopted = extChipRegistry.getPins(id);
        if (!adopted || adopted.length === 0) return;
        const spec = adopted.map((p) => `${p.name}:${p.dir}`).join(",");
        setPinSpec(spec);
        doApply(spec);
    }

    function handleDisconnect() {
        extChipRegistry.dispose(id);
    }

    const canAdopt = !!pins && pins.length > 0;

    return (
        <div
            className="fixed right-0 top-0 bottom-0 z-[15] w-[380px] flex flex-col border-l border-white/10 text-neutral-200 text-sm"
            style={{
                background: "rgba(20,20,23,.96)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "-10px 0 30px rgba(0,0,0,.5)",
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] shrink-0">
                <div>
                    <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">FPGA</div>
                    <div className="font-mono text-[13px] text-neutral-200 mt-0.5">fpgasim</div>
                </div>
                <button
                    onClick={onClose}
                    className="text-neutral-500 hover:text-neutral-100 cursor-pointer text-lg leading-none px-1"
                    title="Close"
                >
                    ×
                </button>
            </div>

            {/* Status */}
            <div className="px-4 py-3 border-b border-white/[0.08] shrink-0">
                <div className="flex items-center gap-2">
                    <span
                        className="text-[10.5px] font-mono px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: style.bg, color: style.fg }}
                    >
                        {style.label}
                    </span>
                    {detailFirstLine && (
                        <span className="text-[11px] text-neutral-400 truncate" title={detailFirstLine}>
                            {detailFirstLine}
                        </span>
                    )}
                </div>
                {status === "error" && detail && (
                    <details className="mt-2">
                        <summary className="text-[10.5px] text-neutral-500 cursor-pointer select-none">
                            Full error log
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10.5px] font-mono text-red-300/90 bg-black/30 rounded p-2">
                            {detail}
                        </pre>
                    </details>
                )}
            </div>

            {/* Fields */}
            <div className="px-4 py-3 border-b border-white/[0.08] shrink-0 flex flex-col gap-3">
                <label className="block">
                    <div className={labelClass}>Bridge URL</div>
                    <input
                        type="text"
                        className={inputClass}
                        value={bridgeUrl}
                        onChange={(e) => setBridgeUrl(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className={labelClass}>Quantum ns</div>
                    <input
                        type="number"
                        className={inputClass}
                        value={quantumNsText}
                        onChange={(e) => setQuantumNsText(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className={labelClass}>Pin spec</div>
                    <input
                        type="text"
                        className={inputClass}
                        placeholder="auto from Verilog top ports when left empty"
                        value={pinSpec}
                        onChange={(e) => setPinSpec(e.target.value)}
                    />
                </label>
            </div>

            {/* Verilog editor */}
            <div className="flex-1 min-h-0 flex flex-col">
                <div className={labelClass + " px-4 pt-3"}>Verilog source</div>
                <div className="flex-1 min-h-0 px-4 pb-3 pt-1">
                    <MonacoEditor
                        height="100%"
                        language="verilog"
                        theme="vs-dark"
                        value={source}
                        onChange={(value) => setSource(value ?? "")}
                        options={{ minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.08] shrink-0">
                <button
                    onClick={() => doApply()}
                    className="text-[12px] px-3 py-1.5 rounded-full text-cyan-200 border border-cyan-500/30 hover:bg-cyan-500/10 cursor-pointer"
                    style={{ background: "rgba(8,145,178,.12)" }}
                >
                    Apply
                </button>
                <button
                    onClick={handleAdoptPins}
                    disabled={!canAdopt}
                    className="text-[12px] px-3 py-1.5 rounded-full text-neutral-300 border border-white/10 hover:bg-white/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    title={canAdopt ? "Write the backend's actual pin layout into Pin spec" : "No pins reported yet"}
                >
                    Adopt pins
                </button>
                <button
                    onClick={handleDisconnect}
                    className="ml-auto text-[12px] px-3 py-1.5 rounded-full text-red-300 border border-red-500/30 hover:bg-red-500/10 cursor-pointer"
                    style={{ background: "rgba(127,29,29,.15)" }}
                >
                    Disconnect
                </button>
            </div>
        </div>
    );
}
