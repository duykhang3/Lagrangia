import { Mat, r3, R3, V3, v3 } from '../linalg';
import type { ContactInfo, EnvBox, ParamSpec, Params, SystemModel } from '../types';
import { commonFrictionSpecs, frictionForce, gravitySpec, num } from './common';

// Franka Emika Panda / FR3 7-DOF arm.
// Kinematics: Craig's modified DH parameters published by Franka Emika.
// Inertial parameters: approximate values as used in the MuJoCo Menagerie model (identified by Gaz et al., 2019).

export const DH = {
  a: [0, 0, 0, 0.0825, -0.0825, 0, 0.088],
  d: [0.333, 0, 0.316, 0, 0.384, 0, 0],
  alpha: [0, -Math.PI / 2, Math.PI / 2, Math.PI / 2, -Math.PI / 2, Math.PI / 2, Math.PI / 2],
  flange: 0.107,
};
export const TCP_OFFSET = 0.107 + 0.1034; // along z of link 7
export const Q_HOME = [0, -Math.PI / 4, 0, (-3 * Math.PI) / 4, 0, Math.PI / 2, Math.PI / 4];
export const Q_MIN = [-2.8973, -1.7628, -2.8973, -3.0718, -2.8973, -0.0175, -2.8973];
export const Q_MAX = [2.8973, 1.7628, 2.8973, -0.0698, 2.8973, 3.7525, 2.8973];
export const TAU_MAX = [87, 87, 87, 87, 12, 12, 12];

interface Link {
  m: number;
  c: V3;
  I: number[]; // ixx iyy izz ixy ixz iyz (about COM, link frame)
}
const LINKS_RAW: Link[] = [
  { m: 4.970684, c: [0.003875, 0.002081, -0.04762], I: [0.70337, 0.70661, 0.009117, -0.000139, 0.006772, 0.019169] },
  { m: 0.646926, c: [-0.003141, -0.02872, 0.003495], I: [0.007962, 0.02811, 0.025995, -0.003925, 0.010254, 0.000704] },
  { m: 3.228604, c: [0.027518, 0.039252, -0.066502], I: [0.037242, 0.036155, 0.01083, -0.004761, -0.011396, -0.012805] },
  { m: 3.587895, c: [-0.05317, 0.104419, 0.027454], I: [0.025853, 0.019552, 0.028323, 0.007796, -0.001332, 0.008641] },
  { m: 1.225946, c: [-0.011953, 0.041065, -0.038437], I: [0.035549, 0.029474, 0.008627, -0.002117, -0.004037, 0.000229] },
  { m: 1.666555, c: [0.060149, -0.014117, -0.010517], I: [0.001964, 0.004354, 0.005433, 0.000109, -0.001158, 0.000341] },
  { m: 0.735522, c: [0.010517, -0.004252, 0.061597], I: [0.012516, 0.010027, 0.004815, -0.000428, -0.001196, -0.000741] },
];

function inertiaMat(I: number[]): R3 {
  const [xx, yy, zz, xy, xz, yz] = I;
  return [xx, xy, xz, xy, yy, yz, xz, yz, zz];
}

/** merge a point-ish body (mass m, com c, inertia Ic about its com) into a link */
function mergeBody(L: { m: number; c: V3; I: R3 }, m: number, c: V3, Ic: R3) {
  const M = L.m + m;
  if (M <= 0) return L;
  const C = v3.scale(v3.add(v3.scale(L.c, L.m), v3.scale(c, m)), 1 / M);
  const shift = (I: R3, mass: number, r: V3): R3 => {
    const rr = v3.dot(r, r);
    const out = I.slice();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] += mass * ((i === j ? rr : 0) - r[i] * r[j]);
    return out;
  };
  const I1 = shift(L.I, L.m, v3.sub(L.c, C));
  const I2 = shift(Ic, m, v3.sub(c, C));
  return { m: M, c: C, I: I1.map((v, i) => v + I2[i]) };
}

