// Matches CircuitJS1's actual default (non-"White Background"/printable)
// palette exactly, extracted from the Java oracle rather than guessed:
//   - Background: "#111" (UIManager.java, printableCheckItem branch).
//   - positiveColor = green, negativeColor = red, neutralColor = gray
//     (CircuitElm.java setColorScale(), the defaults before any query-param
//     override) -- 0V is gray ("colorScaleCount = 201; // odd so ground is
//     gray"), not white.
//   - voltageRange defaults to 5 (CircuitElm.java) -- +-5V is full color
//     saturation, not the +-20V this port originally guessed.
//   - selectColor = cyan, currentColor = yellow (Color.java's named
//     constants: cyan=(0,255,255), yellow=(255,255,0), gray=(128,128,128),
//     red=(255,0,0), green=(0,255,0)).
//   - Color blending is a plain linear RGB mix (Color.java's 3-arg
//     constructor: `r = c1.r*(1-mix) + c2.r*mix`), not HSB.
export const BACKGROUND = "#111111";
export const GRID_DOT = "#242424";
export const SELECT_COLOR = "#00ffff";
export const HOVER_COLOR = "#a78bfa"; // not in Falstad -- this port's own hover affordance
export const CURRENT_COLOR = "#ffff00";
export const NEUTRAL_GRAY = "rgb(128,128,128)";

const VOLTAGE_RANGE = 5;
const NEUTRAL = { r: 128, g: 128, b: 128 };
const POSITIVE = { r: 0, g: 255, b: 0 };
const NEGATIVE = { r: 255, g: 0, b: 0 };

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

export function strokeFor(volts: number, selected: boolean, hovered: boolean): string {
    if (selected) return SELECT_COLOR;
    if (hovered) return HOVER_COLOR;
    return voltageColor(volts);
}
