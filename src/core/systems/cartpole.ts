import { Mat, V3 } from '../linalg';
import type { ParamSpec, Params, SystemModel } from '../types';
import { commonActuatorSensingSpecs, commonFrictionSpecs, frictionForce, gravitySpec, num, numericJacobian } from './common';

// Cart-pole with a point-mass bob on a massless rod.
// q = [x, θ], θ = 0 upright, positive θ tilts the pole towards +x.
// Physics frame: x right, y up, z towards viewer. Pivot at the cart centre.

export const CART_HALF_WIDTH = 0.15;

const specs: ParamSpec[] = [
  { key: 'm_c', group: 'physical', label: { en: 'Cart mass', nl: 'Karmassa' }, symbol: 'm_c', unit: 'kg', default: 1.0, min: 0.05, max: 20, step: 0.05 },
  { key: 'm_p', group: 'physical', label: { en: 'Pendulum (bob) mass', nl: 'Slingermassa' }, symbol: 'm_p', unit: 'kg', default: 0.3, min: 0.01, max: 10, step: 0.01 },
  { key: 'l', group: 'physical', label: { en: 'Pendulum length', nl: 'Slingerlengte' }, symbol: 'l', unit: 'm', default: 0.5, min: 0.05, max: 3, step: 0.01 },
  gravitySpec,
  { key: 'b_c', group: 'friction', label: { en: 'Cart viscous friction', nl: 'Viskeuze wrijving kar' }, symbol: 'b_c', unit: 'N·s/m', default: 0.1, min: 0, max: 20, step: 0.01 },
  { key: 'F_c', group: 'friction', label: { en: 'Cart Coulomb friction', nl: 'Coulombwrijving kar' }, symbol: 'F_c', unit: 'N', default: 0, min: 0, max: 20, step: 0.05 },
  { key: 'F_s', group: 'friction', label: { en: 'Cart static (Stribeck) friction', nl: 'Statische (Stribeck) wrijving kar' }, symbol: 'F_s', unit: 'N', default: 0, min: 0, max: 20, step: 0.05, help: { en: 'Peak friction at zero velocity. Only active if F_s > F_c.', nl: 'Piekwrijving bij snelheid nul. Alleen actief als F_s > F_c.' } },
  { key: 'b_p', group: 'friction', label: { en: 'Pivot viscous friction', nl: 'Viskeuze wrijving scharnier' }, symbol: 'b_p', unit: 'N·m·s/rad', default: 0.002, min: 0, max: 1, step: 0.001 },
  { key: 'F_cp', group: 'friction', label: { en: 'Pivot Coulomb friction', nl: 'Coulombwrijving scharnier' }, symbol: 'F_{c,p}', unit: 'N·m', default: 0, min: 0, max: 1, step: 0.001 },
  ...commonFrictionSpecs,
  { key: 'c_air', group: 'environment', label: { en: 'Air drag on bob (quadratic)', nl: 'Luchtweerstand op massa (kwadratisch)' }, symbol: 'c_d', unit: 'N·s²/m²', default: 0, min: 0, max: 5, step: 0.01, help: { en: 'F = −c_d |v| v acting on the bob, mapped to joints via Jᵀ.', nl: 'F = −c_d |v| v op de massa, via Jᵀ naar de gewrichten.' } },
  { key: 'track', group: 'contact', label: { en: 'Track length', nl: 'Raillengte' }, unit: 'm', default: 2.4, min: 0.6, max: 10, step: 0.1 },
  { key: 'bumper_k', group: 'contact', label: { en: 'End-stop stiffness', nl: 'Stijfheid eindstop' }, unit: 'N/m', default: 30000, min: 100, max: 200000, step: 100 },
  { key: 'bumper_d', group: 'contact', label: { en: 'End-stop damping', nl: 'Demping eindstop' }, unit: 'N·s/m', default: 150, min: 0, max: 5000, step: 10 },
  ...commonActuatorSensingSpecs(30, 'N'),
  { key: 'x0', group: 'initial', label: { en: 'Initial cart position', nl: 'Beginpositie kar' }, symbol: 'x_0', unit: 'm', default: 0, min: -1, max: 1, step: 0.01 },
  { key: 'theta0', group: 'initial', label: { en: 'Initial pole angle', nl: 'Beginhoek slinger' }, symbol: '\\theta_0', unit: 'rad', default: 0.1, min: -3.1416, max: 3.1416, step: 0.01 },
];

