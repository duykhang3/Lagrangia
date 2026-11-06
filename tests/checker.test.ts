import { describe, expect, it } from 'vitest';
import { checkField, compileResidual, type FieldDef } from '../src/core/latex/checker';
import { parseLatex } from '../src/core/latex/parser';
import { allFields, buildGhost, TUTORIALS } from '../src/core/tutorials';
import { SYSTEMS, defaultParams, paramScope } from '../src/core/systems';
import { linearize, Simulator } from '../src/core/sim/simulator';
import { solveVec } from '../src/core/linalg';
import type { SystemId } from '../src/core/types';

const field = (sys: SystemId, id: string) => allFields(sys).find((f) => f.id === id)!;

describe('LaTeX parser', () => {
  it('parses MathLive-style output', () => {
    for (const s of [
      '\\frac{1}{2}\\left(m_{c}+m_{p}\\right)\\dot{x}^{2}',
      '\\sin^{2}\\left(\\theta\\right)',
      '\\operatorname{sign}\\left(\\dot{x}\\right)',
      '\\begin{bmatrix}a & b\\\\ c & d\\end{bmatrix}',
      'M(q)\\ddot{q}+C(q,\\dot{q})\\dot{q}',
      '\\dot{\\theta}_2\\cos\\theta_{2}',
      'J^{\\top}F',
      '\\mleft(x\\mright)^2',
    ])
      expect(() => parseLatex(s)).not.toThrow();
  });
  it('rejects derivative operators with a helpful message', () => {
    expect(() => parseLatex('\\frac{d}{dt}x')).toThrow(/Derivative/);
  });
});

describe('every reference answer passes its own check', () => {
  for (const sys of ['cartpole', 'furuta', 'panda'] as SystemId[])
    for (const f of allFields(sys))
      it(`${sys}/${f.id}`, () => {
        const r = checkField(f, f.ref);
        expect(r.status, JSON.stringify(r.messages)).toBe('correct');
      });
});

describe('checker accepts equivalent forms and diagnoses mistakes', () => {
  const T = field('cartpole', 'cp_T');
  it('accepts expanded / reordered forms', () => {
    expect(checkField(T, 'T = \\frac12 m_c\\dot x^2 + \\frac{1}{2}m_p(\\dot x^2 + 2l\\dot x\\dot\\theta\\cos\\theta + l^2\\dot\\theta^2)').status).toBe('correct');
  });
  it('detects a wrong coefficient', () => {
    const r = checkField(T, '(m_c+m_p)\\dot{x}^2 + m_p l\\dot{x}\\dot{\\theta}\\cos\\theta + \\frac{1}{2}m_p l^2\\dot{\\theta}^2');
    expect(r.status).toBe('incorrect');
    expect(r.messages.map((m) => m.en).join(' ')).toMatch(/coefficient|factor/);
  });
  it('detects a wrong sign of a term', () => {
    const r = checkField(T, '\\frac{1}{2}(m_c+m_p)\\dot{x}^2 - m_p l\\dot{x}\\dot{\\theta}\\cos\\theta + \\frac{1}{2}m_p l^2\\dot{\\theta}^2');
    expect(r.messages.map((m) => m.en).join(' ')).toMatch(/sign|coefficient/);
  });
  it('detects a missing term', () => {
    const r = checkField(T, '\\frac{1}{2}(m_c+m_p)\\dot{x}^2 + \\frac{1}{2}m_p l^2\\dot{\\theta}^2');
    expect(r.messages.map((m) => m.en).join(' ')).toMatch(/missing/);
  });
  it('equations: accepts scaled and rearranged forms', () => {
    const f = field('cartpole', 'cp_eom_th');
    expect(checkField(f, 'l\\ddot\\theta = g\\sin\\theta - \\ddot x\\cos\\theta').status).toBe('correct');
  });
  it('reports unknown symbols', () => {
    const r = checkField(T, '\\frac12 M\\dot x^2');
    expect(r.status).toBe('error');
  });
  it('accepts a non-Christoffel C with a note', () => {
    const f = field('cartpole', 'cp_C');
    const r = checkField(f, '\\begin{bmatrix}0 & -m_p l\\dot\\theta\\sin\\theta\\\\0&0\\end{bmatrix}');
    expect(r.status).toBe('correct');
  });
  it('matrix fields report wrong entries', () => {
    const f = field('cartpole', 'cp_M');
    const r = checkField(f, '\\begin{bmatrix} m_c & m_p l\\cos\\theta \\\\ m_p l\\cos\\theta & m_p l^2 \\end{bmatrix}');
    expect(r.messages.map((m) => m.en).join(' ')).toMatch(/\(1,1\)/);
  });
  it('panda: order of matrix factors matters', () => {
    const f = field('panda', 'pa_eom');
    expect(checkField(f, '\\tau = \\ddot q M + C\\dot q + g + \\tau_f').status).not.toBe('correct');
    expect(checkField(f, '\\tau - \\tau_f = M(q)\\ddot{q} + C(q,\\dot q)\\dot q + g(q)').status).toBe('correct');
  });
  it('panda: null-space projector alternative form', () => {
    const f = field('panda', 'pa_tauimp');
    expect(checkField(f, '\\tau = J^TF + g + (I - J^T(JJ^T)^{-1}J)\\tau_0').status).toBe('correct');
  });
});

