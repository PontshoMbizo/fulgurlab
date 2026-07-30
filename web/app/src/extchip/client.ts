// ExtChipRegistry — app-side client for fulgurlab's lockstep co-simulation
// bridge (docs/bridge-protocol.md, proto v1). This is a faithful TypeScript
// port of the GWT-era war/fulgur-bridge.js (since removed; see git history) onto the FROZEN
// CONTRACT the concurrent UI drawer agent builds against: a class instance
// (not a window global) with an engineStore-style subscribe()/getVersion()
// pair so React can useSyncExternalStore against it, id-keyed chip records
// (one per placed ExtChipElm, keyed by the SAME id the engine element's
// store glue uses), and an injectable SimControl instead of reaching for
// `window.CircuitJS1`/FulgurBridge._simCtl directly.
//
// The full proto-v1 message set is implemented: outbound hello/create/step/
// reset/dispose, inbound welcome/created/stepped/reset_done/ended/error/
// disposed. (`reset`/`reset_done` were specified but implemented nowhere --
// TODO.md P0-3.)
//
// Pacing/backpressure rules are UNCHANGED from fulgur-bridge.js: at most one
// `step` in flight; the sim is paused once the backend falls a full quantum
// behind (bounded skew) and resumed on the next `stepped`/`ended`/`error`.
// See that file's own header comment for the full lockstep rationale.
//
// Per-step call order the engine glue (owned by the lead agent) is expected
// to use, every completed engine.stepOnce():
//   extChipRegistry.setInputs(id, elm.inputBits);
//   extChipRegistry.onSimTime(id, engine.t * 1e9);
//   elm.outputBits = extChipRegistry.getOutputs(id);

export type ExtChipStatus = "unconfigured" | "connecting" | "compiling" | "running" | "resetting" | "ended" | "error";

export interface ExtChipConfig {
    url: string;
    source: string;
    pinSpec: string;
    quantumNs: number;
    engine?: string;
}

export interface ExtChipPinInfo {
    name: string;
    dir: "in" | "out";
}

export interface SimControl {
    pause(): void;
    resume(): void;
}

type BridgeEvent = [number, string, number];

interface ChipRecord {
    id: number;
    cfg: ExtChipConfig;
    // Pins declared by the element's own pinSpec (may be empty -- "adopt
    // whatever the backend built" mode, see class header + configure()).
    declaredPins: ExtChipPinInfo[];
    // Authoritative pins once `created` lands: either declaredPins (after a
    // successful pinsMatch validation) or, for an empty pinSpec, whatever
    // the backend reported -- null until a session has been created.
    pins: ExtChipPinInfo[] | null;
    ws: WebSocket | null;
    session: string | null;
    inBits: number;
    outBits: number;
    events: BridgeEvent[];
    simTNs: number;
    steppedTNs: number;
    quantumNs: number;
    inflight: boolean;
    pausedByBridge: boolean;
    status: ExtChipStatus;
    detail: string;
    // Resolvers for settled() waiters. Drained whenever the in-flight step
    // reaches ANY terminal state, not just a successful `stepped` -- a waiter
    // that only woke on success would hang forever on a dead session.
    settleWaiters: (() => void)[];
}

// "rst:in,led[0]:out" -> [{name,dir}] or {error} -- byte-for-byte the same
// grammar as the removed war/fulgur-bridge.js's parsePinSpec()/ExtChipElm.java's
// parsePinSpec() (name:in|out, comma-separated, no duplicate names, <= 32
// pins). Blank entries between commas are skipped, same as both references.
function parsePinSpec(spec: string): { pins: ExtChipPinInfo[] } | { error: string } {
    const pins: ExtChipPinInfo[] = [];
    const seen = new Set<string>();
    for (const raw of String(spec || "").split(",")) {
        const s = raw.trim();
        if (!s) continue;
        const m = /^([^:\s]+)\s*:\s*(in|out)$/.exec(s);
        if (!m) return { error: "bad pin spec entry: " + s };
        if (seen.has(m[1])) return { error: "duplicate pin " + m[1] };
        seen.add(m[1]);
        pins.push({ name: m[1], dir: m[2] as "in" | "out" });
    }
    if (pins.length === 0) return { error: "empty pin spec" };
    if (pins.length > 32) return { error: "at most 32 pins" };
    return { pins };
}

