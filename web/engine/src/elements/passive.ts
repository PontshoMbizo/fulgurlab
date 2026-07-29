import { CircuitElm, Stamper, escapeDumpText, unescapeDumpText } from './base';
import { CapacitorElm } from './capacitor';

// Two-terminal passive/state-dependent elements ported from Java. Everything
// here is a plain CircuitElm whose conductance is recomputed once per timestep
// in startIteration() and stamped in doStep() — the standard Falstad pattern
// for "resistor whose value depends on its own history".
//
// SLIDER-DRIVEN ELEMENTS (ThermistorNTCElm, LDRElm): Java drives `position`
// from a GWT Scrollbar docked in a side panel. This port has no such panel, so
// `position` is a plain field exposed through the edit dialog instead — same
// electrical behaviour, same dump shape. This is the precedent VarRailElm
// already set (see voltage.ts).

// ---------------------------------------------------------------- Memristor

export class MemristorElm extends CircuitElm {
    r_on = 100;
    r_off = 16000;
    dopeWidth = 0;
    totalWidth = 10e-9;  // meters
    mobility = 1e-10;    // m^2/sV
    resistance = 100;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 5) {
            this.r_on = parseFloat(params[0]);
            this.r_off = parseFloat(params[1]);
            this.dopeWidth = parseFloat(params[2]);
            this.totalWidth = parseFloat(params[3]);
            this.mobility = parseFloat(params[4]);
            if (params.length > 5) {
                const c = parseFloat(params[5]);
                if (Number.isFinite(c)) this.current = c;
            }
        } else {
            this.r_off = 160 * this.r_on;
        }
        this.resistance = 100;
    }

    getDumpType() { return 'm'; }
    dumpTokens() {
        return [this.r_on, this.r_off, this.dopeWidth, this.totalWidth, this.mobility, this.current];
    }

    nonLinear() { return true; }
    reset() { this.dopeWidth = 0; }

    startIteration(stamper: Stamper): void {
        const wd = this.dopeWidth / this.totalWidth;
        this.dopeWidth += stamper.timeStep * this.mobility * this.r_on * this.current / this.totalWidth;
        if (this.dopeWidth < 0) this.dopeWidth = 0;
        if (this.dopeWidth > this.totalWidth) this.dopeWidth = this.totalWidth;
        this.resistance = this.r_on * wd + this.r_off * (1 - wd);
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
    }
    doStep(stamper: Stamper): void {
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    calculateCurrent(): void {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}

// ---------------------------------------------------------- PolarCapacitor

// A CapacitorElm that additionally trips the simulation stop when its reverse
// voltage exceeds maxNegativeVoltage. This port has no sim.stop() equivalent
// reachable from an element, so the condition is surfaced as a public flag
// (`exceededReverseVoltage`) plus `stopMessage`, which the engine reads.
export class PolarCapacitorElm extends CapacitorElm {
    maxNegativeVoltage = 1;
    exceededReverseVoltage = false;
    stopMessage: string | null = null;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[] | number) {
        super(x, y, x2, y2, flags, params);
        if (Array.isArray(params) && params.length > 3) {
            const v = parseFloat(params[3]);
            if (Number.isFinite(v)) this.maxNegativeVoltage = v;
        }
    }

    getDumpType() { return 209; }
    dumpTokens(): (string | number | boolean)[] {
        // CapacitorElm's constructor reads [capacitance, initialVoltage,
        // seriesResistance]; maxNegativeVoltage is appended after them, which
        // is the slot this class's own constructor reads it back from.
        const base = super.dumpTokens();
        while (base.length < 3) base.push(0);
        return [...base, this.maxNegativeVoltage];
    }

    reset(): void {
        super.reset();
        this.exceededReverseVoltage = false;
        this.stopMessage = null;
    }

    stepFinished(stamper: Stamper): void {
        const vd = this.getVoltageDiff();
        if (vd < 0 && vd < -this.maxNegativeVoltage) {
            this.exceededReverseVoltage = true;
            this.stopMessage = 'capacitor exceeded max reverse voltage';
        }
        super.stepFinished(stamper);
    }
}

