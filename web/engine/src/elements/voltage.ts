import { CircuitElm, Stamper, escapeDumpText, unescapeDumpText } from './base';
import { CircuitNode, VoltageSource } from '../core/node';

// Ported from VoltageElm.java. waveform constants and phase/duty-cycle handling
// match the Java source; getVoltage(t) mirrors VoltageElm.getVoltage() exactly
// (including the square/pulse rise-time ramps).
export class VoltageElm extends CircuitElm {
    static FLAG_COS = 2;
    static FLAG_PULSE_DUTY = 4;
    static FLAG_CIRCLE_SYMBOL = 8;
    static FLAG_SHOW_VOLTAGE = 16;
    static FLAG_TIME_SPEC = 32;

    static WF_DC = 0;
    static WF_AC = 1;
    static WF_SQUARE = 2;
    static WF_TRIANGLE = 3;
    static WF_SAWTOOTH = 4;
    static WF_PULSE = 5;
    static WF_NOISE = 6;
    static WF_VAR = 7;
    static defaultPulseDuty = 1 / (2 * Math.PI);

    waveform = 0;
    maxVoltage = 5;
    frequency = 40;
    freqTimeZero = 0;
    bias = 0;
    phaseShift = 0;
    dutyCycle = 0.5;
    noiseValue = 0;
    riseTime = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags);
        if (typeof params === 'number') {
            this.waveform = params;
        } else if (Array.isArray(params) && params.length > 0) {
            this.waveform = parseInt(params[0]) || 0;
            this.frequency = params.length > 1 ? parseFloat(params[1]) : 40;
            this.maxVoltage = params.length > 2 ? parseFloat(params[2]) : 5;
            this.bias = params.length > 3 ? parseFloat(params[3]) : 0;
            this.phaseShift = params.length > 4 ? parseFloat(params[4]) : 0;
            this.dutyCycle = params.length > 5 ? parseFloat(params[5]) : 0.5;
        } else {
            this.waveform = 0;
        }
        this.reset();
        if ((this.flags & VoltageElm.FLAG_COS) !== 0) {
            this.flags &= ~VoltageElm.FLAG_COS;
            this.phaseShift = Math.PI / 2;
        }
        if ((this.flags & VoltageElm.FLAG_PULSE_DUTY) === 0 && this.waveform === VoltageElm.WF_PULSE) {
            this.dutyCycle = VoltageElm.defaultPulseDuty;
        }
    }

    reset() {
        super.reset();
        this.freqTimeZero = 0;
    }

    getDumpType() { return 'v'; }
    // Order matches this class's own constructor's `params` reads exactly:
    // waveform, frequency, maxVoltage, bias, phaseShift, dutyCycle. RailElm
    // inherits this unchanged (same constructor, same fields); ClockElm
    // overrides it below since its constructor's params shape is different
    // (no waveform token -- it's fixed to WF_SQUARE).
    dumpTokens(): (string | number | boolean)[] { return [this.waveform, this.frequency, this.maxVoltage, this.bias, this.phaseShift, this.dutyCycle]; }
    getVoltageSourceCount() { return 1; }
    isVoltageSource() { return true; }

    // BUGFIX (found via dependent-source verification, see dependent_sources.ts):
    // Java's VoltageElm.setVoltageSource() (:131-134) always calls
    // v.setNodes(nodes[0], nodes[1]) -- this port's version silently didn't.
    // Without it, VoltageSource.n1/n2 stay null and assignMatrix() (node.ts)
    // falls all the way back to "elm's last post's matrix", which is null
    // whenever that particular post happens to BE the literal ground node --
    // producing a crash in stampMatrixVSNode/VSVS/NodeVS. Harmless for plain
    // 2-post VoltageElm usage so far (both posts are always in the same
    // matrix by default getMatrixConnection(), so this was a no-op change for
    // every existing passing test) but a real latent gap for e.g. "a battery
    // wired directly across ground" where ground happens to land on post[1].
    // RailElm/ClockElm/VarRailElm/AntennaElm (getPostCount()=1) inherit this
    // unchanged too: nodes[1] is out-of-bounds for them, same as it would be
    // in the real GWT-compiled oracle (nodes[] is allocated to exactly
    // getPostCount() length there as well, see CircuitElm.java:226-233) --
    // both runtimes silently read back `undefined`/out-of-bounds as the
    // *second* argument, and assignMatrix() only ever consults n1 (nodes[0],
    // always their own real, non-ground post) before touching n2, so this
    // is byte-faithful rather than a new fragility this port introduced.
    setVoltageSource(j: number, vs: VoltageSource) {
        this.voltSource = vs;
        vs.setNodes(this.nodes[0], this.nodes[1]);
    }

    triangleFunc(x: number): number {
        if (x < Math.PI) return x * (2 / Math.PI) - 1;
        return 1 - (x - Math.PI) * (2 / Math.PI);
    }

    getVoltage(t: number): number {
        const w = 2 * Math.PI * (t - this.freqTimeZero) * this.frequency + this.phaseShift;
        switch (this.waveform) {
            case VoltageElm.WF_DC: return this.maxVoltage + this.bias;
            case VoltageElm.WF_AC: return Math.sin(w) * this.maxVoltage + this.bias;
            case VoltageElm.WF_SQUARE: {
                const wm = w % (2 * Math.PI);
                const dutyPhase = 2 * Math.PI * this.dutyCycle;
                if (this.riseTime > 0) {
                    const risePhase = this.riseTime * this.frequency * 2 * Math.PI;
                    const halfRise = risePhase / 2;
                    if (wm < halfRise) {
                        const tRatio = (wm + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (2 * tRatio - 1);
                    } else if (wm < dutyPhase - halfRise) {
                        return this.bias + this.maxVoltage;
                    } else if (wm < dutyPhase + halfRise) {
                        const tRatio = (wm - dutyPhase + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (1 - 2 * tRatio);
                    } else if (wm < 2 * Math.PI - halfRise) {
                        return this.bias - this.maxVoltage;
                    } else {
                        const tRatio = (wm - (2 * Math.PI - halfRise)) / risePhase;
                        return this.bias + this.maxVoltage * (2 * tRatio - 1);
                    }
                }
                return this.bias + ((wm > dutyPhase) ? -this.maxVoltage : this.maxVoltage);
            }
            case VoltageElm.WF_TRIANGLE:
                return this.bias + this.triangleFunc(w % (2 * Math.PI)) * this.maxVoltage;
            case VoltageElm.WF_SAWTOOTH:
                return this.bias + (w % (2 * Math.PI)) * (this.maxVoltage / Math.PI) - this.maxVoltage;
            case VoltageElm.WF_PULSE: {
                const wm = w % (2 * Math.PI);
                const dutyPhase = 2 * Math.PI * this.dutyCycle;
                if (this.riseTime > 0) {
                    const risePhase = this.riseTime * this.frequency * 2 * Math.PI;
                    const halfRise = risePhase / 2;
                    if (wm < halfRise) {
                        const tRatio = (wm + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * tRatio;
                    } else if (wm < dutyPhase - halfRise) {
                        return this.bias + this.maxVoltage;
                    } else if (wm < dutyPhase + halfRise) {
                        const tRatio = (wm - dutyPhase + halfRise) / risePhase;
                        return this.bias + this.maxVoltage * (1 - tRatio);
                    } else if (wm < 2 * Math.PI - halfRise) {
                        return this.bias;
                    } else {
                        const tRatio = (wm - (2 * Math.PI - halfRise)) / risePhase;
                        return this.bias + this.maxVoltage * tRatio;
                    }
                }
                return (wm < dutyPhase) ? this.maxVoltage + this.bias : this.bias;
            }
            case VoltageElm.WF_NOISE:
                return this.noiseValue;
            default:
                return 0;
        }
    }

    stamp(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_DC) {
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(stamper.t));
        } else {
            stamper.stampVoltageSource(this.nodes[0], this.nodes[1], this.voltSource);
        }
    }

    doStep(stamper: Stamper) {
        if (this.waveform !== VoltageElm.WF_DC) {
            stamper.updateVoltageSource(this.nodes[0], this.nodes[1], this.voltSource, this.getVoltage(stamper.t));
        }
    }

    stepFinished(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_NOISE) {
            this.noiseValue = (Math.random() * 2 - 1) * this.maxVoltage + this.bias;
        }
    }

    // BUGFIX (see VoltageSource.current's comment in core/node.ts, and
    // CircuitElm.setCurrent()'s comment in base.ts): this element's current
    // flows entirely through its own voltage source -- there is no Ohm's-
    // law-style derivation from volts[] the way a resistor/capacitor
    // computes calculateCurrent(). No override needed here anymore: the
    // base CircuitElm.setCurrent(vs, c) default (`current = c`) already
    // gets dispatched correctly by CircuitEngine.applySolvedRightSide() for
    // any element with exactly one voltage source, which this class always
    // has (getVoltageSourceCount() returns 1 above) -- byte-faithful to
    // Java, which doesn't override setCurrent() on VoltageElm either.
}

