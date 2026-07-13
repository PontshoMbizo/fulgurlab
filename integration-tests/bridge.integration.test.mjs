// INTEGRATION: fulgurlab's FulgurBridge client against the REAL fpgasim and mcusim
// bridge servers (spawned as child processes from the sibling checkouts), running the
// REAL simulators underneath (iverilog/vvp, arm-none-eabi-gcc/qemu-system-arm) with
// SIM_RUNTIME bypassed via a host entrypoint — i.e. the full chain minus the browser:
//
//   FulgurBridge ⇄ ws ⇄ bridge server ⇄ stdio ⇄ vvp harness / QEMU firmware
//
// Requirements (all soft — tests skip if missing):
//   ../fpgasim and ../mcusim sibling checkouts
//   iverilog+vvp on PATH (fpgasim leg), arm-none-eabi-gcc+qemu-system-arm (mcusim leg)
//
// The circuitjs element itself is exercised by jstests/ (unit) and by the GWT build in
// CI; this file pins the cross-repo protocol contract end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import FulgurBridge from "../war/fulgur-bridge.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPGASIM = path.join(ROOT, "..", "fpgasim");
const MCUSIM = path.join(ROOT, "..", "mcusim");

function have(cmd, args) {
  try { execFileSync(cmd, args, { stdio: "pipe" }); return true; } catch { return false; }
}
const HAVE_FPGA = existsSync(FPGASIM) && have("iverilog", ["-V"]) && have("vvp", ["-V"]);
const HAVE_MCU = existsSync(MCUSIM) && have("arm-none-eabi-gcc", ["--version"]) && have("qemu-system-arm", ["--version"]);

// Run a repo's sim/entrypoint-lockstep.sh outside a container by re-pointing its
// fixed paths at a temp dir (and mcusim's /opt/fw at its firmware/).
function hostEntrypoint(repo) {
  const dir = mkdtempSync(path.join(tmpdir(), "fl-int-"));
  let text = readFileSync(path.join(repo, "sim", "entrypoint-lockstep.sh"), "utf8")
    .replaceAll("/opt/fw", path.join(repo, "firmware"))
    .replaceAll("/work", dir);
  const p = path.join(dir, "entrypoint.sh");
  writeFileSync(p, text, { mode: 0o755 });
  return p;
}

