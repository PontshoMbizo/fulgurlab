// Per-dump-type editable field schemas -- what replaces the raw field dump
// Inspector.tsx used to show. Keyed by String(elm.getDumpType()) so both
// letter codes ('r') and numeric codes (162) share one lookup.
//
// DELIBERATE SCOPING RULE: a field only belongs here if it is ALWAYS
// unconditionally emitted by that element's own dumpTokens() (see
// web/engine/src/elements/*.ts, task #34) regardless of the element's other
// field values. A few fields were left OUT specifically because editing them
// here would silently not survive a save/reload or undo/redo round-trip:
//   - DiodeElm/ZenerElm/LEDElm's `modelName` -- only dumped when FLAG_MODEL
//     is set, and editing text here wouldn't also set that flag.
//   - MosfetElm's `pnp` -- derived from flags at construction time, not a
//     dump token at all; editing the field directly would diverge from
//     `flags` and revert on the next reparse.
//   - OpAmpElm's `gain`/`maxOut`/`minOut` -- no dump token exists for these
//     at all in this port (flag-derived or fixed).
// Rather than ship an editable field that quietly lies about persistence,
// these are left for a future pass once they're wired into dump/parse
// properly (flag-twiddling on edit, or a real model registry).
export type FieldType = "number" | "text" | "textarea" | "select" | "checkbox";

export interface SelectOption {
    value: string | number;
    label: string;
}

export interface FieldSchema {
    key: string; // property path on the element instance; "a.b" reaches elm.a.b (one level of nesting, e.g. InductorElm.ind.inductance)
    label: string;
    type: FieldType;
    unit?: string;
    options?: SelectOption[]; // required for type "select"
    min?: number;
    max?: number;
    step?: number;
}

const WAVEFORM_OPTIONS: SelectOption[] = [
    { value: 0, label: "DC" },
    { value: 1, label: "AC (sine)" },
    { value: 2, label: "Square" },
    { value: 3, label: "Triangle" },
    { value: 4, label: "Sawtooth" },
    { value: 5, label: "Pulse" },
    { value: 6, label: "Noise" },
];

const VOLTAGE_SOURCE_FIELDS: FieldSchema[] = [
    { key: "waveform", label: "Waveform", type: "select", options: WAVEFORM_OPTIONS },
    { key: "maxVoltage", label: "Amplitude", type: "number", unit: "V" },
    { key: "frequency", label: "Frequency", type: "number", unit: "Hz" },
    { key: "bias", label: "DC Offset", type: "number", unit: "V" },
    { key: "phaseShift", label: "Phase", type: "number", unit: "rad" },
    { key: "dutyCycle", label: "Duty Cycle", type: "number", min: 0, max: 1, step: 0.05 },
];

const PROBE_METER_OPTIONS: SelectOption[] = [
    { value: 0, label: "Voltage" },
    { value: 1, label: "RMS" },
    { value: 2, label: "Max" },
    { value: 3, label: "Min" },
    { value: 4, label: "Peak-to-peak" },
    { value: 5, label: "Binary (Y/N)" },
    { value: 6, label: "Frequency" },
    { value: 7, label: "Period" },
    { value: 8, label: "Pulse width" },
    { value: 9, label: "Duty cycle" },
];

