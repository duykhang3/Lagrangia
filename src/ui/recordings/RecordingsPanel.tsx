import { useEffect, useState } from 'react';
import { SYSTEMS } from '../../core/systems';
import type { Recording } from '../../core/sim/runtime';
import type { SystemId } from '../../core/types';
import { download, pickFile, toast } from '../common';
import { useT } from '../i18n';
import { useRt, useRtVersion } from '../runtimeCtx';
import { deleteRecording, listRecordings, loadRecording, onRecordingsChanged, recordingToCsv, saveRecording } from './db';

export function RecordingsPanel({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  useRtVersion(rt);
  const [list, setList] = useState<Awaited<ReturnType<typeof listRecordings>>>([]);
  const refresh = () => listRecordings(system).then(setList, () => setList([]));
  useEffect(() => {
    refresh();
    return onRecordingsChanged(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);
  const m = SYSTEMS[system];
  const withRec = async (id: string, f: (r: Recording) => void) => {
    const r = await loadRecording(id);
    if (r) f(r);
  };
  return (
    <div className="panel-pad">
      {rt.recording && (
        <div className="rec-item" style={{ borderColor: 'var(--err)' }}>
          <span className="recdot" /> {rt.recording.name} — {(rt.recording.frames.length / 100).toFixed(1)} s
        </div>
      )}
      {list.length === 0 && !rt.recording && <p className="muted">{t('noRecordings')}</p>}
      {list.map((r) => (
        <div className="rec-item" key={r.id}>
          <div className="row">
            <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</b>
            <span className="muted small">{r.duration.toFixed(1)} s</span>
          </div>
          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <button className="primary" onClick={() => withRec(r.id, (rec) => rt.startReplay(rec))}>
              ▶ {t('replay')}
            </button>
            <button onClick={() => withRec(r.id, (rec) => download(`${rec.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(rec), 'application/json'))}>⬇ {t('exportJson')}</button>
            <button onClick={() => withRec(r.id, (rec) => download(`${rec.name.replace(/[^\w-]+/g, '_')}.csv`, recordingToCsv(rec, m.qNames, m.uNames), 'text/csv'))}>⬇ {t('exportCsv')}</button>
            <button className="danger" onClick={() => confirm(t('confirmDelete')) && deleteRecording(r.id)}>
              🗑
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={async () => {
          const txt = await pickFile('.json,application/json');
          if (!txt) return;
          try {
            const rec = JSON.parse(txt) as Recording;
            if (!rec.frames || !rec.id) throw new Error('Not a Lagrangia recording');
            if (rec.system !== system) throw new Error(`Recording is for system '${rec.system}'`);
            await saveRecording(rec);
            toast('✔');
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      >
        ⬆ {t('importRec')}
      </button>
    </div>
  );
}
