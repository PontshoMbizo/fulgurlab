import { describe, it, expect, vi } from "vitest";
import { createElement } from "@fulgurlab/engine/src/core/factory";
import { undumpCompositeModel } from "@fulgurlab/engine/src/elements/composite";
import { PALETTE, CATEGORIES, EXCLUDED_FROM_PALETTE, CAT_COSIM, type PaletteItem } from "./palette";

// PALETTE PARITY (TODO.md P1-2): the palette listed 61 entries against the Java
// draw menu's 143. These tests pin the two together by Java CLASS NAME (the
// `alias` field), so a preset that shares a dump id with another entry still
// counts once, and they additionally require every entry to actually CONSTRUCT
// through the engine factory with its declared flags/tokens -- a label pointing
// at a broken token list is worse than a missing label.

// Menus.java composeMainMenu()'s full item list, transcribed verbatim (class
// name only; the labels live in palette.ts). Order within a submenu is Java's.
const JAVA_DRAW_MENU: string[] = [
    // top-level
    "WireElm", "RoutedWireElm", "ResistorElm",
    // passMenuBar
    "CapacitorElm", "PolarCapacitorElm", "InductorElm", "SwitchElm", "PushSwitchElm",
    "Switch2Elm", "DPDTSwitchElm", "MBBSwitchElm", "PotElm", "TransformerElm",
    "TappedTransformerElm", "CustomTransformerElm", "TransLineElm", "RelayElm",
    "RelayCoilElm", "RelayContactElm", "LDRElm", "ThermistorNTCElm", "MemristorElm",
    "SparkGapElm", "FuseElm", "CrystalElm", "CrossSwitchElm", "GyratorElm",
    // inputMenuBar
    "GroundElm", "DCVoltageElm", "ACVoltageElm", "RailElm", "ACRailElm", "SquareRailElm",
    "ClockElm", "SweepElm", "VarRailElm", "AntennaElm", "AMElm", "FMElm", "CurrentElm",
    "NoiseElm", "AudioInputElm", "DataInputElm", "ExtVoltageElm",
    // outputMenuBar
    "OutputElm", "LEDElm", "LampElm", "TextElm", "BoxElm", "LineElm", "LabeledNodeElm",
    "ProbeElm", "OhmMeterElm", "AmmeterElm", "WattmeterElm", "TestPointElm",
    "DecimalDisplayElm", "InstructionDisplayElm", "LEDArrayElm", "DataRecorderElm",
    "AudioOutputElm", "StopTriggerElm", "DCMotorElm", "ThreePhaseMotorElm",
    // activeMenuBar
    "DiodeElm", "ZenerElm", "NTransistorElm", "PTransistorElm", "NMosfetElm",
    "PMosfetElm", "NJfetElm", "PJfetElm", "SCRElm", "DiacElm", "TriacElm",
    "NDarlingtonElm", "PDarlingtonElm", "VaractorElm", "TunnelDiodeElm", "TriodeElm",
    "UnijunctionElm",
    // gateMenuBar
    "LogicInputElm", "LogicOutputElm", "BusLogicInputElm", "InverterElm", "NandGateElm",
    "NorGateElm", "AndGateElm", "OrGateElm", "XorGateElm", "XnorGateElm",
    // chipMenuBar
    "DFlipFlopElm", "JKFlipFlopElm", "TFlipFlopElm", "SevenSegElm", "SevenSegDecoderElm",
    "MultiplexerElm", "DeMultiplexerElm", "SipoShiftElm", "PisoShiftElm", "CounterElm",
    "Counter2Elm", "DecadeElm", "LatchElm", "SeqGenElm", "FullAdderElm", "HalfAdderElm",
    "UserDefinedLogicElm", "ExtChipElm", "SRAMElm", "ROMElm", "BusTransceiverElm",
    "BusSplitterElm",
    // achipMenuBar
    "TimerElm", "PhaseCompElm", "DACElm", "ADCElm", "VCOElm", "MonostableElm",
    // activeBlocMenuBar
    "OpAmpElm", "OpAmpSwapElm", "OpAmpRealElm", "AnalogSwitchElm", "AnalogSwitch2Elm",
    "AnalogMuxElm", "TriStateElm", "SchmittElm", "InvertingSchmittElm", "DelayBufferElm",
    "CC2Elm", "CC2NegElm", "ComparatorElm", "OTAElm", "VCVSElm", "VCCSElm", "CCVSElm",
    "CCCSElm", "OptocouplerElm", "TimeDelayRelayElm", "CustomCompositeElm:~LM317-v2",
    "CustomCompositeElm:~TL431", "MotorProtectionSwitchElm", "CustomCompositeElm",
    // otherMenuBar (mouse modes, not elements)
    "DragAll", "DragRow", "DragColumn", "DragSelected", "DragPost", "Select",
];

