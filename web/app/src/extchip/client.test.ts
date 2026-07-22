// Unit tests for ExtChipRegistry (client.ts) -- transliterated from
// jstests/fulgur-bridge.test.mjs (the proven GWT-era client's own test
// suite) onto this class-based, engineStore-style port, PLUS one new
// scenario this contract adds: adopting the backend's pins when the
// element's own pinSpec is empty. Uses the same dependency-free ws test
// server (test-utils/miniws.mjs, copied byte-for-byte from jstests/).
import { describe, it, expect, beforeEach } from "vitest";
import { startMiniWs } from "../../test-utils/miniws.mjs";
import { ExtChipRegistry, type ExtChipConfig } from "./client";

// Minimal shape of miniws.mjs's per-connection handle -- just enough for
// these scripted-backend tests, kept local rather than typing the whole
// (untyped, dependency-free-by-design) miniws module.
interface MiniWsConn {
    send(text: string): void;
    onmessage: ((text: string) => void) | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- scripted backend echoes whatever the client sends
type BridgeMsg = Record<string, any>;

const QUANTUM = 1_000_000;

function scriptedBackend(
    pinsReply: { name: string; dir: "in" | "out" }[],
    onStep: (conn: MiniWsConn, msg: BridgeMsg) => void,
) {
    return startMiniWs((conn: MiniWsConn) => {
        conn.onmessage = (text: string) => {
            const msg = JSON.parse(text);
            if (msg.type === "hello") {
                conn.send(JSON.stringify({ type: "welcome", proto: 1, backend: "fake", version: "0" }));
            } else if (msg.type === "create") {
                conn.send(JSON.stringify({ type: "created", session: "s1", pins: pinsReply, quantum_ns: QUANTUM }));
            } else if (msg.type === "step") {
                onStep(conn, msg);
            } else if (msg.type === "dispose") {
                conn.send(JSON.stringify({ type: "disposed", session: msg.session }));
            }
        };
    });
}

function until(fn: () => boolean, ms = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (fn()) { clearInterval(iv); resolve(); }
            else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("until: timeout")); }
        }, 5);
    });
}

function cfg(overrides: Partial<ExtChipConfig> = {}): ExtChipConfig {
    return { url: "", source: "x", pinSpec: "rst:in,led:out", quantumNs: QUANTUM, ...overrides };
}

const PINS: { name: string; dir: "in" | "out" }[] = [{ name: "rst", dir: "in" }, { name: "led", dir: "out" }];

