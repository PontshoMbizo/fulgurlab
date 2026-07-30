"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { CircuitElm, ExtChipElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import { extChipId } from "@/extchip/ids";
import { extChipRegistry } from "@/extchip/client";
import type { ExtChipStatus, ExtChipPinInfo } from "@/extchip/client";
import { TARGETS, targetById, targetForUrl, type CoSimTarget } from "@/extchip/targets";
import { parseCompileLog, firstError } from "@/extchip/compileLog";
import { describePinChange } from "@/extchip/pinDiff";

// Monaco reaches for browser-only globals (`self`, `window`) the instant its
// module evaluates, so it can never take part in a server-rendered pass --
// next/dynamic's ssr:false is the standard escape hatch. No loader.config()
// CDN override: the package's own default AMD-from-CDN loader is used, which
// also keeps the sizeable monaco bundle out of the route's initial chunk.
// (Carried over from ExtChipDrawer.tsx, which this pane replaces.)
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const STATUS_STYLE: Record<ExtChipStatus, { label: string; bg: string; fg: string }> = {
    unconfigured: { label: "not connected", bg: "rgba(255,255,255,.08)", fg: "#a1a1aa" },
    connecting: { label: "connecting", bg: "rgba(250,204,21,.15)", fg: "#facc15" },
    compiling: { label: "compiling", bg: "rgba(250,204,21,.15)", fg: "#facc15" },
    running: { label: "running", bg: "rgba(52,211,153,.15)", fg: "#34d399" },
    resetting: { label: "resetting", bg: "rgba(251,191,36,.15)", fg: "#fbbf24" },
    ended: { label: "ended", bg: "rgba(96,165,250,.15)", fg: "#60a5fa" },
    error: { label: "error", bg: "rgba(248,113,113,.15)", fg: "#f87171" },
};

const MARKER_OWNER = "fulgurlab-bridge";

interface Props {
    /** Chip currently being edited, or null to pick the first placed one. */
    elm: CircuitElm | null;
    onSelectElm: (elm: CircuitElm | null) => void;
    onClose: () => void;
}