// Bit packing is per-direction (LSB = first "in"/"out" pin respectively) --
// see docs/bridge-protocol.md's "Pin naming" section. Only the order WITHIN
// each direction group is contractual.
function pinsMatch(declared: ExtChipPinInfo[], created: ExtChipPinInfo[]): boolean {
    for (const dir of ["in", "out"] as const) {
        const d = declared.filter((p) => p.dir === dir).map((p) => p.name);
        const c = created.filter((p) => p.dir === dir).map((p) => p.name);
        if (d.length !== c.length || d.some((n, i) => n !== c[i])) return false;
    }
    return true;
}

function inputsObj(c: ChipRecord): Record<string, 0 | 1> {
    const o: Record<string, 0 | 1> = {};
    let i = 0;
    for (const p of c.pins ?? []) if (p.dir === "in") o[p.name] = ((c.inBits >>> i++) & 1) as 0 | 1;
    return o;
}

function outputsToBits(c: ChipRecord, outputs: Record<string, unknown>): number {
    let bits = 0, i = 0;
    for (const p of c.pins ?? []) {
        if (p.dir === "out") {
            if (outputs[p.name]) bits |= 1 << i;
            i++;
        }
    }
    return bits >>> 0;
}

// Default SimControl: a lazy import of the app's engineStore (web/app/src/
// engine/store.ts), mapping stop()/run() to pause()/resume() exactly like
// FulgurBridge._simCtl's default fallback to window.CircuitJS1's
// setSimRunning(false/true). Lazy (rather than a static top-level import) so
// this module never forces engineStore to load just to construct an
// ExtChipRegistry -- tests inject their own SimControl (see client.test.ts)
// and never touch this path at all. The dynamic import() promise is cached
// after the first call so pause()/resume() only pay the async-resolution
// cost once.
function defaultSimCtl(): SimControl {
    let modPromise: Promise<typeof import("../engine/store")> | null = null;
    const ensure = () => {
        if (!modPromise) modPromise = import("../engine/store");
        return modPromise;
    };
    return {
        pause() {
            void ensure().then((m) => m.engineStore.stop());
        },
        resume() {
            void ensure().then((m) => m.engineStore.run());
        },
    };
}

export class ExtChipRegistry {
    private chips = new Map<number, ChipRecord>();
    private listeners = new Set<() => void>();
    private version = 0;
    private simCtl: SimControl;

    static PROTO = 1;

