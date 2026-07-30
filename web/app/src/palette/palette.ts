// Palette metadata for placeable elements. Deliberately thin: reuses the
// engine's own createElement() factory (dump-id -> constructor) so there is
// exactly one source of truth for "how do I build element X from tokens" --
// the same path a loaded Falstad-text circuit goes through.
//
// PARITY (TODO.md P1-2). The categories and item order below are transcribed
// from Menus.java's composeMainMenu(): the nine submenus it builds, in its
// order, with its labels. That tree lists 143 entries; every one of them is
// here except the handful noted in EXCLUDED_FROM_PALETTE at the bottom, which
// have no dump id to place them by. Several entries share a dump id and differ
// only in flags/tokens -- those are Java's own presets (getDumpClass()
// subclasses like ACRailElm or NMosfetElm), not duplicates.
//
// An `alias` records the Java class name a preset stands for, so the parity
// test (palette.test.ts) can check this file against the menu tree by name
// rather than by label.
export interface PaletteItem {
    dumpType: string;
    label: string;
    category: string;
    flags: number;
    tokens: string[];
    /** Java class this entry corresponds to (for the parity test). */
    alias?: string;
}

// Java's own submenu titles, in composeMainMenu() order. Wire/Resistor/Ground
// are top-level items in Java's Draw menu rather than submenu entries; they go
// under Basic here so the flyout has somewhere to put them.
export const CAT_BASIC = "Basic";
export const CAT_PASSIVE = "Passive Components";
export const CAT_SOURCES = "Inputs and Sources";
export const CAT_OUTPUTS = "Outputs and Labels";
export const CAT_ACTIVE = "Active Components";
export const CAT_BLOCKS = "Active Building Blocks";
export const CAT_LOGIC = "Logic Gates, Input and Output";
export const CAT_CHIPS = "Digital Chips";
export const CAT_ACHIPS = "Analog and Hybrid Chips";
export const CAT_COSIM = "Co-simulated";

