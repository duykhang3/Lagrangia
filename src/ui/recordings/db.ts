import { del, entries, get, set } from 'idb-keyval';
import type { Recording } from '../../core/sim/runtime';

type Listener = () => void;
const listeners = new Set<Listener>();
export const onRecordingsChanged = (f: Listener) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
const emit = () => listeners.forEach((f) => f());

export async function saveRecording(r: Recording) {
  await set(`rec:${r.id}`, r);
  emit();
}
export async function loadRecording(id: string): Promise<Recording | undefined> {
  return get(`rec:${id}`);
}
export async function deleteRecording(id: string) {
  await del(`rec:${id}`);
  emit();
}
export async function listRecordings(system: string): Promise<{ id: string; name: string; created: number; duration: number }[]> {
  const all = await entries<string, Recording>();
  return all
    .filter(([k, v]) => String(k).startsWith('rec:') && v.system === system)
    .map(([, v]) => ({ id: v.id, name: v.name, created: v.created, duration: (v.frames.at(-1)?.t ?? 0) - (v.frames[0]?.t ?? 0) }))
    .sort((a, b) => b.created - a.created);
}

export function recordingToCsv(r: Recording, qNames: string[], uNames: string[]): string {
  const head = ['t', ...qNames, ...qNames.map((n) => `d${n}`), ...uNames];
  const lines = [head.join(',')];
  for (const f of r.frames) lines.push([f.t, ...f.q, ...f.dq, ...f.u].map((v) => +v.toPrecision(8)).join(','));
  return lines.join('\n');
}
