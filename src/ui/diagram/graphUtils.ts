import { defaultBlockParams } from '../../core/blocks/library';
import type { Diagram, DiagramEdge, DiagramNode } from '../../core/blocks/types';

let counter = 0;
export const uid = (p = 'b') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function getLevel(root: Diagram, path: string[]): Diagram | null {
  let d: Diagram = root;
  for (const id of path) {
    const n = d.nodes.find((x) => x.id === id && x.type === 'subsystem');
    if (!n) return null;
    d = n.params.diagram ?? { nodes: [], edges: [] };
  }
  return d;
}

export function setLevel(root: Diagram, path: string[], level: Diagram): Diagram {
  if (!path.length) return level;
  const [head, ...rest] = path;
  return {
    ...root,
    nodes: root.nodes.map((n) => (n.id === head ? { ...n, params: { ...n.params, diagram: setLevel(n.params.diagram ?? { nodes: [], edges: [] }, rest, level) } } : n)),
  };
}

export function groupIntoSubsystem(level: Diagram, selected: Set<string>, name: string): Diagram {
  const inside = level.nodes.filter((n) => selected.has(n.id));
  if (inside.length < 1) return level;
  const subId = uid('sub');
  const minX = Math.min(...inside.map((n) => n.x)),
    minY = Math.min(...inside.map((n) => n.y));
  const cx = inside.reduce((s, n) => s + n.x, 0) / inside.length,
    cy = inside.reduce((s, n) => s + n.y, 0) / inside.length;
  const innerNodes: DiagramNode[] = inside.map((n) => ({ ...n, x: n.x - minX + 200, y: n.y - minY + 40 }));
  const innerEdges: DiagramEdge[] = level.edges.filter((e) => selected.has(e.source) && selected.has(e.target));
  const inEdges = level.edges.filter((e) => !selected.has(e.source) && selected.has(e.target));
  const outEdges = level.edges.filter((e) => selected.has(e.source) && !selected.has(e.target));
  const outer: DiagramEdge[] = level.edges.filter((e) => !selected.has(e.source) && !selected.has(e.target));
  // inports: one per external source signal
  const inKeys: string[] = [];
  for (const e of inEdges) {
    const k = `${e.source}:${e.sourcePort}`;
    if (!inKeys.includes(k)) inKeys.push(k);
  }
  inKeys.forEach((k, i) => {
    const id = uid('in');
    innerNodes.push({ id, type: 'inport', x: 20, y: 40 + i * 80, name: `In${i + 1}`, params: { ...defaultBlockParams('inport'), index: String(i + 1) } });
    for (const e of inEdges.filter((x) => `${x.source}:${x.sourcePort}` === k)) innerEdges.push({ id: uid('e'), source: id, sourcePort: 0, target: e.target, targetPort: e.targetPort });
    const [src, sp] = k.split(':');
    outer.push({ id: uid('e'), source: src, sourcePort: Number(sp), target: subId, targetPort: i });
  });
  const outKeys: string[] = [];
  for (const e of outEdges) {
    const k = `${e.source}:${e.sourcePort}`;
    if (!outKeys.includes(k)) outKeys.push(k);
  }
  const maxX = Math.max(...innerNodes.map((n) => n.x));
  outKeys.forEach((k, j) => {
    const id = uid('out');
    const [src, sp] = k.split(':');
    innerNodes.push({ id, type: 'outport', x: maxX + 220, y: 40 + j * 80, name: `Out${j + 1}`, params: { ...defaultBlockParams('outport'), index: String(j + 1) } });
    innerEdges.push({ id: uid('e'), source: src, sourcePort: Number(sp), target: id, targetPort: 0 });
    for (const e of outEdges.filter((x) => `${x.source}:${x.sourcePort}` === k)) outer.push({ id: uid('e'), source: subId, sourcePort: j, target: e.target, targetPort: e.targetPort });
  });
  const sub: DiagramNode = { id: subId, type: 'subsystem', x: cx, y: cy, name, params: { diagram: { nodes: innerNodes, edges: innerEdges } } };
  return { nodes: [...level.nodes.filter((n) => !selected.has(n.id)), sub], edges: outer };
}
