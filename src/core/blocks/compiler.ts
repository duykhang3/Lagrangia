import type { Value } from '../matlab/interp';
import { BLOCK_MAP } from './library';
import type { BlockCtx, BlockInst, Diagram, DiagramEdge } from './types';

export interface FlatNode {
  id: string;
  type: string;
  name: string;
  params: Record<string, any>;
}

export interface CompileIssue {
  nodeId?: string;
  msg: string;
}

interface CBlock {
  node: FlatNode;
  inst: BlockInst;
  feed: boolean;
  nIn: number;
  nOut: number;
  inputs: ({ b: number; port: number } | null)[];
  out: Value[];
  key: string;
}

export function blockLabel(type: string, name?: string) {
  return name || BLOCK_MAP[type]?.name.en || type;
}

/** Flattens subsystems: inner blocks get ids "sub/inner"; in/out ports become pass-through blocks. */
export function flatten(d: Diagram, prefix = '', namePrefix = '', depth = 0): { nodes: FlatNode[]; edges: DiagramEdge[]; issues: CompileIssue[] } {
  if (depth > 8) return { nodes: [], edges: [], issues: [{ msg: 'Subsystems nested too deeply' }] };
  const nodes: FlatNode[] = [];
  const edges: DiagramEdge[] = [];
  const issues: CompileIssue[] = [];
  const subIn = new Map<string, Map<number, string>>(); // subsystem id -> port index -> flat inport id
  const subOut = new Map<string, Map<number, string>>();
  for (const n of d.nodes) {
    const id = prefix + n.id;
    const name = namePrefix + (n.name || blockLabel(n.type));
    if (!BLOCK_MAP[n.type]) {
      issues.push({ nodeId: id, msg: `Unknown block type '${n.type}'` });
      continue;
    }
    if (n.type === 'subsystem') {
      const inner = n.params?.diagram ?? { nodes: [], edges: [] };
      const f = flatten(inner, id + '/', name + '/', depth + 1);
      nodes.push(...f.nodes);
      edges.push(...f.edges);
      issues.push(...f.issues);
      const ins = new Map<number, string>(),
        outs = new Map<number, string>();
      const sortedIn = inner.nodes.filter((x: any) => x.type === 'inport').sort((a: any, b: any) => Number(a.params.index) - Number(b.params.index));
      const sortedOut = inner.nodes.filter((x: any) => x.type === 'outport').sort((a: any, b: any) => Number(a.params.index) - Number(b.params.index));
      sortedIn.forEach((x: any, i: number) => ins.set(i, id + '/' + x.id));
      sortedOut.forEach((x: any, i: number) => outs.set(i, id + '/' + x.id));
      subIn.set(id, ins);
      subOut.set(id, outs);
      continue;
    }
    if ((n.type === 'inport' || n.type === 'outport') && depth === 0) {
      issues.push({ nodeId: id, msg: 'In/Out port blocks can only be used inside a subsystem' });
      continue;
    }
    nodes.push({ id, type: n.type, name, params: n.params ?? {} });
  }
  for (const e of d.edges) {
    let source = prefix + e.source,
      sourcePort = e.sourcePort,
      target = prefix + e.target,
      targetPort = e.targetPort;
    if (subOut.has(source)) {
      const s = subOut.get(source)!.get(sourcePort);
      if (!s) continue;
      source = s;
      sourcePort = 0;
    }
    if (subIn.has(target)) {
      const t = subIn.get(target)!.get(targetPort);
      if (!t) continue;
      target = t;
      targetPort = 0;
    }
    edges.push({ id: prefix + e.id, source, sourcePort, target, targetPort });
  }
  return { nodes, edges, issues };
}

export class Program {
  blocks: CBlock[] = [];
  errors: CompileIssue[] = [];
  warnings: CompileIssue[] = [];
  runtimeError: CompileIssue | null = null;
  hasActuator = false;
  hasTarget = false;
  /** blocks providing interactive/visual state */
  byId = new Map<string, CBlock>();

  step(t: number) {
    if (this.runtimeError) return;
    const bs = this.blocks;
    let cur: CBlock | null = null;
    try {
      for (cur of bs) {
        const ins = cur.inputs.map((src) => (src ? bs[src.b].out[src.port] ?? 0 : 0));
        cur.out = cur.inst.output(t, ins);
        if (cur.out.length < cur.nOut) throw new Error(`Block produced ${cur.out.length} outputs, expected ${cur.nOut}`);
      }
      for (cur of bs) {
        if (!cur.inst.update) continue;
        const ins = cur.inputs.map((src) => (src ? bs[src.b].out[src.port] ?? 0 : 0));
        cur.inst.update(t, ins);
      }
    } catch (e) {
      this.runtimeError = { nodeId: cur?.node.id, msg: `${cur ? `Block "${cur.node.name}": ` : ''}${(e as Error).message}` };
    }
  }

  outputOf(nodeId: string, port: number): Value | undefined {
    return this.byId.get(nodeId)?.out[port];
  }
}

