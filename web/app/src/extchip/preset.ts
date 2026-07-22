// Defaults for a freshly-placed ExtChipElm (dump type 460) -- shared by
// ExtChipDrawer.tsx (falls back to these whenever the element's own fields
// are empty/unset, e.g. a brand-new placement whose constructor never saw
// any dump tokens) and, per the task brief, by the palette entry the lead
// agent wires up separately (this module is the one source of truth for
// "what does a fresh FPGA chip look like").

// A clean, synthesizable 27MHz-clock divider blinky -- deliberately the
// simplest possible fpgasim smoke-test module: one clock in, one LED out,
// nothing else to misconfigure. `clk` is NOT a bridge pin: fpgasim's own
// harness auto-drives the `clk` port of `top` directly from the lockstep
// quantum clock (see docs/bridge-protocol.md's "auto-clock convention") --
// only `led` ever needs to appear in this chip's pinSpec ("led:out"), and
// bridgeUrl/pinSpec/quantumNs below assume exactly that split.
export const DEFAULT_FPGA_SOURCE = `module top #(
    parameter DIVIDER = 27_000_000
) (
    input  wire clk,   // driven by the fpgasim harness -- NOT a bridge pin
    output reg  led
);
    reg [31:0] counter = 32'd0;

    initial led = 1'b0;

    always @(posedge clk) begin
        if (counter >= DIVIDER - 1) begin
            counter <= 32'd0;
            led <= ~led;
        end else begin
            counter <= counter + 32'd1;
        end
    end
endmodule
`;

export interface ExtChipDefaultConfig {
    url: string;
    quantumNs: number;
    pinSpec: string;
}

export const DEFAULT_FPGA_CONFIG: ExtChipDefaultConfig = {
    url: process.env.NEXT_PUBLIC_FPGASIM_BRIDGE ?? "ws://localhost:3100",
    quantumNs: 1_000_000,
    pinSpec: "",
};
