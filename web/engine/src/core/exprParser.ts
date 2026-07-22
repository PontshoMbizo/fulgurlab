// Ported from Expr.java (classes ExprState, Expr, ExprParser -- all three
// live in that one file in Java despite the "ExprParser.java"/"ExprState.java"
// naming an earlier pass expected). Used by VCCSElm/VCVSElm/CCVSElm/CCCSElm
// (dump types 213/212/214/215) to evaluate an arbitrary user-typed expression
// of up to 9 named input "pins" (a..i) plus time/derivative/history helpers.
//
// Faithful, not simplified: every node type, operator, and function Java's
// ExprParser.parseTerm()/parseUminus()/... accepts is implemented here with
// the same precedence chain and the same token-scanning rules (see
// tokenize() below, a direct port of ExprParser.getToken()). Anything Java
// doesn't accept (e.g. unknown function names, wrong arg counts) is a parse
// error here too, not silently coerced.
//
// One deliberate behavioral note carried over VERBATIM from Java (not a
// bug in this port): ExprState.values has 9 slots, one per letter a..i, and
// slot 4 (variable "e") is pre-seeded with Math.E at construction and NEVER
// otherwise touched by expression evaluation itself -- only the ELEMENT
// (dependent_sources.ts, mirroring VCCSElm.doStep()'s
// `for (i=0;i!=inputCount;i++) exprState.values[i]=volts[i]`) overwrites
// values[0..inputCount-1] each step. So an expression using "e" as Euler's
// number works correctly as long as the element has fewer than 5 inputs;
// with 5+ inputs, "e" becomes an ordinary pin voltage instead, and the
// constant is gone -- exactly Java's real behavior, kept intact here.

export interface ExprState {
    values: number[];      // 9 slots: a..i (indices 0..8)
    lastValues: number[];  // same 9 slots, previous step's values (for lastX/dXdt)
    lastOutput: number;    // for the "lastoutput" keyword
    t: number;             // current sim time (for "t")
    timeStep: number;      // for "timestep" keyword and dX/dt division
}

export function createExprState(): ExprState {
    const values = new Array(9).fill(0);
    values[4] = Math.E; // slot for 'e' -- see class comment above
    return {
        values,
        lastValues: new Array(9).fill(0),
        lastOutput: 0,
        t: 0,
        timeStep: 0,
    };
}

// Ported from ExprState.updateLastValues() (Expr.java:18-23).
export function updateLastValues(es: ExprState, lastOut: number): void {
    es.lastOutput = lastOut;
    for (let i = 0; i !== es.values.length; i++) {
        es.lastValues[i] = es.values[i];
    }
}

// Ported from ExprState.reset() (Expr.java:25-29).
export function resetExprState(es: ExprState): void {
    for (let i = 0; i !== es.values.length; i++) {
        es.lastValues[i] = 0;
    }
    es.lastOutput = 0;
}

// ---- Node type tags (mirror Expr.java's E_* constants; values don't need
// to match Java's numbers since nothing serializes them, but names do). ----
type EType =
    | 'ADD' | 'SUB' | 'T' | 'VAL' | 'MUL' | 'DIV' | 'POW' | 'UMINUS'
    | 'SIN' | 'COS' | 'ABS' | 'EXP' | 'LOG' | 'SQRT' | 'TAN'
    | 'MAX' | 'MIN' | 'CLAMP' | 'PWL' | 'TRIANGLE' | 'SAWTOOTH' | 'MOD'
    | 'STEP' | 'SELECT' | 'PWR' | 'PWRS' | 'LASTOUTPUT' | 'TIMESTEP'
    | 'TERNARY' | 'OR' | 'AND' | 'EQUALS' | 'LEQ' | 'GEQ' | 'LESS' | 'GREATER'
    | 'NEQ' | 'NOT' | 'FLOOR' | 'CEIL' | 'ASIN' | 'ACOS' | 'ATAN'
    | 'SINH' | 'COSH' | 'TANH' | 'BITAND' | 'BITOR' | 'RSHIFT'
    | 'A' | 'DADT' | 'LASTA'; // A/DADT/LASTA carry an extra `slot` 0..8