// Ported from RailElm.java: a one-post voltage source referenced to ground.
export class RailElm extends VoltageElm {
    static FLAG_CLOCK = 1;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
    }

    getDumpType() { return 'R'; }
    getPostCount() { return 1; }
    hasGroundConnection(n1: number) { return true; }
    isRail() { return true; }
    // BUGFIX (found this session via the new Power-group verification
    // script, not by inspection): the base CircuitElm.getVoltageDiff()
    // default is `volts[0] - volts[1]`, which is only correct for 2-post
    // elements. RailElm overrides getPostCount() to 1, so `volts` is
    // allocated with length 1 (see CircuitElm.allocNodes()) and volts[1] is
    // always undefined -- every RailElm/ClockElm (and now VarRailElm/
    // AntennaElm) instance has been returning NaN from getVoltageDiff()
    // since this class was written. The circuit SOLVE itself was never
    // affected (stamp()/doStep() call getVoltage(t) directly, not this
    // method) -- only display/measurement consumers were: voltage-based
    // symbol coloring (silently falls back to a 0V color via symbols.tsx's
    // safeVoltageDiff() try/catch, which only catches thrown errors, not
    // NaN) and, more importantly, Scope probe channels in "voltage" mode
    // (EngineStore.recordScopeSamples() calls this directly) -- probing a
    // Rail or Clock element would have recorded an all-NaN trace. Matches
    // the same single-post override already applied to OutputElm/GroundElm/
    // LabeledNodeElm/AmmeterElm (see base.ts's own getVoltageDiff() comment).
    getVoltageDiff() { return this.volts[0]; }

    stamp(stamper: Stamper) {
        if (this.waveform === VoltageElm.WF_DC) {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
        } else {
            stamper.stampVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource);
        }
    }

    doStep(stamper: Stamper) {
        if (this.waveform !== VoltageElm.WF_DC) {
            stamper.updateVoltageSource(CircuitNode.ground, this.nodes[0], this.voltSource, this.getVoltage(stamper.t));
        }
    }

    validateRailNode(n: number) { return true; }
    validate() { return this.validateRailNode(0); }
}

