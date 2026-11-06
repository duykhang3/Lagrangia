import { gaussian, Mat, rng, solveVec, V3 } from '../linalg';
import type { ContactInfo, Params, SystemModel } from '../types';
import { num } from '../systems/common';

export interface DragState {
  body: string;
  local: V3;
  target: V3;
}
export interface KickState {
  body: string;
  local: V3;
  force: V3;
  until: number;
}

export type GhostAccel = (q: number[], dq: number[], u: number[]) => number[];

export class Simulator {
  model: SystemModel;
  params: Params;
  q: number[] = [];
  dq: number[] = [];
  t = 0;
  uCmd: number[];
  uApplied: number[];
  private delayQueue: { t: number; u: number[] }[] = [];
  drag: DragState | null = null;
  kicks: KickState[] = [];
  lastDragForce: V3 = [0, 0, 0];
  contacts: ContactInfo[] = [];
  ghostAccel: GhostAccel | null = null;
  ghostQ: number[] | null = null;
  ghostDq: number[] | null = null;
  ghostError: string | null = null;
  private rand = rng(12345);
  private lastMeasQ: number[] | null = null;

  constructor(model: SystemModel, params: Params) {
    this.model = model;
    this.params = params;
    this.uCmd = new Array(model.nu).fill(0);
    this.uApplied = new Array(model.nu).fill(0);
    this.reset();
  }

  reset() {
    const s = this.model.initialState(this.params);
    this.q = s.q.slice();
    this.dq = s.dq.slice();
    this.t = 0;
    this.uCmd = new Array(this.model.nu).fill(0);
    this.uApplied = new Array(this.model.nu).fill(0);
    this.delayQueue = [];
    this.kicks = [];
    this.lastMeasQ = null;
    this.rand = rng(12345);
    this.contacts = [];
    this.resetGhost();
  }

  resetGhost() {
    this.ghostQ = this.ghostAccel ? this.q.slice() : null;
    this.ghostDq = this.ghostAccel ? this.dq.slice() : null;
    this.ghostError = null;
  }

  setState(q: number[], dq: number[]) {
    this.q = q.slice();
    this.dq = dq.slice();
  }

  saturate(u: number[]): number[] {
    if (this.model.id === 'panda') return this.model.inputMap(u, this.params);
    const m = num(this.params, 'u_max');
    return u.map((v) => (isFinite(v) ? Math.max(-m, Math.min(m, v)) : 0));
  }

  /** Controller writes a new command */
  command(u: number[]) {
    this.uCmd = u.map((v) => (isFinite(v) ? v : 0));
    const delay = num(this.params, 'delay_ms') / 1000;
    if (delay <= 0) {
      this.uApplied = this.saturate(this.uCmd);
      this.delayQueue = [];
    } else this.delayQueue.push({ t: this.t + delay, u: this.uCmd.slice() });
  }

  /** Simulated sensors. Realistic mode: noise + quantisation, velocity from backward difference. */
  measure(realistic: boolean, Ts: number): { q: number[]; dq: number[] } {
    if (!realistic) return { q: this.q.slice(), dq: this.dq.slice() };
    const sd = num(this.params, 'noise_std');
    const qs = num(this.params, 'quant');
    const qm = this.q.map((v) => {
      let x = v + sd * gaussian(this.rand);
      if (qs > 0) x = Math.round(x / qs) * qs;
      return x;
    });
    const prev = this.lastMeasQ ?? qm;
    const dqm = qm.map((v, i) => (v - prev[i]) / Ts);
    this.lastMeasQ = qm;
    return { q: qm, dq: dqm };
  }

  private externalForces(q: number[], dq: number[], t: number): number[] {
    const n = this.model.n;
    const Q = new Array(n).fill(0);
    const apply = (body: string, local: V3, F: V3) => {
      const J = this.model.pointJacobian(q, body, local, this.params);
      for (let j = 0; j < n; j++) Q[j] += J.get(0, j) * F[0] + J.get(1, j) * F[1] + J.get(2, j) * F[2];
      return J;
    };
    if (this.drag) {
      const k = this.model.dragStiffness(this.params);
      const c = 0.08 * k;
      const p = this.model.bodyPoint(q, this.drag.body, this.drag.local, this.params);
      const J = this.model.pointJacobian(q, this.drag.body, this.drag.local, this.params);
      const v = [0, 1, 2].map((i) => {
        let s = 0;
        for (let j = 0; j < n; j++) s += J.get(i, j) * dq[j];
        return s;
      });
      let F: V3 = [0, 1, 2].map((i) => k * (this.drag!.target[i] - p[i]) - c * v[i]) as V3;
      const mag = Math.hypot(F[0], F[1], F[2]);
      const maxF = 0.35 * k;
      if (mag > maxF) F = F.map((f) => (f * maxF) / mag) as V3;
      this.lastDragForce = F;
      for (let j = 0; j < n; j++) Q[j] += J.get(0, j) * F[0] + J.get(1, j) * F[1] + J.get(2, j) * F[2];
    } else this.lastDragForce = [0, 0, 0];
    for (const kck of this.kicks) if (t < kck.until) apply(kck.body, kck.local, kck.force);
    return Q;
  }

  accel(q: number[], dq: number[], t: number, collectContacts = false): number[] {
    const m = this.model;
    const M = m.massMatrix(q, this.params);
    const c = m.coriolis(q, dq, this.params);
    const g = m.gravity(q, this.params);
    const tauU = m.inputMap(this.uApplied, this.params);
    const out = collectContacts ? { contacts: [] as ContactInfo[] } : undefined;
    const tauP = m.passiveForces(q, dq, this.params, out);
    if (out) this.contacts = out.contacts;
    const tauE = this.externalForces(q, dq, t);
    const rhs = q.map((_, i) => tauU[i] + tauP[i] + tauE[i] - c[i] - g[i]);
    return solveVec(M, rhs);
  }

