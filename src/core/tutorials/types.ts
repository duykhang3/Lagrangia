import type { FieldDef } from '../latex/checker';
import type { I18n, Params, SystemId } from '../types';

export type TutorialAction =
  | { type: 'loadExample'; exampleId: string; label: I18n }
  | { type: 'setParams'; params: Params; label: I18n }
  | { type: 'enableGhost'; label: I18n };

export interface TutorialStep {
  id: string;
  title: I18n;
  body: I18n;
  fields?: FieldDef[];
  actions?: TutorialAction[];
  /** markdown shown after the fields (exercises) */
  after?: I18n;
}

export interface GhostSpec {
  /** candidate field-id sets, first complete set wins (one equation per generalized coordinate) */
  fieldSets: string[][];
  /** canonical symbol -> state/input slot */
  map: Record<string, ['q' | 'dq' | 'ddq' | 'u', number]>;
}

export interface Tutorial {
  system: SystemId;
  steps: TutorialStep[];
  ghost?: GhostSpec;
}

export const tx = (en: string, nl: string): I18n => ({ en, nl });