export class Expr {
    type: EType;
    value = 0;      // for VAL
    slot = 0;       // for A/DADT/LASTA: which of a..i (0..8)
    children: Expr[];

    constructor(type: EType, children: Expr[] = []) {
        this.type = type;
        this.children = children;
    }

    static val(v: number): Expr {
        const e = new Expr('VAL');
        e.value = v;
        return e;
    }

    static slotNode(type: 'A' | 'DADT' | 'LASTA', slot: number): Expr {
        const e = new Expr(type);
        e.slot = slot;
        return e;
    }

    private static posmod(x: number, y: number): number {
        x %= y;
        return x >= 0 ? x : x + y;
    }

    // Ported from Expr.pwl() (Expr.java:154-175).
    private static pwl(es: ExprState, args: Expr[]): number {
        const x = args[0].eval(es);
        let x0 = args[1].eval(es);
        let y0 = args[2].eval(es);
        if (x < x0) return y0;
        let x1 = args[3].eval(es);
        let y1 = args[4].eval(es);
        let i = 5;
        for (;;) {
            if (x < x1) return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
            if (i + 1 >= args.length) break;
            x0 = x1;
            y0 = y1;
            x1 = args[i].eval(es);
            y1 = args[i + 1].eval(es);
            i += 2;
        }
        return y1;
    }

    // Ported from Expr.eval() (Expr.java:47-152), case by case.
    eval(es: ExprState): number {
        const left = this.children[0];
        const right = this.children.length === 2 ? this.children[1] : undefined;
        switch (this.type) {
            case 'ADD': return left.eval(es) + right!.eval(es);
            case 'SUB': return left.eval(es) - right!.eval(es);
            case 'MUL': return left.eval(es) * right!.eval(es);
            case 'DIV': return left.eval(es) / right!.eval(es);
            case 'POW': return Math.pow(left.eval(es), right!.eval(es));
            case 'OR': return (left.eval(es) !== 0 || right!.eval(es) !== 0) ? 1 : 0;
            case 'AND': return (left.eval(es) !== 0 && right!.eval(es) !== 0) ? 1 : 0;
            case 'EQUALS': return left.eval(es) === right!.eval(es) ? 1 : 0;
            case 'NEQ': return left.eval(es) !== right!.eval(es) ? 1 : 0;
            case 'LEQ': return left.eval(es) <= right!.eval(es) ? 1 : 0;
            case 'GEQ': return left.eval(es) >= right!.eval(es) ? 1 : 0;
            case 'LESS': return left.eval(es) < right!.eval(es) ? 1 : 0;
            case 'GREATER': return left.eval(es) > right!.eval(es) ? 1 : 0;
            case 'TERNARY': return this.children[left.eval(es) !== 0 ? 1 : 2].eval(es);
            case 'UMINUS': return -left.eval(es);
            case 'NOT': return left.eval(es) === 0 ? 1 : 0;
            case 'VAL': return this.value;
            case 'T': return es.t;
            case 'SIN': return Math.sin(left.eval(es));
            case 'COS': return Math.cos(left.eval(es));
            case 'ABS': return Math.abs(left.eval(es));
            case 'EXP': return Math.exp(left.eval(es));
            case 'LOG': return Math.log(left.eval(es));
            case 'SQRT': return Math.sqrt(left.eval(es));
            case 'TAN': return Math.tan(left.eval(es));
            case 'ASIN': return Math.asin(left.eval(es));
            case 'ACOS': return Math.acos(left.eval(es));
            case 'ATAN': return Math.atan(left.eval(es));
            case 'SINH': return Math.sinh(left.eval(es));
            case 'COSH': return Math.cosh(left.eval(es));
            case 'TANH': return Math.tanh(left.eval(es));
            case 'BITAND': return (left.eval(es) | 0) & (right!.eval(es) | 0);
            case 'BITOR': return (left.eval(es) | 0) | (right!.eval(es) | 0);
            case 'RSHIFT': return (left.eval(es) | 0) >> (right!.eval(es) | 0);
            case 'FLOOR': return Math.floor(left.eval(es));
            case 'CEIL': return Math.ceil(left.eval(es));
            case 'MIN': {
                let x = left.eval(es);
                for (let i = 1; i < this.children.length; i++) x = Math.min(x, this.children[i].eval(es));
                return x;
            }
            case 'MAX': {
                let x = left.eval(es);
                for (let i = 1; i < this.children.length; i++) x = Math.max(x, this.children[i].eval(es));
                return x;
            }
            case 'CLAMP':
                return Math.min(Math.max(left.eval(es), this.children[1].eval(es)), this.children[2].eval(es));
            case 'PWL':
                return Expr.pwl(es, this.children);
            case 'TRIANGLE': {
                const x = Expr.posmod(left.eval(es), Math.PI * 2) / Math.PI;
                return x < 1 ? -1 + x * 2 : 3 - x * 2;
            }
            case 'SAWTOOTH': {
                const x = Expr.posmod(left.eval(es), Math.PI * 2) / Math.PI;
                return x - 1;
            }
            case 'MOD':
                return left.eval(es) % right!.eval(es);
            case 'PWR':
                return Math.pow(Math.abs(left.eval(es)), right!.eval(es));
            case 'PWRS': {
                const x = left.eval(es);
                if (x < 0) return -Math.pow(-x, right!.eval(es));
                return Math.pow(x, right!.eval(es));
            }
            case 'STEP': {
                const x = left.eval(es);
                if (!right) return x < 0 ? 0 : 1;
                return x > right.eval(es) ? 0 : x < 0 ? 0 : 1;
            }
            case 'SELECT': {
                const x = left.eval(es);
                return this.children[x > 0 ? 2 : 1].eval(es);
            }
            case 'LASTOUTPUT':
                return es.lastOutput;
            case 'TIMESTEP':
                return es.timeStep;
            case 'A':
                return es.values[this.slot];
            case 'DADT':
                return (es.values[this.slot] - es.lastValues[this.slot]) / es.timeStep;
            case 'LASTA':
                return es.lastValues[this.slot];
            default:
                return 0;
        }
    }
}

