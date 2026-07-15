"use client";

import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";
import IconButton from "@/chrome/IconButton";
import { TrashIcon } from "@/chrome/icons";
import { FIELD_SCHEMA } from "./schema";
import EditableField from "./EditableField";

// Fallback for any dump type with no schema entry yet (box/wire/graphic
// annotations, op-amp, zener/diode's model, mosfet's flag-derived pnp --
// see schema.ts's header comment for exactly why those specific fields are
// deliberately excluded rather than made editable). Read-only, same as
// before task #37.
const FALLBACK_FIELDS = [
    "resistance", "capacitance", "inductance", "maxVoltage", "frequency",
    "position", "throwCount", "text", "value", "meter", "current",
];

// Floating glass card (bottom-left, mirroring the speed slider's bottom-
// right position) instead of a fixed sidebar -- the reference mockup has no
// inspector to transcribe, so this keeps the same glass-panel recipe as the
// rest of the chrome and only appears when something is selected, so the
// canvas stays clear otherwise. Fields are schema-driven (see schema.ts) --
// labeled, typed inputs (number/select/checkbox/textarea) that write back
// through EngineStore.updateElementField(), each commit its own undo step,
// rather than the raw read-only field dump this used to show.
export default function Inspector() {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const elm = engineStore.selected;

    if (!elm) return null;

    const schema = FIELD_SCHEMA[String(elm.getDumpType())];

    let voltageDiff: string | null = null;
    try {
        voltageDiff = elm.getVoltageDiff().toFixed(4) + " V";
    } catch {
        // some elements need nodes assigned before this is meaningful
    }

    const fallbackRows: [string, string][] = [];
    if (!schema) {
        const record = elm as unknown as Record<string, unknown>;
        for (const f of FALLBACK_FIELDS) {
            const v = record[f];
            if (v === undefined || typeof v === "function") continue;
            fallbackRows.push([f, String(v)]);
        }
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
                    <tr className="border-b border-white/[0.05]">
                        <td className="px-3.5 py-1 text-neutral-500">dump type</td>
                        <td className="px-3.5 py-1 text-right font-mono text-[12.5px]">{String(elm.getDumpType())}</td>
                    </tr>
                    <tr className="border-b border-white/[0.05]">
                        <td className="px-3.5 py-1 text-neutral-500">posts</td>
                        <td className="px-3.5 py-1 text-right font-mono text-[12.5px]">{elm.getPostCount()}</td>
                    </tr>
                    {voltageDiff !== null && (
                        <tr className="border-b border-white/[0.05]">
                            <td className="px-3.5 py-1 text-neutral-500">V diff</td>
                            <td className="px-3.5 py-1 text-right font-mono text-[12.5px]">{voltageDiff}</td>
                        </tr>
                    )}
                    <tr className="border-b border-white/[0.05]">
                        <td className="px-3.5 py-1 text-neutral-500">current</td>
                        <td className="px-3.5 py-1 text-right font-mono text-[12.5px]">{(elm.current ?? 0).toFixed(6)} A</td>
                    </tr>

                    {schema
                        ? schema.map((field) => (
                            <tr key={field.key} className="border-b border-white/[0.05] align-top">
                                <td className="px-3.5 py-1.5 text-neutral-500 whitespace-nowrap">
                                    {field.label}
                                    {field.unit ? <span className="text-neutral-600"> ({field.unit})</span> : null}
                                </td>
                                <td className="px-3.5 py-1.5 w-32">
                                    <EditableField elm={elm} field={field} />
                                </td>
                            </tr>
                        ))
                        : fallbackRows.map(([k, v]) => (
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