// The firmware editor: Monaco over the circuit sandbox, fpgasim's layout.
//
// Replaces ExtChipDrawer.tsx (a fixed 380px overlay that covered the canvas).
// The pane owns the whole co-simulation loop the user actually cares about --
// pick a board, write firmware, compile, watch the pins move, wire them up --
// where the drawer only owned the text.
//
// PINS COME FROM COMPILATION. `configure()` is called with an EMPTY pinSpec,
// which is the client's existing "adopt whatever the backend built" mode
// (client.ts's created handler). The backend parses the real port list out of
// the source, reports it in `created.pins`, and setExtChipPins() regenerates
// the element's posts from it. So the posts you can wire to are the ports your
// firmware actually declares -- there is no hand-typed pin spec to disagree
// with the source anymore.
export default function FirmwareEditorPane({ elm, onSelectElm, onClose }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    useSyncExternalStore(extChipRegistry.subscribe, extChipRegistry.getVersion, extChipRegistry.getVersion);

    const chips = engineStore.engine.elmList.filter((e) => String(e.getDumpType()) === "460");
    // Fall back to the first placed board so opening the pane with nothing
    // selected still shows something useful.
    const chip = (elm && chips.includes(elm) ? elm : chips[0] ?? null) as ExtChipElm | null;

    const [source, setSource] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [bridgeUrl, setBridgeUrl] = useState("");
    const [quantumText, setQuantumText] = useState("");
    const [clockText, setClockText] = useState("");
    const [pinNotice, setPinNotice] = useState("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monaco's namespace is only available at runtime
    const monacoRef = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = useRef<any>(null);
    const lastPinsRef = useRef<ExtChipPinInfo[] | null>(null);

    const target: CoSimTarget = chip
        ? targetById(chip.targetId || targetForUrl(chip.bridgeUrl)?.id)
        : TARGETS[0];

    // Resync local editing state only when the SELECTED CHIP changes -- not on
    // every store/registry bump, or a compile-triggered reanalyze would clobber
    // in-progress typing (same split as EditableField.tsx's text/actualValue).
    useEffect(() => {
        if (!chip) return;
        const t = targetById(chip.targetId || targetForUrl(chip.bridgeUrl)?.id);
        setSource(chip.source && chip.source.length > 0 ? chip.source : t.defaultSource);
        setBridgeUrl(chip.bridgeUrl || t.defaultUrl);
        setQuantumText(String(chip.quantumNs || t.defaultQuantumNs));
        setClockText(String(chip.clockHz ?? t.defaultClockHz));
        setPinNotice("");
        lastPinsRef.current = null;
    }, [chip]);

    const id = chip ? extChipId(chip) : -1;
    const { status, detail } = chip ? extChipRegistry.getStatus(id) : { status: "unconfigured" as const, detail: "" };
    const pins = chip ? extChipRegistry.getPins(id) : null;

    // Backend pins -> element posts. Runs when `created` lands (and after any
    // recompile that changes the port list).
    useEffect(() => {
        if (!chip || !pins || pins.length === 0) return;
        const previous = lastPinsRef.current;
        if (previous) {
            const change = describePinChange(previous, pins);
            if (change.summary) setPinNotice(change.summary);
        }
        lastPinsRef.current = pins;
        engineStore.setExtChipPins(chip, pins);
    }, [chip, pins]);

    // Compile diagnostics -> Monaco markers. Cleared on every new attempt.
    useEffect(() => {
        const monaco = monacoRef.current;
        const editor = editorRef.current;
        if (!monaco || !editor) return;
        const model = editor.getModel();
        if (!model) return;

        if (status !== "error" || !detail) {
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
            return;
        }
        const parsed = parseCompileLog(detail, target.compileUnitName, model.getLineCount());
        monaco.editor.setModelMarkers(model, MARKER_OWNER, parsed.diags.map((d) => ({
            severity: d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
            startLineNumber: d.line,
            endLineNumber: d.line,
            startColumn: 1,
            endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
            message: d.message,
        })));
        const first = firstError(parsed);
        if (first) editor.revealLineInCenter(first.line);
    }, [status, detail, target.compileUnitName]);

    const compileAndRun = useCallback(() => {
        if (!chip) return;
        const quantumNs = parseFloat(quantumText) || target.defaultQuantumNs;
        const clockHz = parseFloat(clockText) || 0;

        // One undo entry for the whole config write, not one per field.
        engineStore.updateExtChipConfig(chip, {
            source, bridgeUrl, quantumNs, clockHz,
            targetId: target.id,
            engineName: target.engineName,
        });

        lastPinsRef.current = null;
        setPinNotice("");
        extChipRegistry.configure(id, {
            url: bridgeUrl,
            source,
            // EMPTY on purpose -- see the component comment. The backend's
            // created.pins becomes authoritative.
            pinSpec: "",
            quantumNs,
            engine: target.engineName || undefined,
            clockHz: clockHz > 0 ? clockHz : undefined,
        });
    }, [chip, id, source, bridgeUrl, quantumText, clockText, target]);

    const style = STATUS_STYLE[status];
    const detailFirstLine = detail.split("\n")[0] ?? "";

    return (
        <div
            className="h-full w-full flex flex-col border-b border-white/10 text-neutral-200 text-sm overflow-hidden"
            style={{ background: "rgba(20,20,23,.96)" }}
        >
            {/* Header: 28px, matching fpgasim's PaneHeader proportions. */}
            <div className="h-8 shrink-0 flex items-center gap-2 px-3 border-b border-white/10 bg-white/[0.03]">
                <span className="text-xs font-medium text-neutral-400">Firmware</span>

                <select
                    className="bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 text-xs outline-none"
                    value={chip ? chips.indexOf(chip) : -1}
                    onChange={(e) => onSelectElm(chips[Number(e.target.value)] ?? null)}
                    disabled={chips.length === 0}
                    title="Which placed board to write firmware for"
                >
                    {chips.length === 0 && <option value={-1}>no board placed</option>}
                    {chips.map((c, i) => {
                        const t = targetById((c as ExtChipElm).targetId);
                        return <option key={i} value={i}>{t.label} #{i + 1}</option>;
                    })}
                </select>

                <span
                    className="px-1.5 py-0.5 rounded text-[11px] font-medium"
                    style={{ background: style.bg, color: style.fg }}
                    title={detail}
                >
                    {style.label}
                </span>

                <div className="flex-1" />

                <button
                    className="px-2 py-0.5 rounded text-xs bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 disabled:hover:bg-emerald-500/15"
                    onClick={compileAndRun}
                    disabled={!chip}
                    title="Compile the firmware and start a co-simulation session"
                >
                    Compile &amp; Run
                </button>
                <button
                    className="px-2 py-0.5 rounded text-xs bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-40"
                    onClick={() => chip && extChipRegistry.dispose(id)}
                    disabled={!chip || status === "unconfigured"}
                    title="Disconnect this board from its backend"
                >
                    Disconnect
                </button>
                <button
                    className="px-2 py-0.5 rounded text-xs bg-white/[0.06] hover:bg-white/[0.12]"
                    onClick={() => setShowSettings((v) => !v)}
                    title="Bridge URL, quantum, board clock"
                >
                    Settings
                </button>
                <button
                    className="px-2 py-0.5 rounded text-xs bg-white/[0.06] hover:bg-white/[0.12]"
                    onClick={onClose}
                    title="Close the editor (V)"
                >
                    Close
                </button>
            </div>

            {showSettings && chip && (
                <div className="shrink-0 px-3 py-2 border-b border-white/10 bg-white/[0.02] flex flex-wrap gap-3 items-end text-xs">
                    <label className="flex flex-col gap-1">
                        <span className="text-neutral-400">Bridge URL</span>
                        <input
                            className="bg-white/[0.06] border border-white/10 rounded px-1.5 py-1 w-56 outline-none font-mono"
                            value={bridgeUrl}
                            onChange={(e) => setBridgeUrl(e.target.value)}
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-neutral-400">Quantum (ns)</span>
                        <input
                            className="bg-white/[0.06] border border-white/10 rounded px-1.5 py-1 w-28 outline-none font-mono"
                            value={quantumText}
                            onChange={(e) => setQuantumText(e.target.value)}
                        />
                    </label>
                    {target.clockPresets.length > 0 && (
                        <label className="flex flex-col gap-1">
                            <span className="text-neutral-400">Board clock</span>
                            <select
                                className="bg-white/[0.06] border border-white/10 rounded px-1.5 py-1 outline-none"
                                value={clockText}
                                onChange={(e) => setClockText(e.target.value)}
                            >
                                {target.clockPresets.map((p) => (
                                    <option key={p.hz} value={p.hz}>{p.label}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    <p className="text-[11px] text-neutral-500 max-w-md leading-relaxed">
                        The circuit only sees pin changes at quantum boundaries, so it resolves
                        signals up to {Math.round(1e9 / (2 * (parseFloat(quantumText) || 1e6)))} Hz.
                        A faster board clock costs wall-clock time in proportion: the real 27 MHz
                        part runs ~54,000 clock edges per 1 ms quantum, which no browser can do in
                        real time.
                    </p>
                </div>
            )}

            <div className="flex-1 min-h-0 flex">
                <div className="flex-1 min-w-0">
                    {chip ? (
                        <MonacoEditor
                            height="100%"
                            language={target.monacoLanguage}
                            theme="vs-dark"
                            value={source}
                            onChange={(v?: string) => setSource(v ?? "")}
                            onMount={(editor: unknown, monaco: unknown) => {
                                // onMount rather than useMonaco(): the hook pulls the
                                // package's SSR-unsafe loader in at module scope, while
                                // this hands back the same namespace with no extra import.
                                editorRef.current = editor;
                                monacoRef.current = monaco;
                            }}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 12,
                                scrollBeyondLastLine: false,
                                wordWrap: "on",
                                renderLineHighlight: "all",
                                padding: { top: 8 },
                            }}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center text-neutral-500 text-xs px-6 text-center">
                            Place a co-simulated board from the palette (Co-simulated category) to write firmware for it.
                        </div>
                    )}
                </div>

                {/* Right rail: live pin state + wiring notes + the log tail. */}
                <div className="w-64 shrink-0 border-l border-white/10 flex flex-col overflow-hidden">
                    <div className="px-3 py-1.5 text-[11px] text-neutral-400 border-b border-white/10">
                        Pins {pins ? `(${pins.length}, from your source)` : "(compile to populate)"}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto px-3 py-2 font-mono text-[11px] space-y-0.5">
                        {pins?.map((p, i) => {
                            const bits = p.dir === "in"
                                ? (chip?.inputBits ?? 0)
                                : (chip?.outputBits ?? 0);
                            const index = pins.filter((q, j) => q.dir === p.dir && j < i).length;
                            const high = ((bits >>> index) & 1) === 1;
                            return (
                                <div key={p.name} className="flex items-center gap-2">
                                    <span className={p.dir === "in" ? "text-sky-400" : "text-amber-400"}>
                                        {p.dir === "in" ? "→" : "←"}
                                    </span>
                                    <span className="flex-1 truncate">{p.name}</span>
                                    <span className={high ? "text-emerald-400" : "text-neutral-600"}>
                                        {high ? "1" : "0"}
                                    </span>
                                </div>
                            );
                        })}
                        {!pins && (
                            <ul className="text-neutral-500 space-y-1 font-sans list-disc pl-4">
                                {target.wiringNotes.map((n) => <li key={n}>{n}</li>)}
                            </ul>
                        )}
                    </div>

                    {pinNotice && (
                        <div className="px-3 py-1.5 text-[11px] text-amber-400 border-t border-white/10 bg-amber-500/[0.06]">
                            {pinNotice}
                        </div>
                    )}
                    {status === "error" && detailFirstLine && (
                        <div className="px-3 py-1.5 text-[11px] text-red-400 border-t border-white/10 bg-red-500/[0.06] max-h-24 overflow-auto whitespace-pre-wrap font-mono">
                            {detail}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
