// A small MATLAB-subset interpreter used by the "MATLAB Function" block, block parameters and the model init script.
// Supports: scalars & real matrices, [..] literals, ranges, 1-based/linear/end indexing, indexed assignment,
// if/elseif/else, for, while, break/continue/return, persistent variables, element-wise and matrix operators,
// and a library of common built-in functions (incl. lqr).

import { det, eig, inv, lqr as lqrSolve, Mat, matmul, pinv, solve, transpose, wrapToPi } from '../linalg';

export type Value = number | Mat | string;

// ---------------------------------------------------------------- lexer
type TokType = 'num' | 'id' | 'kw' | 'op' | 'str' | 'sep' | 'eof';
interface Tok {
  t: TokType;
  v: string;
  n?: number;
  line: number;
  sb: boolean; // space before
  sa: boolean; // space after
}
const KEYWORDS = new Set(['if', 'elseif', 'else', 'end', 'for', 'while', 'break', 'continue', 'return', 'function', 'persistent', 'global']);
const OPS = ['...', '.^', ".'", '.*', './', '==', '~=', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '\\', '^', "'", '<', '>', '&', '|', '~', '!', '=', '(', ')', '[', ']', '{', '}', ',', ';', ':'];

export class MatlabError extends Error {
  line?: number;
  constructor(msg: string, line?: number) {
    super(line ? `Line ${line}: ${msg}` : msg);
    this.line = line;
  }
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const stack: string[] = []; // open delimiters
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r';
  const push = (t: TokType, v: string, extra: Partial<Tok> = {}) => {
    const sb = i > 0 && toks.length > 0 ? spaceBefore : false;
    toks.push({ t, v, line, sb, sa: false, ...extra });
  };
  let spaceBefore = false;
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) {
      spaceBefore = true;
      if (toks.length) toks[toks.length - 1].sa = true;
      i++;
      continue;
    }
    // block comment
    if (c === '%' && src.startsWith('%{', i) && /^%\{\s*$/m.test(src.slice(i, src.indexOf('\n', i) === -1 ? undefined : src.indexOf('\n', i)))) {
      const end = src.indexOf('%}', i);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      line += (chunk.match(/\n/g) || []).length;
      i += chunk.length;
      continue;
    }
    if (c === '%' || c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('...', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      i++;
      line++;
      spaceBefore = true;
      continue;
    }
    if (c === '\n') {
      const top = stack[stack.length - 1];
      if (top === '[' || top === '{') push('op', ';');
      else if (!top) push('sep', '\n');
      line++;
      i++;
      spaceBefore = false;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      push('num', m[0], { n: parseFloat(m[0]) });
      i += m[0].length;
      spaceBefore = false;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      push(KEYWORDS.has(m[0]) ? 'kw' : 'id', m[0]);
      i += m[0].length;
      spaceBefore = false;
      continue;
    }
    if (c === "'" || c === '"') {
      const prev = toks[toks.length - 1];
      const transposeCtx =
        c === "'" && prev && !spaceBefore && (prev.t === 'num' || prev.t === 'id' || prev.v === ')' || prev.v === ']' || prev.v === "'" || prev.v === ".'" || (prev.t === 'kw' && prev.v === 'end'));
      if (!transposeCtx) {
        let j = i + 1;
        let s = '';
        while (j < src.length && src[j] !== '\n') {
          if (src[j] === c) {
            if (src[j + 1] === c) {
              s += c;
              j += 2;
              continue;
            }
            break;
          }
          s += src[j++];
        }
        if (src[j] !== c) throw new MatlabError('Unterminated string', line);
        push('str', s);
        i = j + 1;
        spaceBefore = false;
        continue;
      }
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new MatlabError(`Unexpected character '${c}'`, line);
    if (op === '[' || op === '{' || op === '(') stack.push(op);
    else if (op === ']' || op === '}' || op === ')') stack.pop();
    if ((op === ';' || op === ',') && stack.length === 0) push('sep', op);
    else push('op', op);
    i += op.length;
    spaceBefore = false;
  }
  toks.push({ t: 'eof', v: '', line, sb: false, sa: false });
  return toks;
}

// ---------------------------------------------------------------- AST
export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; name: string; line: number }
  | { k: 'colon' }
  | { k: 'end' }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'un'; op: string; a: Expr }
  | { k: 'post'; op: string; a: Expr }
  | { k: 'range'; a: Expr; s: Expr | null; b: Expr }
  | { k: 'mat'; rows: Expr[][] };

export type Stmt =
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'assign'; name: string; idx: Expr[] | null; e: Expr; line: number }
  | { k: 'multi'; names: string[]; e: Expr; line: number }
  | { k: 'if'; branches: { c: Expr; body: Stmt[] }[]; els: Stmt[] | null; line: number }
  | { k: 'for'; v: string; e: Expr; body: Stmt[]; line: number }
  | { k: 'while'; c: Expr; body: Stmt[]; line: number }
  | { k: 'break' | 'continue' | 'return'; line: number }
  | { k: 'persistent'; names: string[]; line: number };

