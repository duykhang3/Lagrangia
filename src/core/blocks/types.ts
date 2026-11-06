import type { Value } from '../matlab/interp';
import type { I18n, Params, SystemId, SystemModel } from '../types';

export interface BlockParamSpec {
  key: string;
  label: I18n;
  kind: 'expr' | 'text' | 'select' | 'code' | 'bool';
  default: string | boolean;
  options?: { value: string; label: I18n }[];
  help?: I18n;
}

export interface BlockIO {
  sensor(): { q: number[]; dq: number[] };
  actuate(u: number[]): void;
  target(): number[];
  scope(id: string, t: number, vals: Value[]): void;
  display(id: string, vals: Value[]): void;
  slider(id: string): number | undefined;
  info(id: string, text: string): void;
}

export interface BlockCtx {
  Ts: number;
  model: SystemModel;
  params: Params;
  /** nominal model params used by robotics blocks (e.g. without unknown payload) */
  nominal: Params;
  ws: Record<string, Value>;
  io: BlockIO;
  id: string;
}

export interface BlockInst {
  output(t: number, u: Value[]): Value[];
  update?(t: number, u: Value[]): void;
}

export type BlockCategory = 'sources' | 'math' | 'routing' | 'dynamics' | 'control' | 'robotics' | 'user' | 'sinks';

export interface BlockDef {
  type: string;
  category: BlockCategory;
  name: I18n;
  desc: I18n;
  params: BlockParamSpec[];
  ports(p: Record<string, any>): { in: string[]; out: string[] };
  feedthrough?: (p: Record<string, any>) => boolean;
  create(p: Record<string, any>, ctx: BlockCtx): BlockInst;
  systems?: SystemId[];
  /** short label drawn on the block face (LaTeX allowed when it starts with '$') */
  face?: (p: Record<string, any>) => string;
  /** hidden from palette (e.g. inport/outport outside subsystems) */
  hidden?: boolean;
}

export interface DiagramNode {
  id: string;
  type: string;
  x: number;
  y: number;
  name?: string;
  params: Record<string, any>;
}
export interface DiagramEdge {
  id: string;
  source: string;
  sourcePort: number;
  target: string;
  targetPort: number;
}
export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
export interface Model {
  diagram: Diagram;
  initScript: string;
  Ts: number;
}