// Ported from ClockElm.java: a RailElm preset to a 0/2.5V+2.5V-bias square wave.
//
// It is a PALETTE PRESET, not a dump type of its own. Java's ClockElm declares
// `getDumpClass() { return RailElm.class; }` and overrides neither
// getDumpType() nor getXmlDumpType(), so a clock serializes as a plain
// RailElm ('R') carrying RailElm.FLAG_CLOCK in its flags word, and reloads as
// a RailElm — exactly like ACRailElm/SquareRailElm/NoiseElm, which this port
// already models as presets. An earlier draft here gave ClockElm its own dump
// id '164' and registered that in the factory; 164 is really CounterElm
// (CounterElm.java:174), so every counter in a Java-saved file silently loaded
// as a 1-post clock. See elements/sequential.ts.
export class ClockElm extends RailElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        if (Array.isArray(params) && params.length > 0) {
            super(x, y, x2, y2, flags, params);
        } else {
            super(x, y, x2, y2, flags, VoltageElm.WF_SQUARE);
            this.maxVoltage = 2.5;
            this.bias = 2.5;
            this.frequency = 100;
        }
        this.flags |= RailElm.FLAG_CLOCK;
    }
    // getDumpType()/dumpTokens() deliberately NOT overridden — inherited 'R'
    // plus VoltageElm's [waveform, frequency, maxVoltage, bias, phaseShift,
    // dutyCycle], which is what Java writes and what the 'R' factory entry
    // reads back.
}

