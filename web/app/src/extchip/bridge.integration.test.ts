// BRIDGE INTEGRATION (TODO.md P1-5): ExtChipRegistry against the proto-v1 wire
// contract over a REAL WebSocket, driven by RECORDED transcripts of real backend
// sessions (integration-tests/transcripts/, replayed by
// test-utils/fakeBackend.mjs).
//
// The previous suite lived in integration-tests/ and required live
// fpgasim/mcusim containers, so all three of its cases skipped and the client's
// protocol logic -- handshake, session creation, quantum pacing, the
// one-step-in-flight rule, the skew guard, reset, ended, error -- was verified
// nowhere. These run everywhere.
//
// fpgasim-divider.json is a genuine recording (real fpgasim bridge + iverilog/
// vvp). The other transcripts are spec-derived and say so in their own `note`
// field; `node integration-tests/record-transcript.mjs <backend>` refreshes any
// of them from ground truth. The LIVE end-to-end chain (bridge server + vvp/
// QEMU child processes) still lives in integration-tests/ for the cross-repo
// contract; this file is the part that must never skip.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startFakeBackend, sentOfType } from "../../test-utils/fakeBackend.mjs";
import { ExtChipRegistry, type ExtChipConfig } from "./client";

const TRANSCRIPTS = path.join(process.cwd(), "..", "..", "integration-tests", "transcripts");

interface FakeServer {
    // miniws.mjs exposes the ready-made ws:// url (it binds an ephemeral port).
    url: string;
    close(): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw client frames
    received: any[];
}

function transcript(name: string) {
    return JSON.parse(readFileSync(path.join(TRANSCRIPTS, name), "utf8"));
}

function until(fn: () => boolean, ms = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (fn()) { clearInterval(iv); resolve(); }
            else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("until: timeout")); }
        }, 5);
    });
}