export function buildLinks(payload: number) {
  const links = LINKS_RAW.map((l) => ({ m: l.m, c: l.c.slice() as V3, I: inertiaMat(l.I) }));
  // Franka hand (0.73 kg) attached to the flange
  links[6] = mergeBody(links[6], 0.73, [0, 0, DH.flange + 0.04], [0.001, 0, 0, 0, 0.0025, 0, 0, 0, 0.0017]);
  if (payload > 0) links[6] = mergeBody(links[6], payload, [0, 0, TCP_OFFSET], [1e-4, 0, 0, 0, 1e-4, 0, 0, 0, 1e-4]);
  return links;
}

export interface PandaFK {
  R: R3[]; // R[0] = base, R[1..7] links
  p: V3[];
  z: V3[]; // joint axes, z[i] for joint i (1..7)
}

export function pandaFK(q: number[]): PandaFK {
  const R: R3[] = [r3.eye()];
  const p: V3[] = [[0, 0, 0]];
  const z: V3[] = [[0, 0, 1]];
  for (let i = 0; i < 7; i++) {
    const Rprev = R[i];
    const Ri = r3.mul(r3.mul(Rprev, r3.rotX(DH.alpha[i])), r3.rotZ(q[i]));
    const pi = v3.add(v3.add(p[i], r3.apply(Rprev, [DH.a[i], 0, 0])), r3.apply(Ri, [0, 0, DH.d[i]]));
    R.push(Ri);
    p.push(pi);
    z.push(r3.col(Ri, 2));
  }
  return { R, p, z };
}

/** Recursive Newton–Euler: tau = M(q) qdd + C(q,qd) qd + g(q) (with gravity flag) */
export function rnea(q: number[], dq: number[], ddq: number[], links: ReturnType<typeof buildLinks>, gravity: number, fk?: PandaFK): number[] {
  const F = fk ?? pandaFK(q);
  const n = 7;
  let w: V3 = [0, 0, 0],
    wd: V3 = [0, 0, 0],
    a: V3 = [0, 0, gravity];
  const fs: V3[] = [],
    ns: V3[] = [],
    rc: V3[] = [];
  for (let i = 1; i <= n; i++) {
    const zi = F.z[i];
    const dp = v3.sub(F.p[i], F.p[i - 1]);
    const ai = v3.add(a, v3.add(v3.cross(wd, dp), v3.cross(w, v3.cross(w, dp))));
    const wi = v3.add(w, v3.scale(zi, dq[i - 1]));
    const wdi = v3.add(v3.add(wd, v3.scale(zi, ddq[i - 1])), v3.cross(w, v3.scale(zi, dq[i - 1])));
    const L = links[i - 1];
    const r = r3.apply(F.R[i], L.c);
    const ac = v3.add(ai, v3.add(v3.cross(wdi, r), v3.cross(wi, v3.cross(wi, r))));
    const Iw = r3.mul(r3.mul(F.R[i], L.I), r3.transpose(F.R[i]));
    fs.push(v3.scale(ac, L.m));
    ns.push(v3.add(r3.apply(Iw, wdi), v3.cross(wi, r3.apply(Iw, wi))));
    rc.push(r);
    w = wi;
    wd = wdi;
    a = ai;
  }
  const tau = new Array(n).fill(0);
  let f: V3 = [0, 0, 0],
    nm: V3 = [0, 0, 0];
  for (let i = n; i >= 1; i--) {
    const Fi = fs[i - 1];
    const dpNext: V3 = i < n ? v3.sub(F.p[i + 1], F.p[i]) : [0, 0, 0];
    const nNew = v3.add(v3.add(v3.add(ns[i - 1], v3.cross(rc[i - 1], Fi)), nm), v3.cross(dpNext, f));
    f = v3.add(Fi, f);
    nm = nNew;
    tau[i - 1] = v3.dot(F.z[i], nm);
  }
  return tau;
}

