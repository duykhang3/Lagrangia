import { inv, Mat, matmul, pinv, rng, transpose } from '../linalg';
import type { I18n } from '../types';
import { canonicalName, collectSymbols, LatexError, Node, parseLatex } from './parser';

export type Value = number | Mat;

export type SymKind = 'angle' | 'rate' | 'accel' | 'param' | 'input' | 'real' | 'vec' | 'mat' | 'spd' | 'diag' | 'symm' | 'eye';

export interface SymDef {
  tex: string;
  kind: SymKind;
  dims?: [number, number];
  /** LaTeX definition in terms of other symbols (e.g. e = q_d - q) */
  alias?: string;
  /** may be written with arguments, e.g. M(q), C(q,\dot q) */
  fn?: boolean;
  desc?: I18n;
}

export interface FieldDef {
  id: string;
  label: I18n;
  /** LaTeX shown in front of the input, e.g. "T =" */
  prefix?: string;
  kind: 'expr' | 'equation';
  ref: string;
  symbols: SymDef[];
  /** allow a constant offset (potential energy, Lagrangian) */
  offset?: boolean;
  /** C(q,qd) check: compare products with these velocity symbols when the matrix differs */
  christoffel?: string[];
  hint: I18n;
  placeholder?: string;
}

export interface CheckMsg {
  en: string;
  nl: string;
  tex?: string;
}
export interface CheckResult {
  status: 'correct' | 'incorrect' | 'error';
  messages: CheckMsg[];
}

const M = (en: string, nl: string, tex?: string): CheckMsg => ({ en, nl, tex });

// ---------------------------------------------------------------- evaluator
export class EvalError extends Error {}

function isMat(v: Value): v is Mat {
  return v instanceof Mat;
}
function sc(v: Value): Value {
  return isMat(v) && v.r === 1 && v.c === 1 ? v.d[0] : v;
}
function dimStr(v: Value) {
  return isMat(v) ? `${v.r}×${v.c}` : 'scalar';
}
function mul(a: Value, b: Value): Value {
  a = sc(a);
  b = sc(b);
  if (!isMat(a) && !isMat(b)) return a * b;
  if (!isMat(a)) return new Mat((b as Mat).r, (b as Mat).c, (b as Mat).d.map((x) => x * (a as number)));
  if (!isMat(b)) return new Mat(a.r, a.c, a.d.map((x) => x * (b as number)));
  if (a.c !== b.r) throw new EvalError(`Dimension mismatch: cannot multiply ${dimStr(a)} by ${dimStr(b)} (check the order of factors or a missing transpose)`);
  return sc(matmul(a, b));
}
function add(a: Value, b: Value, s: number): Value {
  a = sc(a);
  b = sc(b);
  if (!isMat(b) && b === 0) return a;
  if (!isMat(a) && a === 0 && isMat(b)) return s === 1 ? b : map(b, (x) => s * x);
  if (!isMat(a) && !isMat(b)) return a + s * b;
  if (isMat(a) && isMat(b) && a.r === b.r && a.c === b.c) return new Mat(a.r, a.c, a.d.map((x, i) => x + s * b.d[i]));
  throw new EvalError(`Dimension mismatch: cannot add ${dimStr(a)} and ${dimStr(b)}`);
}
function map(a: Value, f: (x: number) => number): Value {
  return isMat(a) ? new Mat(a.r, a.c, a.d.map(f)) : f(a);
}
const FN: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (x) => 1 / Math.tan(x),
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
  sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
};

export interface EvalEnv {
  vals: Map<string, Value>;
  fnSyms: Set<string>;
}

