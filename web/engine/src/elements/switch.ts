import { CircuitElm } from './base';

// Ported from SwitchElm.java. position 0 = closed (wire-equivalent), 1 = open.
export class SwitchElm extends CircuitElm {
    momentary = false;
    position = 0;
    posCount = 2;
    static FLAG_IEC = 2;
    static FLAG_LABEL = 4;
    label: string | null = null;
    keyShortcut: string | null = null;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            const str = params[0];
            if (str === "true") {
                this.position = 1;
            } else if (str === "false") {
                this.position = 0;
            } else {
                this.position = parseInt(str) || 0;
            }
            if (params.length > 1) {
                this.momentary = params[1] === "true";
            }
        }
    }

    getDumpType() { return 's'; }
    // position dumped as a plain 0/1 (the constructor's parseInt fallback
    // path handles that); momentary relies on the constructor's strict
    // `params[1] === "true"` string comparison, so it must be emitted as the
    // literal words "true"/"false" -- which is exactly what Array.join(' ')
    // produces from a boolean, so no special-casing is needed here.
    dumpTokens() { return [this.position, this.momentary]; }
    getConnection(n1: number, n2: number) { return this.position === 0; }
    isWireEquivalent() { return this.position === 0; }
    isRemovableWire() { return this.position === 0; }

    calculateCurrent() {
        if (this.position === 1) {
            this.current = 0;
        }
    }

    simpleToggle() {
        this.position++;
        if (this.position >= this.posCount) {
            this.position = 0;
        }
    }

    // NOTE: Java's toggle() also re-syncs any other switches sharing a "link"
    // group (Switch2Elm) by walking sim.elmList. CircuitElm has no back-reference
    // to the engine/elmList yet, so cross-switch linking isn't wired up here —
    // only Switch2Elm (SPDT) uses link groups, and its own toggle() documents the
    // same gap.
    toggle() {
        this.simpleToggle();
    }
}
