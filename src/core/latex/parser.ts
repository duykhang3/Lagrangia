// LaTeX math → AST parser for a practical subset (what MathLive / Overleaf users typically type for dynamics).

export type Node =
  | { k: 'num'; v: number }
  | { k: 'sym'; name: string; tex: string }
  | { k: 'add'; terms: { sign: 1 | -1; node: Node; src: string }[] }
  | { k: 'mul'; f: Node[] }
  | { k: 'div'; a: Node; b: Node }
  | { k: 'pow'; base: Node; exp: Node }
  | { k: 'post'; op: 'T' | 'inv' | 'pinv'; a: Node }
  | { k: 'neg'; a: Node }
  | { k: 'fn'; name: string; arg: Node; pow?: Node }
  | { k: 'abs'; a: Node }
  | { k: 'mat'; rows: Node[][] }
  | { k: 'grp'; items: Node[] };

export interface ParsedEq {
  lhs: Node;
  rhs: Node | null;
  parts: Node[]; // all '=' separated parts
}

export class LatexError extends Error {
  pos: number;
  constructor(msg: string, pos: number) {
    super(msg);
    this.pos = pos;
  }
}

type Tok = { t: 'num'; v: string; pos: number; end: number } | { t: 'cmd'; v: string; pos: number; end: number } | { t: 'ch'; v: string; pos: number; end: number } | { t: 'eof'; v: ''; pos: number; end: number };

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);
const FUNCS: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'asin', arccos: 'acos', arctan: 'atan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', ln: 'ln', log: 'ln', sgn: 'sign', sign: 'sign', signum: 'sign', atan: 'atan', diag: 'diag',
};
const PLAIN_FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sign', 'sgn', 'sin', 'cos', 'tan', 'exp', 'ln'];
const IGNORE_CMDS = new Set(['left', 'right', 'mleft', 'mright', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'displaystyle', 'textstyle', ',', ';', ':', '!', ' ', 'quad', 'qquad', 'limits', 'nolimits']);
const DECOR: Record<string, string> = { dot: 'd', ddot: 'dd', hat: 'hat', bar: 'bar', tilde: 'tl', vec: '', mathbf: '', boldsymbol: '', bm: '', mathit: '', mathsf: '', mathcal: '' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '~') {
      i++;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(src.slice(i));
      if (m) {
        out.push({ t: 'cmd', v: m[1], pos: i, end: i + m[0].length });
        i += m[0].length;
      } else {
        out.push({ t: 'cmd', v: src[i + 1] ?? '', pos: i, end: i + 2 });
        i += 2;
      }
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      // plain-text function names (raw LaTeX typed without backslash)
      const prev = out[out.length - 1];
      const afterSub = prev && prev.t === 'ch' && (prev.v === '_' || prev.v === '^');
      const fn = afterSub ? undefined : PLAIN_FUNCS.find((f) => src.startsWith(f, i) && !/[A-Za-z]/.test(src[i + f.length] ?? ''));
      if (fn) {
        out.push({ t: 'cmd', v: fn, pos: i, end: i + fn.length });
        i += fn.length;
        continue;
      }
    }
    out.push({ t: 'ch', v: c, pos: i, end: i + 1 });
    i++;
  }
  // drop the '.' of left-dot / right-dot delimiters
  for (let k = 0; k < out.length - 1; k++) if (out[k].t === 'cmd' && /^m?(left|right)$/.test(out[k].v) && out[k + 1].v === '.') out.splice(k + 1, 1);
  // remove ignorable commands (keeping following delimiters)
  const filtered = out.filter((t) => !(t.t === 'cmd' && IGNORE_CMDS.has(t.v)));
  filtered.push({ t: 'eof', v: '', pos: src.length, end: src.length });
  return filtered;
}

