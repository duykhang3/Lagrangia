import type { Mat, V3 } from './linalg';

export type Lang = 'en' | 'nl';
export interface I18n {
  en: string;
  nl: string;
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

export type ParamGroup = 'physical' | 'friction' | 'environment' | 'contact' | 'actuator' | 'sensing' | 'initial' | 'interaction';

export interface ParamSpec {
  key: string;
  group: ParamGroup;
  label: I18n;
  /** LaTeX symbol shown next to the label */
  symbol?: string;
  unit?: string;
  kind?: 'number' | 'bool' | 'select';
  options?: { value: string; label: I18n }[];
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  help?: I18n;
}

export type SystemId = 'cartpole' | 'furuta' | 'panda';

export interface BodyPick {
  body: string;
  /** point in body-local coordinates */
  local: V3;
}

export interface EnvBox {
  center: V3;
  half: V3;
}

export interface SystemModel {
  id: SystemId;
  name: I18n;
  n: number;
  nu: number;
  dt: number;
  integrator: 'rk4' | 'semi-implicit';
  substeps: number;
  qNames: string[];
  qLatex: string[];
  uNames: string[];
  revolute: boolean[];
  paramSpecs: ParamSpec[];
  /** quantities computed from params (e.g. J_0) that are also available to controllers/checks */
  derived(p: Params): Record<string, number>;
  initialState(p: Params): { q: number[]; dq: number[] };
  massMatrix(q: number[], p: Params): Mat;
  /** C(q,qd) qd */
  coriolis(q: number[], dq: number[], p: Params): number[];
  /** g(q) such that M qdd + C qd + g = tau */
  gravity(q: number[], p: Params): number[];
  /** maps the (saturated) input u to generalized forces */
  inputMap(u: number[], p: Params): number[];
  /** friction, drag, contacts, joint limits: generalized forces acting on the system */
  passiveForces(q: number[], dq: number[], p: Params, out?: { contacts?: ContactInfo[] }): number[];
  bodyPoint(q: number[], body: string, local: V3, p: Params): V3;
  bodyLocal(q: number[], body: string, world: V3, p: Params): V3;
  pointJacobian(q: number[], body: string, local: V3, p: Params): Mat;
  /** end-effector / tip */
  fk?(q: number[], p: Params): { pos: V3; R: number[] };
  jacobian?(q: number[], p: Params): Mat;
  /** equilibrium for linearization (upright) */
  equilibrium?(p: Params): { q: number[]; dq: number[]; u: number[] };
  /** characteristic scale used for interaction spring */
  dragStiffness(p: Params): number;
  envBoxes?(p: Params): EnvBox[];
}

export interface ContactInfo {
  point: V3;
  normal: V3;
  force: V3;
}
