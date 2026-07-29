import { describe, it, expect, vi } from 'vitest';
import { createElement } from '../src/core/factory';
import { undumpCompositeModel } from '../src/elements/composite';

// Coverage gate for TODO.md P1-1 ("71 of 126 Java element types have no TS
// implementation"). Every dump id the Java source emits must be constructible
// through the factory -- with NO tokens, which is the hardest case: it proves
// each constructor has working defaults rather than only surviving a
// well-formed dump line.
//
// The id list is transcribed from `getDumpType()` in every *Elm.java, so if
// upstream adds an element this list is what needs updating (and the mismatch
// will be a deliberate decision rather than a silent gap).

// id -> Java class name, for a readable failure message.
const JAVA_DUMP_IDS: Record<string, string> = {
    // single-character ids (the char literal IS the numeric id in Java)
    'A': 'AntennaElm', 'a': 'OpAmpElm', 'b': 'BoxElm', 'c': 'CapacitorElm',
    'd': 'DiodeElm', 'f': 'MosfetElm', 'g': 'GroundElm', 'i': 'CurrentElm',
    'I': 'InverterElm', 'j': 'JfetElm', 'l': 'InductorElm', 'L': 'LogicInputElm',
    'M': 'LogicOutputElm', 'm': 'MemristorElm', 'O': 'OutputElm', 'p': 'ProbeElm',
    'R': 'RailElm', 'r': 'ResistorElm', 'S': 'Switch2Elm', 's': 'SwitchElm',
    'T': 'TransformerElm', 't': 'TransistorElm', 'v': 'VoltageElm',
    'w': 'WireElm', 'x': 'TextElm', 'z': 'ZenerElm',
    // numeric ids
    '150': 'AndGateElm', '151': 'NandGateElm', '152': 'OrGateElm', '153': 'NorGateElm',
    '154': 'XorGateElm', '155': 'DFlipFlopElm', '156': 'JKFlipFlopElm', '157': 'SevenSegElm',
    '158': 'VCOElm', '159': 'AnalogSwitchElm', '160': 'AnalogSwitch2Elm', '161': 'PhaseCompElm',
    '162': 'LEDElm', '163': 'RingCounterElm', '164': 'CounterElm', '165': 'TimerElm',
    '166': 'DACElm', '167': 'ADCElm', '168': 'LatchElm', '169': 'TappedTransformerElm',
    '170': 'SweepElm', '171': 'TransLineElm', '172': 'VarRailElm', '173': 'TriodeElm',
    '174': 'PotElm', '175': 'TunnelDiodeElm', '176': 'VaractorElm', '177': 'SCRElm',
    '178': 'RelayElm', '179': 'CC2Elm', '180': 'TriStateElm', '181': 'LampElm',
    '182': 'SchmittElm', '183': 'InvertingSchmittElm', '184': 'MultiplexerElm',
    '185': 'DeMultiplexerElm', '186': 'PisoShiftElm', '187': 'SparkGapElm',
    '188': 'SeqGenElm', '189': 'SipoShiftElm', '193': 'TFlipFlopElm', '194': 'MonostableElm',
    '195': 'HalfAdderElm', '196': 'FullAdderElm', '197': 'SevenSegDecoderElm',
    '200': 'AMElm', '201': 'FMElm', '203': 'DiacElm', '206': 'TriacElm',
    '207': 'LabeledNodeElm', '208': 'CustomLogicElm', '209': 'PolarCapacitorElm',
    '210': 'DataRecorderElm', '211': 'AudioOutputElm', '212': 'VCVSElm', '213': 'VCCSElm',
    '214': 'CCVSElm', '215': 'CCCSElm', '216': 'OhmMeterElm', '350': 'ThermistorNTCElm',
    '368': 'TestPointElm', '370': 'AmmeterElm', '374': 'LDRElm', '403': 'ScopeElm',
    '404': 'FuseElm', '405': 'LEDArrayElm', '406': 'CustomTransformerElm',
    '408': 'StopTriggerElm', '410': 'CustomCompositeElm', '411': 'AudioInputElm',
    '412': 'CrystalElm', '413': 'SRAMElm', '414': 'TimeDelayRelayElm', '415': 'DCMotorElm',
    '416': 'MBBSwitchElm', '417': 'UnijunctionElm', '418': 'ExtVoltageElm',
    '419': 'DecimalDisplayElm', '420': 'WattmeterElm', '421': 'Counter2Elm',
    '422': 'DelayBufferElm', '423': 'LineElm', '424': 'DataInputElm', '425': 'RelayCoilElm',
    '426': 'RelayContactElm', '427': 'ThreePhaseMotorElm', '428': 'MotorProtectionSwitchElm',
    '429': 'DPDTSwitchElm', '430': 'CrossSwitchElm', '431': 'XnorGateElm',
    '432': 'AnalogMuxElm', '433': 'BusSplitterElm', '436': 'ROMElm', '460': 'ExtChipElm',
    '400': 'DarlingtonElm', '407': 'OptocouplerElm', '409': 'OpAmpRealElm',
};

