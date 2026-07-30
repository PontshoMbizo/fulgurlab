// Stroke icon set for the floating chrome, transcribed from the reference
// mockup's exact SVG path data (Pontsho's "Simulator Premium" style
// reference) so the toolbar/status cluster read identically. Plain
// 24x24-viewBox stroke icons, sized by the parent via width/height props.
interface IconProps {
    size?: number;
}

const base = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
};

export function PencilIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
            <path d="M2 2l7.586 7.586" />
        </svg>
    );
}

export function WaveformIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M3 12h4l2 6 4-14 2 8h6" />
        </svg>
    );
}

export function CursorIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M3 3l7.07 17 2.51-7.39L20 10.07z" />
        </svg>
    );
}

export function ChevronDownIcon({ size = 14 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.6}>
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

export function ResetIcon({ size = 17 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.4}>
            <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
            <path d="M3 3v5h5" />
        </svg>
    );
}

export function StopIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="3" />
        </svg>
    );
}

export function PlayIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

export function FullscreenIcon({ size = 17 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
    );
}

export function TrashIcon({ size = 15 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
        </svg>
    );
}

// Undo/redo -- not part of the reference mockup (it has no editing-history
// concept), so these aren't transcribed from it like the icons above. Plain
// "corner-turn-back"/"corner-turn-forward" arrows, mirrored from each other,
// kept in the same stroke style as the rest of the set so a new cluster
// reads as belonging to the same app rather than bolted on.
export function UndoIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
        </svg>
    );
}

export function RedoIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H10a6 6 0 0 0 0 12h2" />
        </svg>
    );
}

// Save (export to .txt) / Load (import from a file) -- also not part of the
// reference mockup, same reasoning as Undo/Redo above.
export function DownloadIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M12 3v13" />
            <path d="M7 11l5 5 5-5" />
            <path d="M4 21h16" />
        </svg>
    );
}

export function FolderIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        </svg>
    );
}

// Firmware editor toggle (chevrons, the near-universal "code" glyph).
export function CodeIcon({ size = 16 }: IconProps) {
    return (
        <svg width={size} height={size} {...base} strokeWidth={2.2}>
            <path d="M8 6l-5 6 5 6" />
            <path d="M16 6l5 6-5 6" />
        </svg>
    );
}