/** link geometry segments (local coordinates) used for rendering & contact spheres */
/** Segments for link L = 0 (base) .. 7, from the origin of frame L to the origin of frame L+1, in frame L */
export function pandaLinkSegments(L: number): [V3, V3][] {
  if (L === 7) return [[[0, 0, 0], [0, 0, DH.flange]]];
  const a = DH.a[L],
    al = DH.alpha[L],
    d = DH.d[L];
  const mid: V3 = [a, 0, 0];
  const end: V3 = [a, -Math.sin(al) * d, Math.cos(al) * d];
  const segs: [V3, V3][] = [];
  if (Math.abs(a) > 1e-9) segs.push([[0, 0, 0], mid]);
  if (Math.abs(d) > 1e-9) segs.push([mid, end]);
  return segs;
}

interface Sphere {
  link: number; // 1..7
  c: V3;
  r: number;
}
export const CONTACT_SPHERES: Sphere[] = (() => {
  const out: Sphere[] = [];
  for (let L = 2; L <= 7; L++) {
    const r = L <= 4 ? 0.065 : 0.055;
    for (const [s, e] of pandaLinkSegments(L)) {
      const len = v3.norm(v3.sub(e, s));
      const nseg = Math.max(1, Math.ceil(len / 0.07));
      for (let k = 0; k <= nseg; k++) out.push({ link: L, c: v3.add(s, v3.scale(v3.sub(e, s), k / nseg)), r });
    }
  }
  out.push({ link: 7, c: [0, 0, DH.flange + 0.045], r: 0.055 });
  const fr = 0.012;
  const ang = -Math.PI / 4;
  for (const sgn of [-1, 1]) out.push({ link: 7, c: [sgn * 0.03 * -Math.sin(ang), sgn * 0.03 * Math.cos(ang), TCP_OFFSET - fr], r: fr });
  out.push({ link: 7, c: [0, 0, TCP_OFFSET - fr], r: fr });
  return out;
})();

function boxesFromParams(p: Params): EnvBox[] {
  const boxes: EnvBox[] = [];
  if (p.box_on) {
    const s = num(p, 'box_size') / 2;
    const h = num(p, 'box_h');
    boxes.push({ center: [num(p, 'box_x'), num(p, 'box_y'), h / 2], half: [s, s, h / 2] });
  }
  if (p.wall_on) {
    const wx = num(p, 'wall_x');
    boxes.push({ center: [wx + 0.05, 0, 0.6], half: [0.05, 0.8, 0.6] });
  }
  return boxes;
}

