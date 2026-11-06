import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/core/blocks/examples';
import { Runtime } from '../src/core/sim/runtime';
import { SYSTEMS, defaultParams } from '../src/core/systems';
import { wrapToPi } from '../src/core/linalg';
import type { Params } from '../src/core/types';

function run(exId: string, seconds: number, paramOverrides: Params = {}, onStep?: (rt: Runtime) => void) {
  const ex = EXAMPLES.find((e) => e.id === exId)!;
  const p = { ...defaultParams(ex.system), ...paramOverrides };
  const rt = new Runtime(SYSTEMS[ex.system], p, JSON.parse(JSON.stringify(ex.model)));
  expect(rt.wsError).toBeNull();
  expect(rt.program!.errors).toEqual([]);
  const chunk = 0.1;
  for (let t = 0; t < seconds; t += chunk) {
    rt.advance(chunk, 1e9);
    onStep?.(rt);
  }
  expect(rt.program!.runtimeError).toBeNull();
  expect(rt.simError).toBeNull();
  return rt;
}

describe('example controllers', () => {
  it('cart-pole LQR balances from 0.1 rad', () => {
    const rt = run('cp-lqr', 6);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.01);
    expect(Math.abs(rt.sim.q[0])).toBeLessThan(0.05);
  });
  it('cart-pole gain/slider LQR balances', () => {
    const rt = run('cp-gain', 6);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.01);
  });
  it('cart-pole PID keeps the pole up for a while', () => {
    const rt = run('cp-pid', 3);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.3);
  });
  it('cart-pole swing-up from hanging', () => {
    let upTime = -1;
    const rt = run('cp-swingup', 15, { theta0: Math.PI }, (r) => {
      if (upTime < 0 && Math.abs(wrapToPi(r.sim.q[1])) < 0.05 && Math.abs(r.sim.dq[1]) < 0.3) upTime = r.sim.t;
    });
    console.log('cart-pole swing-up time', upTime, 'final', rt.sim.q);
    expect(upTime).toBeGreaterThan(0);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.05);
  });
  it('furuta LQR balances', () => {
    const rt = run('fu-lqr', 6);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.01);
  });
  it('furuta swing-up from hanging', () => {
    let upTime = -1;
    const rt = run('fu-swingup', 20, { theta2_0: Math.PI }, (r) => {
      if (upTime < 0 && Math.abs(wrapToPi(r.sim.q[1])) < 0.05) upTime = r.sim.t;
    });
    console.log('furuta swing-up time', upTime, 'final', rt.sim.q);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.05);
  });
  it('panda PD + gravity compensation holds home', () => {
    const rt = run('pa-pd', 2);
    const q0 = SYSTEMS.panda.initialState(defaultParams('panda')).q;
    rt.sim.q.forEach((v, i) => expect(Math.abs(v - q0[i])).toBeLessThan(0.01));
  });
  it('panda computed torque tracks', () => {
    let maxErr = 0;
    run('pa-ct', 4, {}, (r) => {
      if (r.sim.t < 1) return;
      const t = r.sim.t;
      const w = 2 * Math.PI * 0.25;
      const A = [0.6, 0.3, 0.4, 0.4, 0.5, 0.4, 0.8];
      const q0 = SYSTEMS.panda.initialState(defaultParams('panda')).q;
      r.sim.q.forEach((v, i) => (maxErr = Math.max(maxErr, Math.abs(v - (q0[i] + A[i] * Math.sin(w * t))))));
    });
    console.log('computed torque max error', maxErr);
    expect(maxErr).toBeLessThan(0.02);
  });
  it('panda impedance follows a moved target', () => {
    const rt = run('pa-imp', 0.2);
    const p0 = rt.target.slice();
    rt.target = [p0[0], p0[1] + 0.15, p0[2] + 0.05];
    for (let i = 0; i < 30; i++) rt.advance(0.1, 1e9);
    const tcp = SYSTEMS.panda.fk!(rt.sim.q, rt.params).pos;
    console.log('impedance tcp', tcp, 'target', rt.target);
    expect(Math.hypot(tcp[0] - rt.target[0], tcp[1] - rt.target[1], tcp[2] - rt.target[2])).toBeLessThan(0.02);
  });
});
