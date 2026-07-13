// Unit tests for war/fulgur-bridge.js — the browser-side lockstep client — against a
// scripted fake backend (miniws.mjs). Verifies the protocol handshake, pin validation,
// quantum pacing, bounded-skew pause/resume, and error surfacing.
// Node >= 22 (global WebSocket).

import { test } from "node:test";
import assert from "node:assert/strict";
import { startMiniWs } from "./miniws.mjs";
import FulgurBridge from "../war/fulgur-bridge.js";

const QUANTUM = 1_000_000;

function scriptedBackend(pinsReply, onStep) {
  return startMiniWs((conn) => {
    conn.onmessage = (text) => {
      const msg = JSON.parse(text);
      if (msg.type === "hello")
        conn.send(JSON.stringify({ type: "welcome", proto: 1, backend: "fake", version: "0" }));
      else if (msg.type === "create")
        conn.send(JSON.stringify({ type: "created", session: "s1", pins: pinsReply, quantum_ns: QUANTUM }));
      else if (msg.type === "step") onStep(conn, msg);
      else if (msg.type === "dispose")
        conn.send(JSON.stringify({ type: "disposed", session: msg.session }));
    };
  });
}

function until(fn, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fn()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error("until: timeout")); }
    }, 5);
  });
}

const PINS = [{ name: "rst", dir: "in" }, { name: "led", dir: "out" }];

test("handshake → create → running; outputs land after a paced step", async () => {
  const steps = [];
  const srv = await scriptedBackend(PINS, (conn, msg) => {
    steps.push(msg);
    conn.send(JSON.stringify({
      type: "stepped", session: "s1", t_ns: steps.length * QUANTUM,
      outputs: { led: msg.inputs.rst ? 1 : 0 }, events: [[42, "led", 1]],
    }));
  });

  FulgurBridge.configure(7, srv.url, "module top; endmodule", "rst:in,led:out", QUANTUM, "");
  await until(() => FulgurBridge.getStatus(7) === "running");

  // circuit time below one quantum: no step yet
  FulgurBridge.setInputs(7, 1);
  FulgurBridge.onSimTime(7, QUANTUM / 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(steps.length, 0);
  assert.equal(FulgurBridge.getOutputs(7), 0);

  // crossing the boundary fires exactly one step with the pushed inputs
  FulgurBridge.onSimTime(7, QUANTUM + 1);
  await until(() => FulgurBridge.getOutputs(7) === 1);
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].inputs, { rst: 1 });
  assert.deepEqual(FulgurBridge.takeEvents(7), [[42, "led", 1]]);
  assert.deepEqual(FulgurBridge.takeEvents(7), []); // drained

  FulgurBridge.dispose(7);
  await srv.close();
});

test("pin mismatch is surfaced as an error, no session", async () => {
  const srv = await scriptedBackend([{ name: "other", dir: "out" }], () => {});
  FulgurBridge.configure(8, srv.url, "x", "rst:in,led:out", QUANTUM, "");
  await until(() => FulgurBridge.getStatus(8).startsWith("error"));
  assert.match(FulgurBridge.getErrorLog(8), /pin mismatch/);
  FulgurBridge.dispose(8);
  await srv.close();
});

test("late backend pauses the sim; reply resumes it (bounded skew)", async () => {
  let replyConn, replyMsg;
  const srv = await scriptedBackend(PINS, (conn, msg) => { replyConn = conn; replyMsg = msg; });

  const calls = [];
  FulgurBridge._simCtl = { setSimRunning: (v) => calls.push(v) };
  try {
    FulgurBridge.configure(9, srv.url, "x", "rst:in,led:out", QUANTUM, "");
    await until(() => FulgurBridge.getStatus(9) === "running");

    FulgurBridge.onSimTime(9, QUANTUM + 1); // fires step 1 (no reply yet)
    await until(() => !!replyMsg);
    assert.deepEqual(calls, []);

    FulgurBridge.onSimTime(9, 2 * QUANTUM + 1); // a full quantum ahead → pause
    assert.deepEqual(calls, [false]);

    replyConn.send(JSON.stringify({ type: "stepped", session: "s1", t_ns: QUANTUM, outputs: { led: 1 }, events: [] }));
    await until(() => calls.length === 2);
    assert.deepEqual(calls, [false, true]); // resumed
    assert.equal(FulgurBridge.getOutputs(9), 1);
  } finally {
    FulgurBridge._simCtl = null;
    FulgurBridge.dispose(9);
    await srv.close();
  }
});

test("backend error frees a paused sim and reports status", async () => {
  const srv = await startMiniWs((conn) => {
    conn.onmessage = (text) => {
      const msg = JSON.parse(text);
      if (msg.type === "hello") conn.send(JSON.stringify({ type: "welcome", proto: 1 }));
      else if (msg.type === "create") conn.send(JSON.stringify({ type: "created", session: "s1", pins: PINS, quantum_ns: QUANTUM }));
      else if (msg.type === "step") conn.send(JSON.stringify({ type: "error", stage: "runtime", log: "boom", session: "s1" }));
    };
  });
  const calls = [];
  FulgurBridge._simCtl = { setSimRunning: (v) => calls.push(v) };
  try {
    FulgurBridge.configure(10, srv.url, "x", "rst:in,led:out", QUANTUM, "");
    await until(() => FulgurBridge.getStatus(10) === "running");
    FulgurBridge.onSimTime(10, QUANTUM + 1);
    FulgurBridge.onSimTime(10, 2 * QUANTUM + 1); // pause while waiting
    await until(() => FulgurBridge.getStatus(10).startsWith("error"));
    assert.match(FulgurBridge.getErrorLog(10), /boom/);
    assert.deepEqual(calls, [false, true]); // pause then forced resume on error
  } finally {
    FulgurBridge._simCtl = null;
    FulgurBridge.dispose(10);
    await srv.close();
  }
});

test("ended (firmware exit) freezes outputs and reports reason", async () => {
  const srv = await startMiniWs((conn) => {
    conn.onmessage = (text) => {
      const msg = JSON.parse(text);
      if (msg.type === "hello") conn.send(JSON.stringify({ type: "welcome", proto: 1 }));
      else if (msg.type === "create") conn.send(JSON.stringify({ type: "created", session: "s1", pins: PINS, quantum_ns: QUANTUM }));
      else if (msg.type === "step") {
        conn.send(JSON.stringify({ type: "stepped", session: "s1", t_ns: QUANTUM, outputs: { led: 1 }, events: [] }));
        conn.send(JSON.stringify({ type: "ended", session: "s1", reason: "eof" }));
      }
    };
  });
  FulgurBridge.configure(11, srv.url, "x", "rst:in,led:out", QUANTUM, "");
  await until(() => FulgurBridge.getStatus(11) === "running");
  FulgurBridge.onSimTime(11, QUANTUM + 1);
  await until(() => FulgurBridge.getStatus(11) === "ended: eof");
  assert.equal(FulgurBridge.getOutputs(11), 1, "outputs freeze at last quantum");
  // further sim time must not throw or step
  FulgurBridge.onSimTime(11, 5 * QUANTUM);
  FulgurBridge.dispose(11);
  await srv.close();
});

test("bad pin spec fails fast without a connection", () => {
  FulgurBridge.configure(12, "ws://127.0.0.1:1/", "x", "rst:sideways", QUANTUM, "");
  assert.match(FulgurBridge.getStatus(12), /error/);
  assert.match(FulgurBridge.getErrorLog(12), /bad pin spec/);
  FulgurBridge.dispose(12);
});
