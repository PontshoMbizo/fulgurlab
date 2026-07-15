import * as elements from '../elements';

type ElementCtor = new (x1: number, y1: number, x2: number, y2: number, flags: number, tokens: string[]) => elements.CircuitElm;

// Dump-id -> constructor table. Keys match CircuitElm.java's getDumpType()
// values exactly (as strings, since factory dispatch and JS object keys are
// string-keyed either way) — see docs/react-rewrite-plan.md §A.1 for the full
// Tier-1 id list. Verified against the Java source file-by-file; a couple of
// ids were wrong in an earlier draft (LogicInputElm 'i'->'L', LogicOutputElm
// 'O'->'M', XnorGateElm 155->431) and are fixed here.
const dumpTypeMap: Record<string, ElementCtor> = {
    'r': elements.ResistorElm,
    'c': elements.CapacitorElm,
    'l': elements.InductorElm,
    'v': elements.VoltageElm,
    'g': elements.GroundElm,
    'w': elements.WireElm,
    's': elements.SwitchElm,
    'S': elements.Switch2Elm,
    'd': elements.DiodeElm,
    't': elements.TransistorElm,
    'a': elements.OpAmpElm,
    'f': elements.MosfetElm,
    'i': elements.CurrentElm,
    'R': elements.RailElm,
    '164': elements.ClockElm,
    'I': elements.InverterElm,
    'L': elements.LogicInputElm,
    'M': elements.LogicOutputElm,
    '150': elements.AndGateElm,
    '151': elements.NandGateElm,
    '152': elements.OrGateElm,
    '153': elements.NorGateElm,
    '154': elements.XorGateElm,
    '431': elements.XnorGateElm,
    '162': elements.LEDElm,
    '174': elements.PotElm,
    'O': elements.OutputElm,
    'p': elements.ProbeElm,
    '207': elements.LabeledNodeElm,
    'x': elements.TextElm,
    'b': elements.BoxElm,
    '370': elements.AmmeterElm,
    'z': elements.ZenerElm,
    // Power/Sources group (see docs/react-rewrite-plan.md session note).
    // ACRailElm/SquareRailElm/NoiseElm need no entries of their own -- Java's
    // getDumpClass() makes them dump/reload as plain RailElm ('R'), so
    // they're palette-only presets (see palette.ts).
    '172': elements.VarRailElm,
    'A': elements.AntennaElm,
    '170': elements.SweepElm,
    '200': elements.AMElm,
    '201': elements.FMElm,
    // Analog Active Building Blocks group (see docs/react-rewrite-plan.md
    // session note). OpAmpSwapElm needs no entry of its own -- like the
    // Power-group presets, it dumps as plain OpAmpElm ('a') via Java's
    // getDumpClass() override.
    '212': elements.VCVSElm,
    '213': elements.VCCSElm,
    '214': elements.CCVSElm,
    '215': elements.CCCSElm,
    '183': elements.InvertingSchmittElm,
    '182': elements.SchmittElm,
    '159': elements.AnalogSwitchElm,
    '160': elements.AnalogSwitch2Elm,
    '401': elements.ComparatorElm,
    '402': elements.OTAElm,
    '180': elements.TriStateElm,
    '422': elements.DelayBufferElm,
    '414': elements.TimeDelayRelayElm,
};

export function createElement(
    dumpType: string,
    x1: number, y1: number, x2: number, y2: number, flags: number,
    tokens: string[],
): elements.CircuitElm | null {
    const Ctor = dumpTypeMap[dumpType];
    if (!Ctor) {
        console.warn(`Element dump type '${dumpType}' is not implemented yet.`);
        return null;
    }
    try {
        return new Ctor(x1, y1, x2, y2, flags, tokens);
    } catch (e) {
        console.error(`Failed to construct element of type ${dumpType}:`, e);
        return null;
    }
}