// Java classes that deliberately have NO dump id of their own: getDumpClass()
// redirects them to a base class, so they serialize as that base plus a flag
// and exist only as palette presets. Registering an id for any of these would
// reintroduce the P0-1 class of bug.
const PRESET_ONLY = [
    'ACRailElm', 'SquareRailElm', 'NoiseElm', 'ClockElm', 'ACVoltageElm', 'DCVoltageElm',
    'OpAmpSwapElm', 'NTransistorElm', 'PTransistorElm', 'NMosfetElm', 'PMosfetElm',
    'NJfetElm', 'PJfetElm', 'NDarlingtonElm', 'PDarlingtonElm', 'PushSwitchElm',
    'CC2NegElm',
    // getDumpType() returns literal 0 in this fork -- intentionally not
    // serializable through the text format.
    'BusLogicInputElm', 'RoutedWireElm',
];

describe('Java dump-id coverage (TODO P1-1)', () => {
    it('every Java dump id constructs from the factory with no tokens', () => {
        // Suppress the factory's "not implemented yet" warning so a genuine
        // failure is readable.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        // 410 needs its subcircuit model registered first -- that is by design
        // (see CustomCompositeElm's constructor), so give it the same trivial
        // "default" model Java ships built in.
        undumpCompositeModel(['default', '0', '1', '1', '1', 'gnd', '1', '0', '2',
            'GroundElm\\s1', '0']);

        const missing: string[] = [];
        for (const [id, name] of Object.entries(JAVA_DUMP_IDS)) {
            const elm = createElement(id, 0, 0, 32, 0, 0, []);
            if (!elm) missing.push(`${id} (${name})`);
        }

        warn.mockRestore();
        error.mockRestore();
        expect(missing).toEqual([]);
    });

    it('records how many Java element types are covered', () => {
        // 123 Java *Elm classes define a getDumpType(); two of them
        // (BusLogicInputElm, RoutedWireElm) return literal 0 and two more
        // (ClockElm, NoiseElm) redirect via getDumpClass(), leaving 123 real
        // ids -- 119 distinct after the 'j'/'m'/'T' char-literal ids are
        // counted once each. This number going DOWN means an element was
        // dropped from the map.
        expect(Object.keys(JAVA_DUMP_IDS).length).toBe(123);
    });

    it('preset-only classes are documented, not registered as dump ids', () => {
        // A guard against re-adding an id for a getDumpClass()-redirected
        // class. These names must never appear as keys above.
        for (const name of PRESET_ONLY) {
            expect(Object.values(JAVA_DUMP_IDS)).not.toContain(name);
        }
    });

    it('an unknown dump id still returns null rather than throwing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(createElement('99999', 0, 0, 0, 0, 0, [])).toBeNull();
        warn.mockRestore();
    });
});