// Ported from VarRailElm.java: a RailElm whose output voltage is directly
// adjustable at runtime. Java drives this from a GWT Scrollbar widget docked
// in a side panel, which recomputes `frequency` -- reused to mean "current
// output voltage", a real field-naming quirk in the oracle, not a typo here
// -- on every getVoltage() call. This port has no side-panel slider, so the
// same field is exposed directly through the schema-driven edit dialog/
// Inspector instead: same electrical behavior (an arbitrary constant output
// between bias and maxVoltage), simpler mechanism, consistent with how the
// rest of this port replaces GWT-specific widgets with React equivalents.
export class VarRailElm extends RailElm {
    sliderText = "Voltage";

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.waveform = VoltageElm.WF_VAR;
        if (Array.isArray(params) && params.length > 6) {
            this.sliderText = unescapeDumpText(params[6]);
        } else {
            // Fresh placement: Java's 2-arg constructor sets frequency =
            // maxVoltage (i.e. the slider starts at 100%, output = max).
            this.frequency = this.maxVoltage;
        }
    }

    getDumpType() { return '172'; }
    // Base RailElm/VoltageElm tokens (waveform is always WF_VAR here) plus
    // this class's own appended sliderText, matching the constructor's read
    // order above.
    dumpTokens(): (string | number | boolean)[] {
        return [...super.dumpTokens(), escapeDumpText(this.sliderText)];
    }

    // Java recomputes `frequency` from the live slider position on every
    // call; here `frequency` IS the directly-editable value (schema-driven),
    // so getVoltage() just returns it as-is -- same field, same meaning.
    getVoltage(_t: number): number { return this.frequency; }
}

// Ported from AntennaElm.java: a RailElm preset to a synthesized "radio
// noise" signal (three summed amplitude-modulated tones), per the Java
// source's own label ("Antenna (amplified)") -- not a real antenna input.
// Keeps its OWN dump identity ('A'), unlike ACRailElm/SquareRailElm/
// NoiseElm, which all dump as plain RailElm via Java's getDumpClass()
// override (see palette.ts -- those three need no dedicated TS class).
export class AntennaElm extends RailElm {
    fmphase = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _params?: string[]) {
        super(x, y, x2, y2, flags, VoltageElm.WF_AC);
        // Java's constructors (both the fresh 2-arg and the StringTokenizer
        // one) force waveform = WF_AC unconditionally -- there's no dumped
        // token for it, since dumpTokens() below never emits the base
        // VoltageElm fields (they aren't meaningful for this element's own
        // getVoltage() override).
        this.waveform = VoltageElm.WF_AC;
    }

    getDumpType() { return 'A'; }
    // fmphase is runtime-only (reset via the constructor, advanced by
    // stepFinished()), never persisted -- just the base geometry+flags.
    dumpTokens(): (string | number | boolean)[] { return []; }

    getVoltage(t: number): number {
        const fm = 3 * Math.sin(this.fmphase);
        return Math.sin(2 * Math.PI * t * 3000) * (1.3 + Math.sin(2 * Math.PI * t * 12)) * 3 +
            Math.sin(2 * Math.PI * t * 2710) * (1.3 + Math.sin(2 * Math.PI * t * 13)) * 3 +
            Math.sin(2 * Math.PI * t * 2433) * (1.3 + Math.sin(2 * Math.PI * t * 14)) * 3 + fm;
    }

    stepFinished(stamper: Stamper) {
        this.fmphase += 2 * Math.PI * (2200 + Math.sin(2 * Math.PI * stamper.t * 13) * 100) * stamper.timeStep;
    }
}