// --------------------------------------------------------------- TunnelDiode

// Empirical tunnel-diode I(V) — the constants are the germanium 1N3716-ish
// parameters hard-coded in TunnelDiodeElm.java, not editable there either.
export class TunnelDiodeElm extends CircuitElm {
    static pvp = 0.1;
    static pip = 4.7e-3;
    static pvv = 0.37;
    static pvt = 0.026;
    static pvpp = 0.525;
    static piv = 370e-6;

    lastvoltdiff = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, _params?: string[]) {
        super(x, y, x2, y2, flags);
    }

    getDumpType() { return 175; }
    nonLinear() { return true; }

    reset(): void {
        this.lastvoltdiff = 0;
        this.volts[0] = this.volts[1] = 0;
    }

    // Java's comment says it "should be much harder than this to prevent
    // convergence problems"; kept byte-for-byte so results match the oracle.
    private limitStep(vnew: number, vold: number): number {
        if (vnew > vold + 1) return vold + 1;
        if (vnew < vold - 1) return vold - 1;
        return vnew;
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
    }

    doStep(stamper: Stamper): void {
        const { pvp, pip, pvv, pvt, pvpp, piv } = TunnelDiodeElm;
        let voltdiff = this.volts[0] - this.volts[1];
        if (Math.abs(voltdiff - this.lastvoltdiff) > 0.01) stamper.converged = false;
        voltdiff = this.limitStep(voltdiff, this.lastvoltdiff);
        this.lastvoltdiff = voltdiff;

        const i0 = piv * Math.exp(-pvv);
        const i = pip * Math.exp(-pvpp / pvt) * (Math.exp(voltdiff / pvt) - 1)
            + pip * (voltdiff / pvp) * Math.exp(1 - voltdiff / pvp)
            + piv * Math.exp(voltdiff - pvv) - i0;
        const geq = pip * Math.exp(-pvpp / pvt) * Math.exp(voltdiff / pvt) / pvt
            + pip * Math.exp(1 - voltdiff / pvp) / pvp
            - Math.exp(1 - voltdiff / pvp) * pip * voltdiff / (pvp * pvp)
            + Math.exp(voltdiff - pvv) * piv;
        const nc = i - geq * voltdiff;
        stamper.stampConductance(this.nodes[0], this.nodes[1], geq);
        stamper.stampCurrentSource(this.nodes[0], this.nodes[1], nc);
    }

    calculateCurrent(): void {
        const { pvp, pip, pvv, pvt, pvpp, piv } = TunnelDiodeElm;
        const voltdiff = this.volts[0] - this.volts[1];
        const i0 = piv * Math.exp(-pvv);
        this.current = pip * Math.exp(-pvpp / pvt) * (Math.exp(voltdiff / pvt) - 1)
            + pip * (voltdiff / pvp) * Math.exp(1 - voltdiff / pvp)
            + piv * Math.exp(voltdiff - pvv) - i0;
    }
}

// ----------------------------------------------------------------- SparkGap

