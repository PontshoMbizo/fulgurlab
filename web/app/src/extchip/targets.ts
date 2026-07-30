// Co-simulation target catalogue -- one descriptor per kind of board the
// firmware editor can build for, and the single source of truth for "what
// does a freshly-placed co-sim chip look like".
//
// Supersedes preset.ts, which only ever described the Tang Nano and only as
// drawer field defaults. Everything here is consumed by three places: the
// palette (placement tokens), editor/FirmwareEditorPane.tsx (Monaco language,
// default source, clock presets, wiring notes) and the bridge client (url,
// quantum, engine name).
//
// A target is NOT the authority on pins. It ships a `defaultPinSpec` so a
// chip has real, wireable posts the instant it is placed and so a saved
// circuit reloads correctly with the backend down -- but the moment the user
// compiles, `created.pins` from the backend replaces it wholesale. See
// engineStore.setExtChipPins().

export interface ClockPreset {
    label: string;
    hz: number;
}

export interface CoSimTarget {
    /** Stable key, dumped as the element's `targetId` token. */
    id: string;
    label: string;
    /** Must match the backend's `welcome.backend` string. */
    backend: "fpgasim" | "mcusim";
    defaultUrl: string;
    /** Monaco language id. "verilog" and "c" are both built-in basic languages. */
    monacoLanguage: string;
    /**
     * What the backend calls the file it compiles. Compile diagnostics come
     * back as "<compileUnitName>:<line>: ...", so this is what
     * extchip/compileLog.ts matches to turn a log into editor markers.
     */
    compileUnitName: string;
    defaultSource: string;
    defaultPinSpec: string;
    defaultQuantumNs: number;
    /** Synthesized board clock. 0 = the backend picks (mcusim has no synth clock). */
    defaultClockHz: number;
    clockPresets: ClockPreset[];
    /** proto v1 `create.config.engine`. */
    engineName: string;
    /**
     * Shown in the editor pane. Load-bearing, not decoration: our chip drives
     * push-pull 0/3.3V, so a user who wires to the real board's active-LOW
     * convention gets inverted behaviour and concludes the simulator is broken.
     */
    wiringNotes: string[];
}

// Active-HIGH, deliberately UNLIKE the real Tang Nano 9K (whose LEDs and
// buttons are both active-LOW, pulled up by 10K on-board resistors).
// ExtChipElm drives push-pull 0/3.3V behind a small output resistance and
// thresholds its inputs, so active-HIGH is the convention that matches what a beginner
// actually builds on the canvas: pin -> resistor -> LED -> ground, and
// 3V3 -> switch -> pin. fpgasim's own standalone editor keeps the real
// board's active-LOW default; the divergence is intentional and is called
// out in wiringNotes below.
const TANG_NANO_SOURCE = `module top(
    input clk,
    input btn1,
    input btn2,
    output reg [5:0] leds
);

  // At the default 1 MHz board clock, bit 21 toggles about every 2 s, so
  // leds[5:0] reads as a slow running binary count.
  reg [21:0] counter;
  always @(posedge clk) counter <= counter + 1;

  always @(posedge clk) begin
    if (btn1)
      leds <= 6'b111111;      // all on
    else if (btn2)
      leds <= 6'b000000;      // all off
    else
      leds <= counter[21:16]; // running count
  end

endmodule
`;

const BLUE_PILL_SOURCE = `#include "trace.h"

// Every pin the circuit can see must be declared here. Outputs are driven
// with trace_pin(), inputs are sampled with trace_read().
LOCKSTEP_PINS("PC13:out", "PA0:in");

int main(void) {
    unsigned t = 0;
    for (;;) {
        if (trace_read("PA0")) {
            trace_pin("PC13", 1);   // button held: LED solid on
        } else {
            trace_pin("PC13", (t >> 12) & 1);   // otherwise blink
        }
        t++;
    }
}
`;

