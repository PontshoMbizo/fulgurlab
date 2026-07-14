import { DiodeElm } from './diode';

// Ported from LEDElm.java (extends DiodeElm; adds RGB color + brightness scale
// which are draw-only concerns for now, kept as plain data).
export class LEDElm extends DiodeElm {
    colorR = 1;
    colorG = 0;
    colorB = 0;
    maxBrightnessCurrent = 0.01;
    static lastLEDModelName = "default-led";

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags, params);
        if (Array.isArray(params) && params.length > 0) {
            // Java's dump order puts the (optional) model name first when
            // FLAG_MODEL/FLAG_FWDROP is set (consumed by the DiodeElm ctor above);
            // the RGB + brightness tokens follow.
            let offset = 0;
            if ((flags & 2) !== 0 || (flags & 1) !== 0) {
                offset = 1;
            }
            if (params.length > offset) {
                this.colorR = parseFloat(params[offset]) || 1;
                this.colorG = parseFloat(params[offset + 1]) || 0;
                this.colorB = parseFloat(params[offset + 2]) || 0;
                if (params.length > offset + 3) {
                    this.maxBrightnessCurrent = parseFloat(params[offset + 3]) || 0.01;
                }
            }
        }
        this.modelName = LEDElm.lastLEDModelName;
    }

    getDumpType() { return '162'; }
}