export function evaluate(n: Node, env: EvalEnv): Value {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'sym': {
      const v = env.vals.get(n.name);
      if (v === undefined) throw new UnknownSymbolError(n.name, n.tex);
      return v;
    }
    case 'grp':
      if (n.items.length !== 1) throw new EvalError('Unexpected comma-separated list (only allowed as arguments such as C(q, \\dot q))');
      return evaluate(n.items[0], env);
    case 'add': {
      let acc: Value | null = null;
      for (const t of n.terms) {
        const v = evaluate(t.node, env);
        acc = acc === null ? (t.sign === 1 ? v : map(v, (x) => -x)) : add(acc, v, t.sign);
      }
      return acc!;
    }
    case 'mul': {
      let acc: Value | null = null;
      for (let i = 0; i < n.f.length; i++) {
        const f = n.f[i];
        const v = evaluate(f, env);
        acc = acc === null ? v : mul(acc, v);
        // M(q), C(q,\dot q): skip the argument list
        const nx = n.f[i + 1];
        if (f.k === 'sym' && env.fnSyms.has(f.name) && nx?.k === 'grp' && nx.items.every((it) => it.k === 'sym' && !it.name.startsWith('dd'))) i++;
      }
      return acc!;
    }
    case 'div': {
      const a = evaluate(n.a, env),
        b = sc(evaluate(n.b, env));
      if (isMat(b)) throw new EvalError('Division by a matrix is not defined: use ^{-1} (inverse)');
      return map(a, (x) => x / b);
    }
    case 'pow': {
      const b = sc(evaluate(n.base, env)),
        e = sc(evaluate(n.exp, env));
      if (isMat(e)) throw new EvalError('Exponent must be a scalar');
      if (isMat(b)) {
        if (b.r !== b.c) throw new EvalError(`Cannot raise a ${dimStr(b)} matrix to a power`);
        if (!Number.isInteger(e) || e < 0) throw new EvalError('Matrix powers must be non-negative integers');
        let r: Mat = Mat.eye(b.r);
        for (let i = 0; i < e; i++) r = matmul(r, b);
        return r;
      }
      return Math.pow(b, e);
    }
    case 'post': {
      const a = sc(evaluate(n.a, env));
      if (n.op === 'T') return isMat(a) ? sc(transpose(a)) : a;
      if (n.op === 'inv') {
        if (!isMat(a)) return 1 / a;
        if (a.r !== a.c) throw new EvalError(`Cannot invert a non-square ${dimStr(a)} matrix (use the pseudo-inverse ^{\\dagger})`);
        return inv(a);
      }
      return isMat(a) ? pinv(a) : 1 / a;
    }
    case 'neg':
      return map(evaluate(n.a, env), (x) => -x);
    case 'abs':
      return map(evaluate(n.a, env), Math.abs);
    case 'fn': {
      let a = evaluate(n.arg, env);
      if (n.name === 'diag') {
        if (!isMat(a)) return a;
        return Mat.diag(a.d);
      }
      const f = FN[n.name];
      if (!f) throw new EvalError(`Unknown function ${n.name}`);
      a = map(a, f);
      if (n.pow) {
        const p = sc(evaluate(n.pow, env));
        if (isMat(p)) throw new EvalError('Exponent must be a scalar');
        a = map(a, (x) => Math.pow(x, p));
      }
      return a;
    }
    case 'mat': {
      const rows = n.rows.map((r) => r.map((x) => evaluate(x, env)));
      // block matrices: every entry scalar or compatible blocks
      const allScalar = rows.every((r) => r.every((v) => !isMat(v) || (v.r === 1 && v.c === 1)));
      if (allScalar) return Mat.fromRows(rows.map((r) => r.map((v) => (isMat(v) ? v.d[0] : v))));
      // block matrix assembly
      const blockRows = rows.map((r) => {
        const ms = r.map((v) => (isMat(v) ? v : new Mat(1, 1, [v])));
        const h = ms[0].r;
        if (ms.some((m) => m.r !== h)) throw new EvalError('Inconsistent block heights in matrix');
        const w = ms.reduce((s, m) => s + m.c, 0);
        const out = new Mat(h, w);
        let off = 0;
        for (const m of ms) {
          for (let i = 0; i < h; i++) for (let j = 0; j < m.c; j++) out.set(i, off + j, m.get(i, j));
          off += m.c;
        }
        return out;
      });
      const w = blockRows[0].c;
      if (blockRows.some((m) => m.c !== w)) throw new EvalError('Inconsistent block widths in matrix');
      const h = blockRows.reduce((s, m) => s + m.r, 0);
      const out = new Mat(h, w);
      let off = 0;
      for (const m of blockRows) {
        out.d.set(m.d, off * w);
        off += m.r;
      }
      return out;
    }
  }
}

export class UnknownSymbolError extends Error {
  name_: string;
  tex: string;
  constructor(name: string, tex: string) {
    super(`Unknown symbol ${tex}`);
    this.name_ = name;
    this.tex = tex;
  }
}

// ---------------------------------------------------------------- sampling
interface SymInfo extends SymDef {
  name: string;
  aliasNode?: Node;
}