// Net names/order lifted from fpgasim's boards/tangnano9k.js PERIPHERAL_PINS
// (the two on-board buttons + the 6-LED bar), so a design written against the
// standalone simulator's net names lines up here without renaming anything.
// The buttons carry 10k PULL-DOWNS. Without a pull, an input wired only to a
// switch floats when the switch is open, the Analyzer shunts it to ground
// through 1e8 ohm, and the button reads the same pressed or not -- i.e. the
// shipped demo would appear broken. Pull-DOWN rather than the real board's
// pull-up because this default source is active-HIGH: wire 3V3 -> switch ->
// pin and pressing reads 1, which is what the Verilog below expects.
export const TANG_NANO_9K_PIN_SPEC =
    "btn1:in:pd10k,btn2:in:pd10k,leds[0]:out,leds[1]:out,leds[2]:out,leds[3]:out,leds[4]:out,leds[5]:out";

export const BLUE_PILL_PIN_SPEC = "PA0:in:pd10k,PC13:out";

export const TARGETS: CoSimTarget[] = [
    {
        id: "tangnano9k",
        label: "FPGA — Tang Nano 9K",
        backend: "fpgasim",
        defaultUrl: process.env.NEXT_PUBLIC_FPGASIM_BRIDGE ?? "ws://localhost:3100",
        monacoLanguage: "verilog",
        compileUnitName: "top.v",
        defaultSource: TANG_NANO_SOURCE,
        defaultPinSpec: TANG_NANO_9K_PIN_SPEC,
        defaultQuantumNs: 1_000_000,
        // NOT the real board's 27 MHz. A 1 ms quantum at 27 MHz is 54,000
        // clock-edge events for vvp per rendezvous, before the design does any
        // work -- which is what made co-simulation unusably slow. 1 MHz keeps
        // the same designs working roughly 27x cheaper. Pick 27 MHz below only
        // when a design's timing genuinely depends on it.
        defaultClockHz: 1_000_000,
        clockPresets: [
            { label: "10 kHz — slowest, cheapest", hz: 10_000 },
            { label: "100 kHz", hz: 100_000 },
            { label: "1 MHz — default", hz: 1_000_000 },
            { label: "27 MHz — real board, slow", hz: 27_000_000 },
        ],
        engineName: "",
        wiringNotes: [
            "Outputs are push-pull 0 / 3.3 V; inputs switch at 1.65 V.",
            "LED: pin → 220 Ω → LED anode, cathode → ground.",
            "Button: 3V3 → switch → pin. The default pins already carry 10k pull-downs.",
            "Active-HIGH, unlike the real board — its LEDs and buttons are active-LOW.",
            "clk is driven by the backend and is not a bridge pin, so it has no post.",
        ],
    },
    {
        id: "bluepill",
        label: "MCU — STM32 Blue Pill",
        backend: "mcusim",
        defaultUrl: process.env.NEXT_PUBLIC_MCUSIM_BRIDGE ?? "ws://localhost:3101",
        monacoLanguage: "c",
        compileUnitName: "user.c",
        defaultSource: BLUE_PILL_SOURCE,
        defaultPinSpec: BLUE_PILL_PIN_SPEC,
        defaultQuantumNs: 1_000_000,
        // mcusim has no synthesized clock to configure: virtual time is
        // tick_count x quantum_ns and the core rate comes from the engine
        // choice (mainline models an F100 @ 24 MHz, xpack an F103 @ 72 MHz).
        defaultClockHz: 0,
        clockPresets: [],
        engineName: "mainline",
        wiringNotes: [
            "Outputs are push-pull 0 / 3.3 V; inputs switch at 1.65 V.",
            "Pins are whatever LOCKSTEP_PINS() declares — edit it and recompile.",
            "Core speed follows the engine (mainline = F100 @ 24 MHz), not a clock setting.",
        ],
    },
];

export const DEFAULT_TARGET_ID = TARGETS[0].id;

/** Falls back to the first target so a dump with an unknown/blank id still opens. */
export function targetById(id: string | null | undefined): CoSimTarget {
    return TARGETS.find((t) => t.id === id) ?? TARGETS[0];
}

/**
 * Best-effort target guess for a chip saved before targetId existed (or one
 * hand-edited to point somewhere else): match on the bridge URL's port.
 */
export function targetForUrl(url: string): CoSimTarget | null {
    let port = "";
    try {
        port = new URL(url).port;
    } catch {
        return null;
    }
    if (!port) return null;
    return TARGETS.find((t) => {
        try {
            return new URL(t.defaultUrl).port === port;
        } catch {
            return false;
        }
    }) ?? null;
}