class Parser {
  toks: Tok[];
  p = 0;
  inMatrix = false;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  get cur() {
    return this.toks[this.p];
  }
  peek(o = 1) {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  next() {
    return this.toks[this.p++];
  }
  isOp(v: string, t = this.cur) {
    return t.t === 'op' && t.v === v;
  }
  expectOp(v: string) {
    if (!this.isOp(v)) throw new MatlabError(`Expected '${v}' but found '${this.cur.v || 'end of input'}'`, this.cur.line);
    return this.next();
  }
  skipSeps() {
    while (this.cur.t === 'sep') this.p++;
  }
  isKw(v: string) {
    return this.cur.t === 'kw' && this.cur.v === v;
  }

  parseBlock(terminators: string[]): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      this.skipSeps();
      if (this.cur.t === 'eof') return out;
      if (this.cur.t === 'kw' && terminators.includes(this.cur.v)) return out;
      out.push(this.parseStmt());
    }
  }

  parseStmt(): Stmt {
    const t = this.cur;
    const line = t.line;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': {
          this.next();
          const branches: { c: Expr; body: Stmt[] }[] = [];
          const c = this.parseExpr();
          branches.push({ c, body: this.parseBlock(['elseif', 'else', 'end']) });
          let els: Stmt[] | null = null;
          for (;;) {
            if (this.isKw('elseif')) {
              this.next();
              const c2 = this.parseExpr();
              branches.push({ c: c2, body: this.parseBlock(['elseif', 'else', 'end']) });
            } else if (this.isKw('else')) {
              this.next();
              els = this.parseBlock(['end']);
            } else break;
          }
          if (!this.isKw('end')) throw new MatlabError("Missing 'end' for 'if'", line);
          this.next();
          return { k: 'if', branches, els, line };
        }
        case 'for': {
          this.next();
          const paren = this.isOp('(');
          if (paren) this.next();
          if (this.cur.t !== 'id') throw new MatlabError('Expected loop variable', line);
          const v = this.next().v;
          this.expectOp('=');
          const e = this.parseExpr();
          if (paren) this.expectOp(')');
          const body = this.parseBlock(['end']);
          if (!this.isKw('end')) throw new MatlabError("Missing 'end' for 'for'", line);
          this.next();
          return { k: 'for', v, e, body, line };
        }
        case 'while': {
          this.next();
          const c = this.parseExpr();
          const body = this.parseBlock(['end']);
          if (!this.isKw('end')) throw new MatlabError("Missing 'end' for 'while'", line);
          this.next();
          return { k: 'while', c, body, line };
        }
        case 'break':
        case 'continue':
        case 'return':
          this.next();
          return { k: t.v, line } as Stmt;
        case 'persistent':
        case 'global': {
          this.next();
          const names: string[] = [];
          while (this.cur.t === 'id') names.push(this.next().v);
          return { k: 'persistent', names, line };
        }
        default:
          throw new MatlabError(`Unexpected '${t.v}'`, line);
      }
    }
    // multi-assignment [a, b] = f(...)
    if (this.isOp('[')) {
      const save = this.p;
      let depth = 0;
      let j = this.p;
      for (; j < this.toks.length; j++) {
        const tk = this.toks[j];
        if (tk.t === 'op' && tk.v === '[') depth++;
        if (tk.t === 'op' && tk.v === ']') {
          depth--;
          if (depth === 0) break;
        }
        if (tk.t === 'eof' || (tk.t === 'sep' && tk.v === '\n')) break;
      }
      const after = this.toks[j + 1];
      if (after && after.t === 'op' && after.v === '=') {
        this.next();
        const names: string[] = [];
        while (!this.isOp(']')) {
          if (this.cur.t === 'id') names.push(this.next().v);
          else if (this.isOp('~')) {
            this.next();
            names.push('~');
          } else if (this.isOp(',')) this.next();
          else throw new MatlabError('Invalid left-hand side', line);
        }
        this.next();
        this.expectOp('=');
        const e = this.parseExpr();
        return { k: 'multi', names, e, line };
      }
      this.p = save;
    }
    const e = this.parseExpr();
    if (this.isOp('=')) {
      this.next();
      const rhs = this.parseExpr();
      if (e.k === 'id') return { k: 'assign', name: e.name, idx: null, e: rhs, line };
      if (e.k === 'call') return { k: 'assign', name: e.name, idx: e.args, e: rhs, line };
      throw new MatlabError('Invalid assignment target', line);
    }
    return { k: 'expr', e, line };
  }

  parseExpr(): Expr {
    return this.parseOrOr();
  }
  parseOrOr(): Expr {
    let a = this.parseAndAnd();
    while (this.isOp('||')) {
      this.next();
      a = { k: 'bin', op: '||', a, b: this.parseAndAnd() };
    }
    return a;
  }
  parseAndAnd(): Expr {
    let a = this.parseOr();
    while (this.isOp('&&')) {
      this.next();
      a = { k: 'bin', op: '&&', a, b: this.parseOr() };
    }
    return a;
  }
  parseOr(): Expr {
    let a = this.parseAnd();
    while (this.isOp('|')) {
      this.next();
      a = { k: 'bin', op: '|', a, b: this.parseAnd() };
    }
    return a;
  }
  parseAnd(): Expr {
    let a = this.parseCmp();
    while (this.isOp('&')) {
      this.next();
      a = { k: 'bin', op: '&', a, b: this.parseCmp() };
    }
    return a;
  }
  parseCmp(): Expr {
    let a = this.parseRange();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['==', '~=', '!=', '<', '<=', '>', '>='].includes(t.v)) {
        if (this.inMatrix && t.sb && !t.sa && false) break;
        this.next();
        a = { k: 'bin', op: t.v === '!=' ? '~=' : t.v, a, b: this.parseRange() };
      } else return a;
    }
  }
  parseRange(): Expr {
    const a = this.parseAdd();
    if (this.isOp(':') && !this.colonIsAll()) {
      this.next();
      const b = this.parseAdd();
      if (this.isOp(':')) {
        this.next();
        const c = this.parseAdd();
        return { k: 'range', a, s: b, b: c };
      }
      return { k: 'range', a, s: null, b };
    }
    return a;
  }
  colonIsAll() {
    return false;
  }
  parseAdd(): Expr {
    let a = this.parseMul();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
        if (this.inMatrix && t.sb && !t.sa) return a; // [1 -2] -> two elements
        this.next();
        a = { k: 'bin', op: t.v, a, b: this.parseMul() };
      } else return a;
    }
  }
  parseMul(): Expr {
    let a = this.parseUnary();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && ['*', '/', '\\', '.*', './'].includes(t.v)) {
        this.next();
        a = { k: 'bin', op: t.v, a, b: this.parseUnary() };
      } else return a;
    }
  }
  parseUnary(): Expr {
    const t = this.cur;
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
      this.next();
      const a = this.parseUnary();
      return t.v === '+' ? a : { k: 'un', op: t.v === '!' ? '~' : t.v, a };
    }
    return this.parsePow();
  }
  parsePow(): Expr {
    let a = this.parsePostfix();
    for (;;) {
      const t = this.cur;
      if (t.t === 'op' && (t.v === '^' || t.v === '.^')) {
        this.next();
        // exponent may carry a unary sign: 2^-1
        let b: Expr;
        if (this.isOp('-') || this.isOp('+')) {
          const s = this.next().v;
          const e = this.parsePostfix();
          b = s === '-' ? { k: 'un', op: '-', a: e } : e;
        } else b = this.parsePostfix();
        a = { k: 'bin', op: t.v, a, b };
      } else return a;
    }
  }
  parsePostfix(): Expr {
    let a = this.parsePrimary();
    while (this.cur.t === 'op' && (this.cur.v === "'" || this.cur.v === ".'") && !this.cur.sb) {
      this.next();
      a = { k: 'post', op: "'", a };
    }
    return a;
  }
  parseArgs(): Expr[] {
    const saved = this.inMatrix;
    this.inMatrix = false;
    this.expectOp('(');
    const args: Expr[] = [];
    if (!this.isOp(')')) {
      for (;;) {
        if (this.isOp(':') && (this.peek().v === ',' || this.peek().v === ')')) {
          this.next();
          args.push({ k: 'colon' });
        } else args.push(this.parseExpr());
        if (this.isOp(',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expectOp(')');
    this.inMatrix = saved;
    return args;
  }
  parsePrimary(): Expr {
    const t = this.cur;
    if (t.t === 'num') {
      this.next();
      return { k: 'num', v: t.n! };
    }
    if (t.t === 'str') {
      this.next();
      return { k: 'str', v: t.v };
    }
    if (t.t === 'kw' && t.v === 'end') {
      this.next();
      return { k: 'end' };
    }
    if (t.t === 'id') {
      this.next();
      if (this.isOp('(') && !(this.inMatrix && this.cur.sb)) {
        const args = this.parseArgs();
        return { k: 'call', name: t.v, args, line: t.line };
      }
      return { k: 'id', name: t.v, line: t.line };
    }
    if (this.isOp('(')) {
      const saved = this.inMatrix;
      this.inMatrix = false;
      this.next();
      const e = this.parseExpr();
      this.expectOp(')');
      this.inMatrix = saved;
      return e;
    }
    if (this.isOp('[') || this.isOp('{')) {
      const close = this.cur.v === '[' ? ']' : '}';
      this.next();
      const saved = this.inMatrix;
      this.inMatrix = true;
      const rows: Expr[][] = [];
      let row: Expr[] = [];
      for (;;) {
        if (this.isOp(close)) {
          this.next();
          break;
        }
        if (this.cur.t === 'eof') throw new MatlabError(`Missing '${close}'`, t.line);
        if (this.isOp(';')) {
          this.next();
          rows.push(row);
          row = [];
          continue;
        }
        if (this.isOp(',')) {
          this.next();
          continue;
        }
        row.push(this.parseExpr());
      }
      rows.push(row);
      this.inMatrix = saved;
      return { k: 'mat', rows: rows.filter((r, i) => r.length > 0 || (rows.length === 1 && i === 0)) };
    }
    throw new MatlabError(`Unexpected '${t.v || 'end of input'}'`, t.line);
  }
}

export function parseProgram(src: string): Stmt[] {
  const p = new Parser(lex(src));
  const body = p.parseBlock([]);
  p.skipSeps();
  if (p.cur.t !== 'eof') throw new MatlabError(`Unexpected '${p.cur.v}'`, p.cur.line);
  return body;
}

export function parseExpression(src: string): Expr {
  const p = new Parser(lex(src));
  p.skipSeps();
  const e = p.parseExpr();
  p.skipSeps();
  if (p.cur.t !== 'eof') throw new MatlabError(`Unexpected '${p.cur.v}'`, p.cur.line);
  return e;
}

export interface FunctionDef {
  name: string;
  inputs: string[];
  outputs: string[];
  body: Stmt[];
  headerLine: number;
}

/** Parses "function [y1, y2] = name(u1, u2)" + body (+ optional trailing end). */
export function parseFunction(src: string): FunctionDef {
  const lines = src.split('\n');
  let hi = lines.findIndex((l) => l.trim() !== '' && !/^\s*%/.test(l));
  if (hi === -1 || !/^\s*function\b/.test(lines[hi])) {
    return { name: 'fcn', inputs: [], outputs: [], body: parseProgram(src), headerLine: 0 };
  }
  const header = lines[hi].replace(/%.*$/, '').trim();
  const m = /^function\s+(?:(\[[^\]]*\]|[A-Za-z_]\w*)\s*=\s*)?([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*$/.exec(header);
  if (!m) throw new MatlabError('Invalid function header. Expected: function [y1, y2] = fcn(u1, u2)', hi + 1);
  const outs = m[1] ? m[1].replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean) : [];
  const ins = m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [];
  const rest = lines.slice(hi + 1);
  // strip a final top-level "end" that closes the function
  const bodySrc = '\n'.repeat(hi + 1) + rest.join('\n');
  let body: Stmt[];
  try {
    body = parseProgram(bodySrc);
  } catch (e) {
    const trimmed = bodySrc.replace(/\bend\s*(%.*)?\s*$/, '');
    body = parseProgram(trimmed);
  }
  return { name: m[2], inputs: ins, outputs: outs, body, headerLine: hi + 1 };
}

// ---------------------------------------------------------------- values
const isMat = (v: Value): v is Mat => v instanceof Mat;
export function toMat(v: Value): Mat {
  if (isMat(v)) return v;
  if (typeof v === 'number') return new Mat(1, 1, [v]);
  throw new MatlabError('Expected a numeric value');
}
export function norm1(v: Value): Value {
  if (isMat(v) && v.r === 1 && v.c === 1) return v.d[0];
  return v;
}
function num(v: Value, what = 'value'): number {
  if (typeof v === 'number') return v;
  if (isMat(v) && v.numel === 1) return v.d[0];
  if (isMat(v)) throw new MatlabError(`Expected a scalar ${what}, got a ${v.r}×${v.c} matrix`);
  throw new MatlabError(`Expected a number, got a string`);
}
export function truthy(v: Value): boolean {
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (v.numel === 0) return false;
  for (const x of v.d) if (x === 0 || Number.isNaN(x)) return false;
  return true;
}
function size(v: Value): [number, number] {
  if (typeof v === 'number') return [1, 1];
  if (typeof v === 'string') return [1, v.length];
  return [v.r, v.c];
}
function numel(v: Value) {
  const [r, c] = size(v);
  return r * c;
}
/** column-major linear access */
function linGet(v: Value, k: number): number {
  if (typeof v === 'number') {
    if (k !== 0) throw new MatlabError(`Index ${k + 1} exceeds array bounds (1)`);
    return v;
  }
  const m = toMat(v);
  if (k < 0 || k >= m.numel) throw new MatlabError(`Index ${k + 1} exceeds array bounds (${m.numel})`);
  const i = k % m.r,
    j = Math.floor(k / m.r);
  return m.d[i * m.c + j];
}
function elementwise(a: Value, b: Value, f: (x: number, y: number) => number, opName: string): Value {
  if (typeof a === 'number' && typeof b === 'number') return f(a, b);
  const A = toMat(a),
    B = toMat(b);
  if (A.numel === 1) {
    const s = A.d[0];
    return new Mat(B.r, B.c, B.d.map((y) => f(s, y)));
  }
  if (B.numel === 1) {
    const s = B.d[0];
    return new Mat(A.r, A.c, A.d.map((x) => f(x, s)));
  }
  if (A.r === B.r && A.c === B.c) {
    const C = new Mat(A.r, A.c);
    for (let i = 0; i < A.d.length; i++) C.d[i] = f(A.d[i], B.d[i]);
    return C;
  }
  // implicit expansion (row vs column)
  const r = A.r === B.r ? A.r : A.r === 1 ? B.r : B.r === 1 ? A.r : -1;
  const c = A.c === B.c ? A.c : A.c === 1 ? B.c : B.c === 1 ? A.c : -1;
  if (r < 0 || c < 0) throw new MatlabError(`Matrix dimensions must agree for '${opName}': ${A.r}×${A.c} and ${B.r}×${B.c}`);
  const C = new Mat(r, c);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) C.d[i * c + j] = f(A.get(A.r === 1 ? 0 : i, A.c === 1 ? 0 : j), B.get(B.r === 1 ? 0 : i, B.c === 1 ? 0 : j));
  return C;
}
function mapv(a: Value, f: (x: number) => number): Value {
  if (typeof a === 'number') return f(a);
  const A = toMat(a);
  return new Mat(A.r, A.c, A.d.map(f));
}
function mtimes(a: Value, b: Value): Value {
  if (typeof a === 'number' || typeof b === 'number' || numel(a) === 1 || numel(b) === 1) return elementwise(a, b, (x, y) => x * y, '*');
  const A = toMat(a),
    B = toMat(b);
  if (A.c !== B.r) throw new MatlabError(`Inner matrix dimensions must agree: ${A.r}×${A.c} * ${B.r}×${B.c}`);
  return norm1(matmul(A, B));
}
function mpower(a: Value, b: Value): Value {
  if (numel(a) === 1) return elementwise(a, b, Math.pow, '^');
  const e = num(b, 'exponent');
  const A = toMat(a);
  if (A.r !== A.c) throw new MatlabError('Matrix power requires a square matrix');
  if (e === -1) return inv(A);
  if (!Number.isInteger(e)) throw new MatlabError('Only integer matrix powers are supported');
  let base = e < 0 ? inv(A) : A;
  let n = Math.abs(e);
  let R = Mat.eye(A.r);
  while (n > 0) {
    if (n & 1) R = matmul(R, base);
    base = matmul(base, base);
    n >>= 1;
  }
  return R;
}
function mrdivide(a: Value, b: Value): Value {
  if (numel(b) === 1) return elementwise(a, b, (x, y) => x / y, '/');
  // a / B = (B' \ a')'
  return norm1(transpose(solve(transpose(toMat(b)), transpose(toMat(a)))));
}
function mldivide(a: Value, b: Value): Value {
  if (numel(a) === 1) return elementwise(a, b, (x, y) => y / x, '\\');
  const A = toMat(a),
    B = toMat(b);
  if (A.r === A.c) return norm1(solve(A, B));
  return norm1(matmul(pinv(A), B));
}
function range(a: number, s: number, b: number): Mat {
  if (s === 0 || (s > 0 && a > b) || (s < 0 && a < b)) return new Mat(1, 0);
  const n = Math.floor((b - a) / s + 1e-10) + 1;
  const m = new Mat(1, n);
  for (let i = 0; i < n; i++) m.d[i] = a + i * s;
  return m;
}
function horzcat(vals: Value[]): Value {
  const ms = vals.map(toMat).filter((m) => m.numel > 0);
  if (!ms.length) return new Mat(0, 0);
  const r = ms[0].r;
  for (const m of ms) if (m.r !== r) throw new MatlabError(`Dimensions of arrays being concatenated are not consistent (rows ${r} vs ${m.r})`);
  const c = ms.reduce((s, m) => s + m.c, 0);
  const out = new Mat(r, c);
  let off = 0;
  for (const m of ms) {
    for (let i = 0; i < r; i++) for (let j = 0; j < m.c; j++) out.d[i * c + off + j] = m.d[i * m.c + j];
    off += m.c;
  }
  return out;
}
function vertcat(vals: Value[]): Value {
  const ms = vals.map(toMat).filter((m) => m.numel > 0);
  if (!ms.length) return new Mat(0, 0);
  const c = ms[0].c;
  for (const m of ms) if (m.c !== c) throw new MatlabError(`Dimensions of arrays being concatenated are not consistent (columns ${c} vs ${m.c})`);
  const r = ms.reduce((s, m) => s + m.r, 0);
  const out = new Mat(r, c);
  let off = 0;
  for (const m of ms) {
    out.d.set(m.d, off * c);
    off += m.r;
  }
  return out;
}
function isVector(m: Mat) {
  return m.r === 1 || m.c === 1;
}
function reduce(a: Value, f: (xs: number[]) => number): Value {
  const A = toMat(a);
  if (isVector(A)) return f(Array.from(A.d));
  const out = new Mat(1, A.c);
  for (let j = 0; j < A.c; j++) {
    const col: number[] = [];
    for (let i = 0; i < A.r; i++) col.push(A.get(i, j));
    out.d[j] = f(col);
  }
  return out;
}
function colvec(xs: number[]) {
  return xs.length === 1 ? xs[0] : Mat.col(xs);
}

// ---------------------------------------------------------------- builtins
type Builtin = (args: Value[], nargout: number) => Value | Value[];
const unary = (f: (x: number) => number): Builtin => (a) => {
  if (a.length !== 1) throw new MatlabError('Expected 1 argument');
  return mapv(a[0], f);
};
const BUILTINS: Record<string, Builtin> = {
  sin: unary(Math.sin),
  cos: unary(Math.cos),
  tan: unary(Math.tan),
  asin: unary(Math.asin),
  acos: unary(Math.acos),
  atan: unary(Math.atan),
  sinh: unary(Math.sinh),
  cosh: unary(Math.cosh),
  tanh: unary(Math.tanh),
  exp: unary(Math.exp),
  log: unary(Math.log),
  log10: unary(Math.log10),
  log2: unary(Math.log2),
  sqrt: unary(Math.sqrt),
  abs: unary(Math.abs),
  sign: unary((x) => (x > 0 ? 1 : x < 0 ? -1 : 0)),
  floor: unary(Math.floor),
  ceil: unary(Math.ceil),
  round: unary(Math.round),
  fix: unary(Math.trunc),
  wrapToPi: unary(wrapToPi),
  deg2rad: unary((x) => (x * Math.PI) / 180),
  rad2deg: unary((x) => (x * 180) / Math.PI),
  isnan: unary((x) => (Number.isNaN(x) ? 1 : 0)),
  atan2: (a) => elementwise(a[0], a[1], Math.atan2, 'atan2'),
  hypot: (a) => elementwise(a[0], a[1], Math.hypot, 'hypot'),
  mod: (a) => elementwise(a[0], a[1], (x, y) => (y === 0 ? x : x - Math.floor(x / y) * y), 'mod'),
  rem: (a) => elementwise(a[0], a[1], (x, y) => (y === 0 ? x : x - Math.trunc(x / y) * y), 'rem'),
  power: (a) => elementwise(a[0], a[1], Math.pow, 'power'),
  sat: (a) => {
    if (a.length === 2) return mapv(a[0], (x) => Math.max(-num(a[1]), Math.min(num(a[1]), x)));
    return mapv(a[0], (x) => Math.max(num(a[1]), Math.min(num(a[2]), x)));
  },
  min: (a, nout) => minmax(a, nout, (x, y) => x < y),
  max: (a, nout) => minmax(a, nout, (x, y) => x > y),
  sum: (a) => reduce(a[0], (xs) => xs.reduce((s, x) => s + x, 0)),
  prod: (a) => reduce(a[0], (xs) => xs.reduce((s, x) => s * x, 1)),
  mean: (a) => reduce(a[0], (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)),
  any: (a) => reduce(a[0], (xs) => (xs.some((x) => x !== 0) ? 1 : 0)),
  all: (a) => reduce(a[0], (xs) => (xs.every((x) => x !== 0) ? 1 : 0)),
  norm: (a) => {
    const A = toMat(a[0]);
    const p = a.length > 1 ? (a[1] === 'inf' || a[1] === 'Inf' ? Infinity : num(a[1])) : 2;
    if (p === Infinity) return Math.max(...Array.from(A.d).map(Math.abs));
    if (p === 1) return Array.from(A.d).reduce((s, x) => s + Math.abs(x), 0);
    return Math.sqrt(Array.from(A.d).reduce((s, x) => s + x * x, 0));
  },
  dot: (a) => {
    const A = toMat(a[0]),
      B = toMat(a[1]);
    if (A.numel !== B.numel) throw new MatlabError('dot: vectors must be the same length');
    let s = 0;
    for (let i = 0; i < A.numel; i++) s += A.d[i] * B.d[i];
    return s;
  },
  cross: (a) => {
    const A = toMat(a[0]),
      B = toMat(a[1]);
    if (A.numel !== 3 || B.numel !== 3) throw new MatlabError('cross: vectors must have 3 elements');
    const [x1, y1, z1] = A.d,
      [x2, y2, z2] = B.d;
    const v = [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2];
    return A.r === 1 ? new Mat(1, 3, v) : Mat.col(v);
  },
  skew: (a) => {
    const v = toMat(a[0]).d;
    return Mat.fromRows([
      [0, -v[2], v[1]],
      [v[2], 0, -v[0]],
      [-v[1], v[0], 0],
    ]);
  },
  zeros: (a) => dims(a, 0),
  ones: (a) => dims(a, 1),
  eye: (a) => {
    const [r, c] = dimArgs(a);
    const m = new Mat(r, c);
    for (let i = 0; i < Math.min(r, c); i++) m.set(i, i, 1);
    return norm1(m);
  },
  diag: (a) => {
    const A = toMat(a[0]);
    if (isVector(A)) return norm1(Mat.diag(A.d));
    const n = Math.min(A.r, A.c);
    return colvec(Array.from({ length: n }, (_, i) => A.get(i, i)));
  },
  inv: (a) => {
    const A = toMat(a[0]);
    if (A.r !== A.c) throw new MatlabError('inv: matrix must be square');
    return norm1(inv(A));
  },
  pinv: (a) => norm1(pinv(toMat(a[0]))),
  det: (a) => det(toMat(a[0])),
  trace: (a) => {
    const A = toMat(a[0]);
    let s = 0;
    for (let i = 0; i < Math.min(A.r, A.c); i++) s += A.get(i, i);
    return s;
  },
  transpose: (a) => norm1(transpose(toMat(a[0]))),
  numel: (a) => numel(a[0]),
  length: (a) => {
    const [r, c] = size(a[0]);
    return r * c === 0 ? 0 : Math.max(r, c);
  },
  size: (a, nout) => {
    const [r, c] = size(a[0]);
    if (a.length > 1) return num(a[1]) === 1 ? r : num(a[1]) === 2 ? c : 1;
    if (nout >= 2) return [r, c];
    return new Mat(1, 2, [r, c]);
  },
  isempty: (a) => (numel(a[0]) === 0 ? 1 : 0),
  reshape: (a) => {
    const A = toMat(a[0]);
    const r = num(a[1]),
      c = a.length > 2 ? num(a[2]) : A.numel / r;
    if (r * c !== A.numel) throw new MatlabError('reshape: number of elements must not change');
    const out = new Mat(r, c);
    for (let k = 0; k < A.numel; k++) {
      const v = linGet(A, k);
      out.d[(k % r) * c + Math.floor(k / r)] = v;
    }
    return norm1(out);
  },
  repmat: (a) => {
    const A = toMat(a[0]);
    const m = num(a[1]),
      n = a.length > 2 ? num(a[2]) : m;
    const out = new Mat(A.r * m, A.c * n);
    for (let i = 0; i < out.r; i++) for (let j = 0; j < out.c; j++) out.set(i, j, A.get(i % A.r, j % A.c));
    return norm1(out);
  },
  linspace: (a) => {
    const lo = num(a[0]),
      hi = num(a[1]),
      n = a.length > 2 ? num(a[2]) : 100;
    return new Mat(1, n, Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / Math.max(n - 1, 1)));
  },
  lqr: (a, nout) => {
    if (a.length < 4) throw new MatlabError('lqr(A, B, Q, R) needs 4 arguments');
    const { K, P } = lqrSolve(toMat(a[0]), toMat(a[1]), toMat(a[2]), toMat(a[3]));
    return nout >= 2 ? [norm1(K), norm1(P)] : norm1(K);
  },
  eig: (a) => {
    const ev = eig(toMat(a[0]));
    return colvec(ev.map(([re]) => re));
  },
  disp: () => 0,
  fprintf: () => 0,
  error: (a) => {
    throw new MatlabError(String(a[0] ?? 'error'));
  },
  double: (a) => a[0],
  logical: (a) => mapv(a[0], (x) => (x !== 0 ? 1 : 0)),
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, eps: 2.220446049250313e-16, Inf: Infinity, inf: Infinity, NaN: NaN, nan: NaN, true: 1, false: 0 };

