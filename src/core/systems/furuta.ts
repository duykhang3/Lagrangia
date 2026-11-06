import { Mat, V3 } from '../linalg';
import type { ParamSpec, Params, SystemModel } from '../types';
import { commonActuatorSensingSpecs, commonFrictionSpecs, frictionForce, gravitySpec, num, numericJacobian } from './common';

// Furuta (rotary inverted) pendulum, following Cazzolato & Prime (2011) with a slender pendulum.
// q = [θ1 (arm), θ2 (pendulum, 0 = upright)]. Physics frame: z up, hub axis on the z-axis, arm plane z = 0.
//   T = ½(J0 + J2 sin²θ2) θ1'² + m2 L1 l2 cosθ2 θ1' θ2' + ½ J2 θ2'²,   V = m2 g l2 cosθ2
// with J0 = J_hub + m1 L1²/3 + m2 L1² and J2 = m2 L2²/3 (pendulum about its pivot), l2 = L2/2.

const specs: ParamSpec[] = [
  { key: 'm_1', group: 'physical', label: { en: 'Arm mass', nl: 'Armmassa' }, symbol: 'm_1', unit: 'kg', default: 0.2, min: 0.01, max: 5, step: 0.01 },
  { key: 'L_1', group: 'physical', label: { en: 'Arm length', nl: 'Armlengte' }, symbol: 'L_1', unit: 'm', default: 0.2, min: 0.05, max: 1, step: 0.005 },
  { key: 'm_2', group: 'physical', label: { en: 'Pendulum mass', nl: 'Slingermassa' }, symbol: 'm_2', unit: 'kg', default: 0.1, min: 0.01, max: 5, step: 0.01 },
  { key: 'L_2', group: 'physical', label: { en: 'Pendulum length', nl: 'Slingerlengte' }, symbol: 'L_2', unit: 'm', default: 0.3, min: 0.05, max: 1.5, step: 0.005 },
  { key: 'J_h', group: 'physical', label: { en: 'Hub + motor rotor inertia', nl: 'Traagheid naaf + motorrotor' }, symbol: 'J_h', unit: 'kg·m²', default: 1e-4, min: 0, max: 0.05, step: 1e-5 },
  gravitySpec,
  { key: 'b_1', group: 'friction', label: { en: 'Arm viscous friction', nl: 'Viskeuze wrijving arm' }, symbol: 'b_1', unit: 'N·m·s/rad', default: 0.001, min: 0, max: 0.1, step: 0.0001 },
  { key: 'F_c1', group: 'friction', label: { en: 'Arm Coulomb friction', nl: 'Coulombwrijving arm' }, symbol: 'F_{c,1}', unit: 'N·m', default: 0, min: 0, max: 0.2, step: 0.001 },
  { key: 'F_s1', group: 'friction', label: { en: 'Arm static (Stribeck) friction', nl: 'Statische (Stribeck) wrijving arm' }, symbol: 'F_{s,1}', unit: 'N·m', default: 0, min: 0, max: 0.2, step: 0.001 },
  { key: 'b_2', group: 'friction', label: { en: 'Pendulum viscous friction', nl: 'Viskeuze wrijving slinger' }, symbol: 'b_2', unit: 'N·m·s/rad', default: 5e-5, min: 0, max: 0.01, step: 1e-5 },
  { key: 'F_c2', group: 'friction', label: { en: 'Pendulum Coulomb friction', nl: 'Coulombwrijving slinger' }, symbol: 'F_{c,2}', unit: 'N·m', default: 0, min: 0, max: 0.05, step: 0.0001 },
  ...commonFrictionSpecs,
  { key: 'c_air', group: 'environment', label: { en: 'Air drag on pendulum tip (quadratic)', nl: 'Luchtweerstand op slingertip (kwadratisch)' }, symbol: 'c_d', unit: 'N·s²/m²', default: 0, min: 0, max: 1, step: 0.001 },
  ...commonActuatorSensingSpecs(1.0, 'N·m'),
  { key: 'theta1_0', group: 'initial', label: { en: 'Initial arm angle', nl: 'Beginhoek arm' }, symbol: '\\theta_{1,0}', unit: 'rad', default: 0, min: -3.1416, max: 3.1416, step: 0.01 },
  { key: 'theta2_0', group: 'initial', label: { en: 'Initial pendulum angle', nl: 'Beginhoek slinger' }, symbol: '\\theta_{2,0}', unit: 'rad', default: 0.1, min: -3.1416, max: 3.1416, step: 0.01 },
];

function consts(p: Params) {
  const m1 = num(p, 'm_1'),
    L1 = num(p, 'L_1'),
    m2 = num(p, 'm_2'),
    L2 = num(p, 'L_2');
  const J_0 = num(p, 'J_h') + (m1 * L1 * L1) / 3 + m2 * L1 * L1;
  const J_2 = (m2 * L2 * L2) / 3;
  const l_2 = L2 / 2;
  return { J_0, J_2, l_2, m2, L1, L2, g: num(p, 'g') };
}

