"use client";

import { useRef, useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";
import IconButton from "./IconButton";
import { UndoIcon, RedoIcon, DownloadIcon, FolderIcon } from "./icons";

function downloadCircuitFile() {
    const text = engineStore.exportText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "circuit.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Small top-center glass pill for undo/redo + save/load. None of these are
// part of the reference mockup (it has no editing-history or file-persistence
// concept at all), so this is placed at top-center rather than squeezed into
// the pixel-exact top-left toolbar pill or top-right status cluster -- it
// can't collide with either regardless of their own (dynamic) widths, and
// keeps both of those byte-for-byte matching the mockup untouched.
// Inline chip-outline icon (kept local: icons.tsx carries only the mockup's
// own glyph set; this button has no mockup counterpart).
function LibraryIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
            <path d="M9 7V4M15 7V4M9 20v-3M15 20v-3M7 9H4M7 15H4M20 9h-3M20 15h-3" />
        </svg>
    );
}

export default function UndoRedoCluster({ onOpenSymbols }: { onOpenSymbols?: () => void }) {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const status = engineStore.status;

    return (
        <div className="absolute top-[18px] left-1/2 -translate-x-1/2 z-[5] flex flex-col items-center gap-1.5">
            <div
                className="flex items-center gap-[3px] p-1 rounded-full border border-white/10 shadow-lg"
                style={{ background: "rgba(255,255,255,.05)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 6px 22px rgba(0,0,0,.4)" }}
            >
                <IconButton title="Undo (Ctrl+Z)" disabled={!engineStore.canUndo()} onClick={() => engineStore.undo()}>
                    <UndoIcon />
                </IconButton>
                <IconButton title="Redo (Ctrl+Y)" disabled={!engineStore.canRedo()} onClick={() => engineStore.redo()}>
                    <RedoIcon />
                </IconButton>
                <div className="w-px h-5 bg-white/[0.12]" />
                <IconButton title="Save circuit (.txt)" onClick={downloadCircuitFile}>
                    <DownloadIcon />
                </IconButton>
                <IconButton title="Open circuit file" onClick={() => fileInputRef.current?.click()}>
                    <FolderIcon />
                </IconButton>
                {onOpenSymbols && (
                    <IconButton title="KiCad symbol library (.kicad_sym import + bindings)" onClick={onOpenSymbols}>
                        <LibraryIcon />
                    </IconButton>
                )}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) engineStore.importFile(file);
                        e.target.value = ""; // so re-selecting the same file still fires onChange
                    }}
                />
            </div>
            {status.state === "error" && (
                <div
                    className="px-3 py-1 rounded-full text-[11px] font-medium text-red-300 border border-red-500/30"
                    style={{ background: "rgba(127,29,29,.35)", backdropFilter: "blur(10px)" }}
                >
                    {status.message}
                </div>
            )}
        </div>
    );
}