const specs: ParamSpec[] = [
  { key: 'payload', group: 'physical', label: { en: 'Payload at TCP (unknown to the controller model)', nl: 'Last aan TCP (onbekend voor regelaarmodel)' }, symbol: 'm_L', unit: 'kg', default: 0, min: 0, max: 3, step: 0.05, help: { en: 'Robotics blocks (M, C, g, ...) use the nominal model without payload: a model mismatch to experiment with.', nl: 'Robotica-blokken (M, C, g, ...) gebruiken het nominale model zonder last: een modelfout om mee te experimenteren.' } },
  { key: 'armature', group: 'physical', label: { en: 'Reflected rotor inertia (armature)', nl: 'Gereflecteerde rotortraagheid (armature)' }, symbol: 'I_m', unit: 'kg·m²', default: 0.1, min: 0, max: 1, step: 0.01, help: { en: 'Added to the diagonal of M(q): motor inertia × gear ratio².', nl: 'Opgeteld bij de diagonaal van M(q): motortraagheid × overbrengverhouding².' } },
  gravitySpec,
  { key: 'b_j', group: 'friction', label: { en: 'Joint viscous friction', nl: 'Viskeuze gewrichtswrijving' }, symbol: 'b', unit: 'N·m·s/rad', default: 0.1, min: 0, max: 10, step: 0.01 },
  { key: 'F_cj', group: 'friction', label: { en: 'Joint Coulomb friction', nl: 'Coulomb-gewrichtswrijving' }, symbol: 'F_c', unit: 'N·m', default: 0, min: 0, max: 10, step: 0.05 },
  { key: 'F_sj', group: 'friction', label: { en: 'Joint static (Stribeck) friction', nl: 'Statische (Stribeck) gewrichtswrijving' }, symbol: 'F_s', unit: 'N·m', default: 0, min: 0, max: 10, step: 0.05 },
  ...commonFrictionSpecs,
  { key: 'floor_on', group: 'contact', kind: 'bool', label: { en: 'Table surface contact (z = 0)', nl: 'Contact met tafelblad (z = 0)' }, default: true },
  { key: 'box_on', group: 'contact', kind: 'bool', label: { en: 'Block on the table', nl: 'Blok op tafel' }, default: true },
  { key: 'box_x', group: 'contact', label: { en: 'Block x position', nl: 'Blok x-positie' }, unit: 'm', default: 0.55, min: -1, max: 1, step: 0.01 },
  { key: 'box_y', group: 'contact', label: { en: 'Block y position', nl: 'Blok y-positie' }, unit: 'm', default: -0.25, min: -1, max: 1, step: 0.01 },
  { key: 'box_size', group: 'contact', label: { en: 'Block width', nl: 'Blokbreedte' }, unit: 'm', default: 0.25, min: 0.05, max: 1, step: 0.01 },
  { key: 'box_h', group: 'contact', label: { en: 'Block height', nl: 'Blokhoogte' }, unit: 'm', default: 0.2, min: 0.02, max: 1, step: 0.01 },
  { key: 'wall_on', group: 'contact', kind: 'bool', label: { en: 'Wall', nl: 'Muur' }, default: false },
  { key: 'wall_x', group: 'contact', label: { en: 'Wall x position', nl: 'Muur x-positie' }, unit: 'm', default: 0.75, min: 0.3, max: 1.5, step: 0.01 },
  { key: 'k_contact', group: 'contact', label: { en: 'Contact stiffness', nl: 'Contactstijfheid' }, unit: 'N/m', default: 30000, min: 1000, max: 200000, step: 1000 },
  { key: 'd_contact', group: 'contact', label: { en: 'Contact damping', nl: 'Contactdemping' }, unit: 'N·s/m', default: 400, min: 0, max: 5000, step: 10 },
  { key: 'mu', group: 'contact', label: { en: 'Contact friction coefficient', nl: 'Contactwrijvingscoëfficiënt' }, symbol: '\\mu', default: 0.5, min: 0, max: 2, step: 0.05 },
  { key: 'u_max', group: 'actuator', label: { en: 'Torque limit scale (× Franka limits 87/12 N·m)', nl: 'Koppellimietschaal (× Franka-limieten 87/12 N·m)' }, default: 1, min: 0, max: 5, step: 0.05 },
  { key: 'delay_ms', group: 'actuator', label: { en: 'Actuator delay', nl: 'Actuatorvertraging' }, unit: 'ms', default: 0, min: 0, max: 100, step: 1 },
  { key: 'noise_std', group: 'sensing', label: { en: 'Joint angle noise (std, realistic mode)', nl: 'Ruis gewrichtshoek (std, realistische modus)' }, unit: 'rad', default: 0.0002, min: 0, max: 0.01, step: 0.0001 },
  { key: 'quant', group: 'sensing', label: { en: 'Encoder resolution (realistic mode)', nl: 'Encoderresolutie (realistische modus)' }, unit: 'rad', default: 0.0001, min: 0, max: 0.01, step: 0.0001 },
];

const linkCache = new Map<number, ReturnType<typeof buildLinks>>();
function getLinks(payload: number) {
  let l = linkCache.get(payload);
  if (!l) {
    l = buildLinks(payload);
    if (linkCache.size > 20) linkCache.clear();
    linkCache.set(payload, l);
  }
  return l;
}