/**
 * Compiles a diagram into an executable, topologically sorted program.
 * `prev` lets unchanged blocks keep their internal state (e.g. integrators) across edits.
 */
export function compile(diagram: Diagram, makeCtx: (nodeId: string) => BlockCtx, wsKey: string, prev?: Program | null): Program {
  const prog = new Program();
  const flat = flatten(diagram);
  prog.errors.push(...flat.issues);
  const index = new Map<string, number>();
  const cblocks: CBlock[] = [];
  const prevMap = new Map<string, CBlock>();
  prev?.blocks.forEach((b) => prevMap.set(b.node.id, b));

  for (const n of flat.nodes) {
    const def = BLOCK_MAP[n.type];
    if (def.systems && !def.systems.includes(makeCtx(n.id).model.id)) {
      prog.errors.push({ nodeId: n.id, msg: `Block "${n.name}" is not available for this system` });
      continue;
    }
    let ports: { in: string[]; out: string[] };
    try {
      ports = def.ports(n.params);
      // flattened subsystem ports are pass-through blocks (1 in, 1 out)
      if (n.type === 'inport' || n.type === 'outport') ports = { in: ['u'], out: ['y'] };
    } catch (e) {
      prog.errors.push({ nodeId: n.id, msg: `Block "${n.name}": ${(e as Error).message}` });
      continue;
    }
    const key = `${n.type}|${JSON.stringify(n.params)}|${wsKey}`;
    const old = prevMap.get(n.id);
    let inst: BlockInst;
    if (old && old.key === key) inst = old.inst;
    else {
      try {
        inst = def.create(n.params, makeCtx(n.id));
      } catch (e) {
        prog.errors.push({ nodeId: n.id, msg: `Block "${n.name}": ${(e as Error).message}` });
        continue;
      }
    }
    if (n.type === 'actuator') {
      if (prog.hasActuator) prog.errors.push({ nodeId: n.id, msg: 'Only one Plant actuator block is allowed' });
      prog.hasActuator = true;
    }
    if (n.type === 'target') prog.hasTarget = true;
    if (n.type === 'matlabfn') {
      const p = def.ports(n.params);
      if (p.out.length === 0) prog.warnings.push({ nodeId: n.id, msg: `Block "${n.name}": function has no outputs` });
    }
    index.set(n.id, cblocks.length);
    cblocks.push({
      node: n,
      inst,
      feed: def.feedthrough ? def.feedthrough(n.params) : true,
      nIn: ports.in.length,
      nOut: ports.out.length,
      inputs: new Array(ports.in.length).fill(null),
      out: new Array(ports.out.length).fill(0),
      key,
    });
  }
  for (const e of flat.edges) {
    const s = index.get(e.source),
      t = index.get(e.target);
    if (s === undefined || t === undefined) continue;
    if (e.targetPort >= cblocks[t].nIn || e.sourcePort >= cblocks[s].nOut) continue;
    if (cblocks[t].inputs[e.targetPort]) prog.errors.push({ nodeId: e.target, msg: `Block "${cblocks[t].node.name}": input ${e.targetPort + 1} has more than one connection` });
    cblocks[t].inputs[e.targetPort] = { b: s, port: e.sourcePort };
  }
  cblocks.forEach((b) =>
    b.inputs.forEach((src, i) => {
      if (!src && b.node.type !== 'inport') prog.warnings.push({ nodeId: b.node.id, msg: `Block "${b.node.name}": input ${i + 1} is not connected (using 0)` });
    }),
  );
  if (!prog.hasActuator) prog.warnings.push({ msg: 'No Plant actuator block: the controller output is not applied (u = 0).' });

  // topological sort; edges into non-feedthrough blocks do not create dependencies
  const indeg = new Array(cblocks.length).fill(0);
  const adj: number[][] = cblocks.map(() => []);
  cblocks.forEach((b, ti) => {
    if (!b.feed) return;
    for (const src of b.inputs)
      if (src) {
        adj[src.b].push(ti);
        indeg[ti]++;
      }
  });
  const order: number[] = [];
  const queue = cblocks.map((_, i) => i).filter((i) => indeg[i] === 0);
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    for (const j of adj[i]) if (--indeg[j] === 0) queue.push(j);
  }
  if (order.length < cblocks.length) {
    const loop = cblocks.filter((_, i) => indeg[i] > 0).map((b) => b.node.name);
    prog.errors.push({ msg: `Algebraic loop detected between: ${loop.join(', ')}. Insert a Unit delay or Integrator to break it.` });
    return prog;
  }
  const remap = new Map<number, number>();
  order.forEach((old, k) => remap.set(old, k));
  prog.blocks = order.map((i) => {
    const b = cblocks[i];
    return { ...b, inputs: b.inputs.map((s) => (s ? { b: remap.get(s.b)!, port: s.port } : null)) };
  });
  prog.blocks.forEach((b) => prog.byId.set(b.node.id, b));
  return prog;
}