describe("ExtChipRegistry", () => {
    let registry: ExtChipRegistry;
    let simCalls: string[];

    beforeEach(() => {
        simCalls = [];
        registry = new ExtChipRegistry({
            pause: () => simCalls.push("pause"),
            resume: () => simCalls.push("resume"),
        });
    });

    it("handshake -> create -> running; outputs land after a paced step", async () => {
        const steps: BridgeMsg[] = [];
        const srv = await scriptedBackend(PINS, (conn, msg) => {
            steps.push(msg);
            conn.send(JSON.stringify({
                type: "stepped", session: "s1", t_ns: steps.length * QUANTUM,
                outputs: { led: msg.inputs.rst ? 1 : 0 }, events: [[42, "led", 1]],
            }));
        });

        registry.configure(7, cfg({ url: srv.url }));
        await until(() => registry.getStatus(7).status === "running");

        // circuit time below one quantum: no step yet
        registry.setInputs(7, 1);
        registry.onSimTime(7, QUANTUM / 2);
        await new Promise((r) => setTimeout(r, 30));
        expect(steps.length).toBe(0);
        expect(registry.getOutputs(7)).toBe(0);

        // crossing the boundary fires exactly one step with the pushed inputs
        registry.onSimTime(7, QUANTUM + 1);
        await until(() => registry.getOutputs(7) === 1);
        expect(steps.length).toBe(1);
        expect(steps[0].inputs).toEqual({ rst: 1 });
        expect(registry.takeEvents(7)).toEqual([[42, "led", 1]]);
        expect(registry.takeEvents(7)).toEqual([]); // drained

        registry.dispose(7);
        await srv.close();
    });

    it("pin mismatch is surfaced as an error, no session", async () => {
        const srv = await scriptedBackend([{ name: "other", dir: "out" }], () => {});
        registry.configure(8, cfg({ url: srv.url }));
        await until(() => registry.getStatus(8).status === "error");
        expect(registry.getStatus(8).detail).toMatch(/pin mismatch/);
        registry.dispose(8);
        await srv.close();
    });

    it("late backend pauses the sim; reply resumes it (bounded skew)", async () => {
        let replyConn: MiniWsConn | undefined, replyMsg: BridgeMsg | undefined;
        const srv = await scriptedBackend(PINS, (conn, msg) => { replyConn = conn; replyMsg = msg; });

        registry.configure(9, cfg({ url: srv.url }));
        await until(() => registry.getStatus(9).status === "running");

        registry.onSimTime(9, QUANTUM + 1); // fires step 1 (no reply yet)
        await until(() => !!replyMsg);
        expect(simCalls).toEqual([]);

        registry.onSimTime(9, 2 * QUANTUM + 1); // a full quantum ahead -> pause
        expect(simCalls).toEqual(["pause"]);

        replyConn!.send(JSON.stringify({ type: "stepped", session: "s1", t_ns: QUANTUM, outputs: { led: 1 }, events: [] }));
        await until(() => simCalls.length === 2);
        expect(simCalls).toEqual(["pause", "resume"]);
        expect(registry.getOutputs(9)).toBe(1);

        registry.dispose(9);
        await srv.close();
    });

    it("backend error frees a paused sim and reports status", async () => {
        const srv = await startMiniWs((conn: MiniWsConn) => {
            conn.onmessage = (text: string) => {
                const msg = JSON.parse(text);
                if (msg.type === "hello") conn.send(JSON.stringify({ type: "welcome", proto: 1 }));
                else if (msg.type === "create") conn.send(JSON.stringify({ type: "created", session: "s1", pins: PINS, quantum_ns: QUANTUM }));
                else if (msg.type === "step") conn.send(JSON.stringify({ type: "error", stage: "runtime", log: "boom", session: "s1" }));
            };
        });

        registry.configure(10, cfg({ url: srv.url }));
        await until(() => registry.getStatus(10).status === "running");
        registry.onSimTime(10, QUANTUM + 1);
        registry.onSimTime(10, 2 * QUANTUM + 1); // pause while waiting
        await until(() => registry.getStatus(10).status === "error");
        expect(registry.getStatus(10).detail).toMatch(/boom/);
        expect(simCalls).toEqual(["pause", "resume"]); // pause then forced resume on error

        registry.dispose(10);
        await srv.close();
    });

    it("ended (firmware exit) freezes outputs and reports reason", async () => {
        const srv = await startMiniWs((conn: MiniWsConn) => {
            conn.onmessage = (text: string) => {
                const msg = JSON.parse(text);
                if (msg.type === "hello") conn.send(JSON.stringify({ type: "welcome", proto: 1 }));
                else if (msg.type === "create") conn.send(JSON.stringify({ type: "created", session: "s1", pins: PINS, quantum_ns: QUANTUM }));
                else if (msg.type === "step") {
                    conn.send(JSON.stringify({ type: "stepped", session: "s1", t_ns: QUANTUM, outputs: { led: 1 }, events: [] }));
                    conn.send(JSON.stringify({ type: "ended", session: "s1", reason: "eof" }));
                }
            };
        });

        registry.configure(11, cfg({ url: srv.url }));
        await until(() => registry.getStatus(11).status === "running");
        registry.onSimTime(11, QUANTUM + 1);
        await until(() => registry.getStatus(11).status === "ended");
        expect(registry.getStatus(11).detail).toBe("eof");
        expect(registry.getOutputs(11)).toBe(1); // outputs freeze at last quantum

        // further sim time must not throw or step
        expect(() => registry.onSimTime(11, 5 * QUANTUM)).not.toThrow();
        registry.dispose(11);
        await srv.close();
    });

    it("bad pin spec fails fast without a connection", () => {
        registry.configure(12, cfg({ url: "ws://127.0.0.1:1/", pinSpec: "rst:sideways" }));
        expect(registry.getStatus(12).status).toBe("error");
        expect(registry.getStatus(12).detail).toMatch(/bad pin spec/);
        registry.dispose(12);
    });

    it("adopts the backend's pins when the element's pinSpec is empty", async () => {
        const adopted = [{ name: "a", dir: "in" as const }, { name: "b", dir: "out" as const }, { name: "c", dir: "out" as const }];
        const srv = await scriptedBackend(adopted, (conn) => {
            conn.send(JSON.stringify({ type: "stepped", session: "s1", t_ns: QUANTUM, outputs: { b: 1, c: 0 }, events: [] }));
        });

        registry.configure(13, cfg({ url: srv.url, pinSpec: "" }));
        await until(() => registry.getStatus(13).status === "running");

        expect(registry.getPins(13)).toEqual(adopted);

        registry.onSimTime(13, QUANTUM + 1);
        await until(() => registry.getOutputs(13) !== 0);
        expect(registry.getOutputs(13)).toBe(1); // b (bit0) set, c (bit1) clear

        registry.dispose(13);
        await srv.close();
    });
});