function dimArgs(a: Value[]): [number, number] {
  if (a.length === 0) return [1, 1];
  if (a.length === 1) {
    if (numel(a[0]) === 2) {
      const m = toMat(a[0]);
      return [m.d[0], m.d[1]];
    }
    const n = num(a[0]);
    return [n, n];
  }
  return [num(a[0]), num(a[1])];
}
function dims(a: Value[], v: number): Value {
  const [r, c] = dimArgs(a);
  const m = new Mat(r, c);
  if (v) m.d.fill(v);
  return norm1(m);
}
function minmax(a: Value[], nout: number, better: (x: number, y: number) => boolean): Value | Value[] {
  if (a.length >= 2 && !(a[1] instanceof Mat && a[1].numel === 0)) return elementwise(a[0], a[1], (x, y) => (better(x, y) ? x : y), 'min/max');
  const A = toMat(a[0]);
  const pick = (xs: number[]) => {
    let bi = 0;
    for (let i = 1; i < xs.length; i++) if (better(xs[i], xs[bi])) bi = i;
    return bi;
  };
  if (isVector(A)) {
    const xs = Array.from(A.d);
    const i = pick(xs);
    return nout >= 2 ? [xs[i], i + 1] : xs[i];
  }
  const vals = new Mat(1, A.c),
    idx = new Mat(1, A.c);
  for (let j = 0; j < A.c; j++) {
    const col = Array.from({ length: A.r }, (_, i) => A.get(i, j));
    const i = pick(col);
    vals.d[j] = col[i];
    idx.d[j] = i + 1;
  }
  return nout >= 2 ? [vals, idx] : vals;
}