const symCache = new Map<string, SymInfo[]>();
export function symbolInfo(defs: SymDef[]): SymInfo[] {
  const key = JSON.stringify(defs);
  const c = symCache.get(key);
  if (c) return c;
  const out = defs.map((d) => ({ ...d, name: canonicalName(d.tex), aliasNode: d.alias ? parseLatex(d.alias).lhs : undefined }));
  symCache.set(key, out);
  return out;
}

function sampleValue(s: SymInfo, r: () => number): Value {
  const u = (a: number, b: number) => a + (b - a) * r();
  const [rr, cc] = s.dims ?? [1, 1];
  switch (s.kind) {
    case 'angle':
      return u(-Math.PI, Math.PI);
    case 'rate':
      return u(-3, 3);
    case 'accel':
      return u(-6, 6);
    case 'param':
      return u(0.3, 2);
    case 'input':
      return u(-5, 5);
    case 'real':
      return u(-2, 2);
    case 'vec':
    case 'mat': {
      const m = new Mat(rr, cc);
      for (let i = 0; i < m.d.length; i++) m.d[i] = u(-1, 1);
      return sc(m);
    }
    case 'eye':
      return Mat.eye(rr);
    case 'diag': {
      const m = new Mat(rr, rr);
      for (let i = 0; i < rr; i++) m.set(i, i, u(0.5, 2));
      return m;
    }
    case 'symm':
    case 'spd': {
      const A = new Mat(rr, rr);
      for (let i = 0; i < A.d.length; i++) A.d[i] = u(-1, 1);
      const S = matmul(transpose(A), A);
      if (s.kind === 'spd') for (let i = 0; i < rr; i++) S.set(i, i, S.get(i, i) + 0.5);
      return sc(S);
    }
  }
}

export function makeEnv(defs: SymDef[], seed: number, paramSeed = seed): EvalEnv {
  const info = symbolInfo(defs);
  const r = rng(seed);
  const rp = rng(paramSeed);
  const vals = new Map<string, Value>();
  const fnSyms = new Set<string>();
  for (const s of info) {
    if (s.fn) fnSyms.add(s.name);
    if (!s.alias) vals.set(s.name, sampleValue(s, s.kind === 'param' ? rp : r));
  }
  const env = { vals, fnSyms };
  for (const s of info) if (s.aliasNode) vals.set(s.name, evaluate(s.aliasNode, env));
  return env;
}

// ---------------------------------------------------------------- comparison helpers
const NGROUPS = 4;
const PER_GROUP = 5;
function flatten(v: Value): number[] {
  return isMat(v) ? Array.from(v.d) : [v];
}
function shape(v: Value): [number, number] {
  return isMat(v) ? [v.r, v.c] : [1, 1];
}

type Fn = (env: EvalEnv) => Value;

interface Samples {
  envs: EvalEnv[];
}
function samples(defs: SymDef[]): Samples {
  const envs: EvalEnv[] = [];
  for (let g = 0; g < NGROUPS; g++) for (let i = 0; i < PER_GROUP; i++) envs.push(makeEnv(defs, 1000 + (g * PER_GROUP + i) * 7919, 77 + g * 104729));
  return { envs };
}

function evalAll(f: Fn, S: Samples): number[][] {
  return S.envs.map((e) => flatten(f(e)));
}

const close = (a: number, b: number, scale: number) => Math.abs(a - b) <= 1e-7 * (Math.abs(a) + Math.abs(b)) + 1e-9 * scale;

/**
 * finds k (per parameter group) such that u = k·r (+ offset) on all samples (k = 1 when !allowScale).
 * k and the offset may depend on the physical parameters but not on the state. Returns k of the first group or null.
 */
