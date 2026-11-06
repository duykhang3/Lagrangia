import { useEffect, useRef } from 'react';
import { exportMatlab } from '../core/export/matlab';
import { SYSTEMS } from '../core/systems';
import type { SystemId } from '../core/types';
import { download, LangSwitch, toast } from './common';
import { useT } from './i18n';
import { saveRecording } from './recordings/db';
import { useRt, useRtVersion } from './runtimeCtx';
import { useApp } from './store';

function Clock() {
  const rt = useRt();
  const ref = useRef<HTMLSpanElement>(null);
  const t = useT();
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (ref.current) {
        const time = rt.replay ? rt.replay.t : rt.sim.t;
        const rtf = rt.playing ? ` · ${(rt.realtimeFactor * 100).toFixed(0)}% ${t('rtf')}` : '';
        ref.current.textContent = `t = ${time.toFixed(3)} s${rtf}`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rt, t]);
  return <span className="time" ref={ref} />;
}

export function Toolbar({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  useRtVersion(rt);
  const open = useApp((s) => s.open);
  const guided = useApp((s) => s.guided);
  const setGuided = useApp((s) => s.setGuided);
  const realistic = useApp((s) => s.systems[system].realistic);
  const setRealistic = useApp((s) => s.setRealistic);
  const model = useApp((s) => s.systems[system].model);
  const params = useApp((s) => s.systems[system].params);

  const kick = () => {
    const p = rt.params;
    if (system === 'cartpole') rt.sim.kick('pole', [Number(p.l), 0, 0], [8 * (Math.random() > 0.5 ? 1 : -1), 0, 0], 0.08);
    else if (system === 'furuta') rt.sim.kick('pendulum', [Number(p.L_2), 0, 0], [0, 0.6 * (Math.random() > 0.5 ? 1 : -1), 0], 0.08);
    else rt.sim.kick('link7', [0, 0, 0.2], [0, 60 * (Math.random() > 0.5 ? 1 : -1), 20], 0.12);
  };

  const toggleRecord = async () => {
    if (rt.recording) {
      const rec = rt.stopRecording();
      if (rec && rec.frames.length > 1) {
        await saveRecording(rec);
        toast(`✔ ${rec.name}`);
      }
    } else {
      const d = new Date();
      rt.startRecording(`${t('recName')} ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`);
      if (!rt.playing) rt.start();
    }
  };

  const ghostAvailable = rt.hasGhostModel();

  return (
    <div className="toolbar">
      <button onClick={() => (rt.pause(), open(null))} title={t('backToMenu')}>
        ← {t('backToMenu')}
      </button>
      <span className="title">{t.l(SYSTEMS[system].name)}</span>
      <div className="sep" />
      {rt.playing ? (
        <button className="active" onClick={() => rt.pause()}>
          ⏸ {t('pause')}
        </button>
      ) : (
        <button className="primary" onClick={() => rt.start()} disabled={!!rt.simError}>
          ▶ {t('play')}
        </button>
      )}
      <button onClick={() => rt.stepOnce()} disabled={rt.playing} title={t('step')}>
        ⏭
      </button>
      <button onClick={() => rt.reset()} title={t('reset')}>
        ⟲ {t('reset')}
      </button>
      <select value={rt.speed} onChange={(e) => ((rt.speed = Number(e.target.value)), rt.notify())} title={t('speed')} style={{ width: 'auto' }}>
        {[0.1, 0.25, 0.5, 1, 2].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <Clock />
      <div className="sep" />
      <label title={t('controllerOn')}>
        <input type="checkbox" checked={rt.controllerOn} onChange={(e) => ((rt.controllerOn = e.target.checked), rt.notify())} />
        {t('controller')}
      </label>
      <label title={t('realisticHelp')}>
        <input type="checkbox" checked={realistic} onChange={(e) => setRealistic(system, e.target.checked)} />
        {t('realistic')}
      </label>
      {system !== 'panda' && (
        <label title={ghostAvailable ? t('ghostHelp') : t('ghostUnavailable')} style={{ opacity: ghostAvailable ? 1 : 0.5 }}>
          <input type="checkbox" disabled={!ghostAvailable} checked={rt.ghostEnabled && ghostAvailable} onChange={(e) => rt.setGhostEnabled(e.target.checked)} />
          👻 {t('ghost')}
        </label>
      )}
      <button onClick={kick} title={t('kick')}>
        💥 {t('kick')}
      </button>
      <div className="sep" />
      <button className={rt.recording ? 'active' : ''} onClick={toggleRecord} title={rt.recording ? t('stopRecording') : t('record')}>
        {rt.recording ? <span className="recdot" /> : '⏺'} {rt.recording ? t('stopRecording') : t('record')}
      </button>
      <button
        onClick={() => {
          download(`lagrangia_${system}_controller.m`, exportMatlab(system, model, params));
          toast(t('exportedMatlab'));
        }}
        title={t('exportMatlab')}
      >
        ⤓ {t('exportMatlab')}
      </button>
      <span className="spacer" />
      <label title={t('guidedHelp')}>
        <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} />
        {t('guided')}
      </label>
      <LangSwitch />
    </div>
  );
}