export const PALETTE: PaletteItem[] = [
    // ---------------------------------------------------------------- Basic
    { dumpType: "w", label: "Wire", category: CAT_BASIC, flags: 0, tokens: [], alias: "WireElm" },
    { dumpType: "r", label: "Resistor", category: CAT_BASIC, flags: 0, tokens: ["1000"], alias: "ResistorElm" },
    { dumpType: "g", label: "Ground", category: CAT_BASIC, flags: 0, tokens: [], alias: "GroundElm" },

    // ---------------------------------------------------- Passive Components
    { dumpType: "c", label: "Capacitor", category: CAT_PASSIVE, flags: 0, tokens: ["0.000001"], alias: "CapacitorElm" },
    { dumpType: "209", label: "Capacitor (polarized)", category: CAT_PASSIVE, flags: 0, tokens: ["0.000001", "0", "0", "1"], alias: "PolarCapacitorElm" },
    { dumpType: "l", label: "Inductor", category: CAT_PASSIVE, flags: 0, tokens: ["0.01"], alias: "InductorElm" },
    { dumpType: "s", label: "Switch", category: CAT_PASSIVE, flags: 0, tokens: [], alias: "SwitchElm" },
    // PushSwitchElm: a SwitchElm preset with momentary = true.
    { dumpType: "s", label: "Push Switch", category: CAT_PASSIVE, flags: 0, tokens: ["0", "true"], alias: "PushSwitchElm" },
    { dumpType: "S", label: "SPDT Switch", category: CAT_PASSIVE, flags: 0, tokens: ["0", "false", "0", "2"], alias: "Switch2Elm" },
    { dumpType: "429", label: "DPDT Switch", category: CAT_PASSIVE, flags: 0, tokens: ["0", "false", "2"], alias: "DPDTSwitchElm" },
    { dumpType: "416", label: "Make-Before-Break Switch", category: CAT_PASSIVE, flags: 0, tokens: ["0", "false", "0"], alias: "MBBSwitchElm" },
    { dumpType: "174", label: "Potentiometer", category: CAT_PASSIVE, flags: 0, tokens: ["1000", "0.5"], alias: "PotElm" },
    { dumpType: "T", label: "Transformer", category: CAT_PASSIVE, flags: 0, tokens: ["4", "1", "0", "0", "0.999", "0"], alias: "TransformerElm" },
    { dumpType: "169", label: "Tapped Transformer", category: CAT_PASSIVE, flags: 0, tokens: ["4", "1", "0", "0", "0", "0.99"], alias: "TappedTransformerElm" },
    { dumpType: "406", label: "Custom Transformer", category: CAT_PASSIVE, flags: 0, tokens: ["4", "0.999", "1:1"], alias: "CustomTransformerElm" },
    { dumpType: "171", label: "Transmission Line", category: CAT_PASSIVE, flags: 0, tokens: ["0.005", "75", "16", "0"], alias: "TransLineElm" },
    { dumpType: "178", label: "Relay", category: CAT_PASSIVE, flags: 0, tokens: ["1", "0.2", "0", "0.05", "1000000", "0.02", "20", "0.015", "0.005", "0"], alias: "RelayElm" },
    { dumpType: "425", label: "Relay Coil", category: CAT_PASSIVE, flags: 0, tokens: ["K1", "0.2", "0", "0.02", "20", "0.015", "0.005", "0", "0", "0"], alias: "RelayCoilElm" },
    { dumpType: "426", label: "Relay Contact", category: CAT_PASSIVE, flags: 4, tokens: ["K1", "0.05", "1000000", "0"], alias: "RelayContactElm" },
    { dumpType: "374", label: "Photoresistor", category: CAT_PASSIVE, flags: 0, tokens: ["0.34", "Lux"], alias: "LDRElm" },
    { dumpType: "350", label: "Thermistor", category: CAT_PASSIVE, flags: 0, tokens: ["10000", "3605", "-40", "150", "0.34", "Temperature"], alias: "ThermistorNTCElm" },
    { dumpType: "m", label: "Memristor", category: CAT_PASSIVE, flags: 0, tokens: ["100", "16000", "0", "1e-8", "1e-10"], alias: "MemristorElm" },
    { dumpType: "187", label: "Spark Gap", category: CAT_PASSIVE, flags: 0, tokens: ["1000", "1000000000", "1000", "0.001"], alias: "SparkGapElm" },
    { dumpType: "404", label: "Fuse", category: CAT_PASSIVE, flags: 0, tokens: ["0.0613", "6.73", "0", "false"], alias: "FuseElm" },
    { dumpType: "412", label: "Crystal", category: CAT_PASSIVE, flags: 1, tokens: [], alias: "CrystalElm" },
    { dumpType: "430", label: "Cross Switch", category: CAT_PASSIVE, flags: 0, tokens: ["0", "false"], alias: "CrossSwitchElm" },

    // ---------------------------------------------------- Inputs and Sources
    { dumpType: "v", label: "Voltage Source (2-terminal)", category: CAT_SOURCES, flags: 0, tokens: ["0", "40", "5", "0", "0"], alias: "DCVoltageElm" },
    { dumpType: "v", label: "A/C Voltage Source (2-terminal)", category: CAT_SOURCES, flags: 0, tokens: ["1", "40", "5", "0", "0"], alias: "ACVoltageElm" },
    { dumpType: "R", label: "Voltage Source (1-terminal)", category: CAT_SOURCES, flags: 0, tokens: ["0", "40", "5"], alias: "RailElm" },
    { dumpType: "R", label: "A/C Voltage Source (1-terminal)", category: CAT_SOURCES, flags: 0, tokens: ["1", "40", "169.7"], alias: "ACRailElm" },
    { dumpType: "R", label: "Square Wave Source (1-terminal)", category: CAT_SOURCES, flags: 0, tokens: ["2", "40", "5"], alias: "SquareRailElm" },
    // ClockElm: RailElm + FLAG_CLOCK (bit 0), WF_SQUARE, 100Hz/2.5V/2.5V bias.
    // It has no dump id of its own -- see TODO P0-1 and voltage.ts's ClockElm.
    { dumpType: "R", label: "Clock", category: CAT_SOURCES, flags: 1, tokens: ["2", "100", "2.5", "2.5", "0", "0.5"], alias: "ClockElm" },
    { dumpType: "170", label: "A/C Sweep", category: CAT_SOURCES, flags: 0, tokens: [], alias: "SweepElm" },
    { dumpType: "172", label: "Variable Voltage", category: CAT_SOURCES, flags: 0, tokens: [], alias: "VarRailElm" },
    { dumpType: "A", label: "Antenna", category: CAT_SOURCES, flags: 0, tokens: [], alias: "AntennaElm" },
    { dumpType: "200", label: "AM Source", category: CAT_SOURCES, flags: 0, tokens: [], alias: "AMElm" },
    { dumpType: "201", label: "FM Source", category: CAT_SOURCES, flags: 0, tokens: [], alias: "FMElm" },
    { dumpType: "i", label: "Current Source", category: CAT_SOURCES, flags: 0, tokens: ["0.01", "0"], alias: "CurrentElm" },
    { dumpType: "R", label: "Noise Generator", category: CAT_SOURCES, flags: 0, tokens: ["6", "40", "5"], alias: "NoiseElm" },
    { dumpType: "411", label: "Audio Input", category: CAT_SOURCES, flags: 0, tokens: ["1", "40", "5", "0", "0", "0.5", "5", "0", "0"], alias: "AudioInputElm" },
    { dumpType: "424", label: "Data Input", category: CAT_SOURCES, flags: 0, tokens: ["1", "40", "5", "0", "0", "0.5", "0.001", "1", "0"], alias: "DataInputElm" },
    { dumpType: "418", label: "External Voltage (JavaScript)", category: CAT_SOURCES, flags: 0, tokens: ["1", "40", "5", "0", "0", "0.5", "ext"], alias: "ExtVoltageElm" },

    // --------------------------------------------------- Outputs and Labels
    { dumpType: "O", label: "Analog Output", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "OutputElm" },
    { dumpType: "162", label: "LED", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "LEDElm" },
    { dumpType: "181", label: "Lamp", category: CAT_OUTPUTS, flags: 0, tokens: ["300", "100", "120", "0.4", "0.4"], alias: "LampElm" },
    { dumpType: "x", label: "Text", category: CAT_OUTPUTS, flags: 0, tokens: ["24", "Label"], alias: "TextElm" },
    { dumpType: "b", label: "Box", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "BoxElm" },
    { dumpType: "423", label: "Line", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "LineElm" },
    { dumpType: "207", label: "Labeled Node", category: CAT_OUTPUTS, flags: 0, tokens: ["node1"], alias: "LabeledNodeElm" },
    { dumpType: "p", label: "Voltmeter/Scope Probe", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "ProbeElm" },
    { dumpType: "216", label: "Ohmmeter", category: CAT_OUTPUTS, flags: 0, tokens: ["0.01", "0"], alias: "OhmMeterElm" },
    { dumpType: "370", label: "Ammeter", category: CAT_OUTPUTS, flags: 0, tokens: ["0", "0"], alias: "AmmeterElm" },
    { dumpType: "420", label: "Wattmeter", category: CAT_OUTPUTS, flags: 0, tokens: ["16", "0"], alias: "WattmeterElm" },
    { dumpType: "368", label: "Test Point", category: CAT_OUTPUTS, flags: 0, tokens: ["0"], alias: "TestPointElm" },
    { dumpType: "419", label: "Decimal Display", category: CAT_OUTPUTS, flags: 0, tokens: ["4", "0"], alias: "DecimalDisplayElm" },
    { dumpType: "405", label: "LED Array", category: CAT_OUTPUTS, flags: 0, tokens: ["8", "8"], alias: "LEDArrayElm" },
    { dumpType: "210", label: "Data Export", category: CAT_OUTPUTS, flags: 0, tokens: ["10240"], alias: "DataRecorderElm" },
    { dumpType: "211", label: "Audio Output", category: CAT_OUTPUTS, flags: 0, tokens: ["1", "8000", "1"], alias: "AudioOutputElm" },
    { dumpType: "408", label: "Stop Trigger", category: CAT_OUTPUTS, flags: 0, tokens: ["1", "0", "0"], alias: "StopTriggerElm" },
    { dumpType: "415", label: "DC Motor", category: CAT_OUTPUTS, flags: 0, tokens: ["0.001", "10", "0.01", "0.01", "0.0001", "0.001", "1", "0"], alias: "DCMotorElm" },
    { dumpType: "427", label: "3-Phase Motor", category: CAT_OUTPUTS, flags: 0, tokens: ["1", "1", "0.1", "0.1", "0.09", "0.001", "1"], alias: "ThreePhaseMotorElm" },
    // Placeable 2-terminal oscilloscope (Simulink Scope-block model) -- placing
    // one auto-creates its scope channel; see engine/store.ts's addElement().
    // Java's ScopeElm is a screen-space overlay, so it has no menu entry there.
    { dumpType: "403", label: "Scope", category: CAT_OUTPUTS, flags: 0, tokens: [], alias: "ScopeElm" },

    // --------------------------------------------------- Active Components
    { dumpType: "d", label: "Diode", category: CAT_ACTIVE, flags: 0, tokens: [], alias: "DiodeElm" },
    { dumpType: "z", label: "Zener Diode", category: CAT_ACTIVE, flags: 0, tokens: [], alias: "ZenerElm" },
    { dumpType: "t", label: "Transistor (bipolar, NPN)", category: CAT_ACTIVE, flags: 0, tokens: ["1"], alias: "NTransistorElm" },
    { dumpType: "t", label: "Transistor (bipolar, PNP)", category: CAT_ACTIVE, flags: 0, tokens: ["-1"], alias: "PTransistorElm" },
    { dumpType: "f", label: "MOSFET (N-Channel)", category: CAT_ACTIVE, flags: 0, tokens: [], alias: "NMosfetElm" },
    { dumpType: "f", label: "MOSFET (P-Channel)", category: CAT_ACTIVE, flags: 1, tokens: [], alias: "PMosfetElm" },
    { dumpType: "j", label: "JFET (N-Channel)", category: CAT_ACTIVE, flags: 0, tokens: ["-4", "0.00125"], alias: "NJfetElm" },
    { dumpType: "j", label: "JFET (P-Channel)", category: CAT_ACTIVE, flags: 1, tokens: ["-4", "0.00125"], alias: "PJfetElm" },
    { dumpType: "177", label: "SCR", category: CAT_ACTIVE, flags: 1, tokens: [], alias: "SCRElm" },
    { dumpType: "203", label: "DIAC", category: CAT_ACTIVE, flags: 0, tokens: ["500", "100000000", "30", "0.01"], alias: "DiacElm" },
    { dumpType: "206", label: "TRIAC", category: CAT_ACTIVE, flags: 0, tokens: ["0.01", "0.0082", "100", "false"], alias: "TriacElm" },
    { dumpType: "400", label: "Darlington Pair (NPN)", category: CAT_ACTIVE, flags: 0, tokens: ["1"], alias: "NDarlingtonElm" },
    { dumpType: "400", label: "Darlington Pair (PNP)", category: CAT_ACTIVE, flags: 0, tokens: ["-1"], alias: "PDarlingtonElm" },
    { dumpType: "176", label: "Varactor/Varicap", category: CAT_ACTIVE, flags: 0, tokens: ["0", "4e-12"], alias: "VaractorElm" },
    { dumpType: "175", label: "Tunnel Diode", category: CAT_ACTIVE, flags: 0, tokens: [], alias: "TunnelDiodeElm" },
    { dumpType: "173", label: "Triode", category: CAT_ACTIVE, flags: 2, tokens: ["93", "680"], alias: "TriodeElm" },
    { dumpType: "417", label: "Unijunction Transistor", category: CAT_ACTIVE, flags: 0, tokens: [], alias: "UnijunctionElm" },

    // ------------------------------------------------ Active Building Blocks
    { dumpType: "a", label: "Op Amp (ideal, - on top)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "OpAmpElm" },
    // OpAmpSwapElm: a thin Java subclass that just sets FLAG_SWAP=1 and dumps
    // as a plain OpAmpElm (getDumpClass()) -- a preset, not a class here.
    { dumpType: "a", label: "Op Amp (ideal, + on top)", category: CAT_BLOCKS, flags: 1, tokens: [], alias: "OpAmpSwapElm" },
    { dumpType: "409", label: "Op Amp (real)", category: CAT_BLOCKS, flags: 1, tokens: [], alias: "OpAmpRealElm" },
    { dumpType: "159", label: "Analog Switch (SPST)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "AnalogSwitchElm" },
    { dumpType: "160", label: "Analog Switch (SPDT)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "AnalogSwitch2Elm" },
    { dumpType: "432", label: "Analog Multiplexer", category: CAT_BLOCKS, flags: 0, tokens: ["2", "20", "10000000000", "2.5"], alias: "AnalogMuxElm" },
    { dumpType: "180", label: "Tristate Buffer", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "TriStateElm" },
    { dumpType: "182", label: "Schmitt Trigger", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "SchmittElm" },
    { dumpType: "183", label: "Schmitt Trigger (Inverting)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "InvertingSchmittElm" },
    { dumpType: "422", label: "Delay Buffer", category: CAT_BLOCKS, flags: 0, tokens: ["0.1", "2.5", "5"], alias: "DelayBufferElm" },
    { dumpType: "179", label: "CCII+", category: CAT_BLOCKS, flags: 0, tokens: ["1"], alias: "CC2Elm" },
    // CC2NegElm: gain -1, dumps as CC2Elm (getDumpClass()).
    { dumpType: "179", label: "CCII-", category: CAT_BLOCKS, flags: 0, tokens: ["-1"], alias: "CC2NegElm" },
    { dumpType: "401", label: "Comparator (Hi-Z/GND output)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "ComparatorElm" },
    { dumpType: "402", label: "OTA (LM13700 style)", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "OTAElm" },
    { dumpType: "212", label: "Voltage-Controlled Voltage Source (VCVS)", category: CAT_BLOCKS, flags: 0, tokens: ["2"], alias: "VCVSElm" },
    { dumpType: "213", label: "Voltage-Controlled Current Source (VCCS)", category: CAT_BLOCKS, flags: 0, tokens: ["0.01"], alias: "VCCSElm" },
    { dumpType: "214", label: "Current-Controlled Voltage Source (CCVS)", category: CAT_BLOCKS, flags: 0, tokens: ["100"], alias: "CCVSElm" },
    { dumpType: "215", label: "Current-Controlled Current Source (CCCS)", category: CAT_BLOCKS, flags: 0, tokens: ["10"], alias: "CCCSElm" },
    { dumpType: "407", label: "Optocoupler", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "OptocouplerElm" },
    { dumpType: "414", label: "Time Delay Relay", category: CAT_BLOCKS, flags: 0, tokens: [], alias: "TimeDelayRelayElm" },
    { dumpType: "428", label: "Motor Protection Switch", category: CAT_BLOCKS, flags: 0, tokens: ["0.0613", "6.73", "false", ""], alias: "MotorProtectionSwitchElm" },
    // Subcircuit instance: needs a "." model line in the circuit first, so
    // placing one from the palette only works once a model has been loaded
    // (see composite.ts's CustomCompositeElm constructor). Java's two built-in
    // presets (~LM317-v2, ~TL431) ship as stored models it loads at startup;
    // this port has no model library yet, so only the generic entry is offered.
    { dumpType: "410", label: "Subcircuit Instance", category: CAT_BLOCKS, flags: 0, tokens: ["default"], alias: "CustomCompositeElm" },

    // -------------------------------------- Logic Gates, Input and Output
    { dumpType: "L", label: "Logic Input", category: CAT_LOGIC, flags: 0, tokens: [], alias: "LogicInputElm" },
    { dumpType: "M", label: "Logic Output", category: CAT_LOGIC, flags: 0, tokens: [], alias: "LogicOutputElm" },
    { dumpType: "I", label: "Inverter", category: CAT_LOGIC, flags: 0, tokens: [], alias: "InverterElm" },
    { dumpType: "151", label: "NAND Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "NandGateElm" },
    { dumpType: "153", label: "NOR Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "NorGateElm" },
    { dumpType: "150", label: "AND Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "AndGateElm" },
    { dumpType: "152", label: "OR Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "OrGateElm" },
    { dumpType: "154", label: "XOR Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "XorGateElm" },
    { dumpType: "431", label: "XNOR Gate", category: CAT_LOGIC, flags: 0, tokens: ["2"], alias: "XnorGateElm" },

    // ------------------------------------------------------- Digital Chips
    { dumpType: "155", label: "D Flip-Flop", category: CAT_CHIPS, flags: 0, tokens: ["0"], alias: "DFlipFlopElm" },
    { dumpType: "156", label: "JK Flip-Flop", category: CAT_CHIPS, flags: 0, tokens: ["0"], alias: "JKFlipFlopElm" },
    { dumpType: "193", label: "T Flip-Flop", category: CAT_CHIPS, flags: 0, tokens: ["0"], alias: "TFlipFlopElm" },
    { dumpType: "157", label: "7 Segment LED", category: CAT_CHIPS, flags: 0, tokens: [], alias: "SevenSegElm" },
    { dumpType: "197", label: "7 Segment Decoder", category: CAT_CHIPS, flags: 0, tokens: ["0"], alias: "SevenSegDecoderElm" },
    { dumpType: "184", label: "Multiplexer", category: CAT_CHIPS, flags: 0, tokens: ["2"], alias: "MultiplexerElm" },
    { dumpType: "185", label: "Demultiplexer", category: CAT_CHIPS, flags: 0, tokens: ["2"], alias: "DeMultiplexerElm" },
    { dumpType: "189", label: "SIPO shift register", category: CAT_CHIPS, flags: 0, tokens: ["8", "0"], alias: "SipoShiftElm" },
    { dumpType: "186", label: "PISO shift register", category: CAT_CHIPS, flags: 2, tokens: ["8", "0"], alias: "PisoShiftElm" },
    { dumpType: "164", label: "Counter", category: CAT_CHIPS, flags: 0, tokens: ["4", "0", "0", "0", "0", "true", "0"], alias: "CounterElm" },
    { dumpType: "421", label: "Counter w/ Load", category: CAT_CHIPS, flags: 0, tokens: ["4", "0", "0", "0", "0", "0"], alias: "Counter2Elm" },
    // DecadeElm is Java's legacy alias for RingCounterElm (CirSim.java:625
    // keeps the name alive for saved shortcuts) -- one element, one entry.
    { dumpType: "163", label: "Ring Counter", category: CAT_CHIPS, flags: 2, tokens: ["10"], alias: "RingCounterElm" },
    { dumpType: "168", label: "Latch", category: CAT_CHIPS, flags: 2, tokens: ["4", "0", "0", "0", "0"], alias: "LatchElm" },
    { dumpType: "188", label: "Sequence generator", category: CAT_CHIPS, flags: 14, tokens: ["8", "0"], alias: "SeqGenElm" },
    { dumpType: "196", label: "Adder", category: CAT_CHIPS, flags: 2, tokens: ["4"], alias: "FullAdderElm" },
    { dumpType: "195", label: "Half Adder", category: CAT_CHIPS, flags: 0, tokens: [], alias: "HalfAdderElm" },
    // UserDefinedLogicElm is Java's legacy alias for CustomLogicElm.
    { dumpType: "208", label: "Custom Logic", category: CAT_CHIPS, flags: 0, tokens: ["default"], alias: "CustomLogicElm" },
    { dumpType: "413", label: "Static RAM", category: CAT_CHIPS, flags: 0, tokens: ["4", "4", "-2"], alias: "SRAMElm" },
    { dumpType: "436", label: "ROM", category: CAT_CHIPS, flags: 0, tokens: ["4", "4", "-2"], alias: "ROMElm" },
    { dumpType: "433", label: "Bus Splitter", category: CAT_CHIPS, flags: 0, tokens: ["4"], alias: "BusSplitterElm" },

    // --------------------------------------------- Analog and Hybrid Chips
    { dumpType: "165", label: "555 Timer", category: CAT_ACHIPS, flags: 6, tokens: ["0"], alias: "TimerElm" },
    { dumpType: "161", label: "Phase Comparator", category: CAT_ACHIPS, flags: 0, tokens: [], alias: "PhaseCompElm" },
    { dumpType: "166", label: "DAC", category: CAT_ACHIPS, flags: 0, tokens: ["4"], alias: "DACElm" },
    { dumpType: "167", label: "ADC", category: CAT_ACHIPS, flags: 0, tokens: ["4"], alias: "ADCElm" },
    { dumpType: "158", label: "VCO", category: CAT_ACHIPS, flags: 0, tokens: [], alias: "VCOElm" },
    { dumpType: "194", label: "Monostable", category: CAT_ACHIPS, flags: 0, tokens: ["false", "0.01"], alias: "MonostableElm" },

    // ----------------------------------------------------- Co-simulated
    // fulgurlab's own addition (docs/bridge-protocol.md). Tokens empty: the
    // element's own defaults apply (ws://localhost:3100, 1ms quantum) and the
    // drawer prefills the blinky Verilog preset on first open.
    { dumpType: "460", label: "FPGA — Tang Nano 9K (fpgasim)", category: CAT_COSIM, flags: 0, tokens: [], alias: "ExtChipElm" },
];

export const CATEGORIES: string[] = [
    CAT_BASIC, CAT_PASSIVE, CAT_SOURCES, CAT_OUTPUTS, CAT_ACTIVE,
    CAT_BLOCKS, CAT_LOGIC, CAT_CHIPS, CAT_ACHIPS, CAT_COSIM,
];

// Menus.java entries deliberately NOT offered, with the reason. Kept as data so
// palette.test.ts can assert that PALETTE plus this list accounts for the whole
// Java draw menu -- a new upstream menu entry then shows up as a test failure
// rather than silently going missing.
export const EXCLUDED_FROM_PALETTE: Record<string, string> = {
    // getDumpType() returns literal 0 in this fork: not serializable through
    // the text format, so there is no id to place them by.
    RoutedWireElm: "getDumpType() == 0 (not serializable in this fork)",
    BusLogicInputElm: "getDumpType() == 0 (not serializable in this fork)",
    // No getDumpType() at all.
    GyratorElm: "no dump type in the Java source",
    InstructionDisplayElm: "no dump type in the Java source",
    BusTransceiverElm: "no dump type in the Java source",
    // Subcircuit presets that need Java's shipped stored-model library; this
    // port has no model library, only the generic Subcircuit Instance entry.
    "CustomCompositeElm:~LM317-v2": "needs Java's built-in stored subcircuit models",
    "CustomCompositeElm:~TL431": "needs Java's built-in stored subcircuit models",
    // Mouse modes, not elements.
    DragAll: "mouse mode, not an element",
    DragRow: "mouse mode, not an element",
    DragColumn: "mouse mode, not an element",
    DragSelected: "mouse mode, not an element",
    DragPost: "mouse mode, not an element",
    Select: "mouse mode, not an element",
    // Legacy aliases folded into the class they resolve to (CirSim.java:625-630).
    DecadeElm: "legacy alias for RingCounterElm",
    UserDefinedLogicElm: "legacy alias for CustomLogicElm",
};
