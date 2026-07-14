import { GraphicElm } from './graphic';

// Ported from TextElm.java (dump-relevant fields only -- see graphic.ts).
// Java's `lines`/split() (breaking `text` into an array on literal "\n"
// escape sequences) exists purely to lay out multi-line text on the canvas;
// with no renderer yet, `text` is kept as the single escaped string as-is
// and split() is not ported.
//
// NOTE: text may itself contain spaces/newlines, which Java encodes with
// CustomLogicModel.escape()/unescape() so a single whitespace-tokenized dump
// field survives round-tripping. This engine's Falstad-text parser is still
// a placeholder (see core/parser.ts) and doesn't implement that escape
// scheme yet, so `params[1]` here is taken as-is; wiring the actual
// escape/unescape belongs in the parser, not this class, once §7 lands.
export class TextElm extends GraphicElm {
    static FLAG_BAR = 2;
    static FLAG_ESCAPE = 4;

    text = "hello";
    size = 24;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.size = parseInt(params[0]) || 24;
            if (params.length > 1) this.text = params.slice(1).join(' ');
        }
    }

    getDumpType() { return 'x'; }
    isBar() { return (this.flags & TextElm.FLAG_BAR) !== 0; }
}