export function builtinNames() {
  return [...Object.keys(BUILTINS), ...Object.keys(CONSTANTS)];
}

// ---------------------------------------------------------------- evaluator
class BreakSig {}
class ContinueSig {}
class ReturnSig {}

export type Env = Map<string, Value>;

interface EvalCtx {
  env: Env;
  endStack: { v: Value; pos: number; count: number }[];
  persistentNames: Set<string>;
  steps: number;
}

const MAX_STEPS = 2_000_000;

function indexValue(v: Value, args: Value[], line: number): Value {
  if (typeof v === 'string') throw new MatlabError('Cannot index a string', line);
  if (args.length === 1) {
    const ix = args[0];
    if (ix === ':') {
      const xs: number[] = [];
      for (let k = 0; k < numel(v); k++) xs.push(linGet(v, k));
      return colvec(xs);
    }
    const I = toMat(ix as Value);
    const out: number[] = [];
    for (const k of I.d) {
      if (!Number.isInteger(k) || k < 1) throw new MatlabError(`Index must be a positive integer, got ${k}`, line);
      if (k > numel(v)) throw new MatlabError(`Index exceeds the number of array elements. Index ${k} > ${numel(v)}`, line);
      out.push(linGet(v, k - 1));
    }
    if (out.length === 1) return out[0];
    const [r] = size(v);
    return r === 1 ? new Mat(1, out.length, out) : Mat.col(out);
  }
  if (args.length === 2) {
    const M = toMat(v);
    const rows = args[0] === ':' ? range(1, 1, M.r).d : toMat(args[0] as Value).d;
    const cols = args[1] === ':' ? range(1, 1, M.c).d : toMat(args[1] as Value).d;
    const out = new Mat(rows.length, cols.length);
    rows.forEach((ri, a) =>
      cols.forEach((cj, b) => {
        if (ri < 1 || ri > M.r || cj < 1 || cj > M.c || !Number.isInteger(ri) || !Number.isInteger(cj))
          throw new MatlabError(`Index (${ri},${cj}) out of bounds for ${M.r}×${M.c} matrix`, line);
        out.set(a, b, M.get(ri - 1, cj - 1));
      }),
    );
    return norm1(out);
  }
  throw new MatlabError('Only 1 or 2 indices are supported', line);
}