class P {
  toks: Tok[];
  i = 0;
  src: string;
  constructor(src: string) {
    this.src = src;
    this.toks = tokenize(src);
  }
  get cur() {
    return this.toks[this.i];
  }
  next() {
    return this.toks[this.i++];
  }
  isCh(v: string) {
    return this.cur.t === 'ch' && this.cur.v === v;
  }
  isCmd(v: string) {
    return this.cur.t === 'cmd' && this.cur.v === v;
  }
  expectCh(v: string) {
    if (!this.isCh(v)) throw new LatexError(`Expected '${v}'`, this.cur.pos);
    return this.next();
  }

  /** {...} group or single token */
  group(): Node {
    if (this.isCh('{')) {
      this.next();
      const e = this.expr();
      this.expectCh('}');
      return e;
    }
    return this.atomForScript();
  }
  atomForScript(): Node {
    const t = this.cur;
    if (t.t === 'num') {
      this.next();
      // single digit only, like LaTeX x^23 = x^2 3
      const d = t.v[0];
      if (t.v.length > 1) {
        // push back rest of number
        this.toks.splice(this.i, 0, { t: 'num', v: t.v.slice(1), pos: t.pos + 1, end: t.end });
      }
      return { k: 'num', v: parseFloat(d) };
    }
    return this.primary(true);
  }
  /** text inside braces as raw string (for \operatorname, \text, subscripts) */
  rawGroup(): string {
    if (this.isCh('{')) {
      const start = this.next().end;
      let depth = 1;
      while (this.cur.t !== 'eof') {
        if (this.isCh('{')) depth++;
        if (this.isCh('}')) {
          depth--;
          if (depth === 0) break;
        }
        this.next();
      }
      const end = this.cur.pos;
      this.expectCh('}');
      return this.src.slice(start, end);
    }
    const t = this.next();
    return t.t === 'cmd' ? '\\' + t.v : t.v;
  }

  equation(): ParsedEq {
    const parts: Node[] = [this.expr()];
    while (this.isCh('=') || this.isCmd('equiv') || this.isCmd('coloneqq')) {
      this.next();
      parts.push(this.expr());
    }
    if (this.cur.t !== 'eof') throw new LatexError(`Unexpected '${this.cur.t === 'cmd' ? '\\' + this.cur.v : this.cur.v}'`, this.cur.pos);
    return { lhs: parts[0], rhs: parts.length > 1 ? parts[parts.length - 1] : null, parts };
  }

  expr(): Node {
    const terms: { sign: 1 | -1; node: Node; src: string }[] = [];
    let sign: 1 | -1 = 1;
    if (this.isCh('+')) this.next();
    else if (this.isCh('-')) {
      this.next();
      sign = -1;
    }
    for (;;) {
      const start = this.cur.pos;
      const node = this.term();
      const end = this.toks[this.i - 1]?.end ?? start;
      terms.push({ sign, node, src: this.src.slice(start, end).trim() });
      if (this.isCh('+') || this.isCmd('pm')) {
        this.next();
        sign = 1;
      } else if (this.isCh('-') || this.isCmd('mp')) {
        this.next();
        sign = -1;
      } else break;
    }
    if (terms.length === 1 && terms[0].sign === 1) return terms[0].node;
    return { k: 'add', terms };
  }