// Ported from ExprParser (Expr.java:240-570). Recursive-descent, same
// precedence chain as Java top to bottom:
//   parse (?:) -> parseOr (||) -> parseAnd (&&) -> parseBitOr (|)
//   -> parseBitAnd (&) -> parseEquals (==) -> parseCompare (<= >= != < >)
//   -> parseShift (>>) -> parseAdd (+ -) -> parseMult (* /)
//   -> parseUminus (unary + - !) -> parsePow (^) -> parseTerm (literals/vars/funcs)
export class ExprParser {
    private text: string;
    private token = '';
    private pos = 0;
    private tlen: number;
    private err: string | null = null;

    constructor(s: string) {
        this.text = s.toLowerCase();
        this.tlen = this.text.length;
        this.pos = 0;
        this.getToken();
    }

    gotError(): string | null {
        return this.err;
    }

    // Ported from ExprParser.getToken() (Expr.java:247-285).
    private getToken(): void {
        while (this.pos < this.tlen && this.text.charAt(this.pos) === ' ') this.pos++;
        if (this.pos === this.tlen) {
            this.token = '';
            return;
        }
        let i = this.pos;
        const c = this.text.charAt(i);
        if ((c >= '0' && c <= '9') || c === '.') {
            for (i = this.pos; i !== this.tlen; i++) {
                if (this.text.charAt(i) === 'e' || this.text.charAt(i) === 'E') {
                    i++;
                    if (i < this.tlen && (this.text.charAt(i) === '+' || this.text.charAt(i) === '-')) i++;
                }
                if (i >= this.tlen) break;
                const ch = this.text.charAt(i);
                if (!((ch >= '0' && ch <= '9') || ch === '.')) break;
            }
        } else if (c >= 'a' && c <= 'z') {
            for (i = this.pos; i !== this.tlen; i++) {
                const ch = this.text.charAt(i);
                if (!(ch >= 'a' && ch <= 'z')) break;
            }
        } else {
            i++;
            if (i < this.tlen) {
                const next = this.text.charAt(i);
                if (next === c && (c === '|' || c === '&' || c === '<' || c === '>' || c === '=')) i++;
                else if ((c === '<' || c === '>' || c === '!') && next === '=') i++;
            }
        }
        this.token = this.text.substring(this.pos, i);
        this.pos = i;
    }

