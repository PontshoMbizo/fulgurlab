import type { ScopeChannel } from "@/engine/store";

// Pure canvas-drawing routine, kept separate from the React shell so the
// "how do I paint a MATLAB-style axes box" logic can be read/tested on its
// own. Called imperatively from a useEffect (canvas is not a declarative
// API) every time EngineStore bumps or the panel is resized.
export function drawScopeCanvas(
    ctx: CanvasRenderingContext2D,
    channels: ScopeChannel[],
    cssWidth: number,
    cssHeight: number,
    dpr: number,
) {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Plot background -- slightly lighter than the app's own canvas
    // background so the scope window's axes box reads as a distinct panel.
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const PAD_LEFT = 52, PAD_RIGHT = 14, PAD_TOP = 10, PAD_BOTTOM = 28;
    const plotW = Math.max(1, cssWidth - PAD_LEFT - PAD_RIGHT);
    const plotH = Math.max(1, cssHeight - PAD_TOP - PAD_BOTTOM);

    // Collect the visible time/value range across every channel's history --
    // a rolling window, same idea as a real oscilloscope's sweep, not a
    // fixed axis range.
    let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const ch of channels) {
        for (const s of ch.history) {
            if (s.t < tMin) tMin = s.t;
            if (s.t > tMax) tMax = s.t;
            if (s.value < vMin) vMin = s.value;
            if (s.value > vMax) vMax = s.value;
        }
    }

    const hasData = channels.some((c) => c.history.length > 1) && Number.isFinite(tMin) && Number.isFinite(vMin);

    // Axes box border (drawn either way, even with no data yet -- an empty
    // set of labeled axes is still useful orientation, same as a fresh
    // MATLAB figure window before anything's been plotted).
    if (!hasData) {
        tMin = 0; tMax = 1; vMin = -1; vMax = 1;
    } else {
        // Pad the value range so a trace never touches the very top/bottom
        // edge, and guard against a degenerate (near-zero-height) range.
        const vSpan = vMax - vMin;
        const vPad = vSpan < 1e-9 ? Math.max(0.1, Math.abs(vMax) * 0.1 || 0.1) : vSpan * 0.1;
        vMin -= vPad; vMax += vPad;
        if (tMax - tMin < 1e-12) { tMax = tMin + 1e-6; }
    }

    const xOf = (t: number) => PAD_LEFT + ((t - tMin) / (tMax - tMin)) * plotW;
    const yOf = (v: number) => PAD_TOP + plotH - ((v - vMin) / (vMax - vMin)) * plotH;

    // Gridlines + tick labels.
    const COLS = 8, ROWS = 6;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(229,231,235,0.5)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;

    for (let i = 0; i <= COLS; i++) {
        const x = PAD_LEFT + (i / COLS) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, PAD_TOP);
        ctx.lineTo(x, PAD_TOP + plotH);
        ctx.stroke();
        const t = tMin + (i / COLS) * (tMax - tMin);
        ctx.textAlign = i === COLS ? "right" : "left";
        ctx.fillText(formatSeconds(t), i === COLS ? x : x + 2, PAD_TOP + plotH + 16);
    }
    for (let i = 0; i <= ROWS; i++) {
        const y = PAD_TOP + (i / ROWS) * plotH;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT, y);
        ctx.lineTo(PAD_LEFT + plotW, y);
        ctx.stroke();
        const v = vMax - (i / ROWS) * (vMax - vMin);
        ctx.textAlign = "right";
        ctx.fillText(formatValue(v), PAD_LEFT - 6, y + 3);
    }

    // Axes border, drawn last so it sits crisply on top of the gridlines.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(PAD_LEFT + 0.5, PAD_TOP + 0.5, plotW - 1, plotH - 1);

    // Axis titles.
    ctx.fillStyle = "rgba(229,231,235,0.65)";
    ctx.textAlign = "center";
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("Time (s)", PAD_LEFT + plotW / 2, cssHeight - 4);
    ctx.save();
    ctx.translate(12, PAD_TOP + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(allSameMode(channels) === "current" ? "Current (A)" : "Voltage (V)", 0, 0);
    ctx.restore();

    if (!hasData) {
        ctx.fillStyle = "rgba(229,231,235,0.35)";
        ctx.textAlign = "center";
        ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText("Waiting for data -- run the simulation", PAD_LEFT + plotW / 2, PAD_TOP + plotH / 2);
        ctx.restore();
        return;
    }

    // Clip trace drawing to the plot box so a channel added mid-scroll can't
    // momentarily paint outside the axes on the first frame.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, PAD_TOP, plotW, plotH);
    ctx.clip();
    for (const ch of channels) {
        if (ch.history.length < 2) continue;
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ch.history.forEach((s, i) => {
            const x = xOf(s.t), y = yOf(s.value);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
}

// SIMPLIFICATION (documented, not silently dropped): all channels share one
// numeric Y-axis regardless of mode, same as most simple scope tools --
// mixing voltage and current channels puts them on the same scale, which
// can look odd if their magnitudes differ wildly (a real dual Y-axis, like
// MATLAB's yyaxis, is a bigger feature for a later pass). "mixed" here only
// affects the axis TITLE text (falls back to "Voltage (V)"), not the actual
// plotted values, which are always each channel's real voltage/current.
function allSameMode(channels: ScopeChannel[]): "voltage" | "current" | "mixed" {
    if (channels.length === 0) return "voltage";
    const first = channels[0].mode;
    return channels.every((c) => c.mode === first) ? first : "mixed";
}

function formatSeconds(t: number): string {
    if (Math.abs(t) < 1e-3 && t !== 0) return `${(t * 1e6).toFixed(0)}µs`;
    if (Math.abs(t) < 1) return `${(t * 1000).toFixed(1)}ms`;
    return `${t.toFixed(2)}s`;
}

function formatValue(v: number): string {
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(1);
    return v.toFixed(Math.abs(v) < 1 ? 3 : 2);
}
