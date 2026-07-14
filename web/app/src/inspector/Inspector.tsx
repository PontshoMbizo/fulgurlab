"use client";

import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";

// Fields worth showing generically if present on the selected element --
// this is a stand-in for the schema-driven <ElementDialog> the plan
// describes for Phase 5 task 5; showing raw fields here is enough for a
// first pass at "can I see what this element is doing".
const INTERESTING_FIELDS = [
    "resistance", "capacitance", "inductance", "maxVoltage", "frequency",
    "position", "throwCount", "text", "value", "meter", "current",
];

export default function Inspector() {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const elm = engineStore.selected;

    if (!elm) {
        return (
            <div className="w-64 shrink-0 h-full border-l border-neutral-800 bg-neutral-950 text-neutral-500 text-sm p-3">
                Select an element to inspect it.
            </div>
        );
    }

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
        <div className="w-64 shrink-0 h-full overflow-y-auto border-l border-neutral-800 bg-neutral-950 text-neutral-200 text-sm">
            <div className="px-3 py-2 font-semibold text-neutral-400 border-b border-neutral-800">
                Inspector
            </div>
            <table className="w-full">
                <tbody>
                    {rows.map(([k, v]) => (
                        <tr key={k} className="border-b border-neutral-900">
                            <td className="px-3 py-1 text-neutral-500">{k}</td>
                            <td className="px-3 py-1 text-right font-mono">{v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <button
                className="m-3 px-3 py-1 rounded bg-red-900/60 hover:bg-red-900 text-sm"
                onClick={() => engineStore.removeElement(elm)}
            >
                Delete (Del)
            </button>
        </div>
    );
}