export class SparkGapElm extends CircuitElm {
    onresistance = 1e3;
    offresistance = 1e9;
    breakdown = 1e3;
    holdcurrent = 0.001;
    state = false;
    resistance = 1e9;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 4) {
            this.onresistance = parseFloat(params[0]);
            this.offresistance = parseFloat(params[1]);
            this.breakdown = parseFloat(params[2]);
            this.holdcurrent = parseFloat(params[3]);
        }
        this.resistance = this.offresistance;
    }

    getDumpType() { return 187; }
    dumpTokens() { return [this.onresistance, this.offresistance, this.breakdown, this.holdcurrent]; }
    nonLinear() { return true; }

    reset(): void {
        super.reset();
        this.state = false;
    }

    startIteration(_stamper: Stamper): void {
        if (Math.abs(this.current) < this.holdcurrent) this.state = false;
        const vd = this.volts[0] - this.volts[1];
        if (Math.abs(vd) > this.breakdown) this.state = true;
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
    }
    doStep(stamper: Stamper): void {
        this.resistance = this.state ? this.onresistance : this.offresistance;
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    calculateCurrent(): void {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}

// --------------------------------------------------------------------- Fuse

export class FuseElm extends CircuitElm {
    static FLAG_IEC_SYMBOL = 1;
    static blownResistance = 1e9;

    // Littelfuse 218-series defaults, same as Java's.
    resistance = 0.0613;
    i2t = 6.73;
    heat = 0;
    blown = false;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 4) {
            this.resistance = parseFloat(params[0]);
            this.i2t = parseFloat(params[1]);
            this.heat = parseFloat(params[2]);
            this.blown = params[3] === 'true';
        }
    }

    getDumpType() { return 404; }
    dumpTokens() { return [this.resistance, this.i2t, this.heat, this.blown]; }
    nonLinear() { return true; }
    isIECSymbol() { return (this.flags & FuseElm.FLAG_IEC_SYMBOL) !== 0; }

    reset(): void {
        super.reset();
        this.heat = 0;
        this.blown = false;
    }

    getPower(): number { return this.getVoltageDiff() * this.current; }

    startIteration(stamper: Stamper): void {
        const i = this.current;
        this.heat += i * i * stamper.timeStep;
        // Java assumes the fuse dissipates its whole i2t budget in 3 seconds.
        this.heat -= stamper.timeStep * this.i2t / 3;
        if (this.heat < 0) this.heat = 0;
        if (this.heat > this.i2t) this.blown = true;
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
    }
    doStep(stamper: Stamper): void {
        stamper.stampResistor(this.nodes[0], this.nodes[1],
            this.blown ? FuseElm.blownResistance : this.resistance);
    }
    calculateCurrent(): void {
        this.current = (this.volts[0] - this.volts[1])
            / (this.blown ? FuseElm.blownResistance : this.resistance);
    }
}

// --------------------------------------------------------------------- Lamp

// Incandescent bulb with a thermal model (resistance rises with filament
// temperature). Formula from http://www.intusoft.com/nlpdf/nl11.pdf, as cited
// in LampElm.java.
export class LampElm extends CircuitElm {
    static roomTemp = 300;

    temp = LampElm.roomTemp;
    nom_pow = 100;
    nom_v = 120;
    warmTime = 0.4;
    coolTime = 0.4;
    resistance = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 5) {
            const t = parseFloat(params[0]);
            this.temp = Number.isNaN(t) ? LampElm.roomTemp : t;
            this.nom_pow = parseFloat(params[1]);
            this.nom_v = parseFloat(params[2]);
            this.warmTime = parseFloat(params[3]);
            this.coolTime = parseFloat(params[4]);
        }
        this.updateResistance(0);
    }

    getDumpType() { return 181; }
    dumpTokens() { return [this.temp, this.nom_pow, this.nom_v, this.warmTime, this.coolTime]; }
    nonLinear() { return true; }

    reset(): void {
        super.reset();
        this.temp = LampElm.roomTemp;
        this.updateResistance(0);
    }

    getPower(): number { return this.getVoltageDiff() * this.current; }

    // Java folds the resistance update and the thermal integration into one
    // startIteration(); split here so the constructor/reset can prime
    // `resistance` without advancing temperature (Java calls startIteration()
    // with sim.timeStep still 0 there, which has the same effect).
    private updateResistance(timeStep: number): void {
        const nom_r = this.nom_v * this.nom_v / this.nom_pow;
        // The fit blows up above 5390 K.
        const tp = this.temp > 5390 ? 5390 : this.temp;
        this.resistance = nom_r * (1.26104
            - 4.90662 * Math.sqrt(17.1839 / tp - 0.00318794)
            - 7.8569 / (tp - 187.56));
        if (timeStep === 0) return;
        const cap = 1.57e-4 * this.nom_pow;
        const capw = cap * this.warmTime / 0.4;
        const capc = cap * this.coolTime / 0.4;
        this.temp += this.getPower() * timeStep / capw;
        const cr = 2600 / this.nom_pow;
        this.temp -= timeStep * (this.temp - LampElm.roomTemp) / (capc * cr);
    }

    startIteration(stamper: Stamper): void {
        this.updateResistance(stamper.timeStep);
    }

    stamp(stamper: Stamper): void {
        stamper.stampNonLinear(this.nodes[0]);
        stamper.stampNonLinear(this.nodes[1]);
    }
    doStep(stamper: Stamper): void {
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    calculateCurrent(): void {
        this.current = this.resistance === 0 ? 0 : (this.volts[0] - this.volts[1]) / this.resistance;
    }
}