    private skip(s: string): boolean {
        if (this.token !== s) return false;
        this.getToken();
        return true;
    }

    private setError(s: string): void {
        if (this.err === null) this.err = s;
    }

    private skipOrError(s: string): void {
        if (!this.skip(s)) this.setError(`expected ${s}, got ${this.token}`);
    }

    parseExpression(): Expr {
        if (this.token.length === 0) return Expr.val(0);
        const e = this.parse();
        if (this.token.length > 0) this.setError(`unexpected token: ${this.token}`);
        return e;
    }

    private parse(): Expr {
        const e = this.parseOr();
        if (this.skip('?')) {
            const e2 = this.parseOr();
            this.skipOrError(':');
            const e3 = this.parse();
            return new Expr('TERNARY', [e, e2, e3]);
        }
        return e;
    }

    private parseOr(): Expr {
        let e = this.parseAnd();
        while (this.skip('||')) e = new Expr('OR', [e, this.parseAnd()]);
        return e;
    }

    private parseAnd(): Expr {
        let e = this.parseBitOr();
        while (this.skip('&&')) e = new Expr('AND', [e, this.parseBitOr()]);
        return e;
    }

    private parseBitOr(): Expr {
        let e = this.parseBitAnd();
        while (this.skip('|')) e = new Expr('BITOR', [e, this.parseBitAnd()]);
        return e;
    }

    private parseBitAnd(): Expr {
        let e = this.parseEquals();
        while (this.skip('&')) e = new Expr('BITAND', [e, this.parseEquals()]);
        return e;
    }

    private parseEquals(): Expr {
        const e = this.parseCompare();
        if (this.skip('==')) return new Expr('EQUALS', [e, this.parseCompare()]);
        return e;
    }

    private parseCompare(): Expr {
        const e = this.parseShift();
        if (this.skip('<=')) return new Expr('LEQ', [e, this.parseShift()]);
        if (this.skip('>=')) return new Expr('GEQ', [e, this.parseShift()]);
        if (this.skip('!=')) return new Expr('NEQ', [e, this.parseShift()]);
        if (this.skip('<')) return new Expr('LESS', [e, this.parseShift()]);
        if (this.skip('>')) return new Expr('GREATER', [e, this.parseShift()]);
        return e;
    }

    private parseShift(): Expr {
        let e = this.parseAdd();
        while (this.skip('>>')) e = new Expr('RSHIFT', [e, this.parseAdd()]);
        return e;
    }

    private parseAdd(): Expr {
        let e = this.parseMult();
        for (;;) {
            if (this.skip('+')) e = new Expr('ADD', [e, this.parseMult()]);
            else if (this.skip('-')) e = new Expr('SUB', [e, this.parseMult()]);
            else break;
        }
        return e;
    }

    private parseMult(): Expr {
        let e = this.parseUminus();
        for (;;) {
            if (this.skip('*')) e = new Expr('MUL', [e, this.parseUminus()]);
            else if (this.skip('/')) e = new Expr('DIV', [e, this.parseUminus()]);
            else break;
        }
        return e;
    }

    private parseUminus(): Expr {
        this.skip('+');
        if (this.skip('!')) return new Expr('NOT', [this.parseUminus()]);
        if (this.skip('-')) return new Expr('UMINUS', [this.parseUminus()]);
        return this.parsePow();
    }

    private parsePow(): Expr {
        let e = this.parseTerm();
        for (;;) {
            if (this.skip('^')) e = new Expr('POW', [e, this.parseTerm()]);
            else break;
        }
        return e;
    }

