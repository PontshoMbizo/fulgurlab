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
    // Placeable 2-terminal oscilloscope probe (Simulink Scope-block model --
    // see elements/scope.ts's class comment for the documented divergence
    // from Java's screen-space-overlay ScopeElm, which this id names there).
    '403': elements.ScopeElm,
    // Digital corpus elements (audit issue #2 part 1) -- CustomLogicElm's
    // "!"-line rules engine and the classic 7-segment display chip.
    '208': elements.CustomLogicElm,
    '157': elements.SevenSegElm,
    // fulgurlab lockstep bridge chip (docs/bridge-protocol.md) -- engine
    // half only, see elements/ext_chip.ts's class comment.
    '460': elements.ExtChipElm,

    // ---- ChipElm family (elements/chip.ts + sequential/combinational/memory)
    // 164 is CounterElm, NOT ClockElm. ClockElm has no dump id of its own --
    // its getDumpClass() is RailElm, so it dumps as 'R' and is a palette
    // preset only (see palette.ts, same as ACRail/SquareRail).
    '164': elements.CounterElm,
    '421': elements.Counter2Elm,
    '163': elements.RingCounterElm,
    '155': elements.DFlipFlopElm,
    '156': elements.JKFlipFlopElm,
    '193': elements.TFlipFlopElm,
    '168': elements.LatchElm,
    '184': elements.MultiplexerElm,
    '185': elements.DeMultiplexerElm,
    '195': elements.HalfAdderElm,
    '196': elements.FullAdderElm,
    '197': elements.SevenSegDecoderElm,
    '188': elements.SeqGenElm,
    '186': elements.PisoShiftElm,
    '189': elements.SipoShiftElm,
    '433': elements.BusSplitterElm,
    '413': elements.SRAMElm,
    '436': elements.ROMElm,
    '432': elements.AnalogMuxElm,
    '419': elements.DecimalDisplayElm,
    // Analog/mixed-signal chips (elements/analog_chips.ts).
    '165': elements.TimerElm,
    '194': elements.MonostableElm,
    '158': elements.VCOElm,
    '161': elements.PhaseCompElm,
    '166': elements.DACElm,
    '167': elements.ADCElm,
    '179': elements.CC2Elm,
    '405': elements.LEDArrayElm,

    // ---- Two-terminal passive / state-dependent (elements/passive.ts).
    // 'm'/'T'/'j' are the ASCII forms of Java's 109/84/106 -- getDumpType()
    // returns a char literal there, so the id and the character are the same
    // number and the parser sees the character.
    'm': elements.MemristorElm,
    '209': elements.PolarCapacitorElm,
    '175': elements.TunnelDiodeElm,
    '176': elements.VaractorElm,
    '187': elements.SparkGapElm,
    '404': elements.FuseElm,
    '181': elements.LampElm,
    '350': elements.ThermistorNTCElm,
    '374': elements.LDRElm,

    // ---- Meters / taps / data sources and sinks (elements/meters.ts).
    '368': elements.TestPointElm,
    '423': elements.LineElm,
    '216': elements.OhmMeterElm,
    '420': elements.WattmeterElm,
    '408': elements.StopTriggerElm,
    '210': elements.DataRecorderElm,
    '211': elements.AudioOutputElm,
    '411': elements.AudioInputElm,
    '424': elements.DataInputElm,
    '418': elements.ExtVoltageElm,

    // ---- Semiconductors (elements/semiconductors.ts).
    'j': elements.JfetElm,
    '173': elements.TriodeElm,
    '177': elements.SCRElm,
    '203': elements.DiacElm,
    '206': elements.TriacElm,

    // ---- Magnetically coupled / distributed (elements/transformer.ts).
    'T': elements.TransformerElm,
    '169': elements.TappedTransformerElm,
    '406': elements.CustomTransformerElm,
    '171': elements.TransLineElm,

    // ---- Relays, multi-pole switches, motors (elements/relays.ts).
    '178': elements.RelayElm,
    '425': elements.RelayCoilElm,
    '426': elements.RelayContactElm,
    '416': elements.MBBSwitchElm,
    '429': elements.DPDTSwitchElm,
    '430': elements.CrossSwitchElm,
    '428': elements.MotorProtectionSwitchElm,
    '415': elements.DCMotorElm,
    '427': elements.ThreePhaseMotorElm,

    // ---- Subcircuits / fixed-model composites (elements/composite.ts).
    '410': elements.CustomCompositeElm,
    '400': elements.DarlingtonElm,
    '407': elements.OptocouplerElm,
    '409': elements.OpAmpRealElm,
    '417': elements.UnijunctionElm,
    '412': elements.CrystalElm,
};

// CompositeElm's model strings reference sub-elements by Java CLASS NAME
// ("NTransistorElm 1 2 4"), not by dump id, so composite.ts needs its own
// name-keyed registry. It is populated here because this module already imports
// every element; registering from composite.ts itself would be an import cycle.
elements.registerElementClasses({
    ...elements,
    // Java's NTransistorElm/PTransistorElm/NMosfetElm/... are palette presets
    // whose getDumpClass() points back at the generic class; the flags word in
    // each model's per-child state blob carries the polarity, so mapping them
    // onto the generic constructor is faithful.
    NTransistorElm: elements.TransistorElm,
    PTransistorElm: elements.TransistorElm,
    NMosfetElm: elements.MosfetElm,
    PMosfetElm: elements.MosfetElm,
    NJfetElm: elements.JfetElm,
    PJfetElm: elements.JfetElm,
    NDarlingtonElm: elements.DarlingtonElm,
    PDarlingtonElm: elements.DarlingtonElm,
    ACVoltageElm: elements.VoltageElm,
    DCVoltageElm: elements.VoltageElm,
    ACRailElm: elements.RailElm,
    SquareRailElm: elements.RailElm,
    ClockElm: elements.ClockElm,
    NoiseElm: elements.RailElm,
    OpAmpSwapElm: elements.OpAmpElm,
    PushSwitchElm: elements.SwitchElm,
});

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