function proportional(U: number[][], R: number[][], allowScale: boolean, allowOffset: boolean): number | null {
  let k0: number | null = null;
  for (let g = 0; g * PER_GROUP < R.length; g++) {
    const k = proportionalGroup(U.slice(g * PER_GROUP, (g + 1) * PER_GROUP), R.slice(g * PER_GROUP, (g + 1) * PER_GROUP), allowScale, allowOffset);
    if (k === null) return null;
    if (g === 0) k0 = k;
  }
  return k0;
}
function proportionalGroup(U: number[][], R: number[][], allowScale: boolean, allowOffset: boolean): number | null {
  const scale = Math.max(1, ...R.flat().map(Math.abs), ...U.flat().map(Math.abs));
  let k: number | null = allowScale ? null : 1;
  if (k === null) {
    let best = 0;
    for (let s = 0; s < R.length; s++)
      for (let i = 0; i < R[s].length; i++)
        if (Math.abs(R[s][i]) > Math.abs(best) && Math.abs(R[s][i]) > 1e-6) {
          best = R[s][i];
          k = U[s][i] / R[s][i];
        }
    if (k === null) {
      // reference identically zero
      return U.flat().every((x) => Math.abs(x) < 1e-9 * scale) ? 1 : null;
    }
    if (!isFinite(k) || Math.abs(k) < 1e-12) return null;
  }
  let offset = 0;
  if (allowOffset) offset = U[0][0] - k * R[0][0];
  for (let s = 0; s < R.length; s++) {
    if (U[s].length !== R[s].length) return null;
    for (let i = 0; i < R[s].length; i++) if (!close(U[s][i], k * R[s][i] + offset, scale)) return null;
  }
  return k;
}

interface Term {
  sign: 1 | -1;
  node: Node;
  src: string;
}
function topTerms(n: Node): Term[] {
  if (n.k === 'add') return n.terms;
  if (n.k === 'neg') return topTerms(n.a).map((t) => ({ ...t, sign: (t.sign * -1) as 1 | -1 }));
  return [{ sign: 1, node: n, src: '' }];
}

function prettyFactor(c: number): string {
  for (const d of [1, 2, 3, 4, 6, 8]) {
    const nmr = c * d;
    if (Math.abs(nmr - Math.round(nmr)) < 1e-6) {
      const n = Math.round(nmr);
      return d === 1 ? `${n}` : `${n}/${d}`;
    }
  }
  return c.toPrecision(4);
}

function symbolTexList(names: Set<string>, info: SymInfo[]): string {
  return [...names]
    .map((n) => info.find((s) => s.name === n)?.tex)
    .filter(Boolean)
    .map((x) => "$" + x + "$")
    .join(", ");
}

// ---------------------------------------------------------------- main checker
function stripLhs(field: FieldDef, src: string): string {
  return src;
}

