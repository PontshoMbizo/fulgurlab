"use client";

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";
import { FIELD_SCHEMA } from "./schema";
import EditableField from "./EditableField";

interface Props {
    onClose: () => void;
}

// Double-click opens this in addition to the sidebar Inspector -- a bigger,
// more prominent modal dialog closer to Falstad's own real editor UX, built
// from the SAME schema-driven fields (schema.ts/EditableField.tsx) rather
// than a second, separate field-rendering implementation.
export default function ElementEditModal({ onClose }: Props) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const elm = engineStore.selectedOne();

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // Closes itself once there's nothing left to show (e.g. the element was
    // deleted, or an undo/redo cleared the selection) rather than lingering
    // on a stale/empty dialog.
    useEffect(() => {
        if (!elm) onClose();
    }, [elm, onClose]);

    if (!elm) return null;

    const schema = FIELD_SCHEMA[String(elm.getDumpType())];

    return (
        <div
            className="fixed inset-0 z-[20] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,.5)" }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-80 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl text-neutral-200 text-sm"
                style={{ background: "rgba(20,20,23,.96)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "0 20px 60px rgba(0,0,0,.6)" }}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[.14em] text-neutral-500">Edit Component</div>
                        <div className="font-mono text-[13px] text-neutral-200 mt-0.5">dump type {String(elm.getDumpType())}</div>
                    </div>
                    <button onClick={onClose} className="text-neutral-500 hover:text-neutral-100 cursor-pointer text-lg leading-none px-1" title="Close (Esc)">
                        ×
                    </button>
                </div>

                {schema ? (
                    <table className="w-full">
                        <tbody>
                            {schema.map((field) => (
                                <tr key={field.key} className="border-b border-white/[0.05] align-top">
                                    <td className="px-4 py-2 text-neutral-500 whitespace-nowrap">
                                        {field.label}
                                        {field.unit ? <span className="text-neutral-600"> ({field.unit})</span> : null}
                                    </td>
                                    <td className="px-4 py-2 w-36">
                                        <EditableField elm={elm} field={field} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="px-4 py-4 text-neutral-500 text-[13px]">
                        This component has no editable values yet.
                    </div>
                )}

                <div className="flex justify-end gap-2 px-4 py-3 border-t border-white/[0.08]">
                    <button
                        onClick={() => { engineStore.removeElement(elm); onClose(); }}
                        className="text-[12px] px-3 py-1.5 rounded-full text-red-300 border border-red-500/30 hover:bg-red-500/10 cursor-pointer"
                        style={{ background: "rgba(127,29,29,.15)" }}
                    >
                        Delete
                    </button>
                    <button
                        onClick={onClose}
                        className="text-[12px] px-3 py-1.5 rounded-full text-neutral-300 border border-white/10 hover:bg-white/10 cursor-pointer"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