describe('reference equations match the simulator dynamics', () => {
  for (const [sys, ids] of [
    ['cartpole', ['cp_eomf_x', 'cp_eomf_th']],
    ['furuta', ['fu_eom1', 'fu_eom2']],
  ] as [SystemId, string[]][]) {
    it(sys, () => {
      const p = { ...defaultParams(sys), coulomb_model: 'sign', F_c: 0.7, c_air: 0, F_s: 0 } as any;
      if (sys === 'furuta') p.F_c1 = 0;
      const sim = new Simulator(SYSTEMS[sys], p);
      const q = [0.3, 0.7],
        dq = [0.4, -0.9];
      sim.setState(q, dq);
      sim.uApplied = [1.3];
      const ddq = sim.accel(q, dq, 0);
      const scope = paramScope(SYSTEMS[sys], p);
      const spec = TUTORIALS[sys].ghost!;
      const vals = new Map<string, any>(Object.entries(scope));
      for (const [name, [k, i]] of Object.entries(spec.map)) vals.set(name, k === 'q' ? q[i] : k === 'dq' ? dq[i] : k === 'ddq' ? ddq[i] : 1.3);
      for (const id of ids) expect(Math.abs(compileResidual(field(sys, id).ref)(vals))).toBeLessThan(1e-9);
    });
  }
  it('furuta analytic A/B match numerical linearisation', () => {
    const p = { ...defaultParams('furuta'), b_1: 0, b_2: 0 };
    const lin = linearize(SYSTEMS.furuta, p)!;
    const s = paramScope(SYSTEMS.furuta, p);
    const D = s.J_0 * s.J_2 - (s.m_2 * s.L_1 * s.l_2) ** 2;
    expect(lin.A.get(3, 1)).toBeCloseTo((s.J_0 * s.m_2 * s.g * s.l_2) / D, 4);
    expect(lin.B.get(2, 0)).toBeCloseTo(s.J_2 / D, 4);
    expect(lin.B.get(3, 0)).toBeCloseTo((-s.m_2 * s.L_1 * s.l_2) / D, 4);
  });
  it('ghost model from reference equations reproduces the simulator', () => {
    const vals: Record<string, string> = {};
    for (const f of allFields('cartpole')) vals[f.id] = f.ref;
    const p = { ...defaultParams('cartpole'), coulomb_model: 'sign' };
    const g = buildGhost('cartpole', vals, {}, paramScope(SYSTEMS.cartpole, p));
    expect(g && 'fn' in g).toBe(true);
    const sim = new Simulator(SYSTEMS.cartpole, p);
    sim.uApplied = [2];
    const a = sim.accel([0.2, 0.5], [0.3, -0.4], 0);
    const b = (g as any).fn([0.2, 0.5], [0.3, -0.4], [2]);
    expect(b[0]).toBeCloseTo(a[0], 8);
    expect(b[1]).toBeCloseTo(a[1], 8);
    void solveVec;
  });
});