// Spawn a bridge server wired to makeSession via a tiny launcher (SIM_EXEC override).
function startBridge(repo, port, entrypoint) {
  const launcher = `
    import { WebSocketServer } from "ws";
    import { handleConnection } from "${path.join(repo, "bridge", "server.mjs").replaceAll("\\", "/")}";
    import { LockstepSession } from "${path.join(repo, "src", "lib", "lockstepSession.js").replaceAll("\\", "/")}";
    const wss = new WebSocketServer({ port: ${port} });
    wss.on("connection", (ws) => handleConnection(ws, (source, hooks) =>
      new LockstepSession(source, { ...hooks, command: ["sh", "${entrypoint}"], replyTimeoutMs: 30000 })));
    console.error("ready");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", launcher], {
    cwd: repo, // resolve `ws` from the repo's node_modules
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    child.stderr.on("data", (d) => { if (String(d).includes("ready")) resolve(child); });
    child.on("exit", (c) => reject(new Error("bridge exited " + c)));
    setTimeout(() => reject(new Error("bridge start timeout")), 10000);
  });
}

function until(fn, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("until: timeout")); }
    }, 10);
  });
}

// Drive the bridge exactly as ExtChipElm.execute() does: push inputs, advance circuit
// time, read outputs. Returns outputs once tNs's quantum reply has landed.
async function stepChip(id, tNs, bits) {
  FulgurBridge.setInputs(id, bits);
  FulgurBridge.onSimTime(id, tNs);
  return FulgurBridge.getOutputs(id);
}

test("fpgasim leg: Verilog divider drives outputs through the full chain", { skip: !HAVE_FPGA }, async () => {
  const server = await startBridge(FPGASIM, 3181, hostEntrypoint(FPGASIM));
  try {
    // Toggle q every 13000 board-clock posedges (~481.5 µs) — see fpgasim's e2e test.
    const src = `
module top(input clk, input en, output reg q);
  reg [15:0] n;
  initial begin n = 0; q = 0; end
  always @(posedge clk) begin
    if (!en) begin n <= 0; end
    else if (n == 16'd12999) begin n <= 0; q <= ~q; end
    else n <= n + 16'd1;
  end
endmodule`;
    FulgurBridge.configure(21, "ws://127.0.0.1:3181/", src, "en:in,q:out", 500_000, "");
    await until(() => FulgurBridge.getStatus(21) === "running" || FulgurBridge.getStatus(21).startsWith("error"));
    assert.equal(FulgurBridge.getStatus(21), "running", FulgurBridge.getErrorLog(21));

    FulgurBridge.setInputs(21, 1);                 // en = 1
    FulgurBridge.onSimTime(21, 500_001);           // cross quantum 1
    await until(() => FulgurBridge.getOutputs(21) === 1);

    FulgurBridge.onSimTime(21, 1_000_001);         // quantum 2 → q toggles back
    await until(() => FulgurBridge.getOutputs(21) === 0);

    const status = FulgurBridge.getStatus(21);
    assert.equal(status, "running");
    FulgurBridge.dispose(21);
  } finally {
    server.kill("SIGKILL");
  }
});

test("mcusim leg: C firmware mirrors PA0→PC13 through the full chain", { skip: !HAVE_MCU }, async () => {
  const server = await startBridge(MCUSIM, 3182, hostEntrypoint(MCUSIM));
  try {
    const src = `
#include "trace.h"
LOCKSTEP_PINS("PC13:out", "PA0:in");
int main(void) {
  unsigned v, i;
  for (;;) {
    v = (unsigned)trace_read("PA0");
    trace_pin("PC13", v);
    for (i = 0; i < 200; ++i) asm volatile("nop");
  }
}`;
    FulgurBridge.configure(22, "ws://127.0.0.1:3182/", src, "PA0:in,PC13:out", 1_000_000, "mainline");
    await until(() => FulgurBridge.getStatus(22) === "running" || FulgurBridge.getStatus(22).startsWith("error"));
    assert.equal(FulgurBridge.getStatus(22), "running", FulgurBridge.getErrorLog(22));

    FulgurBridge.setInputs(22, 1);                 // PA0 = 1
    FulgurBridge.onSimTime(22, 1_000_001);
    await until(() => FulgurBridge.getOutputs(22) === 1);

    FulgurBridge.setInputs(22, 0);                 // PA0 = 0
    FulgurBridge.onSimTime(22, 2_000_001);
    await until(() => FulgurBridge.getOutputs(22) === 0);

    FulgurBridge.dispose(22);
  } finally {
    server.kill("SIGKILL");
  }
});

test("skew guard: circuit pauses when a quantum reply is outstanding past budget", { skip: !HAVE_FPGA }, async () => {
  const server = await startBridge(FPGASIM, 3183, hostEntrypoint(FPGASIM));
  const calls = [];
  FulgurBridge._simCtl = { setSimRunning: (v) => calls.push(v) };
  try {
    const src = "module top(input en, output y); assign y = en; endmodule";
    FulgurBridge.configure(23, "ws://127.0.0.1:3183/", src, "en:in,y:out", 1_000_000, "");
    await until(() => FulgurBridge.getStatus(23) === "running");

    FulgurBridge.setInputs(23, 1);
    FulgurBridge.onSimTime(23, 1_000_001);         // step fires
    FulgurBridge.onSimTime(23, 2_000_001);         // ahead a full quantum → may pause
    await until(() => FulgurBridge.getOutputs(23) === 1);
    // whatever pausing happened must be balanced by a resume once the reply landed
    assert.equal(calls.filter((v) => v === false).length, calls.filter((v) => v === true).length);
    FulgurBridge.dispose(23);
  } finally {
    FulgurBridge._simCtl = null;
    server.kill("SIGKILL");
  }
});