function tipPoint(q: number[], s: number, w: number, a: number, L1: number): V3 {
  const c1 = Math.cos(q[0]),
    s1 = Math.sin(q[0]),
    c2 = Math.cos(q[1]),
    s2 = Math.sin(q[1]);
  const r: V3 = [c1, s1, 0],
    t: V3 = [-s1, c1, 0];
  // e = s2 t + c2 z ; n = c2 t - s2 z
  return [
    (L1 + a) * r[0] + s * s2 * t[0] + w * c2 * t[0],
    (L1 + a) * r[1] + s * s2 * t[1] + w * c2 * t[1],
    s * c2 - w * s2,
  ];
}

export const furuta: SystemModel = {
  id: 'furuta',
  name: { en: 'Furuta (rotary) inverted pendulum', nl: 'Furuta (roterende) omgekeerde slinger' },
  n: 2,
  nu: 1,
  dt: 0.001,
  integrator: 'rk4',
  substeps: 1,
  qNames: ['theta_1', 'theta_2'],
  qLatex: ['\\theta_1', '\\theta_2'],
  uNames: ['tau'],
  revolute: [true, true],
  paramSpecs: specs,
  derived: (p) => {
    const c = consts(p);
    return { J_0: c.J_0, J_2: c.J_2, l_2: c.l_2 };
  },
  initialState: (p) => ({ q: [num(p, 'theta1_0'), num(p, 'theta2_0')], dq: [0, 0] }),
  massMatrix(q, p) {
    const { J_0, J_2, l_2, m2, L1 } = consts(p);
    const s = Math.sin(q[1]),
      c = Math.cos(q[1]);
    const K = m2 * L1 * l_2;
    return Mat.fromRows([
      [J_0 + J_2 * s * s, K * c],
      [K * c, J_2],
    ]);
  },
  coriolis(q, dq, p) {
    const { J_2, l_2, m2, L1 } = consts(p);
    const s = Math.sin(q[1]),
      c = Math.cos(q[1]);
    const K = m2 * L1 * l_2;
    return [2 * J_2 * s * c * dq[0] * dq[1] - K * s * dq[1] * dq[1], -J_2 * s * c * dq[0] * dq[0]];
  },
  gravity(q, p) {
    const { l_2, m2, g } = consts(p);
    return [0, -m2 * g * l_2 * Math.sin(q[1])];
  },
  inputMap: (u) => [u[0] ?? 0, 0],
  passiveForces(q, dq, p) {
    const Q = [
      -frictionForce(dq[0], num(p, 'b_1'), num(p, 'F_c1'), num(p, 'F_s1'), p),
      -frictionForce(dq[1], num(p, 'b_2'), num(p, 'F_c2'), 0, p),
    ];
    const cair = num(p, 'c_air');
    if (cair > 0) {
      const { L1, L2 } = consts(p);
      const J = furuta.pointJacobian(q, 'pendulum', [L2, 0, 0], p);
      const v = [0, 1, 2].map((i) => J.get(i, 0) * dq[0] + J.get(i, 1) * dq[1]);
      const sp = Math.hypot(v[0], v[1], v[2]);
      const F = v.map((vi) => -cair * sp * vi);
      for (let j = 0; j < 2; j++) Q[j] += J.get(0, j) * F[0] + J.get(1, j) * F[1] + J.get(2, j) * F[2];
      void L1;
    }
    return Q;
  },
  bodyPoint(q, body, local, p) {
    const L1 = num(p, 'L_1');
    if (body === 'arm') {
      const c1 = Math.cos(q[0]),
        s1 = Math.sin(q[0]);
      return [local[0] * c1 - local[1] * s1, local[0] * s1 + local[1] * c1, local[2]];
    }
    return tipPoint(q, local[0], local[1], local[2], L1);
  },
  bodyLocal(q, body, w, p) {
    const L1 = num(p, 'L_1');
    const c1 = Math.cos(q[0]),
      s1 = Math.sin(q[0]);
    const lr = w[0] * c1 + w[1] * s1; // along arm
    const lt = -w[0] * s1 + w[1] * c1; // tangential
    if (body === 'arm') return [lr, lt, w[2]];
    const c2 = Math.cos(q[1]),
      s2 = Math.sin(q[1]);
    // p = (L1+a) r + s(s2 t + c2 z) + w(c2 t - s2 z)
    const s = lt * s2 + w[2] * c2;
    const ww = lt * c2 - w[2] * s2;
    return [s, ww, lr - L1];
  },
  pointJacobian(q, body, local, p) {
    return numericJacobian((qq) => furuta.bodyPoint(qq, body, local, p), q);
  },
  fk(q, p) {
    return { pos: tipPoint(q, num(p, 'L_2'), 0, 0, num(p, 'L_1')), R: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  },
  equilibrium: () => ({ q: [0, 0], dq: [0, 0], u: [0] }),
  dragStiffness: () => 20,
};
