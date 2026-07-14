import { DiodeElm, DiodeModel } from './diode';

// Ported from ZenerElm.java: a DiodeElm with a nonzero breakdown voltage by
// default (5.6V, Java's `default_zvoltage`) so the shared Diode model's
// existing Zener-breakdown branch (see Diode.limitStep()/doStep() in
// diode.ts -- `zoffset`/`zvoltage` handling) actually activates.
//
// SIMPLIFICATION (consistent with DiodeElm's existing gap): Java looks up
// models by name through a mutable model registry (DiodeModel.
// getModelWithNameOrCopy / getModelWithParameters), including parsing a raw
// zvoltage token from old-format dumps lacking FLAG_MODEL. This port has no
// named-model registry (DiodeElm.setup() just uses `this.model` directly),
// so that raw-zvoltage-token path isn't ported either -- every ZenerElm gets
// the same default Zener model unless a future model-registry lands.
const DEFAULT_ZENER_MODEL = new DiodeModel(1.7143528192808883e-7, 0, 2, 5.6);

export class ZenerElm extends DiodeElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        this.modelName = "default-zener";
        this.model = DEFAULT_ZENER_MODEL;
        this.setup();
    }

    getDumpType() { return 'z'; }
}