// ------------------------------------------------------------ ThermistorNTC

export class ThermistorNTCElm extends CircuitElm {
    static t0 = 273.15;
    static t25 = 273.15 + 25;

    r25 = 10000;   // Vishay NTCLE100E3010 defaults, same as Java's
    r50 = 3605;
    minTempr = -40;
    maxTempr = 150;
    position = 0.34; // 25 degC over the -40..150 range
    sliderText = 'Temperature';
    b25100 = 0;
    temperature = 25;
    resistance = 10000;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 5) {
            this.r25 = parseFloat(params[0]);
            this.r50 = parseFloat(params[1]);
            this.minTempr = parseFloat(params[2]);
            this.maxTempr = parseFloat(params[3]);
            this.position = parseFloat(params[4]);
            if (params.length > 5) this.sliderText = unescapeDumpText(params[5]);
        }
        this.recalc();
    }

    getDumpType() { return 350; }
    dumpTokens() {
        return [this.r25, this.r50, this.minTempr, this.maxTempr, this.position,
            escapeDumpText(this.sliderText)];
    }

    calcB25100(): number {
        const kelvin1 = ThermistorNTCElm.t0 + 25;
        const kelvin2 = ThermistorNTCElm.t0 + 50;
        return (Math.log(this.r25) - Math.log(this.r50)) / ((1 / kelvin1) - (1 / kelvin2));
    }
    calcResistance(tempr: number): number {
        return Math.round(this.r25 * Math.exp(this.b25100 * ((1 / (tempr + ThermistorNTCElm.t0)) - (1 / ThermistorNTCElm.t25))));
    }
    temprFromSliderPos(): number {
        return Math.round(this.position * (this.maxTempr - this.minTempr) + this.minTempr);
    }

    // Call after changing r25/r50/position from the UI.
    recalc(): void {
        this.b25100 = this.calcB25100();
        this.temperature = this.temprFromSliderPos();
        this.resistance = this.calcResistance(this.temperature);
    }

    stamp(stamper: Stamper): void {
        this.recalc();
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    calculateCurrent(): void {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}

// ---------------------------------------------------------------------- LDR

export class LDRElm extends CircuitElm {
    minLux = 0.1;     // dark
    maxLux = 10000;   // sunlight
    position = 0.34;
    sliderText = 'Lux';
    lux = 0;
    resistance = 0;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length >= 1) {
            this.position = parseFloat(params[0]);
            if (params.length > 1) this.sliderText = unescapeDumpText(params[1]);
        }
        this.recalc();
    }

    getDumpType() { return 374; }
    dumpTokens() { return [this.position, escapeDumpText(this.sliderText)]; }

    luxFromSliderPos(): number { return this.maxLux * this.position + this.minLux; }
    calcResistance(lux: number): number { return Math.round((this.maxLux - lux + 1) * 10); }

    recalc(): void {
        this.lux = this.luxFromSliderPos();
        this.resistance = this.calcResistance(this.lux);
    }

    stamp(stamper: Stamper): void {
        this.recalc();
        stamper.stampResistor(this.nodes[0], this.nodes[1], this.resistance);
    }
    calculateCurrent(): void {
        this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    }
}