export const cartpole: SystemModel = {
  id: 'cartpole',
  name: { en: 'Cart-pole inverted pendulum', nl: 'Kar-slinger (omgekeerde slinger)' },
  n: 2,
  nu: 1,
  dt: 0.001,
  integrator: 'rk4',
  substeps: 1,
  qNames: ['x', 'theta'],
  qLatex: ['x', '\\theta'],
  uNames: ['F'],
  revolute: [false, true],
  paramSpecs: specs,
  derived: () => ({}),
  initialState: (p) => ({ q: [num(p, 'x0'), num(p, 'theta0')], dq: [0, 0] }),
  massMatrix(q, p) {
    const mc = num(p, 'm_c'),
      mp = num(p, 'm_p'),
      l = num(p, 'l');
    const c = Math.cos(q[1]);
    return Mat.fromRows([
      [mc + mp, mp * l * c],
      [mp * l * c, mp * l * l],
    ]);
  },
  coriolis(q, dq, p) {
    const mp = num(p, 'm_p'),
      l = num(p, 'l');
    return [-mp * l * Math.sin(q[1]) * dq[1] * dq[1], 0];
  },
  gravity(q, p) {
    return [0, -num(p, 'm_p') * num(p, 'g') * num(p, 'l') * Math.sin(q[1])];
  },
  inputMap: (u) => [u[0] ?? 0, 0],
  passiveForces(q, dq, p) {
    const l = num(p, 'l');
    const Q = [
      -frictionForce(dq[0], num(p, 'b_c'), num(p, 'F_c'), num(p, 'F_s'), p),
      -frictionForce(dq[1], num(p, 'b_p'), num(p, 'F_cp'), 0, p),
    ];
    // air drag on the bob: Q = J^T F
    const cair = num(p, 'c_air');
    if (cair > 0) {
      const c = Math.cos(q[1]),
        s = Math.sin(q[1]);
      const vx = dq[0] + l * c * dq[1],
        vy = -l * s * dq[1];
      const sp = Math.hypot(vx, vy);
      const Fx = -cair * sp * vx,
        Fy = -cair * sp * vy;
      Q[0] += Fx;
      Q[1] += l * c * Fx - l * s * Fy;
    }
    // track end-stops (penalty contact)
    const lim = num(p, 'track') / 2 - CART_HALF_WIDTH;
    const k = num(p, 'bumper_k'),
      d = num(p, 'bumper_d');
    if (q[0] > lim) Q[0] += Math.min(0, -k * (q[0] - lim) - d * dq[0]);
    else if (q[0] < -lim) Q[0] += Math.max(0, -k * (q[0] + lim) - d * dq[0]);
    return Q;
  },
  bodyPoint(q, body, local) {
    if (body === 'cart') return [q[0] + local[0], local[1], local[2]];
    const s = Math.sin(q[1]),
      c = Math.cos(q[1]);
    return [q[0] + local[0] * s + local[1] * c, local[0] * c - local[1] * s, local[2]];
  },
  bodyLocal(q, body, w) {
    if (body === 'cart') return [w[0] - q[0], w[1], w[2]];
    const s = Math.sin(q[1]),
      c = Math.cos(q[1]);
    const dx = w[0] - q[0],
      dy = w[1];
    return [dx * s + dy * c, dx * c - dy * s, w[2]];
  },
  pointJacobian(q, body, local, p) {
    return numericJacobian((qq) => cartpole.bodyPoint(qq, body, local, p), q);
  },
  fk(q, p) {
    const l = num(p, 'l');
    return { pos: [q[0] + l * Math.sin(q[1]), l * Math.cos(q[1]), 0] as V3, R: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  },
  equilibrium: () => ({ q: [0, 0], dq: [0, 0], u: [0] }),
  dragStiffness: (p) => 100 * (num(p, "m_c") + num(p, "m_p")),
};
