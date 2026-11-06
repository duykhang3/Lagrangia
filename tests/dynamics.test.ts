import { describe, expect, it } from 'vitest';
import { SYSTEMS, defaultParams } from '../src/core/systems';
import { Simulator, linearize } from '../src/core/sim/simulator';
import { eig, lqr, Mat, matmul, madd } from '../src/core/linalg';
import { pandaFK } from '../src/core/systems/panda';
import type { Params, SystemId } from '../src/core/types';

function frictionless(id: SystemId): Params {
  const p = defaultParams(id);
  for (const k of Object.keys(p)) if (/^(b_|F_|c_air)/.test(k)) p[k] = 0;
  if (id === 'panda') {
    p.floor_on = false;
    p.box_on = false;
  }
  p.track = 1000;
  return p;
}

function potential(id: SystemId, q: number[], p: Params): number {
  const g = Number(p.g);
  if (id === 'cartpole') return Number(p.m_p) * g * Number(p.l) * Math.cos(q[1]);
  if (id === 'furuta') return Number(p.m_2) * g * (Number(p.L_2) / 2) * Math.cos(q[1]);
  return NaN;
}

describe('energy conservation (no friction, no input)', () => {
  for (const id of ['cartpole', 'furuta'] as SystemId[]) {
    it(id, () => {
      const p = frictionless(id);
      p[id === 'cartpole' ? 'theta0' : 'theta2_0'] = 2.5;
      const sim = new Simulator(SYSTEMS[id], p);
      sim.dq = [0.5, 1.0];
      const E0 = sim.energy() + potential(id, sim.q, p);
      for (let i = 0; i < 3000; i++) sim.step();
      const E1 = sim.energy() + potential(id, sim.q, p);
      expect(Math.abs(E1 - E0)).toBeLessThan(1e-6 * Math.max(1, Math.abs(E0)) + 1e-7);
    });
  }
  it('panda (RNEA): energy approximately conserved', () => {
    const p = frictionless('panda');
    p.armature = 0;
    const sim = new Simulator(SYSTEMS.panda, p);
    // potential energy via numerical integration is awkward; compare with zero gravity instead
    p.g = 0;
    sim.dq = [0.3, -0.2, 0.4, 0.1, -0.5, 0.3, 0.6];
    const E0 = sim.energy();
    for (let i = 0; i < 4000; i++) sim.step();
    const E1 = sim.energy();
    expect(Math.abs(E1 - E0) / E0).toBeLessThan(0.01);
  });
});

describe('panda model', () => {
  it('mass matrix is symmetric positive definite', () => {
    const p = defaultParams('panda');
    const M = SYSTEMS.panda.massMatrix([0.1, -0.5, 0.3, -2, 0.2, 1.5, 0.4], p);
    const ev = eig(M);
    for (const [re] of ev) expect(re).toBeGreaterThan(0);
  });
  it('home TCP is in front of the robot pointing down', () => {
    const fk = SYSTEMS.panda.fk!(SYSTEMS.panda.initialState(defaultParams('panda')).q, defaultParams('panda'));
    expect(fk.pos[0]).toBeGreaterThan(0.25);
    expect(fk.pos[2]).toBeGreaterThan(0.2);
    expect(fk.R[8]).toBeLessThan(-0.99); // z axis of TCP points down
  });
  it('Jacobian matches finite differences of FK', () => {
    const m = SYSTEMS.panda;
    const p = defaultParams('panda');
    const q = [0.2, -0.3, 0.1, -1.8, 0.4, 1.2, -0.3];
    const J = m.jacobian!(q, p);
    const h = 1e-6;
    for (let j = 0; j < 7; j++) {
      const qp = q.slice();
      qp[j] += h;
      const a = m.fk!(qp, p).pos,
        b = m.fk!(q, p).pos;
      for (let i = 0; i < 3; i++) expect(J.get(i, j)).toBeCloseTo((a[i] - b[i]) / h, 4);
    }
    expect(pandaFK(q).p.length).toBe(8);
  });
});

describe('linearisation + LQR', () => {
  for (const id of ['cartpole', 'furuta'] as SystemId[]) {
    it(`${id}: LQR closed loop is stable`, () => {
      const p = defaultParams(id);
      const lin = linearize(SYSTEMS[id], p)!;
      const { K } = lqr(lin.A, lin.B, Mat.diag([10, 100, 1, 1]), Mat.eye(1));
      const Acl = madd(lin.A, matmul(lin.B, K), -1);
      for (const [re] of eig(Acl)) expect(re).toBeLessThan(0);
    });
  }
  it('cart-pole analytic A matrix', () => {
    const p = defaultParams('cartpole');
    p.b_c = 0;
    p.b_p = 0;
    const { A, B } = linearize(SYSTEMS.cartpole, p)!;
    const mc = 1,
      mp = 0.3,
      l = 0.5,
      g = 9.81;
    expect(A.get(2, 1)).toBeCloseTo((-mp * g) / mc, 5);
    expect(A.get(3, 1)).toBeCloseTo(((mc + mp) * g) / (mc * l), 5);
    expect(B.get(2, 0)).toBeCloseTo(1 / mc, 5);
    expect(B.get(3, 0)).toBeCloseTo(-1 / (mc * l), 5);
  });
});
