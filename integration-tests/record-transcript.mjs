// TRANSCRIPT RECORDER for the bridge replay tests (TODO.md P1-5).
//
// Connects to a REAL fpgasim/mcusim bridge server, drives one session by hand,
// and writes every backend frame out as a replay transcript that
// web/app/test-utils/fakeBackend.mjs can serve. That is what lets the bridge
// integration tests run everywhere instead of skipping without containers.
//
//   node integration-tests/record-transcript.mjs fpgasim
//   node integration-tests/record-transcript.mjs mcusim
//
// Requires the sibling checkout plus its toolchain (iverilog/vvp for fpgasim,
// arm-none-eabi-gcc/qemu-system-arm for mcusim). The recorded transcripts are
// committed, so this only needs re-running when the protocol changes.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "integration-tests", "transcripts");

const WHICH = process.argv[2];
if (!["fpgasim", "mcusim"].includes(WHICH)) {
    console.error("usage: node record-transcript.mjs <fpgasim|mcusim>");
    process.exit(2);
}
const REPO = path.join(ROOT, "..", WHICH);
if (!existsSync(REPO)) {
    console.error(`error: sibling checkout ${REPO} not found`);
    process.exit(2);
}

const CASES = {
    fpgasim: {
        out: "fpgasim-divider.json",
        note: "recorded from the real fpgasim bridge + iverilog/vvp: a Verilog counter that toggles q every 13000 board-clock posedges",
        pinSpec: "en:in,q:out",
        quantumNs: 500_000,
        engine: "",
        source: `
module top(input clk, input en, output reg q);
  reg [15:0] n;
  initial begin n = 0; q = 0; end
  always @(posedge clk) begin
    if (!en) begin n <= 0; end
    else if (n == 16'd12999) begin n <= 0; q <= ~q; end
    else n <= n + 16'd1;
  end
endmodule`,
    },
    mcusim: {
        out: "mcusim-mirror.json",
        note: "recorded from the real mcusim bridge + arm-none-eabi-gcc/QEMU: firmware mirroring PA0 to PC13",
        pinSpec: "PA0:in,PC13:out",
        quantumNs: 1_000_000,
        engine: "mainline",
        source: `
#include "trace.h"
LOCKSTEP_PINS("PC13:out", "PA0:in");
int main(void) {
  unsigned v, i;
  for (;;) {
    v = (unsigned)trace_read("PA0");
    trace_pin("PC13", v);
    for (i = 0; i < 200; ++i) asm volatile("nop");
  }
}`,
    },
};

function hostEntrypoint(repo) {
    const dir = mkdtempSync(path.join(tmpdir(), "fl-rec-"));
    const text = readFileSync(path.join(repo, "sim", "entrypoint-lockstep.sh"), "utf8")
        .replaceAll("/opt/fw", path.join(repo, "firmware"))
        .replaceAll("/work", dir);
    const p = path.join(dir, "entrypoint.sh");
    writeFileSync(p, text, { mode: 0o755 });
    return p;
}

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
        cwd: repo,
        stdio: ["ignore", "pipe", "pipe"],
    });
    return new Promise((resolve, reject) => {
        let err = "";
        child.stderr.on("data", (d) => {
            err += String(d);
            if (String(d).includes("ready")) resolve(child);
        });
        child.on("exit", (c) => reject(new Error(`bridge exited ${c}: ${err}`)));
        setTimeout(() => reject(new Error(`bridge start timeout: ${err}`)), 15000);
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const c = CASES[WHICH];
    const port = WHICH === "fpgasim" ? 3191 : 3192;
    const server = await startBridge(REPO, port, hostEntrypoint(REPO));
    const frames = [];
    let lastClientType = null;
    let session = null;
    let outputs = null;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const send = (o) => { lastClientType = o.type; ws.send(JSON.stringify(o)); };

    // Replace the concrete session id with a template so the fake can hand out
    // its own; same for the backend clock on `stepped`.
    const templatize = (msg) => {
        const copy = JSON.parse(JSON.stringify(msg));
        if (copy.session) copy.session = "{{session}}";
        return copy;
    };

    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("ws open timeout")), 10000);
        ws.onopen = () => { clearTimeout(t); resolve(); };
        ws.onerror = (e) => { clearTimeout(t); reject(new Error("ws error " + e?.message)); };
    });

    ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        frames.push({ on: lastClientType, send: templatize(msg) });
        if (msg.type === "welcome") {
            send({ type: "create", source: c.source, config: { quantum_ns: c.quantumNs, engine: c.engine || undefined } });
        } else if (msg.type === "created") {
            session = msg.session;
        } else if (msg.type === "stepped") {
            outputs = msg.outputs;
        }
    };

    send({ type: "hello", proto: 1, client: "fulgurlab" });

    // Wait for the session.
    for (let i = 0; i < 600 && !session; i++) await sleep(50);
    if (!session) throw new Error("no `created` frame -- compile failed? " + JSON.stringify(frames, null, 2));
    console.error(`session ${session} ready`);

    const inputs = WHICH === "fpgasim" ? [{ en: 1 }, { en: 1 }, { en: 1 }] : [{ PA0: 1 }, { PA0: 0 }, { PA0: 1 }];
    let t = 0;
    for (const inp of inputs) {
        outputs = null;
        t += c.quantumNs;
        send({ type: "step", session, t_ns: t + 1, inputs: inp });
        for (let i = 0; i < 600 && outputs === null; i++) await sleep(50);
        if (outputs === null) throw new Error("no `stepped` reply");
        console.error(`step @${t} inputs=${JSON.stringify(inp)} -> ${JSON.stringify(outputs)}`);
    }

    // reset / reset_done (TODO P0-3): the frame the replay tests need most, and
    // the one nothing had ever exercised against a real backend.
    send({ type: "reset", session });
    await sleep(1500);

    send({ type: "dispose", session });
    await sleep(500);
    ws.close();
    server.kill("SIGKILL");

    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, c.out);
    writeFileSync(outPath, JSON.stringify({
        backend: WHICH, note: c.note, session: "s-fake", frames,
    }, null, 2) + "\n");
    console.error(`\nwrote ${frames.length} frames -> ${outPath}`);
    for (const f of frames) console.error(`  on ${String(f.on).padEnd(8)} <- ${f.send.type}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