function assignIndex(old: Value | undefined, args: (Value | ':')[], rhs: Value, line: number): Value {
  let M = old === undefined ? new Mat(0, 0) : toMat(old).clone();
  const R = toMat(rhs);
  if (args.length === 1) {
    const idx = args[0] === ':' ? range(1, 1, Math.max(M.numel, 1)).d : toMat(args[0] as Value).d;
    const maxK = Math.max(...Array.from(idx));
    if (maxK > M.numel) {
      // grow (as column unless row vector)
      if (M.numel === 0 || M.c === 1) {
        const N = new Mat(maxK, 1);
        for (let k = 0; k < M.numel; k++) N.d[k] = linGet(M, k);
        M = N;
      } else if (M.r === 1) {
        const N = new Mat(1, maxK);
        N.d.set(M.d);
        M = N;
      } else throw new MatlabError('Linear index out of bounds for matrix assignment', line);
    }
    idx.forEach((k, a) => {
      if (!Number.isInteger(k) || k < 1) throw new MatlabError(`Index must be a positive integer, got ${k}`, line);
      const val = R.numel === 1 ? R.d[0] : linGet(R, a);
      const i = (k - 1) % M.r,
        j = Math.floor((k - 1) / M.r);
      M.set(i, j, val);
    });
    return norm1(M);
  }
  const rows = args[0] === ':' ? range(1, 1, M.r).d : toMat(args[0] as Value).d;
  const cols = args[1] === ':' ? range(1, 1, M.c).d : toMat(args[1] as Value).d;
  const nr = Math.max(M.r, ...Array.from(rows)),
    nc = Math.max(M.c, ...Array.from(cols));
  if (nr !== M.r || nc !== M.c) {
    const N = new Mat(nr, nc);
    for (let i = 0; i < M.r; i++) for (let j = 0; j < M.c; j++) N.set(i, j, M.get(i, j));
    M = N;
  }
  if (R.numel !== 1 && R.numel !== rows.length * cols.length) throw new MatlabError(`Assignment dimension mismatch: ${rows.length}×${cols.length} vs ${R.r}×${R.c}`, line);
  rows.forEach((ri, a) =>
    cols.forEach((cj, b) => {
      M.set(ri - 1, cj - 1, R.numel === 1 ? R.d[0] : R.get(a, b));
    }),
  );
  return norm1(M);
}

