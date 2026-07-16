// Minimal hand-written s-expression reader for KiCad's `.kicad_sym` format
// (and, incidentally, any other KiCad s-expr file -- schematics/footprints
// use the same grammar). KiCad's own file format has no public grammar spec
// beyond "it's an s-expression, see the sexpr.h writer in the source" -- this
// parser targets exactly the subset KiCad 6/7/8 actually emits: parenthesized
// lists, double-quoted strings (with backslash escapes), and bare atoms
// (identifiers/numbers/booleans), never dotted pairs or reader macros. No
// external parser lib is pulled in for this -- the grammar is tiny enough
// that a ~100-line hand-rolled tokenizer+parser is both simpler and more
// auditable than adding a dependency for it.

export type SNode = string | number | SExpr;
// A parsed list, e.g. (pin passive line (at 0 3.81 270) ...) becomes
// ["pin", "passive", "line", ["at", 0, 3.81, 270], ...]. Bare identifiers and
// quoted strings are both plain `string`; anything that parses as a finite
// number (KiCad never quotes numeric fields) becomes `number` instead so
// callers don't have to re-parse coordinates themselves.
export type SExpr = SNode[];

export class SExprSyntaxError extends Error {
    constructor(message: string, public line: number, public col: number) {
        super(`${message} (line ${line}, col ${col})`);
        this.name = "SExprSyntaxError";
    }
}

interface Token {
    kind: "lparen" | "rparen" | "atom" | "string";
    text: string;
    line: number;
    col: number;
}

// Tokenizer: single left-to-right scan tracking line/col for error messages.
// Whitespace (space/tab/CR/LF) separates atoms; `(`/`)` are always their own
// token even with no surrounding whitespace (KiCad emits both styles, e.g.
// "(at 0 0)" and occasionally tighter nesting). Comments are not part of
// KiCad's grammar (unlike e.g. Scheme's `;`) so none are stripped here --
// a bare `;` would incorrectly swallow legitimate content if we did.
function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0, line = 1, col = 1;
    const n = src.length;

    function advance(count: number) {
        for (let k = 0; k < count; k++) {
            if (src[i + k] === "\n") { line++; col = 1; } else { col++; }
        }
        i += count;
    }

    while (i < n) {
        const c = src[i];
        if (c === " " || c === "\t" || c === "\r" || c === "\n") { advance(1); continue; }
        const startLine = line, startCol = col;
        if (c === "(") { tokens.push({ kind: "lparen", text: "(", line: startLine, col: startCol }); advance(1); continue; }
        if (c === ")") { tokens.push({ kind: "rparen", text: ")", line: startLine, col: startCol }); advance(1); continue; }
        if (c === '"') {
            // Quoted string: scan to the next unescaped `"`, unescaping \" and
            // \\ as we go (the only two escapes KiCad's writer produces --
            // arbitrary values like symbol names/descriptions can contain
            // literal quotes, which is exactly why this escaping exists).
            let j = i + 1;
            let out = "";
            let closed = false;
            while (j < n) {
                const cj = src[j];
                if (cj === "\\" && j + 1 < n && (src[j + 1] === '"' || src[j + 1] === "\\")) {
                    out += src[j + 1];
                    j += 2;
                    continue;
                }
                if (cj === '"') { closed = true; j++; break; }
                out += cj;
                j++;
            }
            if (!closed) throw new SExprSyntaxError("unterminated string literal", startLine, startCol);
            advance(j - i);
            tokens.push({ kind: "string", text: out, line: startLine, col: startCol });
            continue;
        }
        // Bare atom: identifier, number, or symbol-ish token (KiCad also
        // emits bare tokens like `yes`/`no` and UUIDs) -- runs until the next
        // paren or whitespace.
        let j = i;
        while (j < n && !" \t\r\n()".includes(src[j])) j++;
        if (j === i) throw new SExprSyntaxError(`unexpected character '${c}'`, startLine, startCol);
        const text = src.slice(i, j);
        advance(j - i);
        tokens.push({ kind: "atom", text, line: startLine, col: startCol });
    }
    return tokens;
}

