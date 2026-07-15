import { GraphicElm } from './graphic';
import { escapeDumpText, unescapeDumpText } from './base';

// Ported from TextElm.java (dump-relevant fields only -- see graphic.ts).
// Java's `lines`/split() (breaking `text` into an array on literal "\n"
// escape sequences) exists purely to lay out multi-line text on the canvas;
// with no renderer yet, `text` is kept as the single escaped string as-is
// and split() is not ported.
//
// NOTE: text may itself contain spaces/newlines, which need to survive as a
// single whitespace-tokenized dump field. This port's own dumpTokens() (see
// below) always emits a single escaped token (params.length === 2 after the
// fixed x/y/x2/y2/flags prefix), so a dump produced by this class always
// round-trips exactly, including embedded newlines. The `params.length > 2`
// branch below is kept only for back-compat with hand-authored/legacy
// multi-token text (the tokenizer already split it on whitespace, so this
// just rejoins with single spaces -- lossy for embedded newlines or repeated
// spaces, same limitation as before escaping existed).
export class TextElm extends GraphicElm {
    static FLAG_BAR = 2;
    static FLAG_ESCAPE = 4;

    text = "hello";
    size = 24;

    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        if (Array.isArray(params) && params.length > 0) {
            this.size = parseInt(params[0]) || 24;
            if (params.length === 2) {
                this.text = unescapeDumpText(params[1]);
            } else if (params.length > 2) {
                this.text = params.slice(1).join(' ');
            }
        }
    }

    getDumpType() { return 'x'; }
    dumpTokens() { return [this.size, escapeDumpText(this.text)]; }
    isBar() { return (this.flags & TextElm.FLAG_BAR) !== 0; }
}
