// Palette metadata for placeable Tier-1 elements. Deliberately thin: reuses
// the engine's own createElement() factory (dump-id -> constructor) so there
// is exactly one source of truth for "how do I build element X from
// tokens" -- the same path a loaded Falstad-text circuit goes through.
// Categories loosely mirror Menus.java's grouping (see plan §5 task 4);
// full parity with that tree is a later refinement, not needed for a first
// working canvas.
export interface PaletteItem {
    dumpType: string;
    label: string;
    category: string;
    flags: number;
    tokens: string[];
}

export const PALETTE: PaletteItem[] = [
    // Basic
    { dumpType: 'w', label: 'Wire', category: 'Basic', flags: 0, tokens: [] },
    { dumpType: 'g', label: 'Ground', category: 'Basic', flags: 0, tokens: [] },
    { dumpType: '207', label: 'Labeled Node', category: 'Basic', flags: 0, tokens: ['node1'] },
    { dumpType: 'x', label: 'Text', category: 'Basic', flags: 0, tokens: ['24', 'Label'] },
    { dumpType: 'b', label: 'Box', category: 'Basic', flags: 0, tokens: [] },

    // Passive
    { dumpType: 'r', label: 'Resistor', category: 'Passive', flags: 0, tokens: ['1000'] },
    { dumpType: 'c', label: 'Capacitor', category: 'Passive', flags: 0, tokens: ['0.000001'] },
    { dumpType: 'l', label: 'Inductor', category: 'Passive', flags: 0, tokens: ['0.01'] },
    { dumpType: '174', label: 'Potentiometer', category: 'Passive', flags: 0, tokens: ['1000', '0.5'] },
    { dumpType: 's', label: 'Switch', category: 'Passive', flags: 0, tokens: [] },
    { dumpType: 'S', label: 'SPDT Switch', category: 'Passive', flags: 0, tokens: ['0', 'false', '0', '2'] },

    // Sources ("Power" -- mirrors Menus.java's "Inputs and Sources" menu).
    // ACRailElm/SquareRailElm/NoiseElm need no dedicated engine class -- Java
    // dumps all three as plain RailElm (getDumpClass() override), so they're
    // presets of dumpType 'R' with a different default waveform token, same
    // as how DC/AC Voltage Source above are both dumpType 'v'.
    { dumpType: 'v', label: 'DC Voltage Source', category: 'Sources', flags: 0, tokens: ['0', '40', '5', '0', '0'] },
    { dumpType: 'v', label: 'AC Voltage Source', category: 'Sources', flags: 0, tokens: ['1', '40', '5', '0', '0'] },
    { dumpType: 'R', label: 'Rail (fixed voltage)', category: 'Sources', flags: 0, tokens: ['0', '40', '5'] },
    { dumpType: 'R', label: 'A/C Voltage Source (1-terminal)', category: 'Sources', flags: 0, tokens: ['1', '40', '169.7'] },
    { dumpType: 'R', label: 'Square Wave (1-terminal)', category: 'Sources', flags: 0, tokens: ['2', '40', '5'] },
    { dumpType: 'R', label: 'Noise Generator', category: 'Sources', flags: 0, tokens: ['6', '40', '5'] },
    { dumpType: '164', label: 'Clock', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: '172', label: 'Variable Voltage', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: 'A', label: 'Antenna', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: '170', label: 'Sweep (frequency source)', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: '200', label: 'AM Source', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: '201', label: 'FM Source', category: 'Sources', flags: 0, tokens: [] },
    { dumpType: 'i', label: 'Current Source', category: 'Sources', flags: 0, tokens: ['0.01', '0'] },

    // Outputs
    { dumpType: 'O', label: 'Voltage Output', category: 'Outputs', flags: 0, tokens: [] },
    { dumpType: 'p', label: 'Probe', category: 'Outputs', flags: 0, tokens: [] },
    { dumpType: '370', label: 'Ammeter', category: 'Outputs', flags: 0, tokens: ['0', '0'] },

    // Semiconductors
    { dumpType: 'd', label: 'Diode', category: 'Semiconductors', flags: 0, tokens: [] },
    { dumpType: 'z', label: 'Zener Diode', category: 'Semiconductors', flags: 0, tokens: [] },
    { dumpType: '162', label: 'LED', category: 'Semiconductors', flags: 0, tokens: [] },
    { dumpType: 't', label: 'Transistor (NPN)', category: 'Semiconductors', flags: 0, tokens: ['1'] },
    { dumpType: 't', label: 'Transistor (PNP)', category: 'Semiconductors', flags: 0, tokens: ['-1'] },
    { dumpType: 'f', label: 'MOSFET (N-ch)', category: 'Semiconductors', flags: 0, tokens: [] },
    { dumpType: 'f', label: 'MOSFET (P-ch)', category: 'Semiconductors', flags: 1, tokens: [] },

    // Active building blocks
    { dumpType: 'a', label: 'Op-Amp', category: 'Active', flags: 0, tokens: [] },
    // OpAmpSwapElm in Java: a thin subclass that just sets FLAG_SWAP=1 at
    // construction and dumps/reloads AS a plain OpAmpElm (getDumpClass()) --
    // no separate TS class needed, only this preset (see opamp.ts's
    // FLAG_SWAP constant).
    { dumpType: 'a', label: 'Op-Amp (+ on top)', category: 'Active', flags: 1, tokens: [] },
    // Dependent sources (batch 1) -- fixed-gain SPICE-style controlled
    // sources (see dependent_sources.ts's simplification note). Default
    // tokens match each class's own defaultGain fallback closely enough to
    // be a sane starting point once placed and edited via the inspector.
    { dumpType: '213', label: 'VCCS (Voltage-Controlled Current Source)', category: 'Active', flags: 0, tokens: ['0.01'] },
    { dumpType: '212', label: 'VCVS (Voltage-Controlled Voltage Source)', category: 'Active', flags: 0, tokens: ['2'] },
    { dumpType: '214', label: 'CCVS (Current-Controlled Voltage Source)', category: 'Active', flags: 0, tokens: ['100'] },
    { dumpType: '215', label: 'CCCS (Current-Controlled Current Source)', category: 'Active', flags: 0, tokens: ['10'] },
    // Switches, Schmitt triggers, comparator, OTA (batch 2). Empty token
    // arrays deliberately fall through to each constructor's own
    // fresh-placement defaults (see schmitt.ts/analog_switch.ts/
    // comparator.ts/ota.ts) rather than duplicating those defaults here.
    { dumpType: '183', label: 'Schmitt Trigger (inverting)', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '182', label: 'Schmitt Trigger', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '159', label: 'Analog Switch', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '160', label: 'Analog Switch (SPDT)', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '401', label: 'Comparator', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '402', label: 'OTA (Transconductance Amp)', category: 'Active', flags: 0, tokens: [] },
    // Tri-state buffer, delay buffer, time-delay relay (batch 3). Current
    // conveyors (CC2Elm/CC2NegElm) are intentionally excluded from this
    // port -- see docs/react-rewrite-plan.md's Analog group scoping note.
    { dumpType: '180', label: 'Tri-State Buffer', category: 'Active', flags: 0, tokens: [] },
    { dumpType: '422', label: 'Delay Buffer', category: 'Active', flags: 0, tokens: ['0.1', '2.5', '5'] },
    { dumpType: '414', label: 'Time Delay Relay', category: 'Active', flags: 0, tokens: [] },

    // Logic gates
    { dumpType: '150', label: 'AND Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: '151', label: 'NAND Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: '152', label: 'OR Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: '153', label: 'NOR Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: '154', label: 'XOR Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: '431', label: 'XNOR Gate', category: 'Logic', flags: 0, tokens: ['2'] },
    { dumpType: 'I', label: 'Inverter', category: 'Logic', flags: 0, tokens: [] },
    { dumpType: 'L', label: 'Logic Input', category: 'Logic', flags: 0, tokens: [] },
    { dumpType: 'M', label: 'Logic Output', category: 'Logic', flags: 0, tokens: [] },
];

export const CATEGORIES: string[] = Array.from(new Set(PALETTE.map(p => p.category)));