  step() {
    const dt = this.model.dt;
    // actuator delay
    while (this.delayQueue.length && this.delayQueue[0].t <= this.t + 1e-12) {
      this.uApplied = this.saturate(this.delayQueue.shift()!.u);
    }
    if (this.model.integrator === 'rk4') {
      const [q, dq] = rk4((qq, vv, tt) => this.accel(qq, vv, tt), this.q, this.dq, this.t, dt);
      this.q = q;
      this.dq = dq;
      this.accel(this.q, this.dq, this.t, true);
    } else {
      const a = this.accel(this.q, this.dq, this.t, true);
      for (let i = 0; i < this.q.length; i++) {
        this.dq[i] += a[i] * dt;
        this.q[i] += this.dq[i] * dt;
      }
    }
    if (this.ghostAccel && this.ghostQ && this.ghostDq && !this.ghostError) {
      try {
        const u = this.uApplied;
        const [gq, gdq] = rk4((qq, vv) => this.ghostAccel!(qq, vv, u), this.ghostQ, this.ghostDq, this.t, dt);
        if (gq.some((v) => !isFinite(v)) || gdq.some((v) => Math.abs(v) > 1e4)) throw new Error('Ghost model diverged');
        this.ghostQ = gq;
        this.ghostDq = gdq;
      } catch (e) {
        this.ghostError = (e as Error).message;
      }
    }
    this.kicks = this.kicks.filter((k) => this.t < k.until);
    this.t += dt;
    if (this.q.some((v) => !isFinite(v)) || this.dq.some((v) => !isFinite(v))) {
      throw new Error('Simulation diverged (non-finite state). Reset the simulation.');
    }
  }

  kick(body: string, local: V3, force: V3, duration: number) {
    this.kicks.push({ body, local, force, until: this.t + duration });
  }

  energy(): number {
    const M = this.model.massMatrix(this.q, this.params);
    let T = 0;
    for (let i = 0; i < this.q.length; i++) for (let j = 0; j < this.q.length; j++) T += 0.5 * this.dq[i] * M.get(i, j) * this.dq[j];
    return T;
  }
}

export function rk4(
  f: (q: number[], dq: number[], t: number) => number[],
  q: number[],
  dq: number[],
  t: number,
  h: number,
): [number[], number[]] {
  const n = q.length;
  const add = (a: number[], b: number[], s: number) => a.map((v, i) => v + s * b[i]);
  const k1v = f(q, dq, t);
  const k1q = dq;
  const q2 = add(q, k1q, h / 2),
    dq2 = add(dq, k1v, h / 2);
  const k2v = f(q2, dq2, t + h / 2);
  const k2q = dq2;
  const q3 = add(q, k2q, h / 2),
    dq3 = add(dq, k2v, h / 2);
  const k3v = f(q3, dq3, t + h / 2);
  const k3q = dq3;
  const q4 = add(q, k3q, h),
    dq4 = add(dq, k3v, h);
  const k4v = f(q4, dq4, t + h);
  const k4q = dq4;
  const qn = new Array(n),
    dqn = new Array(n);
  for (let i = 0; i < n; i++) {
    qn[i] = q[i] + (h / 6) * (k1q[i] + 2 * k2q[i] + 2 * k3q[i] + k4q[i]);
    dqn[i] = dq[i] + (h / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]);
  }
  return [qn, dqn];
}

/** Numerical linearisation about the model's equilibrium (Coulomb friction & drag removed). x = [q; dq] */
export function linearize(model: SystemModel, params: Params): { A: Mat; B: Mat } | null {
  if (!model.equilibrium) return null;
  const p: Params = { ...params, c_air: 0 };
  for (const k of Object.keys(p)) if (/^F_[cs]/.test(k)) p[k] = 0;
  const eq = model.equilibrium(p);
  const n = model.n,
    nu = model.nu;
  const f = (x: number[], u: number[]) => {
    const q = x.slice(0, n),
      dq = x.slice(n);
    const M = model.massMatrix(q, p);
    const c = model.coriolis(q, dq, p),
      g = model.gravity(q, p);
    const tu = model.inputMap(u, p),
      tp = model.passiveForces(q, dq, p);
    const ddq = solveVec(M, q.map((_, i) => tu[i] + tp[i] - c[i] - g[i]));
    return [...dq, ...ddq];
  };
  const x0 = [...eq.q, ...eq.dq];
  const A = new Mat(2 * n, 2 * n),
    B = new Mat(2 * n, nu);
  const h = 1e-6;
  for (let j = 0; j < 2 * n; j++) {
    const xp = x0.slice(),
      xm = x0.slice();
    xp[j] += h;
    xm[j] -= h;
    const fp = f(xp, eq.u),
      fm = f(xm, eq.u);
    for (let i = 0; i < 2 * n; i++) A.set(i, j, Math.abs((fp[i] - fm[i]) / (2 * h)) < 1e-9 ? 0 : (fp[i] - fm[i]) / (2 * h));
  }
  for (let j = 0; j < nu; j++) {
    const up = eq.u.slice(),
      um = eq.u.slice();
    up[j] += h;
    um[j] -= h;
    const fp = f(x0, up),
      fm = f(x0, um);
    for (let i = 0; i < 2 * n; i++) B.set(i, j, Math.abs((fp[i] - fm[i]) / (2 * h)) < 1e-9 ? 0 : (fp[i] - fm[i]) / (2 * h));
  }
  return { A, B };
}
