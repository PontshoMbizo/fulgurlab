// Defaults for a freshly-placed ExtChipElm (dump type 460) -- shared by
// ExtChipDrawer.tsx (falls back to these whenever the element's own fields
// are empty/unset, e.g. a brand-new placement whose constructor never saw
// any dump tokens) and, per the task brief, by the palette entry the lead
// agent wires up separately (this module is the one source of truth for
// "what does a fresh FPGA chip look like").

// The SAME default design fpgasim's own standalone editor ships
// (src/lib/templateDefaults.js's DEFAULT_DESIGN, Tang Nano 9K's real onboard
// S1/S2 buttons + 6-LED bar) -- placing this chip and clicking Apply gives
// the exact same demo behavior as the standalone simulator, just wired
// through a real analog circuit instead of a plain waveform view. `clk` is
// NOT a bridge pin: fpgasim's own harness auto-drives the `clk` port of
// `top` directly from the lockstep quantum clock (see
// docs/bridge-protocol.md's "auto-clock convention") -- only btn1/btn2/leds
// appear in TANG_NANO_9K_PIN_SPEC below.
export const DEFAULT_FPGA_SOURCE = `module top(
    input clk,
    input btn1,
    input btn2,
    output reg [5:0] leds
);

  // Simple clock divider for visual testing
  reg [24:0] counter;
  always @(posedge clk) begin
    counter <= counter + 1;
  end

  always @(posedge clk) begin
    if (!btn1)
      leds <= 6'b111111;
    else if (!btn2)
      leds <= 6'b000000;
    else
      leds <= counter[24:19];
  end

endmodule
`;

// Net names/order/direction lifted straight from boards/tangnano9k.js's
// PERIPHERAL_PINS (fpgasim repo) for the two onboard buttons + 6 LEDs --
// this is what "Load Tang Nano 9K pinout" in ExtChipDrawer.tsx writes into
// Pin spec, so a fresh chip's ports line up with DEFAULT_FPGA_SOURCE above
// (and with anything else written against the standalone board's own net
// names) without the user having to hand-type them.
export const TANG_NANO_9K_PIN_SPEC = "btn1:in,btn2:in,leds[0]:out,leds[1]:out,leds[2]:out,leds[3]:out,leds[4]:out,leds[5]:out";

export interface ExtChipDefaultConfig {
    url: string;
    quantumNs: number;
    pinSpec: string;
}

export const DEFAULT_FPGA_CONFIG: ExtChipDefaultConfig = {
    url: process.env.NEXT_PUBLIC_FPGASIM_BRIDGE ?? "ws://localhost:3100",
    quantumNs: 1_000_000,
    pinSpec: TANG_NANO_9K_PIN_SPEC,
};