    private parseFunc(t: EType): Expr {
        this.skipOrError('(');
        const e = this.parse();
        this.skipOrError(')');
        return new Expr(t, [e]);
    }

    private parseFuncMulti(t: EType, minArgs: number, maxArgs: number): Expr {
        let args = 1;
        this.skipOrError('(');
        const children = [this.parse()];
        while (this.skip(',')) {
            children.push(this.parse());
            args++;
        }
        this.skipOrError(')');
        if (args < minArgs || args > maxArgs) this.setError(`bad number of function args: ${args}`);
        return new Expr(t, children);
    }

    private parseTerm(): Expr {
        if (this.skip('(')) {
            const e = this.parse();
            this.skipOrError(')');
            return e;
        }
        if (this.skip('t')) return new Expr('T');
        if (this.token.length === 1) {
            const c = this.token.charCodeAt(0);
            if (c >= 97 && c <= 105) { // 'a'..'i'
                this.getToken();
                return Expr.slotNode('A', c - 97);
            }
        }
        if (this.token.startsWith('last') && this.token.length === 5) {
            const c = this.token.charCodeAt(4);
            if (c >= 97 && c <= 105) {
                this.getToken();
                return Expr.slotNode('LASTA', c - 97);
            }
        }
        if (this.token.endsWith('dt') && this.token.startsWith('d') && this.token.length === 4) {
            const c = this.token.charCodeAt(1);
            if (c >= 97 && c <= 105) {
                this.getToken();
                return Expr.slotNode('DADT', c - 97);
            }
        }
        if (this.skip('lastoutput')) return new Expr('LASTOUTPUT');
        if (this.skip('timestep')) return new Expr('TIMESTEP');
        if (this.skip('pi')) return Expr.val(3.14159265358979323846);
        if (this.skip('sin')) return this.parseFunc('SIN');
        if (this.skip('cos')) return this.parseFunc('COS');
        if (this.skip('asin')) return this.parseFunc('ASIN');
        if (this.skip('acos')) return this.parseFunc('ACOS');
        if (this.skip('atan')) return this.parseFunc('ATAN');
        if (this.skip('sinh')) return this.parseFunc('SINH');
        if (this.skip('cosh')) return this.parseFunc('COSH');
        if (this.skip('tanh')) return this.parseFunc('TANH');
        if (this.skip('abs')) return this.parseFunc('ABS');
        if (this.skip('exp')) return this.parseFunc('EXP');
        if (this.skip('log')) return this.parseFunc('LOG');
        if (this.skip('sqrt')) return this.parseFunc('SQRT');
        if (this.skip('tan')) return this.parseFunc('TAN');
        if (this.skip('tri')) return this.parseFunc('TRIANGLE');
        if (this.skip('saw')) return this.parseFunc('SAWTOOTH');
        if (this.skip('floor')) return this.parseFunc('FLOOR');
        if (this.skip('ceil')) return this.parseFunc('CEIL');
        if (this.skip('min')) return this.parseFuncMulti('MIN', 2, 1000);
        if (this.skip('max')) return this.parseFuncMulti('MAX', 2, 1000);
        if (this.skip('pwl')) return this.parseFuncMulti('PWL', 2, 1000);
        if (this.skip('mod')) return this.parseFuncMulti('MOD', 2, 2);
        if (this.skip('step')) return this.parseFuncMulti('STEP', 1, 2);
        if (this.skip('select')) return this.parseFuncMulti('SELECT', 3, 3);
        if (this.skip('clamp')) return this.parseFuncMulti('CLAMP', 3, 3);
        if (this.skip('pwr')) return this.parseFuncMulti('PWR', 2, 2);
        if (this.skip('pwrs')) return this.parseFuncMulti('PWRS', 2, 2);
        const num = Number(this.token);
        if (this.token.length > 0 && !Number.isNaN(num)) {
            this.getToken();
            return Expr.val(num);
        }
        if (this.token.length === 0) this.setError('unexpected end of input');
        else this.setError(`unrecognized token: ${this.token}`);
        return Expr.val(0);
    }
}
