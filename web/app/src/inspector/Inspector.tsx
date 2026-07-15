"use client";

import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";
import IconButton from "@/chrome/IconButton";
import { TrashIcon } from "@/chrome/icons";

// Fields worth showing generically if present on the selected element --
// this is a stand-in for the schema-driven <ElementDialog> the plan
// describes for Phase 5 task 5; showing raw fields here is enough for a
// first pass at "can I see what this element is doing".
const INTERESTING_FIELDS = [
    "resistance", "capacitance", "inductance", "maxVoltage", "frequency",
    "position", "throwCount", "text", "value", "meter", "current",
];

// Floating glass card (bottom-left, mirroring the speed slider's bottom-
// right position) instead of a fixed sidebar -- the reference mockup has no
// inspector to transcribe, so this keeps the same glass-panel recipe as the
// rest of the chrome and only appears when something is selected, so the
// canvas stays clear otherwise.
export default function Inspector() {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const elm = engineStore.selected;

    if (!elm) return null;

    const record = elm as unknown as Record<string, unknown>;
    const rows: [string, string][] = [];
    rows.push(["dump type", String(elm.getDumpType())]);
    rows.push(["posts", String(elm.getPostCount())]);
    try {
        rows.push(["V diff", elm.getVoltageDiff().toFixed(4) + " V"]);
    } catch {
        // some elements need nodes assigned before this is meaningful
    }
    rows.push(["current", (elm.current ?? 0).toFixed(6) + " A"]);
    for (const f of INTERESTING_FIELDS) {
        const v = record[f];
        if (v === undefined || typeof v === "function") continue;
        rows.push([f, String(v)]);
    }

    return (
        <div
            className="absolute bottom-[18px] left-[18px] z-[5] w-64 max-h-[50vh] overflow-y-auto rounded-2xl border border-white/10 shadow-lg text-neutral-200 text-sm"
            style={{ background: "rgba(18,18,20,.85)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 8px 24px rgba(0,0,0,.45)" }}
        >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08]">
                <span className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">Inspector</span>
                <IconButton title="Delete (Del)" size={26} onClick={() => engineStore.removeElement(elm)}>
                    <TrashIcon size={13} />
                </IconButton>
            </div>
            <table className="w-full">
                <tbody>
                    {rows.map(([k, v]) => (
                        <tr key={k} className="border-b border-white/[0.05]">
                            <td className="px-3.5 py-1 text-neutral-500">{k}</td>
                            <td className="px-3.5 py-1 text-right font-mono text-[12.5px]">{v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