    constructor(simCtl?: SimControl) {
        this.simCtl = simCtl ?? defaultSimCtl();
    }

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    };

    getVersion = (): number => this.version;

    private notify() {
        this.version++;
        for (const l of this.listeners) l();
    }

    private setStatus(c: ChipRecord, status: ExtChipStatus, detail = "") {
        c.status = status;
        c.detail = detail;
        this.notify();
    }

    /**
     * Wake everything blocked on this chip's in-flight step. Must be called on
     * EVERY terminal transition (stepped, reset_done, ended, error, dispose),
     * not just the happy one -- the async run loop awaits this, so a path that
     * forgets to drain deadlocks the simulation rather than merely misreporting.
     */
    private settle(c: ChipRecord) {
        if (c.settleWaiters.length === 0) return;
        const waiters = c.settleWaiters;
        c.settleWaiters = [];
        for (const w of waiters) w();
    }

    private fail(c: ChipRecord, log: string) {
        this.setStatus(c, "error", String(log));
        c.session = null;
        c.inflight = false;
        this.resume(c); // never leave the sim wedged
        this.settle(c);
    }

    private pause(c: ChipRecord) {
        if (c.pausedByBridge) return;
        c.pausedByBridge = true;
        this.simCtl.pause();
    }

    private resume(c: ChipRecord) {
        if (!c.pausedByBridge) return;
        c.pausedByBridge = false;
        this.simCtl.resume();
    }

    private sendStep(c: ChipRecord) {
        c.inflight = true;
        c.ws!.send(JSON.stringify({ type: "step", session: c.session, t_ns: c.simTNs, inputs: inputsObj(c) }));
    }

    private handleMsg(c: ChipRecord, msg: Record<string, unknown>) {
        switch (msg.type) {
            case "welcome": {
                c.ws!.send(JSON.stringify({
                    type: "create",
                    source: c.cfg.source,
                    config: { quantum_ns: c.cfg.quantumNs, engine: c.cfg.engine || undefined },
                }));
                this.setStatus(c, "compiling");
                return;
            }
            case "created": {
                const createdPins = (msg.pins as ExtChipPinInfo[]) ?? [];
                if (c.declaredPins.length > 0) {
                    if (!pinsMatch(c.declaredPins, createdPins)) {
                        this.fail(c, "pin mismatch: element declares [" +
                            c.declaredPins.map((p) => p.name + ":" + p.dir).join(",") +
                            "] but backend built [" +
                            createdPins.map((p) => p.name + ":" + p.dir).join(",") + "]");
                        c.ws?.close();
                        return;
                    }
                    c.pins = c.declaredPins;
                } else {
                    // Empty pinSpec -> adopt the backend's pins as authoritative
                    // (skip pinsMatch entirely; see class header/adopt-pins test).
                    c.pins = createdPins;
                }
                c.session = msg.session as string;
                c.quantumNs = (msg.quantum_ns as number) ?? c.quantumNs;
                c.steppedTNs = 0;
                c.outBits = 0;
                c.events = [];
                this.setStatus(c, "running");
                return;
            }
            case "stepped": {
                c.inflight = false;
                c.steppedTNs = msg.t_ns as number;
                c.outBits = outputsToBits(c, (msg.outputs as Record<string, unknown>) ?? {});
                const events = (msg.events as BridgeEvent[]) ?? [];
                if (events.length) {
                    c.events.push(...events);
                    if (c.events.length > 4096) c.events.splice(0, c.events.length - 4096);
                }
                this.resume(c);
                this.settle(c);
                this.notify();
                return;
            }
            case "reset_done": {
                // docs/bridge-protocol.md: the backend has restarted the SAME
                // build at t = 0. Everything time- or output-related has to go
                // back to its post-`created` state, but the session id and pin
                // list survive (no recompile happened).
                if (c.session !== msg.session) return;
                c.inflight = false;
                c.steppedTNs = 0;
                c.simTNs = 0;
                c.outBits = 0;
                c.events = [];
                this.resume(c);
                this.settle(c);
                this.setStatus(c, "running");
                return;
            }
            case "ended": {
                if (c.session === msg.session) {
                    this.setStatus(c, "ended", String(msg.reason ?? ""));
                    c.session = null;
                    c.inflight = false;
                    this.resume(c);
                    this.settle(c);
                }
                return;
            }
            case "error": {
                c.inflight = false;
                const stage = msg.stage ? String(msg.stage) : "error";
                const detail = stage + ": " + String(msg.log ?? "");
                // docs/bridge-protocol.md: "session dead unless stage:'proto'".
                // A protocol-level complaint (e.g. the reference backends'
                // "reset not supported in v1") leaves the session perfectly
                // usable, so tearing it down here -- which is what this did
                // unconditionally -- threw away a live session and wedged the
                // chip in `error` for the rest of the run.
                if (stage === "proto" && c.session) {
                    this.resume(c);
                    this.settle(c);
                    this.setStatus(c, "running", detail);
                    return;
                }
                this.fail(c, detail);
                return;
            }
            case "disposed":
                return;
            default:
                return;
        }
    }

    /** (Re)configure a chip: opens the ws, compiles, starts a session. */
    configure(id: number, cfg: ExtChipConfig): void {
        this.dispose(id);

        const trimmedSpec = cfg.pinSpec.trim();
        let declaredPins: ExtChipPinInfo[] = [];
        let parseError: string | null = null;
        if (trimmedSpec !== "") {
            const parsed = parsePinSpec(cfg.pinSpec);
            if ("error" in parsed) parseError = parsed.error;
            else declaredPins = parsed.pins;
        }

        const c: ChipRecord = {
            id,
            cfg,
            declaredPins,
            pins: null,
            ws: null,
            session: null,
            inBits: 0,
            outBits: 0,
            events: [],
            simTNs: 0,
            steppedTNs: 0,
            quantumNs: cfg.quantumNs || 1_000_000,
            inflight: false,
            pausedByBridge: false,
            status: "connecting",
            detail: "",
            settleWaiters: [],
        };
        this.chips.set(id, c);

        if (parseError) {
            this.fail(c, parseError);
            return;
        }
        if (typeof WebSocket === "undefined") {
            this.fail(c, "no WebSocket in this environment");
            return;
        }

        let ws: WebSocket;
        try {
            ws = new WebSocket(cfg.url);
        } catch (e) {
            this.fail(c, "ws: " + (e instanceof Error ? e.message : String(e)));
            return;
        }
        c.ws = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", proto: ExtChipRegistry.PROTO, client: "fulgurlab" }));
        ws.onmessage = (ev: MessageEvent) => {
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(String(ev.data));
            } catch {
                return;
            }
            this.handleMsg(c, msg);
        };
        ws.onclose = () => {
            if (c.status === "running" || c.status === "compiling" || c.status === "connecting" || c.status === "resetting") {
                this.fail(c, "bridge connection closed");
            }
        };
        ws.onerror = () => {};
    }

    /**
     * Restart the backend's simulation from t = 0 WITHOUT recompiling
     * (docs/bridge-protocol.md's `reset`). Returns false when there is no live
     * session to reset -- callers that want a full rebuild should use
     * configure() instead, which tears the session down and compiles again.
     *
     * Local state is cleared optimistically so a caller that resets and then
     * immediately steps cannot ship the pre-reset output bits into the circuit;
     * `reset_done` then confirms and re-marks the chip as running.
     *
     * NOTE: the reference fpgasim/mcusim backends answer `reset` with
     * `error stage:"proto"` ("reset not supported in v1 -- dispose and create").
     * That is a survivable outcome by design: the proto-stage error handler
     * leaves the session alive and puts the chip back to `running`, so a caller
     * that optimistically resets simply gets its clock rewound locally and can
     * fall back to configure() if it needs a true restart. See
     * docs/bridge-protocol.md's "Reserved" note.
     */
    reset(id: number): boolean {
        const c = this.chips.get(id);
        if (!c || !c.session || !c.ws || c.ws.readyState !== 1 /* OPEN */) return false;
        c.inflight = false;
        c.steppedTNs = 0;
        c.simTNs = 0;
        c.outBits = 0;
        c.events = [];
        this.resume(c);
        this.setStatus(c, "resetting");
        try {
            c.ws.send(JSON.stringify({ type: "reset", session: c.session }));
        } catch (e) {
            this.fail(c, "reset: " + (e instanceof Error ? e.message : String(e)));
            return false;
        }
        return true;
    }

    dispose(id: number): void {
        const c = this.chips.get(id);
        if (!c) return;
        this.resume(c);
        try {
            if (c.session && c.ws && c.ws.readyState === 1 /* OPEN */) {
                c.ws.send(JSON.stringify({ type: "dispose", session: c.session }));
            }
            c.ws?.close();
        } catch {
            /* best-effort teardown */
        }
        // Before the record leaves the map, or anything awaiting its in-flight
        // step waits out the full timeout for a chip that no longer exists.
        c.inflight = false;
        this.settle(c);
        this.chips.delete(id);
        this.notify();
    }

    getStatus(id: number): { status: ExtChipStatus; detail: string } {
        const c = this.chips.get(id);
        return c ? { status: c.status, detail: c.detail } : { status: "unconfigured", detail: "" };
    }

    getPins(id: number): ExtChipPinInfo[] | null {
        const c = this.chips.get(id);
        return c ? c.pins : null;
    }

    /** Element pushes its current input pin bits (LSB = first declared "in" pin). */
    setInputs(id: number, bits: number): void {
        const c = this.chips.get(id);
        if (c) c.inBits = bits >>> 0;
    }

    /** Latest quantum-boundary output bits (LSB = first declared "out" pin). */
    getOutputs(id: number): number {
        const c = this.chips.get(id);
        return c ? c.outBits : 0;
    }

    /**
     * Called every engine step with the circuit clock (ns). Fires a quantum
     * step when due; pauses the sim if the backend is a full quantum late.
     */
    onSimTime(id: number, tNs: number): void {
        const c = this.chips.get(id);
        if (!c || !c.session) return;
        // A `reset` is outstanding: the backend's clock is going back to 0, so
        // stepping now would advance from a state neither side agrees on.
        if (c.status === "resetting") return;
        c.simTNs = tNs;
        const due = c.steppedTNs + c.quantumNs;
        if (!c.inflight && tNs >= due) this.sendStep(c);
        if (c.inflight && tNs >= due + c.quantumNs) this.pause(c);
    }

    // --- Async run-loop support (engine/store.ts) --------------------------
    //
    // Everything above keeps the original synchronous contract exactly as it
    // was, so the pre-existing test suite still describes real behaviour. The
    // methods below are additive: they let the run loop AWAIT a rendezvous
    // instead of tearing down the animation frame and rebuilding it, which is
    // what the legacy pause()/resume() SimControl path does.

    /** Cheap gate so the loop skips all co-sim work on pure-analog circuits. */
    hasLiveSessions(): boolean {
        for (const c of this.chips.values()) if (c.session) return true;
        return false;
    }

    /** Pacing state for cosimPacing.ts's decision function. */
    pacingState(): { id: number; steppedTNs: number; quantumNs: number; inflight: boolean }[] {
        const out = [];
        for (const c of this.chips.values()) {
            if (!c.session || c.status === "resetting") continue;
            out.push({ id: c.id, steppedTNs: c.steppedTNs, quantumNs: c.quantumNs, inflight: c.inflight });
        }
        return out;
    }

    /**
     * Resolves once the chip's in-flight step reaches any terminal state, or
     * after `timeoutMs`. Returns null when there is nothing to wait for.
     *
     * NEVER REJECTS. The run loop awaits this on its hot path; a rejection
     * would have to be caught at the call site on pain of an unhandled
     * rejection killing the loop, and there is nothing useful for the loop to
     * do differently anyway. A timeout instead fails the chip, so a wedged
     * backend surfaces as a visible `error` rather than a frozen simulation.
     *
     * The default timeout is deliberately longer than fpgasim's own
     * REPLY_TIMEOUT_MS (5 s) so the backend's `error stage:"timeout"` -- which
     * carries the container log -- wins the race and the user gets the log
     * rather than a bare "no reply".
     */
    settled(id: number, timeoutMs = 8000): Promise<void> | null {
        const c = this.chips.get(id);
        if (!c || !c.inflight) return null;
        return new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                if (done) return;
                if (c.inflight) this.fail(c, `bridge timeout: no reply in ${timeoutMs} ms`);
                finish();
            }, timeoutMs);
            c.settleWaiters.push(finish);
        });
    }

    /**
     * Replace the SimControl installed at construction.
     *
     * The store calls this at module init so the legacy pause()/resume() path
     * cannot fight the async loop. That path still fires in one case -- a
     * quantum shorter than a single timestep makes onSimTime() send and pause
     * on the same call -- and defaultSimCtl()'s engineStore.stop() would end
     * the loop outright.
     */
    setSimControl(ctl: SimControl): void {
        this.simCtl = ctl;
    }

    /** Drain buffered intra-quantum output events: [[t_ns, PIN, v], ...] */
    takeEvents(id: number): BridgeEvent[] {
        const c = this.chips.get(id);
        if (!c) return [];
        const e = c.events;
        c.events = [];
        return e;
    }
}

export const extChipRegistry = new ExtChipRegistry();