// Recursive-descent list reader over the flat token stream. KiCad's format is
// exactly one top-level list (kicad_symbol_lib ...), but this reader accepts
// any well-formed forest since fixtures/tests may parse standalone
// sub-expressions directly.
function parseNode(tokens: Token[], pos: { i: number }): SNode {
    const tok = tokens[pos.i];
    if (!tok) throw new SExprSyntaxError("unexpected end of input", 0, 0);
    if (tok.kind === "rparen") throw new SExprSyntaxError("unexpected ')'", tok.line, tok.col);
    if (tok.kind === "string") { pos.i++; return tok.text; }
    if (tok.kind === "atom") {
        pos.i++;
        // Numeric atoms become `number` so downstream code (kicadSym.ts) can
        // read coordinates/lengths/rotations without re-parsing strings --
        // KiCad never quotes a numeric field, so this heuristic (does it
        // parse as a finite JS number?) never collides with a real string
        // atom like a symbol name, which is always quoted.
        const asNum = Number(tok.text);
        if (tok.text.length > 0 && Number.isFinite(asNum) && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok.text)) {
            return asNum;
        }
        return tok.text;
    }
    // lparen: consume until the matching rparen, collecting child nodes.
    pos.i++;
    const list: SExpr = [];
    while (true) {
        const next = tokens[pos.i];
        if (!next) throw new SExprSyntaxError("unterminated list, expected ')'", tok.line, tok.col);
        if (next.kind === "rparen") { pos.i++; break; }
        list.push(parseNode(tokens, pos));
    }
    return list;
}

// Parses `src` as a sequence of top-level s-expressions and returns them all
// (KiCad files always have exactly one -- kicad_symbol_lib -- but returning
// an array keeps this parser honest about the grammar rather than silently
// discarding trailing content or throwing on it).
export function parseSExpr(src: string): SExpr[] {
    const tokens = tokenize(src);
    const pos = { i: 0 };
    const nodes: SExpr[] = [];
    while (pos.i < tokens.length) {
        const node = parseNode(tokens, pos);
        if (!Array.isArray(node)) {
            const tok = tokens[pos.i - 1];
            throw new SExprSyntaxError("expected a list '(' at top level", tok.line, tok.col);
        }
        nodes.push(node);
    }
    return nodes;
}

// --- small helpers used by kicadSym.ts to walk the generic tree -----------

// True if `node` is a list whose first element is the atom `tag`, i.e. it's
// an s-expr shaped like `(tag ...)`. This is the fundamental "what kind of
// node is this" test throughout kicadSym.ts, since SExpr has no tagged-union
// type of its own -- the tag is just list[0].
export function isTagged(node: SNode, tag: string): node is SExpr {
    return Array.isArray(node) && node[0] === tag;
}

// Finds the first child of `list` tagged `tag`, e.g. find(pinNode, "at") to
// get the `(at x y rot)` child. Returns undefined if absent (many properties
// are optional in KiCad's format -- e.g. `hide` on a property).
export function find(list: SExpr, tag: string): SExpr | undefined {
    for (const child of list) {
        if (isTagged(child, tag)) return child;
    }
    return undefined;
}

// All children of `list` tagged `tag`, in order -- e.g. every `(symbol ...)`
// unit inside a top-level `(symbol "Lib:Name" ...)`, or every `(xy ...)`
// inside a `(pts ...)`.
export function findAll(list: SExpr, tag: string): SExpr[] {
    const out: SExpr[] = [];
    for (const child of list) {
        if (isTagged(child, tag)) out.push(child);
    }
    return out;
}

// Reads node[index] as a number, throwing a descriptive error rather than
// silently returning NaN -- coordinate/length fields are load-bearing for
// toWorld() math, so a malformed fixture or hand-edited file should fail
// loudly here rather than draw a symbol at NaN,NaN.
export function num(list: SExpr, index: number, context: string): number {
    const v = list[index];
    if (typeof v !== "number") throw new Error(`${context}: expected a number at index ${index}, got ${JSON.stringify(v)}`);
    return v;
}

// Reads node[index] as a string (KiCad quotes every string field, so this
// only ever sees `string`-kind tokens from the tokenizer -- see parseNode).
export function str(list: SExpr, index: number, context: string): string {
    const v = list[index];
    if (typeof v !== "string") throw new Error(`${context}: expected a string at index ${index}, got ${JSON.stringify(v)}`);
    return v;
}
