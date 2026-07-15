"use client";

import { CircuitEngine, CircuitElm } from "@fulgurlab/engine";

// Single engine instance owned outside React state (plan §3.2: "the React
// app owns a single engine instance outside React state"). React components
// subscribe via useSyncExternalStore against `version`, which bumps on every
// completed step or circuit mutation. The canvas itself does NOT go through
// React per frame -- it reads engine.elmList directly in its own rAF loop;
// `version` is only for UI chrome (toolbar/inspector) that needs a re-render.
export type RunStatus =
    | { state: "idle" }
    | { state: "running" }
    | { state: "error"; message: string };

class EngineStore {
    engine = new CircuitEngine();
    version = 0;
    status: RunStatus = { state: "idle" };
    selected: CircuitElm | null = null;

    private listeners = new Set<() => void>();
    private rafHandle: number | null = null;
    stepsPerFrame = 4;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getVersion = () => this.version;

    private bump() {
        this.version++;
        for (const l of this.listeners) l();
    }

    // Re-run analysis after any circuit-shape mutation (add/remove/move
    // element). Safe to call on an incomplete circuit -- the Analyzer's
    // unconnected-node handling (a large resistor to ground) means a
    // dangling half-built circuit just reads ~0V rather than crashing.
    reanalyze() {
        try {
            this.engine.analyzeAndStamp();
            if (this.status.state === "error") this.status = { state: "idle" };
        } catch (e) {
            this.status = { state: "error", message: e instanceof Error ? e.message : String(e) };
        }
        this.bump();
    }

    addElement(elm: CircuitElm) {
        elm.preStamp();
        this.engine.elmList = [...this.engine.elmList, elm];
        this.reanalyze();
    }

    removeElement(elm: CircuitElm) {
        this.engine.elmList = this.engine.elmList.filter(e => e !== elm);
        if (this.selected === elm) this.selected = null;
        this.reanalyze();
    }

    clear() {
        this.engine.clear();
        this.selected = null;
        this.status = { state: "idle" };
        this.bump();
    }

    select(elm: CircuitElm | null) {
        this.selected = elm;
        this.bump();
    }

    stepOnceSafe(): boolean {
        try {
            this.engine.stepOnce();
            return true;
        } catch (e) {
            this.status = { state: "error", message: e instanceof Error ? e.message : String(e) };
            this.stop();
            return false;
        }
    }

    isRunning() { return this.rafHandle !== null; }

    run() {
        if (this.rafHandle !== null) return;
        this.status = { state: "running" };
        const loop = () => {
            for (let i = 0; i < this.stepsPerFrame; i++) {
                if (!this.stepOnceSafe()) break;
            }
            this.bump();
            if (this.rafHandle !== null) {
                this.rafHandle = requestAnimationFrame(loop);
            }
        };
        this.rafHandle = requestAnimationFrame(loop);
        this.bump();
    }

    stop() {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.status.state === "running") this.status = { state: "idle" };
        this.bump();
    }

    step() {
        this.stop();
        this.stepOnceSafe();
        this.bump();
    }

    // "Reset simulation" (the floating status cluster's reset button) --
    // rewinds time and re-stamps fresh matrices without touching the
    // circuit's topology, unlike clear() which deletes every element. This
    // matches Falstad's own Reset button: same circuit, t back to 0, any
    // accumulated capacitor/inductor state reinitialized by the fresh
    // analyzeAndStamp() (new zeroed lastNodeVoltages/nodeVoltages).
    resetTime() {
        this.stop();
        this.engine.t = 0;
        this.engine.timeStepAccum = 0;
        this.reanalyze();
    }
}

// One instance for the whole app (module singletons are per-tab in Next's
// client bundle, which is exactly the single-circuit-editor scope we want).
export const engineStore = new EngineStore();
