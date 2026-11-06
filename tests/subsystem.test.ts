import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/core/blocks/examples';
import { Runtime } from '../src/core/sim/runtime';
import { SYSTEMS, defaultParams } from '../src/core/systems';
import { groupIntoSubsystem } from '../src/ui/diagram/graphUtils';
import { wrapToPi } from '../src/core/linalg';

describe('subsystems', () => {
  it('grouping LQR + reference into a subsystem keeps the controller working', () => {
    const ex = EXAMPLES.find((e) => e.id === 'cp-lqr')!;
    const model = JSON.parse(JSON.stringify(ex.model));
    model.diagram = groupIntoSubsystem(model.diagram, new Set(['lqr', 'ref']), 'Controller');
    const sub = model.diagram.nodes.find((n: any) => n.type === 'subsystem');
    expect(sub.params.diagram.nodes.filter((n: any) => n.type === 'inport').length).toBe(1);
    expect(sub.params.diagram.nodes.filter((n: any) => n.type === 'outport').length).toBe(1);
    const rt = new Runtime(SYSTEMS.cartpole, defaultParams('cartpole'), model);
    expect(rt.program!.errors).toEqual([]);
    for (let i = 0; i < 50; i++) rt.advance(0.1, 1e9);
    expect(Math.abs(wrapToPi(rt.sim.q[1]))).toBeLessThan(0.01);
  });
  it('detects algebraic loops', () => {
    const model = { Ts: 0.001, initScript: '', diagram: { nodes: [
      { id: 'a', type: 'gain', x: 0, y: 0, params: { K: '1', mode: 'matrix' } },
      { id: 'b', type: 'sum', x: 0, y: 0, params: { signs: '+-' } },
    ], edges: [
      { id: 'e1', source: 'a', sourcePort: 0, target: 'b', targetPort: 0 },
      { id: 'e2', source: 'b', sourcePort: 0, target: 'a', targetPort: 0 },
    ] } };
    const rt = new Runtime(SYSTEMS.cartpole, defaultParams('cartpole'), model);
    expect(rt.program!.errors.map((e) => e.msg).join()).toMatch(/Algebraic loop/);
  });
});