function evalExpr(e: Expr, ctx: EvalCtx, nargout = 1): Value | Value[] {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'str':
      return e.v;
    case 'colon':
      throw new MatlabError("':' can only be used inside an index");
    case 'end': {
      const top = ctx.endStack[ctx.endStack.length - 1];
      if (!top) throw new MatlabError("'end' can only be used inside an index");
      const [r, c] = size(top.v);
      if (top.count === 1) return r * c;
      return top.pos === 0 ? r : c;
    }
    case 'id': {
      if (ctx.env.has(e.name)) return ctx.env.get(e.name)!;
      if (e.name in CONSTANTS) return CONSTANTS[e.name];
      if (e.name in BUILTINS) return BUILTINS[e.name]([], nargout);
      throw new MatlabError(`Undefined function or variable '${e.name}'`, e.line);
    }
    case 'call': {
      if (ctx.env.has(e.name)) {
        const v = ctx.env.get(e.name)!;
        const args = e.args.map((a, i) => {
          if (a.k === 'colon') return ':';
          ctx.endStack.push({ v, pos: i, count: e.args.length });
          try {
            return ev(a, ctx);
          } finally {
            ctx.endStack.pop();
          }
        });
        return indexValue(v, args as Value[], e.line);
      }
      const f = BUILTINS[e.name];
      if (!f) throw new MatlabError(`Undefined function or variable '${e.name}'`, e.line);
      const args = e.args.map((a) => ev(a, ctx));
      try {
        return f(args, nargout);
      } catch (err) {
        if (err instanceof MatlabError && err.line) throw err;
        throw new MatlabError(`${e.name}: ${(err as Error).message}`, e.line);
      }
    }
    case 'un': {
      const a = ev(e.a, ctx);
      if (e.op === '-') return mapv(a, (x) => -x);
      return mapv(a, (x) => (x === 0 ? 1 : 0));
    }
    case 'post':
      return norm1(transpose(toMat(ev(e.a, ctx))));
    case 'range': {
      const a = num(ev(e.a, ctx)),
        b = num(ev(e.b, ctx));
      const s = e.s ? num(ev(e.s, ctx)) : 1;
      return norm1(range(a, s, b));
    }
    case 'mat': {
      const rows = e.rows.map((r) => horzcat(r.map((x) => ev(x, ctx))));
      return norm1(toMat(vertcat(rows)));
    }
    case 'bin': {
      if (e.op === '&&') return truthy(ev(e.a, ctx)) && truthy(ev(e.b, ctx)) ? 1 : 0;
      if (e.op === '||') return truthy(ev(e.a, ctx)) || truthy(ev(e.b, ctx)) ? 1 : 0;
      const a = ev(e.a, ctx),
        b = ev(e.b, ctx);
      switch (e.op) {
        case '+':
          return elementwise(a, b, (x, y) => x + y, '+');
        case '-':
          return elementwise(a, b, (x, y) => x - y, '-');
        case '.*':
          return elementwise(a, b, (x, y) => x * y, '.*');
        case './':
          return elementwise(a, b, (x, y) => x / y, './');
        case '.^':
          return elementwise(a, b, Math.pow, '.^');
        case '*':
          return mtimes(a, b);
        case '/':
          return mrdivide(a, b);
        case '\\':
          return mldivide(a, b);
        case '^':
          return mpower(a, b);
        case '==':
          return elementwise(a, b, (x, y) => (x === y ? 1 : 0), '==');
        case '~=':
          return elementwise(a, b, (x, y) => (x !== y ? 1 : 0), '~=');
        case '<':
          return elementwise(a, b, (x, y) => (x < y ? 1 : 0), '<');
        case '<=':
          return elementwise(a, b, (x, y) => (x <= y ? 1 : 0), '<=');
        case '>':
          return elementwise(a, b, (x, y) => (x > y ? 1 : 0), '>');
        case '>=':
          return elementwise(a, b, (x, y) => (x >= y ? 1 : 0), '>=');
        case '&':
          return elementwise(a, b, (x, y) => (x !== 0 && y !== 0 ? 1 : 0), '&');
        case '|':
          return elementwise(a, b, (x, y) => (x !== 0 || y !== 0 ? 1 : 0), '|');
      }
      throw new MatlabError(`Unknown operator ${e.op}`);
    }
  }
}
function ev(e: Expr, ctx: EvalCtx): Value {
  const v = evalExpr(e, ctx, 1);
  return Array.isArray(v) ? v[0] : v;
}

