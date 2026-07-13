// FulgurBridge — client side of fulgurlab's lockstep co-simulation bridge
// (docs/bridge-protocol.md, proto v1). Owns the WebSocket sessions to fpgasim/mcusim
// bridge servers and paces circuit time against backend quanta so ExtChipElm's JSNI
// calls stay synchronous and non-blocking:
//
//   ExtChipElm.execute()  --per circuitjs timestep-->  setInputs / onSimTime / getOutputs
//   FulgurBridge          --per quantum boundary---->  ws `step` / apply `stepped`
//
// Lockstep rule: at most one step in flight. If the circuit runs a full quantum ahead
// of the backend, the simulation is PAUSED (CircuitJS1.setSimRunning(false)) and
// resumed when the reply lands — skew is bounded at one quantum by construction.
//
// Runs in the browser (window.FulgurBridge, used via JSNI) and under Node >= 22
// (global WebSocket) for unit/integration tests.

(function (root) {
  "use strict";

  const chips = new Map(); // id -> chip record

  function simCtl() {
    return FulgurBridge._simCtl || (typeof root.CircuitJS1 !== "undefined" ? root.CircuitJS1 : null);
  }

  function setStatus(c, s) {
    c.status = s;
    FulgurBridge.onstatus && FulgurBridge.onstatus(c.id, s);
  }

  /** "rst:in,led[0]:out" -> [{name,dir}] or {error} */
  function parsePinSpec(spec) {
    const pins = [];
    const seen = new Set();
    for (const raw of String(spec || "").split(",")) {
      const s = raw.trim();
      if (!s) continue;
      const m = /^([^:\s]+)\s*:\s*(in|out)$/.exec(s);
      if (!m) return { error: "bad pin spec entry: " + s };
      if (seen.has(m[1])) return { error: "duplicate pin " + m[1] };
      seen.add(m[1]);
      pins.push({ name: m[1], dir: m[2] });
    }
    if (pins.length === 0) return { error: "empty pin spec" };
    if (pins.length > 32) return { error: "at most 32 pins" };
    return { pins };
  }

  function pinsMatch(declared, created) {
    if (declared.length !== created.length) return false;
    for (let i = 0; i < declared.length; i++)
      if (declared[i].name !== created[i].name || declared[i].dir !== created[i].dir) return false;
    return true;
  }

  function inputsObj(c) {
    const o = {};
    let i = 0;
    for (const p of c.pins) if (p.dir === "in") o[p.name] = (c.inBits >>> i++) & 1;
    return o;
  }

  function outputsToBits(c, outputs) {
    let bits = 0, i = 0;
    for (const p of c.pins) if (p.dir === "out") {
      if (outputs[p.name]) bits |= 1 << i;
      i++;
    }
    return bits >>> 0;
  }

  function pause(c) {
    if (c.pausedByBridge) return;
    const ctl = simCtl();
    if (ctl && ctl.setSimRunning) {
      c.pausedByBridge = true;
      ctl.setSimRunning(false);
    }
  }

  function resume(c) {
    if (!c.pausedByBridge) return;
    c.pausedByBridge = false;
    const ctl = simCtl();
    if (ctl && ctl.setSimRunning) ctl.setSimRunning(true);
  }

  function fail(c, log) {
    setStatus(c, "error: " + String(log).split("\n")[0].slice(0, 200));
    c.errorLog = String(log);
    c.session = null;
    resume(c); // never leave the sim wedged
  }

  function sendStep(c) {
    c.inflight = true;
    c.ws.send(JSON.stringify({ type: "step", session: c.session, t_ns: c.simTNs, inputs: inputsObj(c) }));
  }

  function handleMsg(c, msg) {
    switch (msg.type) {
      case "welcome":
        c.ws.send(JSON.stringify({
          type: "create",
          source: c.cfg.source,
          config: { quantum_ns: c.cfg.quantumNs, engine: c.cfg.engine || undefined },
        }));
        setStatus(c, "compiling");
        return;
      case "created": {
        if (!pinsMatch(c.pins, msg.pins)) {
          fail(c, "pin mismatch: element declares [" +
            c.pins.map((p) => p.name + ":" + p.dir).join(",") +
            "] but backend built [" +
            msg.pins.map((p) => p.name + ":" + p.dir).join(",") + "]");
          c.ws.close();
          return;
        }
        c.session = msg.session;
        c.quantumNs = msg.quantum_ns;
        c.steppedTNs = 0;
        c.outBits = 0;
        c.events = [];
        setStatus(c, "running");
        return;
      }
      case "stepped": {
        c.inflight = false;
        c.steppedTNs = msg.t_ns;
        c.outBits = outputsToBits(c, msg.outputs || {});
        if (msg.events && msg.events.length) {
          c.events.push(...msg.events);
          if (c.events.length > 4096) c.events.splice(0, c.events.length - 4096);
        }
        resume(c);
        return;
      }
      case "ended":
        if (c.session === msg.session) {
          setStatus(c, "ended: " + msg.reason);
          c.session = null;
          c.inflight = false;
          resume(c);
        }
        return;
      case "error":
        c.inflight = false;
        fail(c, (msg.stage || "error") + ": " + (msg.log || ""));
        return;
      case "disposed":
        return;
      default:
        return;
    }
  }

  const FulgurBridge = {
    PROTO: 1,
    _simCtl: null, // test override for CircuitJS1

    /** (Re)configure a chip: opens the ws, compiles, starts a session. */
    configure(id, url, source, pinSpec, quantumNs, engine) {
      this.dispose(id);
      const parsed = parsePinSpec(pinSpec);
      const c = {
        id, cfg: { url, source, quantumNs: quantumNs || 1_000_000, engine: engine || "" },
        pins: parsed.pins || [],
        inBits: 0, outBits: 0, events: [],
        simTNs: 0, steppedTNs: 0, quantumNs: quantumNs || 1_000_000,
        session: null, inflight: false, pausedByBridge: false,
        status: "connecting", errorLog: "",
      };
      chips.set(id, c);
      if (parsed.error) return fail(c, parsed.error);
      if (typeof WebSocket === "undefined") return fail(c, "no WebSocket in this environment");
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        return fail(c, "ws: " + e.message);
      }
      c.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "hello", proto: FulgurBridge.PROTO, client: "fulgurlab" }));
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        handleMsg(c, msg);
      };
      ws.onclose = () => {
        if (c.status === "running" || c.status === "compiling" || c.status === "connecting")
          fail(c, "bridge connection closed");
      };
      ws.onerror = () => {};
    },

    /** Element pushes its current input pin bits (LSB = first declared "in" pin). */
    setInputs(id, bits) {
      const c = chips.get(id);
      if (c) c.inBits = bits >>> 0;
    },

    /** Latest quantum-boundary output bits (LSB = first declared "out" pin). */
    getOutputs(id) {
      const c = chips.get(id);
      return c ? c.outBits : 0;
    },

    /**
     * Called every circuitjs timestep with the circuit clock (ns). Fires a quantum
     * step when due; pauses the sim if the backend is a full quantum late.
     */
    onSimTime(id, tNs) {
      const c = chips.get(id);
      if (!c || !c.session) return;
      c.simTNs = tNs;
      const due = c.steppedTNs + c.quantumNs;
      if (!c.inflight && tNs >= due) sendStep(c);
      if (c.inflight && tNs >= due + c.quantumNs) pause(c);
    },

    getStatus(id) {
      const c = chips.get(id);
      return c ? c.status : "unconfigured";
    },

    getErrorLog(id) {
      const c = chips.get(id);
      return c ? c.errorLog : "";
    },

    /** Drain buffered intra-quantum output events: [[t_ns, PIN, v], ...] */
    takeEvents(id) {
      const c = chips.get(id);
      if (!c) return [];
      const e = c.events;
      c.events = [];
      return e;
    },

    dispose(id) {
      const c = chips.get(id);
      if (!c) return;
      resume(c);
      try {
        if (c.session && c.ws && c.ws.readyState === 1)
          c.ws.send(JSON.stringify({ type: "dispose", session: c.session }));
        c.ws && c.ws.close();
      } catch {}
      chips.delete(id);
    },

    onstatus: null, // optional (id, status) => void hook
  };

  root.FulgurBridge = FulgurBridge;
  if (typeof module !== "undefined" && module.exports) module.exports = FulgurBridge;
})(typeof window !== "undefined" ? window : globalThis);