function aliases(): Set<string> {
    return new Set(PALETTE.map((p) => p.alias).filter((a): a is string => !!a));
}

describe("palette parity with Menus.java's draw menu", () => {
    it("accounts for every Java draw-menu entry (offered or explicitly excluded)", () => {
        const offered = aliases();
        const unaccounted = JAVA_DRAW_MENU.filter(
            (cls) => !offered.has(cls) && !(cls in EXCLUDED_FROM_PALETTE));
        expect(unaccounted).toEqual([]);
    });

    it("offers no entry that is also on the exclusion list", () => {
        const offered = aliases();
        const contradictions = Object.keys(EXCLUDED_FROM_PALETTE).filter((c) => offered.has(c));
        expect(contradictions).toEqual([]);
    });

    it("every exclusion names a real Java menu entry and gives a reason", () => {
        for (const [cls, reason] of Object.entries(EXCLUDED_FROM_PALETTE)) {
            expect(JAVA_DRAW_MENU, `${cls} is excluded but is not in the Java menu`).toContain(cls);
            expect(reason.length).toBeGreaterThan(10);
        }
    });

    it("covers substantially more of the menu than the pre-parity palette did", () => {
        // The transcribed menu has 149 entries; 15 of them are unplaceable,
        // mouse modes, or legacy aliases (EXCLUDED_FROM_PALETTE), leaving 134
        // real elements -- all of which are offered. The palette was 61 entries
        // before this.
        expect(JAVA_DRAW_MENU.length).toBe(149);
        const placeable = JAVA_DRAW_MENU.filter((c) => !(c in EXCLUDED_FROM_PALETTE));
        expect(placeable.length).toBe(134);
        expect(aliases().size).toBeGreaterThanOrEqual(134);
    });

    it("has no duplicate aliases and every entry declares one", () => {
        // The rule is scoped to the section transcribed from Menus.java, where
        // it catches copy-paste slips: there, two entries of the same class are
        // always distinct Java getDumpClass() subclasses (RailElm/ACRailElm,
        // NMosfetElm/PMosfetElm) and so always have distinct aliases.
        //
        // CAT_COSIM is fulgurlab's own category, not transcribed from anything.
        // Java had exactly one ExtChipElm; we offer one preset per co-simulation
        // target (extchip/targets.ts), all of the same class and distinguished
        // only by tokens -- which "presets that share a dump id produce
        // distinguishable elements" below is the test that actually guards.
        // Uniqueness here would force a fake alias per board for no benefit:
        // the alias's real job is the JAVA_DRAW_MENU coverage check, which
        // duplicates cannot weaken.
        const seen = new Set<string>();
        for (const p of PALETTE) {
            expect(p.alias, `entry "${p.label}" has no alias`).toBeTruthy();
            if (p.category === CAT_COSIM) continue;
            expect(seen.has(p.alias!), `duplicate alias ${p.alias}`).toBe(false);
            seen.add(p.alias!);
        }
    });

    // REGRESSION: the single co-sim entry used to carry `tokens: []`, so the
    // element's pinSpec defaulted to "" and getPostCount() returned 0. The
    // board landed on the canvas as an inert picture with no posts -- nothing
    // to wire to until the user found the config panel and hit Apply. The
    // "every entry constructs" test above passed the whole time, because a
    // zero-post element constructs perfectly well.
    it("co-simulated boards are placed with real, wireable posts", () => {
        const cosim = PALETTE.filter((p) => p.category === CAT_COSIM);
        expect(cosim.length).toBeGreaterThanOrEqual(2);
        for (const p of cosim) {
            const elm = createElement(p.dumpType, 0, 0, 64, 0, p.flags, p.tokens)!;
            expect(elm.getPostCount(), `${p.label} placed with no posts`).toBeGreaterThan(0);
        }
    });

    it("every entry's category is a declared category", () => {
        for (const p of PALETTE) expect(CATEGORIES).toContain(p.category);
    });

    it("every declared category actually has entries", () => {
        for (const c of CATEGORIES) {
            expect(PALETTE.filter((p) => p.category === c).length,
                `category "${c}" is empty`).toBeGreaterThan(0);
        }
    });

    it("has no duplicate labels (they are the flyout's only user-visible key)", () => {
        const labels = PALETTE.map((p) => p.label);
        expect(labels.length).toBe(new Set(labels).size);
    });
});

