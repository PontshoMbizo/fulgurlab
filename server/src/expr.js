// Safe expression language for the User Function block.
//
// Scilab would evaluate a raw string as code, so user text must never reach the
// script. Instead the text is parsed here with a tiny grammar and codegen
// re-emits it from the parsed tree: numbers go through fmt(), variables map to
// a fixed spelling, and only the whitelisted functions below can appear.
//
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?          (right-associative, binds tighter than unary minus on the left)
//   atom   := number | 'u1'..'u8' | func '(' expr ')' | '(' expr ')'

export const FUNCTIONS = ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs'];
export const MAX_EXPR_LENGTH = 200;
const MAX_DEPTH = 24;

export class ExprError extends Error {}

/**
 * Parse an expression.
 * @param {string} text
 * @param {number} nin number of inputs the block declares (u1..u<nin> are allowed)
 * @returns {object} AST: {n}, {u}, {neg}, {bin, a, b}, {fn, arg}
 * @throws {ExprError}
 */
export function parseExpr(text, nin) {
  if (typeof text !== 'string' || !text.trim()) throw new ExprError('expression is empty');
  if (text.length > MAX_EXPR_LENGTH) throw new ExprError(`expression is longer than ${MAX_EXPR_LENGTH} characters`);

  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^()]))/y;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new ExprError(`unexpected character "${text.slice(pos).trimStart()[0]}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) {
      const v = Number(m[1]);
      if (!Number.isFinite(v)) throw new ExprError(`number ${m[1]} is not finite`);
      tokens.push({ t: 'num', v });
    } else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
  }

  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"`);
    i++;
  };

  function expr(d) {
    if (d > MAX_DEPTH) throw new ExprError('expression is nested too deeply');
    let a = term(d);
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++].v;
      a = { bin: op, a, b: term(d) };
    }
    return a;
  }
  function term(d) {
    let a = unary(d);
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++].v;
      a = { bin: op, a, b: unary(d) };
    }
    return a;
  }
  function unary(d) {
    if (d > MAX_DEPTH) throw new ExprError('expression is nested too deeply');
    if (isOp('-')) { i++; return { neg: unary(d + 1) }; }
    if (isOp('+')) { i++; return unary(d + 1); }
    return power(d);
  }
  function power(d) {
    const a = atom(d);
    if (isOp('^')) { i++; return { bin: '^', a, b: unary(d + 1) }; }
    return a;
  }
  function atom(d) {
    const tk = tokens[i];
    if (!tk) throw new ExprError('expression ends unexpectedly');
    if (tk.t === 'num') { i++; return { n: tk.v }; }
    if (tk.t === 'op' && tk.v === '(') {
      i++;
      const e = expr(d + 1);
      expect(')');
      return e;
    }
    if (tk.t === 'id') {
      i++;
      const m = /^u([1-9])$/.exec(tk.v);
      if (m) {
        const k = Number(m[1]);
        if (k > nin) throw new ExprError(`${tk.v} is not an input: the block has ${nin} input${nin === 1 ? '' : 's'}`);
        return { u: k };
      }
      if (FUNCTIONS.includes(tk.v)) {
        expect('(');
        const arg = expr(d + 1);
        expect(')');
        return { fn: tk.v, arg };
      }
      throw new ExprError(`unknown name "${tk.v.slice(0, 20)}": use u1..u${nin}, numbers and ${FUNCTIONS.join(', ')}`);
    }
    throw new ExprError(`unexpected "${tk.v}"`);
  }

  const ast = expr(0);
  if (i < tokens.length) throw new ExprError(`unexpected "${tokens[i].v}"`);
  return ast;
}

/**
 * Emit a parsed expression as text for Scilab's EXPRESSION block.
 * @param {object} ast from parseExpr
 * @param {(x:number)=>string} fmt number formatter (validates finiteness)
 */
export function emitExpr(ast, fmt) {
  if ('n' in ast) return fmt(ast.n);
  if ('u' in ast) return `u${ast.u}`;
  if ('neg' in ast) return `(0-${emitExpr(ast.neg, fmt)})`;
  if ('fn' in ast) return `${ast.fn}(${emitExpr(ast.arg, fmt)})`;
  return `(${emitExpr(ast.a, fmt)}${ast.bin}${emitExpr(ast.b, fmt)})`;
}