export const FIELD_SCHEMA: Record<string, FieldSchema[]> = {
    r: [{ key: "resistance", label: "Resistance", type: "number", unit: "Ω" }],
    c: [
        { key: "capacitance", label: "Capacitance", type: "number", unit: "F" },
        { key: "initialVoltage", label: "Initial Voltage", type: "number", unit: "V" },
        { key: "seriesResistance", label: "Series Resistance", type: "number", unit: "Ω" },
    ],
    l: [
        { key: "ind.inductance", label: "Inductance", type: "number", unit: "H" },
        { key: "initialCurrent", label: "Initial Current", type: "number", unit: "A" },
        { key: "ind.saturationCurrent", label: "Saturation Current", type: "number", unit: "A" },
    ],
    v: VOLTAGE_SOURCE_FIELDS,
    R: VOLTAGE_SOURCE_FIELDS,
    "164": [
        { key: "frequency", label: "Frequency", type: "number", unit: "Hz" },
        { key: "maxVoltage", label: "Amplitude", type: "number", unit: "V" },
        { key: "bias", label: "DC Offset", type: "number", unit: "V" },
        { key: "phaseShift", label: "Phase", type: "number", unit: "rad" },
        { key: "dutyCycle", label: "Duty Cycle", type: "number", min: 0, max: 1, step: 0.05 },
    ],
    s: [
        { key: "position", label: "State", type: "select", options: [{ value: 0, label: "Closed" }, { value: 1, label: "Open" }] },
        { key: "momentary", label: "Momentary", type: "checkbox" },
    ],
    S: [
        { key: "position", label: "Position", type: "number", min: 0, step: 1 },
        { key: "momentary", label: "Momentary", type: "checkbox" },
        { key: "link", label: "Link Group", type: "number", step: 1 },
        { key: "throwCount", label: "Throw Count", type: "number", min: 2, step: 1 },
    ],
    "162": [
        { key: "colorR", label: "Color R", type: "number", min: 0, max: 1, step: 0.05 },
        { key: "colorG", label: "Color G", type: "number", min: 0, max: 1, step: 0.05 },
        { key: "colorB", label: "Color B", type: "number", min: 0, max: 1, step: 0.05 },
        { key: "maxBrightnessCurrent", label: "Max Brightness Current", type: "number", unit: "A" },
    ],
    t: [
        { key: "pnp", label: "Type", type: "select", options: [{ value: 1, label: "NPN" }, { value: -1, label: "PNP" }] },
        { key: "beta", label: "Beta (hFE)", type: "number" },
    ],
    f: [
        { key: "vt", label: "Threshold Voltage", type: "number", unit: "V" },
        { key: "beta", label: "Beta", type: "number" },
    ],
    "150": [ // AndGateElm -- shared shape for the whole gate family below
        { key: "inputCount", label: "Inputs", type: "number", min: 1, step: 1 },
        { key: "highVoltage", label: "High Voltage", type: "number", unit: "V" },
    ],
    g: [{ key: "symbolType", label: "Symbol Style", type: "number", step: 1 }],
    i: [
        { key: "currentValue", label: "Current", type: "number", unit: "A" },
        { key: "maxVoltage", label: "Max Voltage (0 = unlimited)", type: "number", unit: "V" },
    ],
    "370": [
        { key: "meter", label: "Mode", type: "select", options: [{ value: 0, label: "Instantaneous" }, { value: 1, label: "RMS" }] },
        { key: "scale", label: "Scale", type: "number", step: 1 },
    ],
    p: [
        { key: "meter", label: "Mode", type: "select", options: PROBE_METER_OPTIONS },
        { key: "scale", label: "Scale", type: "number", step: 1 },
        { key: "resistance", label: "Resistance (0 = passive)", type: "number", unit: "Ω" },
    ],
    O: [{ key: "scale", label: "Scale", type: "number", step: 1 }],
    "207": [{ key: "text", label: "Label", type: "text" }],
    x: [
        { key: "size", label: "Font Size", type: "number", step: 1, unit: "px" },
        { key: "text", label: "Text", type: "textarea" },
    ],
    L: [
        { key: "position", label: "State", type: "select", options: [{ value: 0, label: "Low" }, { value: 1, label: "High" }] },
        { key: "momentary", label: "Momentary", type: "checkbox" },
        { key: "hiV", label: "High Voltage", type: "number", unit: "V" },
        { key: "loV", label: "Low Voltage", type: "number", unit: "V" },
    ],
    M: [{ key: "threshold", label: "Threshold", type: "number", unit: "V" }],
    I: [
        { key: "slewRate", label: "Slew Rate", type: "number", unit: "V/ns" },
        { key: "highVoltage", label: "High Voltage", type: "number", unit: "V" },
    ],
    "174": [
        { key: "maxResistance", label: "Max Resistance", type: "number", unit: "Ω" },
        { key: "position", label: "Wiper Position", type: "number", min: 0, max: 1, step: 0.01 },
        { key: "sliderText", label: "Slider Label", type: "text" },
    ],
    // Power/Sources group. AntennaElm ('A') has no entry -- dumpTokens()
    // emits nothing (fmphase is runtime-only), so it falls back to the
    // Inspector's "no editable fields" message, same as WireElm/BoxElm.
    "172": [
        { key: "bias", label: "Min Voltage", type: "number", unit: "V" },
        { key: "maxVoltage", label: "Max Voltage", type: "number", unit: "V" },
        { key: "frequency", label: "Current Value", type: "number", unit: "V" },
        { key: "sliderText", label: "Slider Label", type: "text" },
    ],
    "170": [
        { key: "minF", label: "Min Frequency", type: "number", unit: "Hz" },
        { key: "maxF", label: "Max Frequency", type: "number", unit: "Hz" },
        { key: "maxV", label: "Max Voltage", type: "number", unit: "V" },
        { key: "sweepTime", label: "Sweep Time", type: "number", unit: "s" },
    ],
    "200": [
        { key: "carrierfreq", label: "Carrier Frequency", type: "number", unit: "Hz" },
        { key: "signalfreq", label: "Signal Frequency", type: "number", unit: "Hz" },
        { key: "maxVoltage", label: "Max Voltage", type: "number", unit: "V" },
    ],
    "201": [
        { key: "carrierfreq", label: "Carrier Frequency", type: "number", unit: "Hz" },
        { key: "signalfreq", label: "Signal Frequency", type: "number", unit: "Hz" },
        { key: "maxVoltage", label: "Max Voltage", type: "number", unit: "V" },
        { key: "deviation", label: "Deviation", type: "number", unit: "Hz" },
    ],
    // Analog Active Building Blocks group. ComparatorElm ('401') and OTAElm
    // ('402') have no entries -- like OpAmpElm, their dumpTokens() always
    // returns [] in this port (no editable fields exist to dump/reload), so
    // they fall back to the Inspector's "no editable fields" message.
    "213": [{ key: "gain", label: "Gain (gm)", type: "number", unit: "A/V" }],
    "212": [{ key: "gain", label: "Gain (μ)", type: "number" }],
    "214": [{ key: "gain", label: "Gain (transresistance)", type: "number", unit: "Ω" }],
    "215": [{ key: "gain", label: "Gain (β)", type: "number" }],
    "183": [
        { key: "slewRate", label: "Slew Rate", type: "number", unit: "V/ns" },
        { key: "lowerTrigger", label: "Lower Trigger", type: "number", unit: "V" },
        { key: "upperTrigger", label: "Upper Trigger", type: "number", unit: "V" },
        { key: "logicOnLevel", label: "Logic High Level", type: "number", unit: "V" },
        { key: "logicOffLevel", label: "Logic Low Level", type: "number", unit: "V" },
    ],
    "159": [
        { key: "r_on", label: "On Resistance", type: "number", unit: "Ω" },
        { key: "r_off", label: "Off Resistance", type: "number", unit: "Ω" },
        { key: "threshold", label: "Threshold", type: "number", unit: "V" },
    ],
    "180": [
        { key: "r_on", label: "On Resistance", type: "number", unit: "Ω" },
        { key: "r_off", label: "Off Resistance", type: "number", unit: "Ω" },
        { key: "r_off_ground", label: "Off Pulldown Resistance", type: "number", unit: "Ω" },
        { key: "highVoltage", label: "High Voltage", type: "number", unit: "V" },
    ],
    "422": [
        { key: "delay", label: "Delay", type: "number", unit: "s" },
        { key: "threshold", label: "Threshold", type: "number", unit: "V" },
        { key: "highVoltage", label: "High Voltage", type: "number", unit: "V" },
    ],
    "414": [
        { key: "onDelay", label: "On Delay", type: "number", unit: "s" },
        { key: "offDelay", label: "Off Delay", type: "number", unit: "s" },
        { key: "onResistance", label: "On Resistance", type: "number", unit: "Ω" },
        { key: "offResistance", label: "Off Resistance", type: "number", unit: "Ω" },
    ],
};

// The gate family (AND/OR/NAND/NOR/XOR/XNOR) all share AndGateElm's shape --
// aliased rather than duplicated, keyed by each subclass's own dump id.
for (const id of ["151", "152", "153", "154", "431"]) {
    FIELD_SCHEMA[id] = FIELD_SCHEMA["150"];
}

// SchmittElm ('182') doesn't override dumpTokens() -- same 5-field shape as
// its parent InvertingSchmittElm ('183'). AnalogSwitch2Elm ('160') likewise
// inherits AnalogSwitchElm's ('159') dumpTokens() unchanged.
FIELD_SCHEMA["182"] = FIELD_SCHEMA["183"];
FIELD_SCHEMA["160"] = FIELD_SCHEMA["159"];

export function getFieldValue(elm: object, key: string): unknown {
    const parts = key.split(".");
    let obj: unknown = elm;
    for (const p of parts) {
        if (obj === null || obj === undefined) return undefined;
        obj = (obj as Record<string, unknown>)[p];
    }
    return obj;
}

export function setFieldValue(elm: object, key: string, value: unknown): void {
    const parts = key.split(".");
    let obj = elm as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
}
