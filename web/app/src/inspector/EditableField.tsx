"use client";

import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { CircuitElm } from "@fulgurlab/engine";
import { engineStore } from "@/engine/store";
import type { FieldSchema } from "./schema";
import { getFieldValue } from "./schema";

interface Props {
    elm: CircuitElm;
    field: FieldSchema;
}

const inputClass = "w-full bg-transparent text-right font-mono text-[12.5px] text-neutral-100 outline-none border-0 focus:bg-white/[0.06] rounded px-1 -mx-1";

// One labeled row in the Inspector's editable schema table -- text/number/
// textarea fields hold their own in-progress typed value locally and only
// commit (engineStore.updateElementField, itself one undo step) on blur or
// Enter, so a half-typed number never round-trips through the engine on
// every keystroke. Select/checkbox commit immediately since picking an
// option or toggling a box is already a single, discrete action with no
// "in progress" state to protect.
export default function EditableField({ elm, field }: Props) {
    const actualValue = getFieldValue(elm, field.key);
    const [text, setText] = useState(() => String(actualValue ?? ""));

    // Resync local text when the selected element or field identity changes
    // (switching selection, or -- since undo/redo always clears selection,
    // see EngineStore.loadSnapshot() -- never while this stays mounted for
    // the same elm). Deliberately NOT keyed on `actualValue` itself: doing so
    // would clobber in-progress typing every time some unrelated reanalyze()
    // bump re-rendered this row (e.g. dragging the element while its dialog
    // is open).
    useEffect(() => {
        setText(String(actualValue ?? ""));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elm, field.key]);

    function revert() {
        setText(String(getFieldValue(elm, field.key) ?? ""));
    }

    function commitNumberOrText(raw: string) {
        if (field.type === "number") {
            const n = parseFloat(raw);
            if (Number.isNaN(n)) { revert(); return; }
            if (n === actualValue) return;
            engineStore.updateElementField(elm, field.key, n);
        } else {
            if (raw === actualValue) return;
            engineStore.updateElementField(elm, field.key, raw);
        }
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
        const isTextarea = field.type === "textarea";
        if (e.key === "Enter" && (!isTextarea || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commitNumberOrText(text);
            (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
            revert();
            (e.target as HTMLElement).blur();
        }
    }

    if (field.type === "select") {
        return (
            <select
                className={inputClass + " cursor-pointer"}
                value={String(actualValue)}
                onChange={(e) => {
                    const opt = field.options?.find((o) => String(o.value) === e.target.value);
                    engineStore.updateElementField(elm, field.key, opt ? opt.value : e.target.value);
                }}
            >
                {field.options?.map((o) => (
                    <option key={String(o.value)} value={String(o.value)} className="bg-neutral-900 text-neutral-100">
                        {o.label}
                    </option>
                ))}
            </select>
        );
    }

    if (field.type === "checkbox") {
        return (
            <input
                type="checkbox"
                className="cursor-pointer accent-cyan-400"
                checked={Boolean(actualValue)}
                onChange={(e) => engineStore.updateElementField(elm, field.key, e.target.checked)}
            />
        );
    }

    if (field.type === "textarea") {
        return (
            <textarea
                className={inputClass + " resize-none text-left"}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => commitNumberOrText(text)}
                onKeyDown={onKeyDown}
            />
        );
    }

    return (
        <input
            type="text"
            inputMode={field.type === "number" ? "decimal" : "text"}
            className={inputClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commitNumberOrText(text)}
            onKeyDown={onKeyDown}
        />
    );
}
