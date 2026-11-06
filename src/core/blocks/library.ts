import { gaussian, lqr, Mat, matmul, rng, transpose } from '../linalg';
import { evalString, MatlabFunction, Value, valueToString, vops } from '../matlab/interp';
import type { I18n } from '../types';
import type { BlockCtx, BlockDef, BlockInst, BlockParamSpec } from './types';

const { elementwise, mtimes, mapv, toMat, norm1, num, numel } = vops;

const ev = (src: unknown, ctx: BlockCtx, what: string): Value => {
  const s = String(src ?? '').trim();
  if (!s) throw new Error(`Parameter '${what}' is empty`);
  try {
    return evalString(s, ctx.ws);
  } catch (e) {
    throw new Error(`Parameter '${what}': ${(e as Error).message}`);
  }
};
const evNum = (src: unknown, ctx: BlockCtx, what: string) => {
  const v = ev(src, ctx, what);
  return num(v, what);
};
const evOptNum = (src: unknown, ctx: BlockCtx, what: string, dflt: number) => (String(src ?? '').trim() === '' ? dflt : evNum(src, ctx, what));
const colvec = (xs: number[]): Value => (xs.length === 1 ? xs[0] : Mat.col(xs));
export const flat = (v: Value): number[] => {
  if (typeof v === 'number') return [v];
  if (typeof v === 'string') return [];
  const m = toMat(v);
  const out: number[] = [];
  for (let j = 0; j < m.c; j++) for (let i = 0; i < m.r; i++) out.push(m.d[i * m.c + j]); // column-major like MATLAB
  return out;
};

const L = (en: string, nl: string): I18n => ({ en, nl });
const P = (key: string, en: string, nl: string, def: string, kind: BlockParamSpec['kind'] = 'expr', extra: Partial<BlockParamSpec> = {}): BlockParamSpec => ({
  key,
  label: L(en, nl),
  kind,
  default: def,
  ...extra,
});
const stateless = (f: (t: number, u: Value[]) => Value[]): BlockInst => ({ output: f });
const range = (n: number, prefix = 'u') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const intParam = (p: Record<string, any>, key: string, dflt: number, min = 1, max = 16) => {
  const v = parseInt(String(p[key] ?? dflt), 10);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dflt;
};

/** continuous LTI system integrated with RK4 over each sample interval (ZOH input) */
function ltiInst(A: Mat, B: Mat, C: Mat, D: Mat, x0: number[], Ts: number): BlockInst {
  const n = A.r;
  let x = x0.slice();
  const f = (xx: number[], u: number[]) => {
    const dx = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += A.get(i, j) * xx[j];
      for (let j = 0; j < B.c; j++) s += B.get(i, j) * u[j];
      dx[i] = s;
    }
    return dx;
  };
  const out = (u: number[]) => {
    const y: number[] = [];
    for (let i = 0; i < C.r; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += C.get(i, j) * x[j];
      for (let j = 0; j < D.c; j++) s += D.get(i, j) * (u[j] ?? 0);
      y.push(s);
    }
    return y;
  };
  return {
    output: (_t, u) => [colvec(out(u[0] === undefined ? [] : flat(u[0])))],
    update: (_t, u) => {
      const uu = flat(u[0] ?? 0);
      const h = Ts / 4;
      for (let k = 0; k < 4; k++) {
        const add = (a: number[], b: number[], s: number) => a.map((v, i) => v + s * b[i]);
        const k1 = f(x, uu),
          k2 = f(add(x, k1, h / 2), uu),
          k3 = f(add(x, k2, h / 2), uu),
          k4 = f(add(x, k3, h), uu);
        x = x.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      }
    },
  };
}

function tfToSS(num_: number[], den_: number[]) {
  let den = den_.slice();
  while (den.length && den[0] === 0) den.shift();
  if (!den.length) throw new Error('Denominator is zero');
  let numr = num_.slice();
  while (numr.length > 1 && numr[0] === 0) numr.shift();
  const n = den.length - 1;
  if (numr.length > den.length) throw new Error('Transfer function must be proper (deg num ≤ deg den)');
  const a0 = den[0];
  den = den.map((v) => v / a0);
  numr = numr.map((v) => v / a0);
  while (numr.length < den.length) numr.unshift(0);
  const d = numr[0];
  const A = new Mat(n, n),
    B = new Mat(n, 1),
    C = new Mat(1, n),
    D = new Mat(1, 1, [d]);
  if (n > 0) {
    for (let j = 0; j < n; j++) A.set(0, j, -den[j + 1]);
    for (let i = 1; i < n; i++) A.set(i, i - 1, 1);
    B.set(0, 0, 1);
    for (let j = 0; j < n; j++) C.set(0, j, numr[j + 1] - d * den[j + 1]);
  }
  return { A, B, C, D, n };
}

const qOf = (v: Value) => flat(v);

