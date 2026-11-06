import type { Params, SystemId, SystemModel } from '../types';
import { cartpole } from './cartpole';
import { furuta } from './furuta';
import { panda } from './panda';
import { defaultsFromSpecs } from './common';

export const SYSTEMS: Record<SystemId, SystemModel> = { cartpole, furuta, panda };
export const SYSTEM_IDS: SystemId[] = ['cartpole', 'furuta', 'panda'];

export function defaultParams(id: SystemId): Params {
  return defaultsFromSpecs(SYSTEMS[id].paramSpecs);
}

/** Numeric value of all params plus derived quantities, used as variables in controllers & checks */
export function paramScope(model: SystemModel, p: Params): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of model.paramSpecs) {
    const v = p[s.key];
    if (typeof v === 'number') out[s.key] = v;
    else if (typeof v === 'boolean') out[s.key] = v ? 1 : 0;
  }
  Object.assign(out, model.derived(p));
  return out;
}
