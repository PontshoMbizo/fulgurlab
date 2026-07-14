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