function execBlock(stmts: Stmt[], ctx: EvalCtx) {
  for (const s of stmts) {
    if (++ctx.steps > MAX_STEPS) throw new MatlabError('Execution limit exceeded (infinite loop?)', s.line);
    try {
      execStmt(s, ctx);
    } catch (err) {
      if (err instanceof BreakSig || err instanceof ContinueSig || err instanceof ReturnSig) throw err;
      if (err instanceof MatlabError) {
        if (err.line === undefined) throw new MatlabError(err.message, s.line);
        throw err;
      }
      throw new MatlabError((err as Error).message, s.line);
    }
  }
}

function execStmt(s: Stmt, ctx: EvalCtx) {
  switch (s.k) {
    case 'expr': {
      const v = ev(s.e, ctx);
      if (s.e.k !== 'call' || ctx.env.has((s.e as any).name)) ctx.env.set('ans', v);
      return;
    }
    case 'assign': {
      const rhs = ev(s.e, ctx);
      if (s.idx) {
        const old = ctx.env.get(s.name);
        const args = s.idx.map((a, i) => {
          if (a.k === 'colon') return ':' as const;
          ctx.endStack.push({ v: old ?? new Mat(0, 0), pos: i, count: s.idx!.length });
          try {
            return ev(a, ctx);
          } finally {
            ctx.endStack.pop();
          }
        });
        ctx.env.set(s.name, assignIndex(old, args as (Value | ':')[], rhs, s.line));
      } else ctx.env.set(s.name, rhs);
      return;
    }
    case 'multi': {
      const vals = evalExpr(s.e, ctx, s.names.length);
      const arr = Array.isArray(vals) ? vals : [vals];
      s.names.forEach((n, i) => {
        if (n === '~') return;
        if (i >= arr.length) throw new MatlabError('Too many output arguments', s.line);
        ctx.env.set(n, arr[i]);
      });
      return;
    }
    case 'if': {
      for (const b of s.branches) {
        if (truthy(ev(b.c, ctx))) {
          execBlock(b.body, ctx);
          return;
        }
      }
      if (s.els) execBlock(s.els, ctx);
      return;
    }
    case 'for': {
      const v = ev(s.e, ctx);
      const M = toMat(v);
      for (let j = 0; j < M.c; j++) {
        const col: number[] = [];
        for (let i = 0; i < M.r; i++) col.push(M.get(i, j));
        ctx.env.set(s.v, colvec(col));
        try {
          execBlock(s.body, ctx);
        } catch (err) {
          if (err instanceof BreakSig) break;
          if (err instanceof ContinueSig) continue;
          throw err;
        }
      }
      return;
    }
    case 'while': {
      while (truthy(ev(s.c, ctx))) {
        try {
          execBlock(s.body, ctx);
        } catch (err) {
          if (err instanceof BreakSig) break;
          if (err instanceof ContinueSig) continue;
          throw err;
        }
      }
      return;
    }
    case 'break':
      throw new BreakSig();
    case 'continue':
      throw new ContinueSig();
    case 'return':
      throw new ReturnSig();
    case 'persistent':
      for (const n of s.names) {
        ctx.persistentNames.add(n);
        if (!ctx.env.has(n)) ctx.env.set(n, new Mat(0, 0));
      }
      return;
  }
}