export const BLOCKS: BlockDef[] = [
  // ------------------------------------------------------------ sources
  {
    type: 'state',
    category: 'sources',
    name: L('Plant sensors', 'Plant-sensoren'),
    desc: L('Measured joint positions q, velocities q̇ and the full state x = [q; q̇].', 'Gemeten gewrichtsposities q, snelheden q̇ en de volledige toestand x = [q; q̇].'),
    params: [],
    ports: () => ({ in: [], out: ['q', 'q̇', 'x'] }),
    face: () => 'Plant',
    create: (_p, ctx) =>
      stateless(() => {
        const { q, dq } = ctx.io.sensor();
        return [colvec(q), colvec(dq), colvec([...q, ...dq])];
      }),
  },
  {
    type: 'constant',
    category: 'sources',
    name: L('Constant', 'Constante'),
    desc: L('Outputs a constant (scalar, vector or matrix). Accepts MATLAB expressions and workspace variables.', 'Geeft een constante (scalar, vector of matrix). Accepteert MATLAB-expressies en workspace-variabelen.'),
    params: [P('value', 'Value', 'Waarde', '1')],
    ports: () => ({ in: [], out: ['y'] }),
    face: (p) => String(p.value ?? ''),
    create: (p, ctx) => {
      const v = ev(p.value, ctx, 'value');
      return stateless(() => [v]);
    },
  },
  {
    type: 'step',
    category: 'sources',
    name: L('Step', 'Stap'),
    desc: L('Steps from the initial to the final value at the step time.', 'Springt van begin- naar eindwaarde op het staptijdstip.'),
    params: [P('time', 'Step time [s]', 'Staptijd [s]', '1'), P('initial', 'Initial value', 'Beginwaarde', '0'), P('final', 'Final value', 'Eindwaarde', '1')],
    ports: () => ({ in: [], out: ['y'] }),
    face: () => '⎍',
    create: (p, ctx) => {
      const T = evNum(p.time, ctx, 'time');
      const a = ev(p.initial, ctx, 'initial'),
        b = ev(p.final, ctx, 'final');
      return stateless((t) => [t >= T ? b : a]);
    },
  },
  {
    type: 'sine',
    category: 'sources',
    name: L('Sine wave', 'Sinusgolf'),
    desc: L('y = A sin(2π f t + φ) + bias', 'y = A sin(2π f t + φ) + offset'),
    params: [P('amp', 'Amplitude', 'Amplitude', '1'), P('freq', 'Frequency [Hz]', 'Frequentie [Hz]', '0.5'), P('phase', 'Phase [rad]', 'Fase [rad]', '0'), P('bias', 'Bias', 'Offset', '0')],
    ports: () => ({ in: [], out: ['y'] }),
    face: () => '∿',
    create: (p, ctx) => {
      const A = ev(p.amp, ctx, 'amp'),
        f = evNum(p.freq, ctx, 'freq'),
        ph = evNum(p.phase, ctx, 'phase'),
        b = ev(p.bias, ctx, 'bias');
      return stateless((t) => [elementwise(mtimes(A, Math.sin(2 * Math.PI * f * t + ph)), b, (x, y) => x + y, '+')]);
    },
  },
  {
    type: 'pulse',
    category: 'sources',
    name: L('Pulse generator', 'Pulsgenerator'),
    desc: L('Square wave with amplitude, period and duty cycle.', 'Blokgolf met amplitude, periode en duty cycle.'),
    params: [P('amp', 'Amplitude', 'Amplitude', '1'), P('period', 'Period [s]', 'Periode [s]', '2'), P('duty', 'Duty cycle [%]', 'Duty cycle [%]', '50'), P('delay', 'Delay [s]', 'Vertraging [s]', '0')],
    ports: () => ({ in: [], out: ['y'] }),
    face: () => '⊓⊔',
    create: (p, ctx) => {
      const A = ev(p.amp, ctx, 'amp'),
        T = Math.max(evNum(p.period, ctx, 'period'), 1e-6),
        d = evNum(p.duty, ctx, 'duty') / 100,
        dl = evNum(p.delay, ctx, 'delay');
      return stateless((t) => {
        if (t < dl) return [0];
        const ph = ((t - dl) % T) / T;
        return [ph < d ? A : mtimes(A, 0)];
      });
    },
  },
  {
    type: 'ramp',
    category: 'sources',
    name: L('Ramp', 'Helling'),
    desc: L('y = slope·(t − start) for t ≥ start', 'y = helling·(t − start) voor t ≥ start'),
    params: [P('slope', 'Slope', 'Helling', '1'), P('start', 'Start time [s]', 'Starttijd [s]', '0')],
    ports: () => ({ in: [], out: ['y'] }),
    face: () => '⟋',
    create: (p, ctx) => {
      const s = ev(p.slope, ctx, 'slope'),
        t0 = evNum(p.start, ctx, 'start');
      return stateless((t) => [mtimes(s, Math.max(0, t - t0))]);
    },
  },
  {
    type: 'clock',
    category: 'sources',
    name: L('Clock', 'Klok'),
    desc: L('Simulation time t.', 'Simulatietijd t.'),
    params: [],
    ports: () => ({ in: [], out: ['t'] }),
    face: () => '⏱',
    create: () => stateless((t) => [t]),
  },
  {
    type: 'slider',
    category: 'sources',
    name: L('Slider', 'Schuifregelaar'),
    desc: L('Interactive value you can drag live while the simulation runs.', 'Interactieve waarde die je live kunt verslepen tijdens de simulatie.'),
    params: [P('min', 'Minimum', 'Minimum', '-1'), P('max', 'Maximum', 'Maximum', '1'), P('value', 'Value', 'Waarde', '0')],
    ports: () => ({ in: [], out: ['y'] }),
    create: (p, ctx) => {
      const v0 = evNum(p.value, ctx, 'value');
      return stateless(() => [ctx.io.slider(ctx.id) ?? v0]);
    },
  },
  {
    type: 'target',
    category: 'sources',
    name: L('3D target', '3D-doel'),
    desc: L('Position (3×1) of a draggable target gizmo in the 3D view (physics frame).', 'Positie (3×1) van een versleepbaar doel in de 3D-weergave (fysica-assenstelsel).'),
    params: [],
    ports: () => ({ in: [], out: ['p'] }),
    face: () => '⊕',
    create: (_p, ctx) => stateless(() => [Mat.col(ctx.io.target())]),
  },
  {
    type: 'noise',
    category: 'sources',
    name: L('Random noise', 'Ruis'),
    desc: L('Gaussian white noise with standard deviation σ (vector σ gives a vector).', 'Gaussische witte ruis met standaarddeviatie σ (vector σ geeft een vector).'),
    params: [P('std', 'Std. deviation σ', 'Standaarddeviatie σ', '0.1'), P('seed', 'Seed', 'Seed', '1')],
    ports: () => ({ in: [], out: ['y'] }),
    face: () => '≈',
    create: (p, ctx) => {
      const s = ev(p.std, ctx, 'std');
      const r = rng(evNum(p.seed, ctx, 'seed'));
      return stateless(() => [mapv(s, (x) => x * gaussian(r))]);
    },
  },
  // ------------------------------------------------------------ math
  {
    type: 'gain',
    category: 'math',
    name: L('Gain', 'Versterking'),
    desc: L('y = K·u (matrix product when K is a matrix; element-wise optional).', 'y = K·u (matrixproduct als K een matrix is; element-gewijs optioneel).'),
    params: [
      P('K', 'Gain K', 'Versterking K', '1'),
      P('mode', 'Multiplication', 'Vermenigvuldiging', 'matrix', 'select', {
        options: [
          { value: 'matrix', label: L('Matrix (K*u)', 'Matrix (K*u)') },
          { value: 'elementwise', label: L('Element-wise (K.*u)', 'Element-gewijs (K.*u)') },
        ],
      }),
    ],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: (p) => String(p.K ?? 'K'),
    create: (p, ctx) => {
      const K = ev(p.K, ctx, 'K');
      if (p.mode === 'elementwise') return stateless((_t, u) => [elementwise(K, u[0], (a, b) => a * b, '.*')]);
      return stateless((_t, u) => [mtimes(K, u[0])]);
    },
  },
  {
    type: 'sum',
    category: 'math',
    name: L('Sum', 'Optelling'),
    desc: L("Adds/subtracts its inputs. Signs e.g. '+-' or '++-'.", "Telt ingangen op/af. Tekens bijv. '+-' of '++-'."),
    params: [P('signs', 'Signs', 'Tekens', '+-', 'text')],
    ports: (p) => ({ in: String(p.signs ?? '+-').replace(/[^+-]/g, '').split('').map((s, i) => `${s}${i + 1}`), out: ['y'] }),
    face: () => 'Σ',
    create: (p) => {
      const signs = String(p.signs ?? '+-').replace(/[^+-]/g, '').split('');
      if (!signs.length) throw new Error("Signs must contain '+' or '-'");
      return stateless((_t, u) => {
        let acc: Value = signs[0] === '-' ? mapv(u[0], (x) => -x) : u[0];
        for (let i = 1; i < signs.length; i++) acc = elementwise(acc, u[i], signs[i] === '+' ? (a, b) => a + b : (a, b) => a - b, signs[i]);
        return [acc];
      });
    },
  },
  {
    type: 'product',
    category: 'math',
    name: L('Product', 'Product'),
    desc: L("Multiplies/divides inputs. Ops e.g. '**' or '*/'. Element-wise or matrix.", "Vermenigvuldigt/deelt ingangen. Bijv. '**' of '*/'. Element-gewijs of matrix."),
    params: [
      P('ops', 'Operations', 'Bewerkingen', '**', 'text'),
      P('mode', 'Mode', 'Modus', 'elementwise', 'select', {
        options: [
          { value: 'elementwise', label: L('Element-wise', 'Element-gewijs') },
          { value: 'matrix', label: L('Matrix', 'Matrix') },
        ],
      }),
    ],
    ports: (p) => ({ in: String(p.ops ?? '**').replace(/[^*/]/g, '').split('').map((s, i) => `${s === '*' ? '×' : '÷'}${i + 1}`), out: ['y'] }),
    face: () => '×',
    create: (p) => {
      const ops = String(p.ops ?? '**').replace(/[^*/]/g, '').split('');
      const matrix = p.mode === 'matrix';
      return stateless((_t, u) => {
        let acc: Value = ops[0] === '/' ? mapv(u[0], (x) => 1 / x) : u[0];
        for (let i = 1; i < ops.length; i++) {
          if (matrix) acc = ops[i] === '*' ? mtimes(acc, u[i]) : mtimes(acc, norm1(require_inv(u[i])));
          else acc = elementwise(acc, u[i], ops[i] === '*' ? (a, b) => a * b : (a, b) => a / b, ops[i]);
        }
        return [acc];
      });
    },
  },
  {
    type: 'mathfn',
    category: 'math',
    name: L('Math function', 'Wiskundige functie'),
    desc: L('Element-wise function: sin, cos, abs, sign, sqrt, exp, square, tanh, wrapToPi, ... (atan2 takes 2 inputs).', 'Element-gewijze functie: sin, cos, abs, sign, sqrt, exp, kwadraat, tanh, wrapToPi, ... (atan2 heeft 2 ingangen).'),
    params: [
      P('fn', 'Function', 'Functie', 'sin', 'select', {
        options: ['sin', 'cos', 'tan', 'atan', 'atan2', 'abs', 'sign', 'sqrt', 'square', 'exp', 'log', 'tanh', 'wrapToPi', 'reciprocal', 'norm'].map((v) => ({ value: v, label: L(v, v) })),
      }),
    ],
    ports: (p) => ({ in: p.fn === 'atan2' ? ['y', 'x'] : ['u'], out: ['y'] }),
    face: (p) => String(p.fn ?? 'f(u)'),
    create: (p) => {
      const fn = String(p.fn ?? 'sin');
      const table: Record<string, (x: number) => number> = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        atan: Math.atan,
        abs: Math.abs,
        sign: Math.sign,
        sqrt: Math.sqrt,
        square: (x) => x * x,
        exp: Math.exp,
        log: Math.log,
        tanh: Math.tanh,
        wrapToPi: (x) => {
          const t = (x + Math.PI) % (2 * Math.PI);
          return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
        },
        reciprocal: (x) => 1 / x,
      };
      if (fn === 'atan2') return stateless((_t, u) => [elementwise(u[0], u[1], Math.atan2, 'atan2')]);
      if (fn === 'norm') return stateless((_t, u) => [Math.hypot(...flat(u[0]))]);
      const f = table[fn];
      if (!f) throw new Error(`Unknown function ${fn}`);
      return stateless((_t, u) => [mapv(u[0], f)]);
    },
  },
  {
    type: 'saturation',
    category: 'math',
    name: L('Saturation', 'Saturatie'),
    desc: L('Limits the signal to [lower, upper].', 'Begrenst het signaal tot [onder, boven].'),
    params: [P('lower', 'Lower limit', 'Ondergrens', '-1'), P('upper', 'Upper limit', 'Bovengrens', '1')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => '⟋̅',
    create: (p, ctx) => {
      const lo = ev(p.lower, ctx, 'lower'),
        hi = ev(p.upper, ctx, 'upper');
      return stateless((_t, u) => [elementwise(elementwise(u[0], lo, Math.max, 'max'), hi, Math.min, 'min')]);
    },
  },
  {
    type: 'deadzone',
    category: 'math',
    name: L('Dead zone', 'Dode zone'),
    desc: L('Zero output inside [start, end].', 'Uitgang nul binnen [begin, eind].'),
    params: [P('lo', 'Start of dead zone', 'Begin dode zone', '-0.1'), P('hi', 'End of dead zone', 'Einde dode zone', '0.1')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => '⌐¬',
    create: (p, ctx) => {
      const lo = evNum(p.lo, ctx, 'lo'),
        hi = evNum(p.hi, ctx, 'hi');
      return stateless((_t, u) => [mapv(u[0], (x) => (x > hi ? x - hi : x < lo ? x - lo : 0))]);
    },
  },
  {
    type: 'relational',
    category: 'math',
    name: L('Relational operator', 'Relationele operator'),
    desc: L('Compares two inputs element-wise, outputs 1 or 0.', 'Vergelijkt twee ingangen element-gewijs, geeft 1 of 0.'),
    params: [P('op', 'Operator', 'Operator', '>=', 'select', { options: ['<', '<=', '>', '>=', '==', '~='].map((v) => ({ value: v, label: L(v, v) })) })],
    ports: () => ({ in: ['a', 'b'], out: ['y'] }),
    face: (p) => String(p.op),
    create: (p) => {
      const ops: Record<string, (a: number, b: number) => number> = {
        '<': (a, b) => +(a < b),
        '<=': (a, b) => +(a <= b),
        '>': (a, b) => +(a > b),
        '>=': (a, b) => +(a >= b),
        '==': (a, b) => +(a === b),
        '~=': (a, b) => +(a !== b),
      };
      const f = ops[String(p.op)] ?? ops['>='];
      return stateless((_t, u) => [elementwise(u[0], u[1], f, String(p.op))]);
    },
  },
  {
    type: 'logic',
    category: 'math',
    name: L('Logical operator', 'Logische operator'),
    desc: L('AND / OR / XOR / NOT of its inputs.', 'AND / OR / XOR / NOT van de ingangen.'),
    params: [
      P('op', 'Operator', 'Operator', 'AND', 'select', { options: ['AND', 'OR', 'XOR', 'NOT'].map((v) => ({ value: v, label: L(v, v) })) }),
      P('n', 'Number of inputs', 'Aantal ingangen', '2', 'text'),
    ],
    ports: (p) => ({ in: p.op === 'NOT' ? ['u'] : range(intParam(p, 'n', 2, 2, 8)), out: ['y'] }),
    face: (p) => String(p.op),
    create: (p) => {
      const op = String(p.op);
      if (op === 'NOT') return stateless((_t, u) => [mapv(u[0], (x) => +(x === 0))]);
      const f = op === 'AND' ? (a: number, b: number) => +(a !== 0 && b !== 0) : op === 'OR' ? (a: number, b: number) => +(a !== 0 || b !== 0) : (a: number, b: number) => +((a !== 0) !== (b !== 0));
      return stateless((_t, u) => [u.slice(1).reduce((acc, x) => elementwise(acc, x, f, op), mapv(u[0], (x) => +(x !== 0)))]);
    },
  },
  {
    type: 'minmax',
    category: 'math',
    name: L('MinMax', 'MinMax'),
    desc: L('Element-wise minimum or maximum of the inputs (single input: over its elements).', 'Element-gewijs minimum of maximum (één ingang: over de elementen).'),
    params: [
      P('fn', 'Function', 'Functie', 'max', 'select', { options: ['min', 'max'].map((v) => ({ value: v, label: L(v, v) })) }),
      P('n', 'Number of inputs', 'Aantal ingangen', '2', 'text'),
    ],
    ports: (p) => ({ in: range(intParam(p, 'n', 2, 1, 8)), out: ['y'] }),
    face: (p) => String(p.fn),
    create: (p) => {
      const f = p.fn === 'min' ? Math.min : Math.max;
      return stateless((_t, u) => {
        if (u.length === 1) return [f(...flat(u[0]))];
        return [u.slice(1).reduce((acc, x) => elementwise(acc, x, f, String(p.fn)), u[0])];
      });
    },
  },
  {
    type: 'transpose',
    category: 'math',
    name: L('Transpose', 'Transponeren'),
    desc: L("y = uᵀ", "y = uᵀ"),
    params: [],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => '$u^T$',
    create: () => stateless((_t, u) => [norm1(transpose(toMat(u[0])))]),
  },
  {
    type: 'matmul',
    category: 'math',
    name: L('Matrix multiply', 'Matrixvermenigvuldiging'),
    desc: L('y = A·B', 'y = A·B'),
    params: [],
    ports: () => ({ in: ['A', 'B'], out: ['y'] }),
    face: () => 'A·B',
    create: () => stateless((_t, u) => [mtimes(u[0], u[1])]),
  },
  // ------------------------------------------------------------ routing
  {
    type: 'mux',
    category: 'routing',
    name: L('Mux', 'Mux'),
    desc: L('Stacks inputs into one column vector.', 'Stapelt ingangen tot één kolomvector.'),
    params: [P('n', 'Number of inputs', 'Aantal ingangen', '2', 'text')],
    ports: (p) => ({ in: range(intParam(p, 'n', 2, 2, 16)), out: ['y'] }),
    face: () => '▐',
    create: () => stateless((_t, u) => [colvec(u.flatMap(flat))]),
  },
  {
    type: 'demux',
    category: 'routing',
    name: L('Demux', 'Demux'),
    desc: L("Splits a vector into n equal parts, or into the given sizes e.g. '[2 2]'.", "Splitst een vector in n gelijke delen, of in gegeven groottes bijv. '[2 2]'."),
    params: [P('n', 'Number of outputs or sizes', 'Aantal uitgangen of groottes', '2', 'text')],
    ports: (p) => {
      const s = String(p.n ?? '2').trim();
      const sizes = s.startsWith('[') ? s.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean) : null;
      return { in: ['u'], out: range(sizes ? sizes.length : intParam(p, 'n', 2, 1, 16), 'y') };
    },
    face: () => '▌',
    create: (p) => {
      const s = String(p.n ?? '2').trim();
      const sizes = s.startsWith('[') ? s.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean).map(Number) : null;
      const n = sizes ? sizes.length : intParam(p, 'n', 2, 1, 16);
      return stateless((_t, u) => {
        const xs = flat(u[0]);
        const sz = sizes ?? Array(n).fill(xs.length / n);
        if (sz.some((v) => !Number.isInteger(v)) || sz.reduce((a, b) => a + b, 0) !== xs.length)
          throw new Error(`Demux: cannot split a ${xs.length}-element signal into [${sz.join(' ')}]`);
        const out: Value[] = [];
        let o = 0;
        for (const k of sz) {
          out.push(colvec(xs.slice(o, o + k)));
          o += k;
        }
        return out;
      });
    },
  },
  {
    type: 'selector',
    category: 'routing',
    name: L('Selector', 'Selector'),
    desc: L("Selects elements by (1-based) index, e.g. '2' or '[1 3]'.", "Selecteert elementen op (1-gebaseerde) index, bijv. '2' of '[1 3]'."),
    params: [P('idx', 'Indices', 'Indices', '1')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: (p) => `(${p.idx})`,
    create: (p, ctx) => {
      const idx = flat(ev(p.idx, ctx, 'idx'));
      return stateless((_t, u) => {
        const xs = flat(u[0]);
        return [
          colvec(
            idx.map((k) => {
              if (k < 1 || k > xs.length) throw new Error(`Selector index ${k} out of range (signal has ${xs.length} elements)`);
              return xs[k - 1];
            }),
          ),
        ];
      });
    },
  },
  {
    type: 'switch',
    category: 'routing',
    name: L('Switch', 'Schakelaar'),
    desc: L('Passes u1 when the control input u2 ≥ threshold, otherwise u3.', 'Geeft u1 door als stuuringang u2 ≥ drempel, anders u3.'),
    params: [P('th', 'Threshold', 'Drempel', '0.5')],
    ports: () => ({ in: ['u1', 'ctrl', 'u3'], out: ['y'] }),
    face: () => '⇄',
    create: (p, ctx) => {
      const th = evNum(p.th, ctx, 'th');
      return stateless((_t, u) => [num(u[1] ?? 0, 'switch control') >= th ? u[0] : u[2]]);
    },
  },
  // ------------------------------------------------------------ dynamics
  {
    type: 'integrator',
    category: 'dynamics',
    name: L('Integrator', 'Integrator'),
    desc: L('Discrete-time integrator (forward Euler): y[k+1] = y[k] + Ts·u[k], optional limits.', 'Discrete integrator (voorwaartse Euler): y[k+1] = y[k] + Ts·u[k], optionele limieten.'),
    params: [P('x0', 'Initial condition', 'Beginwaarde', '0'), P('lower', 'Lower limit (empty = none)', 'Ondergrens (leeg = geen)', ''), P('upper', 'Upper limit (empty = none)', 'Bovengrens (leeg = geen)', '')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    feedthrough: () => false,
    face: () => '$\\frac{1}{s}$',
    create: (p, ctx) => {
      let x: Value = ev(p.x0, ctx, 'x0');
      const lo = evOptNum(p.lower, ctx, 'lower', -Infinity),
        hi = evOptNum(p.upper, ctx, 'upper', Infinity);
      return {
        output: () => [x],
        update: (_t, u) => {
          x = mapv(elementwise(x, u[0], (a, b) => a + ctx.Ts * b, '+'), (v) => Math.max(lo, Math.min(hi, v)));
        },
      };
    },
  },
  {
    type: 'derivative',
    category: 'dynamics',
    name: L('Derivative', 'Afgeleide'),
    desc: L('Backward difference, optionally filtered: D(s) ≈ N s / (s + N).', 'Achterwaartse differentie, optioneel gefilterd: D(s) ≈ N s / (s + N).'),
    params: [P('N', 'Filter coefficient N [rad/s] (0 = none)', 'Filtercoëfficiënt N [rad/s] (0 = geen)', '100')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => '$\\frac{du}{dt}$',
    create: (p, ctx) => {
      const N = evNum(p.N, ctx, 'N');
      let prev: Value | null = null;
      let xf: Value | null = null;
      let y: Value = 0;
      return {
        output: (_t, u) => {
          if (N > 0) {
            if (xf === null) xf = u[0];
            y = mapv(elementwise(u[0], xf, (a, b) => a - b, '-'), (v) => N * v);
          } else y = prev === null ? mapv(u[0], () => 0) : mapv(elementwise(u[0], prev, (a, b) => a - b, '-'), (v) => v / ctx.Ts);
          return [y];
        },
        update: (_t, u) => {
          prev = u[0];
          if (N > 0 && xf !== null) {
            const a = Math.min(1, N * ctx.Ts);
            xf = elementwise(xf, u[0], (xv, uv) => xv + a * (uv - xv), '+');
          }
        },
      };
    },
  },
  {
    type: 'tf',
    category: 'dynamics',
    name: L('Transfer function', 'Overdrachtsfunctie'),
    desc: L('Continuous SISO transfer function num(s)/den(s), coefficients in descending powers of s.', 'Continue SISO-overdrachtsfunctie teller(s)/noemer(s), coëfficiënten in dalende machten van s.'),
    params: [P('num', 'Numerator', 'Teller', '[1]'), P('den', 'Denominator', 'Noemer', '[0.1 1]')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    feedthrough: (p) => {
      const n = String(p.num ?? '').replace(/[[\]]/g, '').trim().split(/[\s,]+/).filter(Boolean).length;
      const d = String(p.den ?? '').replace(/[[\]]/g, '').trim().split(/[\s,]+/).filter(Boolean).length;
      return n >= d;
    },
    face: (p) => `$\\frac{${String(p.num).replace(/[[\]]/g, '')}}{${String(p.den).replace(/[[\]]/g, '')}}$`,
    create: (p, ctx) => {
      const { A, B, C, D, n } = tfToSS(flat(ev(p.num, ctx, 'num')), flat(ev(p.den, ctx, 'den')));
      return ltiInst(A, B, C, D, new Array(n).fill(0), ctx.Ts);
    },
  },
  {
    type: 'ss',
    category: 'dynamics',
    name: L('State space', 'Toestandsruimte'),
    desc: L('ẋ = A x + B u,  y = C x + D u (continuous, integrated with RK4).', 'ẋ = A x + B u,  y = C x + D u (continu, geïntegreerd met RK4).'),
    params: [P('A', 'A', 'A', '-1'), P('B', 'B', 'B', '1'), P('C', 'C', 'C', '1'), P('D', 'D', 'D', '0'), P('x0', 'Initial state x0', 'Begintoestand x0', '0')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    feedthrough: (p) => String(p.D ?? '0').trim() !== '0',
    face: () => 'ẋ=Ax+Bu',
    create: (p, ctx) => {
      const A = toMat(ev(p.A, ctx, 'A')),
        B = toMat(ev(p.B, ctx, 'B')),
        C = toMat(ev(p.C, ctx, 'C')),
        D = toMat(ev(p.D, ctx, 'D'));
      const x0 = flat(ev(p.x0, ctx, 'x0'));
      if (A.r !== A.c) throw new Error('A must be square');
      if (B.r !== A.r) throw new Error('B must have as many rows as A');
      if (C.c !== A.r) throw new Error('C must have as many columns as A');
      const x = x0.length === 1 && A.r > 1 ? new Array(A.r).fill(x0[0]) : x0;
      return ltiInst(A, B, C, D.numel === 1 && C.r * B.c > 1 ? new Mat(C.r, B.c) : D, x, ctx.Ts);
    },
  },
  {
    type: 'delay',
    category: 'dynamics',
    name: L('Unit delay', 'Eenheidsvertraging'),
    desc: L('y[k] = u[k−1]  (z⁻¹).', 'y[k] = u[k−1]  (z⁻¹).'),
    params: [P('x0', 'Initial output', 'Beginuitgang', '0')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    feedthrough: () => false,
    face: () => '$\\frac{1}{z}$',
    create: (p, ctx) => {
      let x: Value = ev(p.x0, ctx, 'x0');
      return { output: () => [x], update: (_t, u) => void (x = u[0]) };
    },
  },
  {
    type: 'zoh',
    category: 'dynamics',
    name: L('Zero-order hold', 'Nulde-orde houder'),
    desc: L('Samples the input every Th seconds and holds it.', 'Bemonstert de ingang elke Th seconden en houdt die vast.'),
    params: [P('Th', 'Sample time Th [s]', 'Bemonsteringstijd Th [s]', '0.01')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => 'ZOH',
    create: (p, ctx) => {
      const Th = Math.max(evNum(p.Th, ctx, 'Th'), ctx.Ts);
      let next = 0;
      let held: Value = 0;
      return {
        output: (t, u) => {
          if (t + 1e-9 >= next) {
            held = u[0];
            next = t + Th;
          }
          return [held];
        },
      };
    },
  },
  {
    type: 'lowpass',
    category: 'dynamics',
    name: L('Low-pass filter', 'Laagdoorlaatfilter'),
    desc: L('First-order low-pass filter with cut-off frequency fc.', 'Eerste-orde laagdoorlaatfilter met kantelfrequentie fc.'),
    params: [P('fc', 'Cut-off frequency fc [Hz]', 'Kantelfrequentie fc [Hz]', '20')],
    ports: () => ({ in: ['u'], out: ['y'] }),
    face: () => 'LPF',
    create: (p, ctx) => {
      const a = 1 - Math.exp(-2 * Math.PI * evNum(p.fc, ctx, 'fc') * ctx.Ts);
      let y: Value | null = null;
      return {
        output: (_t, u) => {
          y = y === null ? u[0] : elementwise(y, u[0], (yv, uv) => yv + a * (uv - yv), '+');
          return [y];
        },
      };
    },
  },
  // ------------------------------------------------------------ control
  {
    type: 'pid',
    category: 'control',
    name: L('PID controller', 'PID-regelaar'),
    desc: L('u = Kp e + Ki ∫e + Kd ė (filtered derivative, output limits with back-calculation anti-windup).', 'u = Kp e + Ki ∫e + Kd ė (gefilterde afgeleide, uitgangslimieten met back-calculation anti-windup).'),
    params: [
      P('Kp', 'Kp', 'Kp', '1'),
      P('Ki', 'Ki', 'Ki', '0'),
      P('Kd', 'Kd', 'Kd', '0'),
      P('N', 'Derivative filter N [rad/s]', 'Afgeleidefilter N [rad/s]', '100'),
      P('umin', 'Output lower limit', 'Uitgang ondergrens', '-Inf'),
      P('umax', 'Output upper limit', 'Uitgang bovengrens', 'Inf'),
    ],
    ports: () => ({ in: ['e'], out: ['u'] }),
    face: () => 'PID',
    create: (p, ctx) => {
      const Kp = ev(p.Kp, ctx, 'Kp'),
        Ki = ev(p.Ki, ctx, 'Ki'),
        Kd = ev(p.Kd, ctx, 'Kd');
      const N = evNum(p.N, ctx, 'N');
      const lo = ev(p.umin, ctx, 'umin'),
        hi = ev(p.umax, ctx, 'umax');
      let I: Value = 0;
      let df: Value | null = null;
      let D: Value = 0;
      let lastSat: Value = 0,
        lastRaw: Value = 0;
      const add = (a: Value, b: Value) => elementwise(a, b, (x, y) => x + y, '+');
      const sub = (a: Value, b: Value) => elementwise(a, b, (x, y) => x - y, '-');
      const mul = (a: Value, b: Value) => elementwise(a, b, (x, y) => x * y, '.*');
      return {
        output: (_t, u) => {
          const e = u[0];
          if (df === null) df = e;
          D = mapv(sub(e, df), (v) => v * N);
          lastRaw = add(add(mul(Kp, e), I), mul(Kd, D));
          lastSat = elementwise(elementwise(lastRaw, lo, Math.max, 'max'), hi, Math.min, 'min');
          return [lastSat];
        },
        update: (_t, u) => {
          const e = u[0];
          // back-calculation anti-windup with gain 1/Ts-limited
          const kb = 1;
          I = add(I, mapv(add(mul(Ki, e), mapv(sub(lastSat, lastRaw), (v) => v * kb)), (v) => v * ctx.Ts));
          const a = Math.min(1, N * ctx.Ts);
          if (df !== null) df = elementwise(df, e, (x, y) => x + a * (y - x), '+');
        },
      };
    },
  },
  {
    type: 'lqr',
    category: 'control',
    name: L('LQR controller', 'LQR-regelaar'),
    desc: L('Computes K = lqr(A, B, Q, R) and outputs u = −K (x − x_ref). A_lin/B_lin = linearised plant.', 'Berekent K = lqr(A, B, Q, R) en geeft u = −K (x − x_ref). A_lin/B_lin = gelineariseerde plant.'),
    params: [P('A', 'A', 'A', 'A_lin'), P('B', 'B', 'B', 'B_lin'), P('Q', 'Q', 'Q', 'diag([10 100 1 1])'), P('R', 'R', 'R', '0.1')],
    ports: () => ({ in: ['x', 'x_ref'], out: ['u'] }),
    face: () => 'LQR',
    systems: ['cartpole', 'furuta'],
    create: (p, ctx) => {
      const A = toMat(ev(p.A, ctx, 'A')),
        B = toMat(ev(p.B, ctx, 'B')),
        Q = toMat(ev(p.Q, ctx, 'Q')),
        R = toMat(ev(p.R, ctx, 'R'));
      const { K } = lqr(A, B, Q, R);
      ctx.io.info(ctx.id, `K = ${valueToString(norm1(K))}`);
      const Kv = norm1(K);
      return stateless((_t, u) => [mapv(mtimes(Kv, elementwise(u[0], u[1] ?? 0, (a, b) => a - b, '-')), (v) => -v)]);
    },
  },
  {
    type: 'statefb',
    category: 'control',
    name: L('State feedback', 'Toestandsterugkoppeling'),
    desc: L('u = −K (x − r)', 'u = −K (x − r)'),
    params: [P('K', 'K', 'K', '[1 1]')],
    ports: () => ({ in: ['x', 'r'], out: ['u'] }),
    face: () => '−K',
    create: (p, ctx) => {
      const K = ev(p.K, ctx, 'K');
      return stateless((_t, u) => [mapv(mtimes(K, elementwise(u[0], u[1] ?? 0, (a, b) => a - b, '-')), (v) => -v)]);
    },
  },
  // ------------------------------------------------------------ robotics
  {
    type: 'massmatrix',
    category: 'robotics',
    name: L('Mass matrix M(q)', 'Massamatrix M(q)'),
    desc: L('Joint-space inertia matrix of the (nominal) model.', 'Inertiematrix in gewrichtsruimte van het (nominale) model.'),
    params: [],
    ports: () => ({ in: ['q'], out: ['M'] }),
    face: () => '$M(q)$',
    create: (_p, ctx) => stateless((_t, u) => [norm1(ctx.model.massMatrix(qOf(u[0]), ctx.nominal))]),
  },
  {
    type: 'coriolis',
    category: 'robotics',
    name: L('Coriolis C(q,q̇)q̇', 'Coriolis C(q,q̇)q̇'),
    desc: L('Coriolis and centrifugal torques C(q,q̇)q̇.', 'Coriolis- en centrifugaalkoppels C(q,q̇)q̇.'),
    params: [],
    ports: () => ({ in: ['q', 'q̇'], out: ['Cq̇'] }),
    face: () => '$C(q,\\dot q)\\dot q$',
    create: (_p, ctx) => stateless((_t, u) => [colvec(ctx.model.coriolis(qOf(u[0]), qOf(u[1]), ctx.nominal))]),
  },
  {
    type: 'gravity',
    category: 'robotics',
    name: L('Gravity g(q)', 'Zwaartekracht g(q)'),
    desc: L('Gravity torques g(q) = ∂V/∂q.', 'Zwaartekrachtkoppels g(q) = ∂V/∂q.'),
    params: [],
    ports: () => ({ in: ['q'], out: ['g'] }),
    face: () => '$g(q)$',
    create: (_p, ctx) => stateless((_t, u) => [colvec(ctx.model.gravity(qOf(u[0]), ctx.nominal))]),
  },
  {
    type: 'fk',
    category: 'robotics',
    name: L('Forward kinematics', 'Voorwaartse kinematica'),
    desc: L('End-effector (TCP / tip) position p (3×1) and orientation R (3×3).', 'Eindeffector (TCP / tip) positie p (3×1) en oriëntatie R (3×3).'),
    params: [],
    ports: () => ({ in: ['q'], out: ['p', 'R'] }),
    face: () => 'FK',
    create: (_p, ctx) =>
      stateless((_t, u) => {
        const fk = ctx.model.fk!(qOf(u[0]), ctx.nominal);
        return [Mat.col(fk.pos), new Mat(3, 3, fk.R)];
      }),
  },
  {
    type: 'jacobian',
    category: 'robotics',
    name: L('Geometric Jacobian J(q)', 'Geometrische Jacobiaan J(q)'),
    desc: L('6×n Jacobian of the TCP: [v; ω] = J(q) q̇ (world frame).', '6×n Jacobiaan van de TCP: [v; ω] = J(q) q̇ (wereldframe).'),
    params: [],
    ports: () => ({ in: ['q'], out: ['J'] }),
    face: () => '$J(q)$',
    systems: ['panda'],
    create: (_p, ctx) => stateless((_t, u) => [ctx.model.jacobian!(qOf(u[0]), ctx.nominal)]),
  },
  {
    type: 'jdotqdot',
    category: 'robotics',
    name: L('J̇(q,q̇) q̇', 'J̇(q,q̇) q̇'),
    desc: L('Time derivative of the Jacobian times q̇ (needed for task-space acceleration).', 'Tijdsafgeleide van de Jacobiaan maal q̇ (nodig voor taakruimteversnelling).'),
    params: [],
    ports: () => ({ in: ['q', 'q̇'], out: ['J̇q̇'] }),
    face: () => '$\\dot J\\dot q$',
    systems: ['panda'],
    create: (_p, ctx) =>
      stateless((_t, u) => {
        const q = qOf(u[0]),
          dq = qOf(u[1]);
        const h = 1e-6;
        const J0 = ctx.model.jacobian!(q, ctx.nominal);
        const J1 = ctx.model.jacobian!(
          q.map((v, i) => v + h * dq[i]),
          ctx.nominal,
        );
        const out: number[] = [];
        for (let i = 0; i < J0.r; i++) {
          let s = 0;
          for (let j = 0; j < J0.c; j++) s += ((J1.get(i, j) - J0.get(i, j)) / h) * dq[j];
          out.push(s);
        }
        return [Mat.col(out)];
      }),
  },
  // ------------------------------------------------------------ user
  {
    type: 'matlabfn',
    category: 'user',
    name: L('MATLAB Function', 'MATLAB-functie'),
    desc: L('Write your own function in MATLAB syntax. Ports follow the function header.', 'Schrijf je eigen functie in MATLAB-syntax. Poorten volgen de functiekop.'),
    params: [P('code', 'Code', 'Code', 'function y = fcn(u)\n% t, Ts and all model parameters are available\ny = u;\n', 'code')],
    ports: (p) => {
      try {
        const m = /function\s+(?:(\[[^\]]*\]|[A-Za-z_]\w*)\s*=\s*)?[A-Za-z_]\w*\s*(?:\(([^)]*)\))?/.exec(String(p.code ?? ''));
        if (!m) return { in: [], out: [] };
        const outs = m[1] ? m[1].replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean) : [];
        const ins = m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
        return { in: ins, out: outs };
      } catch {
        return { in: [], out: [] };
      }
    },
    face: () => 'fcn',
    create: (p, ctx) => {
      const f = new MatlabFunction(String(p.code ?? ''));
      const scope: Record<string, Value> = { ...ctx.ws, Ts: ctx.Ts, t: 0 };
      return stateless((t, u) => {
        scope.t = t;
        return f.call(u, scope);
      });
    },
  },
  {
    type: 'subsystem',
    category: 'user',
    name: L('Subsystem', 'Subsysteem'),
    desc: L('Groups blocks. Double-click to open. Use In/Out port blocks inside.', 'Groepeert blokken. Dubbelklik om te openen. Gebruik In/Uit-poortblokken binnenin.'),
    params: [],
    ports: (p) => {
      const nodes: any[] = p.diagram?.nodes ?? [];
      const cnt = (t: string) =>
        nodes
          .filter((n) => n.type === t)
          .map((n) => n.name || `${t === 'inport' ? 'In' : 'Out'}${n.params?.index ?? ''}`)
          .sort();
      const ins = nodes.filter((n) => n.type === 'inport').sort((a, b) => Number(a.params.index) - Number(b.params.index));
      const outs = nodes.filter((n) => n.type === 'outport').sort((a, b) => Number(a.params.index) - Number(b.params.index));
      void cnt;
      return { in: ins.map((n) => n.name || `In${n.params.index}`), out: outs.map((n) => n.name || `Out${n.params.index}`) };
    },
    face: () => '⧉',
    create: () => {
      throw new Error('Subsystems are flattened before execution');
    },
  },
  {
    type: 'inport',
    category: 'user',
    name: L('In port', 'Ingangspoort'),
    desc: L('Input of a subsystem.', 'Ingang van een subsysteem.'),
    params: [P('index', 'Port number', 'Poortnummer', '1', 'text')],
    ports: () => ({ in: [], out: ['y'] }),
    face: (p) => `In ${p.index}`,
    create: () => stateless((_t, u) => [u[0] ?? 0]),
  },
  {
    type: 'outport',
    category: 'user',
    name: L('Out port', 'Uitgangspoort'),
    desc: L('Output of a subsystem.', 'Uitgang van een subsysteem.'),
    params: [P('index', 'Port number', 'Poortnummer', '1', 'text')],
    ports: () => ({ in: ['u'], out: [] }),
    face: (p) => `Out ${p.index}`,
    create: () => stateless((_t, u) => [u[0] ?? 0]),
  },
  // ------------------------------------------------------------ sinks
  {
    type: 'actuator',
    category: 'sinks',
    name: L('Plant actuator', 'Plant-actuator'),
    desc: L('Sends the control input u (force/torque) to the plant.', 'Stuurt het stuursignaal u (kracht/koppel) naar de plant.'),
    params: [],
    ports: () => ({ in: ['u'], out: [] }),
    face: () => 'Plant',
    create: (_p, ctx) =>
      stateless((_t, u) => {
        const v = flat(u[0] ?? 0);
        if (v.length !== ctx.model.nu) throw new Error(`Actuator expects ${ctx.model.nu} element(s), got ${v.length}`);
        ctx.io.actuate(v);
        return [];
      }),
  },
  {
    type: 'scope',
    category: 'sinks',
    name: L('Scope', 'Scope'),
    desc: L('Plots its inputs live in the Scopes panel.', 'Plot de ingangen live in het Scopes-paneel.'),
    params: [P('n', 'Number of inputs', 'Aantal ingangen', '1', 'text')],
    ports: (p) => ({ in: range(intParam(p, 'n', 1, 1, 8)), out: [] }),
    face: () => '📈',
    create: (_p, ctx) =>
      stateless((t, u) => {
        ctx.io.scope(ctx.id, t, u);
        return [];
      }),
  },
  {
    type: 'display',
    category: 'sinks',
    name: L('Display', 'Display'),
    desc: L('Shows the current value on the block.', 'Toont de huidige waarde op het blok.'),
    params: [],
    ports: () => ({ in: ['u'], out: [] }),
    create: (_p, ctx) =>
      stateless((_t, u) => {
        ctx.io.display(ctx.id, u);
        return [];
      }),
  },
  {
    type: 'terminator',
    category: 'sinks',
    name: L('Terminator', 'Terminator'),
    desc: L('Ends an unused signal.', 'Beëindigt een ongebruikt signaal.'),
    params: [],
    ports: () => ({ in: ['u'], out: [] }),
    face: () => '⏚',
    create: () => stateless(() => []),
  },
];

function require_inv(v: Value): Value {
  return evalString('inv(X)', { X: v });
}

export const BLOCK_MAP: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.type, b]));

export const CATEGORIES: { id: BlockDef['category']; name: I18n }[] = [
  { id: 'sources', name: L('Sources', 'Bronnen') },
  { id: 'math', name: L('Math operations', 'Wiskundige bewerkingen') },
  { id: 'routing', name: L('Signal routing', 'Signaalroutering') },
  { id: 'dynamics', name: L('Continuous & discrete', 'Continu & discreet') },
  { id: 'control', name: L('Controllers', 'Regelaars') },
  { id: 'robotics', name: L('Robotics', 'Robotica') },
  { id: 'user', name: L('User-defined', 'Gebruikergedefinieerd') },
  { id: 'sinks', name: L('Sinks', 'Uitgangen') },
];

export function defaultBlockParams(type: string): Record<string, any> {
  const def = BLOCK_MAP[type];
  const p: Record<string, any> = {};
  for (const s of def?.params ?? []) p[s.key] = s.default;
  if (type === 'subsystem') p.diagram = { nodes: [], edges: [] };
  return p;
}

export { numel, matmul };