export function checkField(field: FieldDef, userLatex: string): CheckResult {
  const info = symbolInfo(field.symbols);
  const allowed = new Set(info.map((s) => s.name));
  let user;
  try {
    user = parseLatex(stripLhs(field, userLatex));
  } catch (e) {
    if (e instanceof LatexError) return { status: 'error', messages: [M(`Could not read your input: ${e.message}`, `Kon je invoer niet lezen: ${e.message}`)] };
    throw e;
  }
  const ref = parseLatex(field.ref);

  // build residual / expression nodes
  let uNode: Node, rNode: Node;
  const residual = (eq: ReturnType<typeof parseLatex>): Node =>
    eq.rhs ? { k: 'add', terms: [...topTerms(eq.lhs), ...topTerms(eq.rhs).map((t) => ({ ...t, sign: (t.sign * -1) as 1 | -1 }))] } : eq.lhs;
  if (field.kind === 'equation') {
    if (!user.rhs) {
      return { status: 'error', messages: [M('This field expects an equation with an "=" sign.', 'Dit veld verwacht een vergelijking met een "="-teken.')] };
    }
    if (user.parts.length > 2) return { status: 'error', messages: [M('Use a single "=" sign.', 'Gebruik één "="-teken.')] };
    uNode = residual(user);
    rNode = residual(ref);
  } else {
    // expression: "T = ..." -> take the right-most part
    uNode = user.parts[user.parts.length - 1];
    rNode = ref.parts[ref.parts.length - 1];
  }

  // unknown symbols
  const used = collectSymbols(uNode);
  const unknown = [...used].filter((s) => !allowed.has(s));
  if (unknown.length) {
    const list = unknown.join(', ');
    return {
      status: 'error',
      messages: [
        M(`Unknown symbol(s): ${list}. Use the symbols from the palette below the field.`, `Onbekende symbolen: ${list}. Gebruik de symbolen uit het palet onder het veld.`),
      ],
    };
  }

  const S = samples(field.symbols);
  let U: number[][], R: number[][];
  try {
    U = evalAll((e) => evaluate(uNode, e), S);
  } catch (e) {
    const msg = (e as Error).message;
    return { status: 'error', messages: [M(`Cannot evaluate your expression: ${msg}`, `Kan je uitdrukking niet evalueren: ${msg}`)] };
  }
  R = evalAll((e) => evaluate(rNode, e), S);
  const shU = shape(evaluate(uNode, S.envs[0])),
    shR = shape(evaluate(rNode, S.envs[0]));
  if (shU[0] !== shR[0] || shU[1] !== shR[1]) {
    return {
      status: 'incorrect',
      messages: [M(`Wrong dimensions: your result is ${shU[0]}×${shU[1]}, expected ${shR[0]}×${shR[1]}.`, `Verkeerde dimensies: jouw resultaat is ${shU[0]}×${shU[1]}, verwacht ${shR[0]}×${shR[1]}.`)],
    };
  }
  const isEq = field.kind === 'equation';
  const k = proportional(U, R, isEq, !!field.offset);
  if (k !== null) {
    const msgs: CheckMsg[] = [M('Correct! ✔', 'Correct! ✔')];
    if (isEq && Math.abs(k - 1) > 1e-9) msgs.push(M(`Equivalent to the reference equation (scaled by ${prettyFactor(k)}).`, `Equivalent aan de referentievergelijking (geschaald met ${prettyFactor(k)}).`));
    if (field.offset && Math.abs(U[0][0] - R[0][0]) > 1e-9) msgs.push(M('Equal up to a constant: fine, a constant does not change the dynamics.', 'Gelijk op een constante na: prima, een constante verandert de dynamica niet.'));
    return { status: 'correct', messages: msgs };
  }

  // Christoffel: C(q,qd) not unique, only C qd is
  if (field.christoffel && shR[1] === shR[0] && shR[0] > 1) {
    const qd = field.christoffel;
    const prod = (rows: number[][]) =>
      rows.map((m, s) => {
        const n = shR[0];
        const v = qd.map((name) => S.envs[s].vals.get(canonicalName(name)) as number);
        return Array.from({ length: n }, (_, i) => m.slice(i * n, (i + 1) * n).reduce((acc, x, j) => acc + x * v[j], 0));
      });
    if (proportional(prod(U), prod(R), false, false) !== null) {
      return {
        status: 'correct',
        messages: [
          M('Correct C(q,q̇)q̇! ✔', 'Correct C(q,q̇)q̇! ✔'),
          M(
            'Your C differs from the Christoffel-symbol form. That is a valid factorization, but only the Christoffel choice makes Ṁ − 2C skew-symmetric (important for passivity-based control).',
            'Jouw C verschilt van de Christoffel-vorm. Dat is een geldige factorisatie, maar alleen de Christoffel-keuze maakt Ṁ − 2C scheef-symmetrisch (belangrijk voor passiviteitsgebaseerde regeling).',
          ),
        ],
      };
    }
  }

  const msgs: CheckMsg[] = [M('Not correct yet.', 'Nog niet correct.')];
  try {
    msgs.push(...diagnose(uNode, rNode, U, R, S, isEq, !!field.offset, info, shR));
  } catch {
    /* diagnostics are best effort */
  }
  return { status: 'incorrect', messages: msgs.slice(0, 4) };
}