/** Run a script; returns the resulting workspace. */
export function runScript(src: string, scope: Record<string, Value> = {}): Env {
  const prog = parseProgram(src);
  const env: Env = new Map(Object.entries(scope));
  const ctx: EvalCtx = { env, endStack: [], persistentNames: new Set(), steps: 0 };
  try {
    execBlock(prog, ctx);
  } catch (err) {
    if (!(err instanceof ReturnSig)) throw err;
  }
  return env;
}

/** Evaluate a single expression (block parameter fields). */
export function evalString(src: string, scope: Record<string, Value> | Env = {}): Value {
  const e = parseExpression(src);
  const env: Env = scope instanceof Map ? scope : new Map(Object.entries(scope));
  return ev(e, { env, endStack: [], persistentNames: new Set(), steps: 0 });
}

/** Compiled MATLAB function with persistent storage (one per block instance). */
export class MatlabFunction {
  def: FunctionDef;
  persist = new Map<string, Value>();
  constructor(src: string) {
    this.def = parseFunction(src);
  }
  reset() {
    this.persist.clear();
  }
  call(inputs: Value[], scope: Record<string, Value>): Value[] {
    const env: Env = new Map(Object.entries(scope));
    this.def.inputs.forEach((n, i) => env.set(n, inputs[i] ?? 0));
    for (const [k, v] of this.persist) env.set(k, v);
    const ctx: EvalCtx = { env, endStack: [], persistentNames: new Set(this.persist.keys()), steps: 0 };
    try {
      execBlock(this.def.body, ctx);
    } catch (err) {
      if (!(err instanceof ReturnSig)) throw err;
    }
    for (const n of ctx.persistentNames) this.persist.set(n, env.get(n)!);
    return this.def.outputs.map((o) => {
      if (!env.has(o)) throw new MatlabError(`Output argument '${o}' is not assigned`);
      return env.get(o)!;
    });
  }
}

export function valueToString(v: Value, digits = 4): string {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'number') return fmt(v, digits);
  if (v.numel === 0) return '[]';
  return '[' + v.toRows().map((r) => r.map((x) => fmt(x, digits)).join(' ')).join('; ') + ']';
}
function fmt(x: number, digits: number) {
  if (!isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e4 || a < 1e-3) return x.toExponential(digits - 1);
  return Number(x.toPrecision(digits)).toString();
}

export const vops = { elementwise, mtimes, mapv, toMat, norm1, num, numel, size, horzcat, vertcat, linGet };
