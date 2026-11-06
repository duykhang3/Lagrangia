import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultModel } from '../core/blocks/examples';
import type { Model } from '../core/blocks/types';
import type { CheckResult } from '../core/latex/checker';
import { defaultParams, SYSTEM_IDS } from '../core/systems';
import type { Lang, Params, SystemId } from '../core/types';

export interface SystemWS {
  params: Params;
  model: Model;
  fields: Record<string, string>;
  results: Record<string, CheckResult>;
  step: number;
  realistic: boolean;
}

export interface AppState {
  lang: Lang;
  guided: boolean;
  latexMode: 'visual' | 'raw';
  current: SystemId | null;
  systems: Record<SystemId, SystemWS>;
  setLang(l: Lang): void;
  setGuided(b: boolean): void;
  setLatexMode(m: 'visual' | 'raw'): void;
  open(s: SystemId | null): void;
  setParams(s: SystemId, p: Params): void;
  patchParams(s: SystemId, p: Params): void;
  resetParams(s: SystemId): void;
  setModel(s: SystemId, m: Model): void;
  setField(s: SystemId, id: string, v: string): void;
  setResult(s: SystemId, id: string, r: CheckResult | null): void;
  setStep(s: SystemId, n: number): void;
  setRealistic(s: SystemId, b: boolean): void;
  importAll(data: any): void;
  resetAll(): void;
}

export function freshWS(s: SystemId): SystemWS {
  return { params: defaultParams(s), model: defaultModel(s), fields: {}, results: {}, step: 0, realistic: false };
}

const freshSystems = () => Object.fromEntries(SYSTEM_IDS.map((s) => [s, freshWS(s)])) as Record<SystemId, SystemWS>;

const browserLang = (): Lang => (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('nl') ? 'nl' : 'en');

export const useApp = create<AppState>()(
  persist(
    (set) => {
      const upd = (s: SystemId, f: (w: SystemWS) => Partial<SystemWS>) =>
        set((st) => ({ systems: { ...st.systems, [s]: { ...st.systems[s], ...f(st.systems[s]) } } }));
      return {
        lang: browserLang(),
        guided: false,
        latexMode: 'visual',
        current: null,
        systems: freshSystems(),
        setLang: (lang) => set({ lang }),
        setGuided: (guided) => set({ guided }),
        setLatexMode: (latexMode) => set({ latexMode }),
        open: (current) => set({ current }),
        setParams: (s, p) => upd(s, () => ({ params: p })),
        patchParams: (s, p) => upd(s, (w) => ({ params: { ...w.params, ...p } })),
        resetParams: (s) => upd(s, () => ({ params: defaultParams(s) })),
        setModel: (s, model) => upd(s, () => ({ model })),
        setField: (s, id, v) => upd(s, (w) => ({ fields: { ...w.fields, [id]: v } })),
        setResult: (s, id, r) =>
          upd(s, (w) => {
            const results = { ...w.results };
            if (r) results[id] = r;
            else delete results[id];
            return { results };
          }),
        setStep: (s, step) => upd(s, () => ({ step })),
        setRealistic: (s, realistic) => upd(s, () => ({ realistic })),
        importAll: (data) =>
          set((st) => {
            const systems = { ...st.systems };
            for (const s of SYSTEM_IDS) if (data?.systems?.[s]) systems[s] = { ...freshWS(s), ...data.systems[s], params: { ...defaultParams(s), ...data.systems[s].params } };
            return { systems, lang: data?.lang ?? st.lang, guided: data?.guided ?? st.guided };
          }),
        resetAll: () => set({ systems: freshSystems() }),
      };
    },
    {
      name: 'lagrangia-v1',
      version: 1,
      partialize: (s) => ({ lang: s.lang, guided: s.guided, latexMode: s.latexMode, systems: s.systems, current: s.current }),
      merge: (persisted: any, current) => {
        const systems = { ...current.systems };
        for (const s of SYSTEM_IDS) {
          const p = persisted?.systems?.[s];
          if (p) systems[s] = { ...freshWS(s), ...p, params: { ...defaultParams(s), ...p.params } };
        }
        return { ...current, ...persisted, systems };
      },
    },
  ),
);
