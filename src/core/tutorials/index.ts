import type { SystemId } from '../types';
import { cartpoleTutorial } from './cartpole';
import { furutaTutorial } from './furuta';
import { pandaTutorial } from './panda';
import type { FieldDef } from '../latex/checker';
import { compileResidual, symbolInfo, type Value } from '../latex/checker';
import type { GhostAccel } from '../sim/simulator';
import { Mat, solveVec } from '../linalg';
import type { Tutorial } from './types';

export const TUTORIALS: Record<SystemId, Tutorial> = { cartpole: cartpoleTutorial, furuta: furutaTutorial, panda: pandaTutorial };

export function allFields(sys: SystemId): FieldDef[] {
  return TUTORIALS[sys].steps.flatMap((s) => s.fields ?? []);
}

/** Builds a ghost model from the user's equations of motion (null if not available). */
export function buildGhost(sys: SystemId, fieldValues: Record<string, string>, passed: Record<string, boolean>, scope: Record<string, number>): { fn: GhostAccel; fields: string[] } | { error: string } | null {
  const spec = TUTORIALS[sys].ghost;
  if (!spec) return null;
  const set = spec.fieldSets.find((ids) => ids.every((id) => (fieldValues[id] ?? '').trim() !== ''));
  if (!set) return null;
  try {
    const rows = set.map((id) => compileResidual(fieldValues[id]));
    const fields = allFields(sys);
    // check that only known symbols are used
    const known = new Set<string>();
    for (const id of set) for (const s of symbolInfo(fields.find((f) => f.id === id)!.symbols)) known.add(s.name);
    const n = set.length;
    const base = new Map<string, Value>(Object.entries(scope));
    const fn: GhostAccel = (q, dq, u) => {
      const vals = new Map(base);
      for (const [name, [kind, i]] of Object.entries(spec.map)) {
        if (kind === 'q') vals.set(name, q[i]);
        else if (kind === 'dq') vals.set(name, dq[i]);
        else if (kind === 'u') vals.set(name, u[i] ?? 0);
        else vals.set(name, 0);
      }
      const h = rows.map((r) => r(vals));
      const Mm = new Mat(n, n);
      for (let j = 0; j < n; j++) {
        const key = Object.entries(spec.map).find(([, [k, i]]) => k === 'ddq' && i === j)![0];
        vals.set(key, 1);
        rows.forEach((r, i) => Mm.set(i, j, r(vals) - h[i]));
        vals.set(key, 0);
      }
      return solveVec(Mm, h.map((v) => -v));
    };
    // smoke test
    fn([0.1, 0.2], [0.1, 0.1], [0]);
    void passed;
    return { fn, fields: set };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