describe("bridge integration (recorded transcripts)", () => {
    let servers: FakeServer[];
    let registries: ExtChipRegistry[];
    let simCalls: string[];

    beforeEach(() => {
        servers = [];
        registries = [];
        simCalls = [];
    });

    afterEach(() => {
        for (const r of registries) for (let id = 0; id < 20; id++) r.dispose(id);
        for (const s of servers) s.close();
    });

    async function backend(name: string, opts = {}): Promise<FakeServer> {
        const s = (await startFakeBackend(transcript(name), opts)) as FakeServer;
        servers.push(s);
        return s;
    }
    function registry(): ExtChipRegistry {
        const r = new ExtChipRegistry({
            pause: () => simCalls.push("pause"),
            resume: () => simCalls.push("resume"),
        });
        registries.push(r);
        return r;
    }
    function cfg(server: FakeServer, over: Partial<ExtChipConfig> = {}): ExtChipConfig {
        return {
            url: server.url,
            source: "module top(input clk, input en, output reg q); endmodule",
            pinSpec: "en:in,q:out",
            quantumNs: 500_000,
            ...over,
        };
    }

    it("fpgasim: real recorded session goes create -> step -> outputs -> dispose", async () => {
        const s = await backend("fpgasim-divider.json");
        const reg = registry();
        reg.configure(1, cfg(s));
        await until(() => ["running", "error"].includes(reg.getStatus(1).status));
        expect(reg.getStatus(1).status).toBe("running");

        // Pins come from the recorded `created` frame.
        expect(reg.getPins(1)).toEqual([{ name: "en", dir: "in" }, { name: "q", dir: "out" }]);

        reg.setInputs(1, 1);                 // en = 1
        reg.onSimTime(1, 500_001);
        await until(() => reg.getOutputs(1) === 1);

        reg.onSimTime(1, 1_000_001);         // next quantum -> q toggles back
        await until(() => reg.getOutputs(1) === 0);

        const steps = sentOfType(s.received, "step");
        expect(steps.length).toBe(2);
        for (const st of steps) expect(st.session).toBe("s-fake");
        expect(steps[0].inputs).toEqual({ en: 1 });

        // Intra-quantum edges were buffered for the scope, and drain once.
        expect(reg.takeEvents(1).length).toBeGreaterThan(0);
        expect(reg.takeEvents(1).length).toBe(0);

        reg.dispose(1);
        // dispose() sends the frame and closes; the frame is in flight, so wait
        // for it rather than asserting synchronously.
        await until(() => sentOfType(s.received, "dispose").length === 1);
    });

    it("one-step-in-flight: no second step is sent before the first is answered", async () => {
        // Go silent on the first step so it stays outstanding.
        const s = await backend("fpgasim-divider.json", {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onFrame: (msg: any) => msg.type !== "step",
        });
        const reg = registry();
        reg.configure(2, cfg(s, { quantumNs: 1_000_000 }));
        await until(() => reg.getStatus(2).status === "running");

        reg.setInputs(2, 1);
        reg.onSimTime(2, 1_000_001);
        await until(() => sentOfType(s.received, "step").length === 1);

        reg.onSimTime(2, 2_000_001);
        reg.onSimTime(2, 3_000_001);
        reg.onSimTime(2, 4_000_001);
        expect(sentOfType(s.received, "step").length).toBe(1);
    });

    it("skew guard: pauses the circuit once a reply is a full quantum late, and always resumes", async () => {
        const s = await backend("fpgasim-divider.json", {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onFrame: (msg: any) => msg.type !== "step",
        });
        const reg = registry();
        reg.configure(3, cfg(s, { quantumNs: 1_000_000 }));
        await until(() => reg.getStatus(3).status === "running");

        reg.setInputs(3, 1);
        reg.onSimTime(3, 1_000_001);         // step goes out, unanswered
        reg.onSimTime(3, 3_000_001);         // now a full quantum past due
        await until(() => simCalls.includes("pause"));

        reg.dispose(3);                      // teardown must never leave it wedged
        expect(simCalls.filter((v) => v === "pause").length)
            .toBe(simCalls.filter((v) => v === "resume").length);
    });

    it("mcusim: mirrors an input pin to an output pin and packs one input", async () => {
        const s = await backend("mcusim-mirror.json");
        const reg = registry();
        reg.configure(4, cfg(s, {
            source: '#include "trace.h"\nLOCKSTEP_PINS("PC13:out", "PA0:in");',
            pinSpec: "PA0:in,PC13:out",
            quantumNs: 1_000_000,
            engine: "mainline",
        }));
        await until(() => ["running", "error"].includes(reg.getStatus(4).status));
        expect(reg.getStatus(4).status).toBe("running");

        reg.setInputs(4, 1);
        reg.onSimTime(4, 1_000_001);
        await until(() => reg.getOutputs(4) === 1);

        reg.setInputs(4, 0);
        reg.onSimTime(4, 2_000_001);
        await until(() => reg.getOutputs(4) === 0);

        expect(Object.keys(sentOfType(s.received, "step")[0].inputs)).toEqual(["PA0"]);
    });

    // ------------------------------------------------------------------ P0-3

    it("reset: a backend that supports reset_done restarts the session at t=0 without recompiling", async () => {
        const s = await backend("fpgasim-reset-supported.json");
        const reg = registry();
        reg.configure(5, cfg(s));
        await until(() => reg.getStatus(5).status === "running");

        reg.setInputs(5, 1);
        reg.onSimTime(5, 500_001);
        await until(() => reg.getOutputs(5) === 1);

        const createsBefore = sentOfType(s.received, "create").length;
        expect(reg.reset(5)).toBe(true);

        // Outputs cleared optimistically: a step between `reset` and
        // `reset_done` must not be able to ship stale bits into the circuit.
        expect(reg.getOutputs(5)).toBe(0);
        expect(reg.getStatus(5).status).toBe("resetting");

        // No step may go out while the reset is outstanding.
        reg.onSimTime(5, 500_001);
        expect(sentOfType(s.received, "step").length).toBe(1);

        await until(() => reg.getStatus(5).status === "running");
        expect(sentOfType(s.received, "reset").length).toBe(1);
        expect(sentOfType(s.received, "create").length).toBe(createsBefore); // no recompile

        // The quantum clock restarted, so one quantum of circuit time fires a
        // fresh step even though t_ns went backwards.
        reg.onSimTime(5, 500_001);
        await until(() => sentOfType(s.received, "step").length === 2);
    });

    it("reset: the reference backends' `error stage:\"proto\"` rejection keeps the session alive", async () => {
        // This is the REAL recorded behaviour: fpgasim answers `reset` with
        // {stage:"proto", log:"reset not supported in v1 — dispose and create"}.
        // docs/bridge-protocol.md says a proto-stage error does NOT kill the
        // session, so the chip must land back in `running`, not `error`.
        const s = await backend("fpgasim-divider.json");
        const reg = registry();
        reg.configure(6, cfg(s));
        await until(() => reg.getStatus(6).status === "running");

        reg.setInputs(6, 1);
        reg.onSimTime(6, 500_001);
        await until(() => reg.getOutputs(6) === 1);

        expect(reg.reset(6)).toBe(true);
        await until(() => reg.getStatus(6).status === "running");
        expect(reg.getStatus(6).detail).toMatch(/reset not supported/);

        // Still usable afterwards: a fresh step goes out and is answered.
        reg.onSimTime(6, 500_001);
        await until(() => sentOfType(s.received, "step").length === 2);
        expect(reg.getStatus(6).status).toBe("running");
    });

    it("reset on a chip with no session is a no-op, not a crash", () => {
        expect(registry().reset(999)).toBe(false);
    });

    // ---------------------------------------------------------- ended / error

    it("`ended` freezes outputs, clears the session, and releases the sim", async () => {
        const s = await backend("fpgasim-ended.json");
        const reg = registry();
        reg.configure(7, cfg(s));
        await until(() => reg.getStatus(7).status === "running");

        reg.onSimTime(7, 500_001);
        await until(() => reg.getStatus(7).status === "ended");
        expect(reg.getStatus(7).detail).toMatch(/finish/);

        // No further steps once the session is gone.
        const before = sentOfType(s.received, "step").length;
        reg.onSimTime(7, 1_000_001);
        expect(sentOfType(s.received, "step").length).toBe(before);
        expect(simCalls.filter((v) => v === "pause").length)
            .toBe(simCalls.filter((v) => v === "resume").length);
    });

    it("a compile-stage `error` surfaces the log and kills the session", async () => {
        const s = await backend("fpgasim-compile-error.json");
        const reg = registry();
        reg.configure(8, cfg(s, { source: "module top(" }));
        await until(() => reg.getStatus(8).status === "error");
        expect(reg.getStatus(8).detail).toMatch(/compile/);
        expect(reg.getStatus(8).detail).toMatch(/syntax error/);

        reg.onSimTime(8, 500_001);
        expect(sentOfType(s.received, "step").length).toBe(0);
    });

    it("every committed transcript is well-formed and declares its provenance", () => {
        for (const name of ["fpgasim-divider.json", "fpgasim-reset-supported.json",
            "fpgasim-ended.json", "fpgasim-compile-error.json", "mcusim-mirror.json"]) {
            const t = transcript(name);
            expect(t.backend).toMatch(/^(fpgasim|mcusim)$/);
            expect(typeof t.note).toBe("string");
            expect(t.note.length).toBeGreaterThan(20);
            expect(Array.isArray(t.frames)).toBe(true);
            expect(t.frames.length).toBeGreaterThan(0);
            // Frame 0 must be the handshake reply, or the client never gets going.
            expect(t.frames[0].on).toBe("hello");
            expect(t.frames[0].send.type).toBe("welcome");
            expect(t.frames[0].send.proto).toBe(ExtChipRegistry.PROTO);
        }
    });
});