function pointJac(F: PandaFK, link: number, pt: V3): Mat {
  const J = new Mat(3, 7);
  for (let j = 1; j <= link; j++) {
    const c = v3.cross(F.z[j], v3.sub(pt, F.p[j]));
    J.set(0, j - 1, c[0]);
    J.set(1, j - 1, c[1]);
    J.set(2, j - 1, c[2]);
  }
  return J;
}

export function contactSpheresWorld(q: number[]) {
  const F = pandaFK(q);
  return CONTACT_SPHERES.map((s) => ({ c: v3.add(F.p[s.link], r3.apply(F.R[s.link], s.c)), r: s.r }));
}

export const panda: SystemModel = {
  id: 'panda',
  name: { en: 'Franka FR3 / Panda 7-DOF arm', nl: 'Franka FR3 / Panda 7-DOF arm' },
  n: 7,
  nu: 7,
  dt: 0.0005,
  integrator: 'semi-implicit',
  substeps: 2,
  qNames: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
  qLatex: ['q_1', 'q_2', 'q_3', 'q_4', 'q_5', 'q_6', 'q_7'],
  uNames: ['tau1', 'tau2', 'tau3', 'tau4', 'tau5', 'tau6', 'tau7'],
  revolute: [true, true, true, true, true, true, true],
  paramSpecs: specs,
  derived: () => ({}),
  initialState: () => ({ q: Q_HOME.slice(), dq: new Array(7).fill(0) }),
  massMatrix(q, p) {
    const links = getLinks(num(p, 'payload'));
    const F = pandaFK(q);
    const M = new Mat(7, 7);
    const zero = new Array(7).fill(0);
    for (let j = 0; j < 7; j++) {
      const e = zero.slice();
      e[j] = 1;
      const col = rnea(q, zero, e, links, 0, F);
      for (let i = 0; i < 7; i++) M.set(i, j, col[i]);
    }
    const arm = num(p, 'armature');
    for (let i = 0; i < 7; i++) {
      M.set(i, i, M.get(i, i) + arm);
      for (let j = 0; j < i; j++) {
        const v = 0.5 * (M.get(i, j) + M.get(j, i));
        M.set(i, j, v);
        M.set(j, i, v);
      }
    }
    return M;
  },
  coriolis(q, dq, p) {
    return rnea(q, dq, new Array(7).fill(0), getLinks(num(p, 'payload')), 0);
  },
  gravity(q, p) {
    return rnea(q, new Array(7).fill(0), new Array(7).fill(0), getLinks(num(p, 'payload')), num(p, 'g'));
  },
  inputMap(u, p) {
    const s = num(p, 'u_max');
    return Array.from({ length: 7 }, (_, i) => Math.max(-TAU_MAX[i] * s, Math.min(TAU_MAX[i] * s, u[i] ?? 0)));
  },
  passiveForces(q, dq, p, out) {
    const Q = new Array(7).fill(0);
    const b = num(p, 'b_j'),
      Fc = num(p, 'F_cj'),
      Fs = num(p, 'F_sj');
    for (let i = 0; i < 7; i++) {
      Q[i] -= frictionForce(dq[i], b, Fc, Fs, p);
      // joint limits (stiff spring-damper)
      if (q[i] > Q_MAX[i]) Q[i] += Math.min(0, -3000 * (q[i] - Q_MAX[i]) - 30 * dq[i]);
      else if (q[i] < Q_MIN[i]) Q[i] += Math.max(0, -3000 * (q[i] - Q_MIN[i]) - 30 * dq[i]);
    }
    // environment contacts
    const floor = !!p.floor_on;
    const boxes = boxesFromParams(p);
    if (!floor && boxes.length === 0) return Q;
    const F = pandaFK(q);
    const k = num(p, 'k_contact'),
      dc = num(p, 'd_contact'),
      mu = num(p, 'mu');
    for (const s of CONTACT_SPHERES) {
      const c = v3.add(F.p[s.link], r3.apply(F.R[s.link], s.c));
      const hits: { n: V3; pen: number }[] = [];
      if (floor && c[2] < s.r) hits.push({ n: [0, 0, 1], pen: s.r - c[2] });
      for (const bx of boxes) {
        const d = v3.sub(c, bx.center);
        const cl: V3 = [0, 1, 2].map((i) => Math.max(-bx.half[i], Math.min(bx.half[i], d[i]))) as V3;
        const diff = v3.sub(d, cl);
        const dist = v3.norm(diff);
        if (dist > 1e-9) {
          if (dist < s.r) hits.push({ n: v3.scale(diff, 1 / dist), pen: s.r - dist });
        } else {
          // centre inside the box: push out through the nearest face
          let best = 0,
            bestPen = Infinity,
            sgn = 1;
          for (let i = 0; i < 3; i++) {
            const pn = bx.half[i] - Math.abs(d[i]);
            if (pn < bestPen) {
              bestPen = pn;
              best = i;
              sgn = d[i] >= 0 ? 1 : -1;
            }
          }
          const n: V3 = [0, 0, 0];
          n[best] = sgn;
          hits.push({ n, pen: bestPen + s.r });
        }
      }
      if (!hits.length) continue;
      const J = pointJac(F, s.link, c);
      const v: V3 = [0, 0, 0];
      for (let j = 0; j < 7; j++) for (let i = 0; i < 3; i++) v[i] += J.get(i, j) * dq[j];
      for (const h of hits) {
        const vn = v3.dot(v, h.n);
        const Fn = Math.max(0, k * h.pen - dc * vn);
        if (Fn <= 0) continue;
        const vt = v3.sub(v, v3.scale(h.n, vn));
        const vtn = v3.norm(vt);
        let f = v3.scale(h.n, Fn);
        if (vtn > 1e-9 && mu > 0) f = v3.add(f, v3.scale(vt, (-mu * Fn * Math.tanh(vtn / 0.01)) / vtn));
        for (let j = 0; j < 7; j++) Q[j] += J.get(0, j) * f[0] + J.get(1, j) * f[1] + J.get(2, j) * f[2];
        out?.contacts?.push({ point: v3.sub(c, v3.scale(h.n, s.r)), normal: h.n, force: f });
      }
    }
    return Q;
  },
  bodyPoint(q, body, local) {
    const F = pandaFK(q);
    const L = Number(body.replace('link', ''));
    return v3.add(F.p[L], r3.apply(F.R[L], local));
  },
  bodyLocal(q, body, w) {
    const F = pandaFK(q);
    const L = Number(body.replace('link', ''));
    return r3.applyT(F.R[L], v3.sub(w, F.p[L]));
  },
  pointJacobian(q, body, local) {
    const F = pandaFK(q);
    const L = Number(body.replace('link', ''));
    return pointJac(F, L, v3.add(F.p[L], r3.apply(F.R[L], local)));
  },
  fk(q) {
    const F = pandaFK(q);
    const R = r3.mul(F.R[7], r3.rotZ(-Math.PI / 4));
    return { pos: v3.add(F.p[7], r3.apply(F.R[7], [0, 0, TCP_OFFSET])), R };
  },
  jacobian(q) {
    const F = pandaFK(q);
    const pt = v3.add(F.p[7], r3.apply(F.R[7], [0, 0, TCP_OFFSET]));
    const J = new Mat(6, 7);
    for (let j = 1; j <= 7; j++) {
      const c = v3.cross(F.z[j], v3.sub(pt, F.p[j]));
      for (let i = 0; i < 3; i++) {
        J.set(i, j - 1, c[i]);
        J.set(i + 3, j - 1, F.z[j][i]);
      }
    }
    return J;
  },
  dragStiffness: () => 400,
  envBoxes: boxesFromParams,
};