describe("palette entries construct through the engine factory", () => {
    it("every entry builds a real element with its declared flags and tokens", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        // The Subcircuit Instance entry needs a "." model registered first --
        // that is by design (see composite.ts), so give it the trivial default
        // model Java ships built in.
        undumpCompositeModel(["default", "0", "1", "1", "1", "gnd", "1", "0", "2",
            "GroundElm\\s1", "0"]);

        const failures: string[] = [];
        for (const p of PALETTE) {
            let elm = null;
            try {
                elm = createElement(p.dumpType, 0, 0, 64, 0, p.flags, p.tokens);
            } catch (e) {
                failures.push(`${p.label} (${p.dumpType}) threw: ${e}`);
                continue;
            }
            if (!elm) failures.push(`${p.label} (${p.dumpType}) returned null`);
        }
        warn.mockRestore();
        error.mockRestore();
        expect(failures).toEqual([]);
    });

    it("presets that share a dump id produce distinguishable elements", () => {
        // The whole point of a preset is that flags/tokens change behaviour; if
        // two entries with the same dumpType built identical elements, one of
        // them would be dead weight in the flyout.
        const byType = new Map<string, PaletteItem[]>();
        for (const p of PALETTE) {
            if (!byType.has(p.dumpType)) byType.set(p.dumpType, []);
            byType.get(p.dumpType)!.push(p);
        }
        for (const [dumpType, items] of byType) {
            if (items.length < 2) continue;
            const shapes = items.map((p) => JSON.stringify([p.flags, p.tokens]));
            expect(new Set(shapes).size,
                `dump type ${dumpType} has ${items.length} entries but only ` +
                `${new Set(shapes).size} distinct flag/token shapes`).toBe(items.length);
        }
    });

    it("the counter preset really builds a multi-post CounterElm (guards TODO P0-1)", () => {
        const counter = PALETTE.find((p) => p.alias === "CounterElm")!;
        const elm = createElement(counter.dumpType, 0, 0, 64, 0, counter.flags, counter.tokens)!;
        expect(elm).toBeTruthy();
        expect(String(elm.getDumpType())).toBe("164");
        // 4 bits -> clock + reset + 4 Q outputs.
        expect(elm.getPostCount()).toBe(6);
    });

    it("the clock preset builds a 1-post flagged rail, not a dump type of its own", () => {
        const clock = PALETTE.find((p) => p.alias === "ClockElm")!;
        expect(clock.dumpType).toBe("R");
        const elm = createElement(clock.dumpType, 0, 0, 64, 0, clock.flags, clock.tokens)!;
        expect(elm.getPostCount()).toBe(1);
        expect(elm.flags & 1).toBeTruthy(); // RailElm.FLAG_CLOCK
    });
});
