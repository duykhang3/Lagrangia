import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Runtime } from '../core/sim/runtime';

export const RtCtx = createContext<Runtime>(null!);
export const useRt = () => useContext(RtCtx);

export function useRtVersion(rt: Runtime) {
  return useSyncExternalStore(
    (cb) => {
      const un = rt.subscribe(cb);
      return () => void un();
    },
    () => rt.version,
  );
}

/** re-render periodically (for live numbers) */
export function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