function diagnose(uNode: Node, rNode: Node, U: number[][], R: number[][], S: Samples, isEq: boolean, offset: boolean, info: SymInfo[], shR: [number, number]): CheckMsg[] {
  const out: CheckMsg[] = [];
  // matrices: which entries are wrong?
  if (shR[0] * shR[1] > 1 && (uNode.k === 'mat' || rNode.k === 'mat') && !isEq) {
    const wrong: string[] = [];
    for (let i = 0; i < shR[0]; i++)
      for (let j = 0; j < shR[1]; j++) {
        const idx = i * shR[1] + j;
        const ok = U.every((u, s) => close(u[idx], R[s][idx], Math.max(1, Math.abs(R[s][idx]))));
        if (!ok) wrong.push(shR[1] === 1 ? `(${i + 1})` : `(${i + 1},${j + 1})`);
      }
    if (wrong.length) out.push(M(`Entries that are wrong: ${wrong.join(', ')}.`, `Foute elementen: ${wrong.join(', ')}.`));
    return out;
  }
  // overall sign
  if (!isEq && proportional(U, R.map((r) => r.map((x) => -x)), false, offset) !== null)
    return [M('The overall sign is flipped.', 'Het totale teken is omgedraaid.')];
  if (!isEq) {
    const k = proportional(U, R, true, offset);
    if (k !== null) return [M(`Your result is ${prettyFactor(k)} times the correct one: check a constant factor (e.g. ½).`, `Je resultaat is ${prettyFactor(k)} keer het juiste: controleer een constante factor (bijv. ½).`)];
  }
  const uTerms = topTerms(uNode);
  const rTerms = topTerms(rNode);
  const evT = (t: Term) => S.envs.map((e) => flatten(evaluate(t.node, e)).map((x) => x * t.sign));
  const sub = (A: number[][], B: number[][], s = 1) => A.map((a, i) => a.map((x, j) => x - s * B[i][j]));
  // extra / sign-flipped / wrong-coefficient terms in the user's input
  if (uTerms.length > 1) {
    for (const t of uTerms) {
      let T: number[][];
      try {
        T = evT(t);
      } catch {
        continue;
      }
      const src = t.src || '';
      if (proportional(sub(U, T), R, isEq, offset) !== null) {
        out.push(M('This term should not be there (or belongs elsewhere):', 'Deze term hoort er niet (of hoort ergens anders):', src));
        return out;
      }
      if (proportional(sub(U, T, 2), R, isEq, offset) !== null) {
        out.push(M('This term has the wrong sign:', 'Deze term heeft het verkeerde teken:', src));
        return out;
      }
      if (!isEq) {
        // coefficient: U - T + c T = R  -> c = (R - U + T)/T
        const s0 = T[0].findIndex((x) => Math.abs(x) > 1e-6);
        if (s0 >= 0) {
          const c = (R[0][s0] - U[0][s0] + T[0][s0]) / T[0][s0];
          if (isFinite(c) && Math.abs(c - 1) > 1e-6 && Math.abs(c) > 1e-6) {
            const fixed = U.map((u, i) => u.map((x, j) => x - T[i][j] + c * T[i][j]));
            if (proportional(fixed, R, false, offset) !== null) {
              out.push(M(`The coefficient of this term is off by a factor ${prettyFactor(c)}:`, `De coëfficiënt van deze term wijkt af met een factor ${prettyFactor(c)}:`, src));
              return out;
            }
          }
        }
      }
    }
  }
  // missing reference term
  for (const t of rTerms) {
    const T = evT(t);
    if (rTerms.length > 1 && proportional(U, sub(R, T), isEq, offset) !== null) {
      const syms = collectSymbols(t.node);
      const list = symbolTexList(syms, info);
      out.push(M(`A term is missing. It contains: ${list || 'only constants'}.`, `Er ontbreekt een term. Die bevat: ${list || 'alleen constanten'}.`));
      return out;
    }
  }
  // variables check
  const uSyms = collectSymbols(uNode),
    rSyms = collectSymbols(rNode);
  const missing = [...rSyms].filter((s) => !uSyms.has(s));
  const extra = [...uSyms].filter((s) => !rSyms.has(s));
  if (missing.length) out.push(M(`Hint: the answer also depends on ${symbolTexList(new Set(missing), info)}.`, `Hint: het antwoord hangt ook af van ${symbolTexList(new Set(missing), info)}.`));
  if (extra.length) out.push(M(`Hint: the answer does not depend on ${symbolTexList(new Set(extra), info)}.`, `Hint: het antwoord hangt niet af van ${symbolTexList(new Set(extra), info)}.`));
  if (out.length === 0) out.push(M('Several terms differ from the reference. Compare term by term.', 'Meerdere termen wijken af van de referentie. Vergelijk term voor term.'));
  return out;
}

/** Ghost model support: compiles user EOM fields into a function for numerical simulation */
export function compileResidual(latex: string, fnSyms: string[] = []): (vals: Map<string, Value>) => number {
  const eq = parseLatex(latex);
  if (!eq.rhs) throw new Error('Equation needs an "=" sign');
  const node: Node = { k: 'add', terms: [...topTerms(eq.lhs), ...topTerms(eq.rhs).map((t) => ({ ...t, sign: (t.sign * -1) as 1 | -1 }))] };
  const fs = new Set(fnSyms);
  return (vals) => {
    const v = evaluate(node, { vals, fnSyms: fs });
    if (isMat(v)) throw new Error('Equation must be scalar');
    return v;
  };
}
