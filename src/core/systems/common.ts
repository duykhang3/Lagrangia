import { Mat, V3 } from '../linalg';
import type { ParamSpec, Params } from '../types';

export const num = (p: Params, k: string) => Number(p[k] ?? 0);

/** Generic friction model: viscous + Coulomb (+ Stribeck) */
export function frictionForce(v: number, b: number, Fc: number, Fs: number, p: Params): number {
  const model = String(p.coulomb_model ?? 'tanh');
  const eps = Math.max(num(p, 'coulomb_eps'), 1e-6);
  const vs = Math.max(num(p, 'stribeck_vs'), 1e-6);
  const sgn = model === 'sign' ? Math.sign(v) : Math.tanh(v / eps);
  let mag = Fc;
  if (Fs > Fc) mag = Fc + (Fs - Fc) * Math.exp(-((v / vs) ** 2));
  return b * v + mag * sgn;
}

/** numerical point Jacobian 3×n */
export function numericJacobian(f: (q: number[]) => V3, q: number[]): Mat {
  const n = q.length;
  const J = new Mat(3, n);
  const h = 1e-6;
  for (let j = 0; j < n; j++) {
    const qp = q.slice();
    const qm = q.slice();
    qp[j] += h;
    qm[j] -= h;
    const a = f(qp);
    const b = f(qm);
    for (let i = 0; i < 3; i++) J.set(i, j, (a[i] - b[i]) / (2 * h));
  }
  return J;
}

export const commonFrictionSpecs: ParamSpec[] = [
  {
    key: 'coulomb_model',
    group: 'friction',
    kind: 'select',
    label: { en: 'Coulomb model', nl: 'Coulomb-model' },
    default: 'tanh',
    options: [
      { value: 'tanh', label: { en: 'Smooth: tanh(v/ε)', nl: 'Glad: tanh(v/ε)' } },
      { value: 'sign', label: { en: 'Discontinuous: sign(v)', nl: 'Discontinu: sign(v)' } },
    ],
    help: {
      en: 'sign(v) is the textbook model but makes the ODE discontinuous at v = 0 (chattering). tanh(v/ε) smooths it.',
      nl: 'sign(v) is het klassieke model maar maakt de ODE discontinu bij v = 0 (chattering). tanh(v/ε) maakt het glad.',
    },
  },
  { key: 'coulomb_eps', group: 'friction', label: { en: 'Smoothing velocity', nl: 'Afvlakkingssnelheid' }, symbol: '\\varepsilon', unit: 'm/s | rad/s', default: 0.01, min: 1e-4, max: 1, step: 0.001 },
  { key: 'stribeck_vs', group: 'friction', label: { en: 'Stribeck velocity', nl: 'Stribeck-snelheid' }, symbol: 'v_s', unit: 'm/s | rad/s', default: 0.05, min: 1e-3, max: 1, step: 0.005 },
];

export const commonActuatorSensingSpecs = (uMax: number, uUnit: string): ParamSpec[] => [
  { key: 'u_max', group: 'actuator', label: { en: 'Actuator limit (saturation)', nl: 'Actuatorlimiet (saturatie)' }, symbol: 'u_{max}', unit: uUnit, default: uMax, min: 0, max: uMax * 10, step: uMax / 100 },
  { key: 'delay_ms', group: 'actuator', label: { en: 'Actuator delay', nl: 'Actuatorvertraging' }, unit: 'ms', default: 0, min: 0, max: 100, step: 1 },
  { key: 'noise_std', group: 'sensing', label: { en: 'Position noise (std, realistic mode)', nl: 'Positieruis (std, realistische modus)' }, symbol: '\\sigma', unit: 'm | rad', default: 0.0005, min: 0, max: 0.05, step: 0.0001 },
  { key: 'quant', group: 'sensing', label: { en: 'Encoder resolution (realistic mode)', nl: 'Encoderresolutie (realistische modus)' }, unit: 'm | rad', default: 0.0015, min: 0, max: 0.05, step: 0.0001 },
];

export const gravitySpec: ParamSpec = { key: 'g', group: 'environment', label: { en: 'Gravity', nl: 'Zwaartekracht' }, symbol: 'g', unit: 'm/s²', default: 9.81, min: 0, max: 30, step: 0.01 };

export function defaultsFromSpecs(specs: ParamSpec[]): Params {
  const p: Params = {};
  for (const s of specs) p[s.key] = s.default;
  return p;
}