  startsFactor(): boolean {
    const t = this.cur;
    if (t.t === 'eof') return false;
    if (t.t === 'num') return true;
    if (t.t === 'ch') return /[A-Za-z({[|]/.test(t.v);
    if (t.t === 'cmd') {
      return !['cdot', 'times', 'ast', 'div', 'end', 'pm', 'mp', 'right', '\\', 'equiv', 'coloneqq', '}'].includes(t.v);
    }
    return false;
  }

  term(): Node {
    const f: Node[] = [this.factor()];
    for (;;) {
      if (this.isCmd('cdot') || this.isCmd('times') || this.isCmd('ast') || this.isCh('*')) {
        this.next();
        f.push(this.factor());
      } else if (this.isCh('/') || this.isCmd('div')) {
        this.next();
        const b = this.factor();
        const a: Node = f.length === 1 ? f[0] : { k: 'mul', f: f.splice(0) };
        f.length = 0;
        f.push({ k: 'div', a, b });
      } else if (this.startsFactor() && !this.isCh('|')) {
        f.push(this.factor());
      } else if (this.isCh('|') && this.absOpenAllowed()) {
        f.push(this.factor());
      } else break;
    }
    return f.length === 1 ? f[0] : { k: 'mul', f };
  }
  absDepth = 0;
  absOpenAllowed() {
    return this.absDepth === 0;
  }

  factor(): Node {
    if (this.isCh('-')) {
      this.next();
      return { k: 'neg', a: this.factor() };
    }
    if (this.isCh('+')) {
      this.next();
      return this.factor();
    }
    return this.postfix(this.primary(false));
  }

  postfix(base: Node): Node {
    for (;;) {
      if (this.isCh('^')) {
        this.next();
        // transpose / inverse / pseudo-inverse markers
        const save = this.i;
        const raw = this.isCh('{') ? this.rawGroup() : this.next().v;
        const r = raw.replace(/\s|\\mathsf|\\mathrm|\\text|[{}]/g, '');
        if (r === 'T' || r === '\\top' || r === '\\intercal' || r === 'top' || r === 'intercal') {
          base = { k: 'post', op: 'T', a: base };
          continue;
        }
        if (r === '\\dagger' || r === '+' || r === 'dagger' || r === '\\#') {
          base = { k: 'post', op: 'pinv', a: base };
          continue;
        }
        if (r === '-1') {
          base = { k: 'post', op: 'inv', a: base };
          continue;
        }
        if (r === '-T' || r === '-\\top') {
          base = { k: 'post', op: 'T', a: { k: 'post', op: 'inv', a: base } };
          continue;
        }
        this.i = save;
        const exp = this.group();
        base = { k: 'pow', base, exp };
        continue;
      }
      if (this.isCh("'")) {
        throw new LatexError("Primes (') are not supported: use \\dot{} for time derivatives", this.cur.pos);
      }
      if (this.isCh('!')) {
        throw new LatexError('Factorials are not supported', this.cur.pos);
      }
      return base;
    }
  }

  /** symbol name with optional subscript; `decor` is a prefix such as 'd' for \dot */
  symbolTail(base: string, tex: string): Node {
    let name = base;
    let fullTex = tex;
    if (this.isCh('_')) {
      this.next();
      const sub = this.rawGroup();
      name += '_' + canonSub(sub);
      fullTex += `_{${sub}}`;
    }
    return { k: 'sym', name, tex: fullTex };
  }

  primary(inScript: boolean): Node {
    const t = this.cur;
    if (t.t === 'eof') throw new LatexError('Unexpected end of expression', t.pos);
    if (t.t === 'num') {
      this.next();
      return { k: 'num', v: parseFloat(t.v) };
    }
    if (t.t === 'ch') {
      if (/[A-Za-z]/.test(t.v)) {
        this.next();
        return this.symbolTail(t.v, t.v);
      }
      if (t.v === '(' || t.v === '[') {
        this.next();
        const items = [this.expr()];
        while (this.isCh(',')) {
          this.next();
          items.push(this.expr());
        }
        this.expectCh(t.v === '(' ? ')' : ']');
        return { k: 'grp', items };
      }
      if (t.v === '{') {
        this.next();
        const e = this.expr();
        this.expectCh('}');
        return inScript ? e : this.maybeSubscriptOnGroup(e);
      }
      if (t.v === '|') {
        this.next();
        this.absDepth++;
        const e = this.expr();
        this.absDepth--;
        this.expectCh('|');
        return { k: 'abs', a: e };
      }
      throw new LatexError(`Unexpected '${t.v}'`, t.pos);
    }
    // commands
    const c = t.v;
    if (c === '{' || c === '(' || c === '[') {
      this.next();
      const e = this.expr();
      if (this.cur.t === 'cmd' && (this.cur.v === '}' || this.cur.v === ')' || this.cur.v === ']')) this.next();
      else throw new LatexError('Unbalanced brace', this.cur.pos);
      return e;
    }
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') {
      this.next();
      if (this.isCh('{')) {
        const save = this.i;
        const rawNum = this.rawGroup().replace(/\s/g, '');
        if (/^(d|\\partial|\\mathrm\{d\})$/.test(rawNum) || /^(\\partial|d)[A-Za-z\\]/.test(rawNum)) {
          throw new LatexError('Derivative operators (d/dt, ∂/∂q) cannot be evaluated: write out the resulting expression', t.pos);
        }
        this.i = save;
      }
      const a = this.group();
      const b = this.group();
      return { k: 'div', a, b };
    }
    if (c === 'sqrt') {
      this.next();
      let n: Node | null = null;
      if (this.isCh('[')) {
        this.next();
        n = this.expr();
        this.expectCh(']');
      }
      const a = this.group();
      return n ? { k: 'pow', base: a, exp: { k: 'div', a: { k: 'num', v: 1 }, b: n } } : { k: 'fn', name: 'sqrt', arg: a };
    }
    if (c in DECOR) {
      this.next();
      const inner = this.group();
      const prefix = DECOR[c];
      if (inner.k !== 'sym') {
        if (prefix === '') return inner; // \mathbf{...} on non-symbol
        throw new LatexError(`\\${c}{...} must contain a single symbol`, t.pos);
      }
      // \dot{\theta}_2 -> subscript after decoration
      const decorated = { k: 'sym' as const, name: prefix + inner.name, tex: prefix ? `\\${c}{${inner.tex}}` : inner.tex };
      if (this.isCh('_')) {
        this.next();
        const sub = this.rawGroup();
        return { k: 'sym', name: decorated.name + '_' + canonSub(sub), tex: decorated.tex + `_{${sub}}` };
      }
      return decorated;
    }
    if (c === 'operatorname' || c === 'text' || c === 'textrm' || c === 'mathrm' || c === 'operatorname*') {
      this.next();
      const raw = this.rawGroup().trim();
      const fn = FUNCS[raw];
      if (fn) return this.fnCall(fn);
      if (/^[A-Za-z]$/.test(raw)) return this.symbolTail(raw, raw);
      if (/^[A-Za-z]+$/.test(raw)) return this.symbolTail(raw, `\\mathrm{${raw}}`);
      throw new LatexError(`Unknown operator '${raw}'`, t.pos);
    }
    if (c in FUNCS) {
      this.next();
      return this.fnCall(FUNCS[c]);
    }
    if (GREEK.has(c) || c === 'ell') {
      this.next();
      const name = c === 'ell' ? 'l' : c === 'varepsilon' ? 'epsilon' : c === 'vartheta' ? 'theta' : c === 'varphi' ? 'phi' : c;
      if (name === 'pi' && !this.isCh('_')) return { k: 'num', v: Math.PI };
      return this.symbolTail(name, '\\' + c);
    }
    if (c === 'begin') {
      this.next();
      const env = this.rawGroup().trim();
      if (!/^(b|p|v|B|V|small)?matrix\*?$|^array$/.test(env)) throw new LatexError(`Unsupported environment '${env}'`, t.pos);
      if (env === 'array' && this.isCh('{')) this.rawGroup();
      const rows: Node[][] = [];
      let row: Node[] = [];
      for (;;) {
        if (this.isCmd('end')) {
          this.next();
          this.rawGroup();
          break;
        }
        if (this.cur.t === 'eof') throw new LatexError(`Missing \\end{${env}}`, this.cur.pos);
        row.push(this.expr());
        if (this.isCh('&')) {
          this.next();
          continue;
        }
        if (this.isCmd('\\') || this.isCmd('cr')) {
          this.next();
          rows.push(row);
          row = [];
          continue;
        }
      }
      if (row.length) rows.push(row);
      const w = rows[0]?.length ?? 0;
      if (!w || rows.some((r) => r.length !== w)) throw new LatexError('Matrix rows must have the same number of entries', t.pos);
      return { k: 'mat', rows };
    }
    if (c === 'exponentialE') {
      this.next();
      return { k: 'num', v: Math.E };
    }
    if (c === 'partial' || c === 'nabla') throw new LatexError('Derivative operators cannot be evaluated: write out the resulting expression', t.pos);
    if (c === 'placeholder') throw new LatexError('Fill in the empty placeholder', t.pos);
    if (c === 'infty') {
      this.next();
      return { k: 'num', v: Infinity };
    }
    throw new LatexError(`Unsupported command \\${c}`, t.pos);
  }

  curIsFunc(): boolean {
    const c = this.toks[this.i];
    return c.t === 'cmd' && c.v in FUNCS;
  }

  maybeSubscriptOnGroup(e: Node): Node {
    return e;
  }

  fnCall(name: string): Node {
    let pow: Node | undefined;
    if (this.isCh('^')) {
      this.next();
      pow = this.group();
    }
    let arg: Node;
    if (this.isCh('(') || this.isCh('[') || (this.cur.t === 'cmd' && (this.cur.v === '(' || this.cur.v === '{'))) {
      arg = this.primary(false);
    } else if (this.isCh('{')) {
      arg = this.primary(true);
    } else if (this.cur.t === 'num') {
      // \sin 2\theta  -> sin(2 theta)
      const n = this.primary(false);
      if (this.startsFactor() && !this.curIsFunc()) {
        const s = this.postfix(this.primary(false));
        arg = { k: 'mul', f: [n, s] };
      } else arg = n;
    } else {
      arg = this.postfix(this.primary(false));
    }
    return { k: 'fn', name, arg, pow };
  }
}

export function canonSub(sub: string): string {
  return sub
    .replace(/\\(mathrm|text|mathit|textrm|operatorname)\s*/g, '')
    .replace(/\\([A-Za-z]+)/g, '$1')
    .replace(/[{}\s,]/g, '');
}

export function parseLatex(src: string): ParsedEq {
  const cleaned = src.replace(/\\placeholder\{\}/g, '\\placeholder').trim();
  if (!cleaned) throw new LatexError('Empty input', 0);
  return new P(cleaned).equation();
}

/** canonical symbol names from LaTeX (used for palettes) */
export function canonicalName(tex: string): string {
  const eq = parseLatex(tex);
  if (eq.lhs.k !== 'sym') throw new Error(`Not a symbol: ${tex}`);
  return eq.lhs.name;
}

export function collectSymbols(n: Node, out = new Set<string>()): Set<string> {
  switch (n.k) {
    case 'sym':
      out.add(n.name);
      break;
    case 'add':
      n.terms.forEach((t) => collectSymbols(t.node, out));
      break;
    case 'mul':
      n.f.forEach((x) => collectSymbols(x, out));
      break;
    case 'div':
      collectSymbols(n.a, out);
      collectSymbols(n.b, out);
      break;
    case 'pow':
      collectSymbols(n.base, out);
      collectSymbols(n.exp, out);
      break;
    case 'post':
    case 'neg':
    case 'abs':
      collectSymbols(n.a, out);
      break;
    case 'fn':
      collectSymbols(n.arg, out);
      if (n.pow) collectSymbols(n.pow, out);
      break;
    case 'mat':
      n.rows.forEach((r) => r.forEach((x) => collectSymbols(x, out)));
      break;
    case 'grp':
      n.items.forEach((x) => collectSymbols(x, out));
      break;
  }
  return out;
}
