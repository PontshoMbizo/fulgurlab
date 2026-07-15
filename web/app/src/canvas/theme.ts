// Pontsho supplied an exact visual reference (a "Simulator Premium" mockup)
// for the chrome + canvas look: near-black background, a soft dot-grid +
// radial vignette, glassmorphic floating panels, and -- notably -- circuit
// geometry drawn in a muted slate gray (`currentColor` = #4b5563) rather
// than Falstad's saturated rgb(128,128,128) neutral, with a distinct green
// accent (#16a34a) reserved for ground. This file keeps Falstad's actual
// mechanism (linear RGB blend, +-5V full saturation, selected/hovered
// layered on top -- see the previous revision's comment for the Java
// sources) but recalibrates the three blend endpoints and the canvas
// background to match the mockup exactly, since "match this style" was
// explicit and pixel-specific. The voltage-reactive swing itself (component
// color shifts as its voltage moves away from 0V) is real, useful Falstad
// behavior and is not discarded -- only its resting-state color and the
// saturated-color endpoints changed.

// --- canvas backdrop (mirrors the mockup's layered background exactly) ---
export const BACKGROUND = "#070707";
export const CANVAS_BACKGROUND_IMAGE =
    "radial-gradient(#161616 1.1px, transparent 1.1px), " +
    "radial-gradient(125% 95% at 50% 30%, #191919 0%, #070707 72%)";
export const CANVAS_BACKGROUND_SIZE = "26px 26px, 100% 100%";
export const CANVAS_VIGNETTE_SHADOW = "inset 0 0 160px 40px rgba(0,0,0,.6)";

// --- circuit geometry colors ---
export const SELECT_COLOR = "#22d3ee"; // cyan-400 -- Falstad's selectColor, softened to match the mockup's muted-but-bright accent register
export const HOVER_COLOR = "#a78bfa"; // violet-400 -- not in Falstad, this port's own hover affordance
export const CURRENT_COLOR = "#fbbf24"; // amber-400 -- matches the mockup's animated current-flow dashes
export const GROUND_COLOR = "#16a34a"; // green-600, exactly the mockup's ground/source-label accent -- ground is drawn in this fixed color, not the voltage gradient
export const NEUTRAL_GRAY = "#4b5563"; // slate-600, exactly the mockup's resting `currentColor`

const VOLTAGE_RANGE = 5;
const NEUTRAL = { r: 0x4b, g: 0x55, b: 0x63 }; // #4b5563
const POSITIVE = { r: 0x4a, g: 0xde, b: 0x80 }; // #4ade80 green-400
const NEGATIVE = { r: 0xf8, g: 0x71, b: 0x71 }; // #f87171 red-400

function mix(a: typeof NEUTRAL, b: typeof NEUTRAL, t: number): string {
    const r = Math.round(a.r * (1 - t) + b.r * t);
    const g = Math.round(a.g * (1 - t) + b.g * t);
    const bl = Math.round(a.b * (1 - t) + b.b * t);
    return `rgb(${r},${g},${bl})`;
}

export function voltageColor(volts: number): string {
    if (Number.isNaN(volts)) volts = 0;
    const t = Math.max(-1, Math.min(1, volts / VOLTAGE_RANGE));
    return t < 0 ? mix(NEUTRAL, NEGATIVE, -t) : mix(NEUTRAL, POSITIVE, t);
}

// Selected/hovered always take priority over whatever the resting color
// would otherwise be -- shared by every element, including ones like ground
// that don't use the voltage gradient as their resting color.
export function overlayColor(base: string, selected: boolean, hovered: boolean): string {
    if (selected) return SELECT_COLOR;
    if (hovered) return HOVER_COLOR;
    return base;
}

export function strokeFor(volts: number, selected: boolean, hovered: boolean): string {
    return overlayColor(voltageColor(volts), selected, hovered);
}
