import { EXAMPLES } from '../../core/blocks/examples';
import { TUTORIALS } from '../../core/tutorials';
import type { TutorialAction } from '../../core/tutorials/types';
import type { SystemId } from '../../core/types';
import { toast } from '../common';
import { useT } from '../i18n';
import { useRt } from '../runtimeCtx';
import { useApp } from '../store';
import { EquationField } from './EquationField';
import { Markdown } from './Markdown';

export function TutorialPanel({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  const tut = TUTORIALS[system];
  const step = useApp((s) => s.systems[system].step);
  const results = useApp((s) => s.systems[system].results);
  const guided = useApp((s) => s.guided);
  const setStep = useApp((s) => s.setStep);
  const setModel = useApp((s) => s.setModel);
  const patchParams = useApp((s) => s.patchParams);

  const stepDone = (i: number) => (tut.steps[i].fields ?? []).every((f) => results[f.id]?.status === 'correct');
  const unlocked = (i: number) => !guided || tut.steps.slice(0, i).every((_, k) => stepDone(k));
  const cur = Math.min(step, tut.steps.length - 1);
  const s = tut.steps[cur];

  const runAction = (a: TutorialAction) => {
    if (a.type === 'loadExample') {
      const ex = EXAMPLES.find((e) => e.id === a.exampleId);
      if (ex && confirm(t('confirmLoad'))) {
        setModel(system, JSON.parse(JSON.stringify(ex.model)));
        toast(`✔ ${t.l(ex.name)}`);
      }
    } else if (a.type === 'setParams') {
      patchParams(system, a.params);
      setTimeout(() => rt.reset(), 50);
      toast(`✔ ${t('applied')}`);
    } else if (a.type === 'enableGhost') {
      if (rt.hasGhostModel()) {
        rt.setGhostEnabled(true);
        rt.reset();
        toast('👻 ✔');
      } else toast(t('ghostUnavailable'));
    }
  };

  return (
    <div>
      <div className="tut-nav">
        <button disabled={cur === 0} onClick={() => setStep(system, cur - 1)} title={t('prev')}>
          ‹
        </button>
        <select value={cur} onChange={(e) => setStep(system, Number(e.target.value))}>
          {tut.steps.map((st, i) => (
            <option key={st.id} value={i} disabled={!unlocked(i)}>
              {stepDone(i) && (st.fields?.length ?? 0) > 0 ? '✅ ' : unlocked(i) ? '' : '🔒 '}
              {t.l(st.title)}
            </option>
          ))}
        </select>
        <button disabled={cur >= tut.steps.length - 1 || !unlocked(cur + 1)} onClick={() => setStep(system, cur + 1)} title={unlocked(cur + 1) ? t('next') : t('locked')}>
          ›
        </button>
      </div>
      <div className="panel-pad">
        <div className="muted small">
          {t('stepOf')} {cur + 1} / {tut.steps.length}
        </div>
        <h2 className="tut-title">{t.l(s.title)}</h2>
        <Markdown text={t.l(s.body)} />
        {(s.fields ?? []).map((f) => (
          <EquationField key={f.id} system={system} field={f} />
        ))}
        {s.actions && (
          <div className="tut-actions">
            {s.actions.map((a, i) => (
              <button key={i} onClick={() => runAction(a)} style={{ justifyContent: 'flex-start' }}>
                {a.type === 'loadExample' ? '📂' : a.type === 'setParams' ? '⚙' : '👻'} {t.l(a.label)}
              </button>
            ))}
          </div>
        )}
        {s.after && <Markdown text={t.l(s.after)} />}
        <div className="row" style={{ marginTop: 16 }}>
          <button disabled={cur === 0} onClick={() => setStep(system, cur - 1)}>
            ‹ {t('prev')}
          </button>
          <span className="spacer" />
          {guided && !unlocked(cur + 1) && cur < tut.steps.length - 1 && <span className="muted small">🔒 {t('locked')}</span>}
          <button className="primary" disabled={cur >= tut.steps.length - 1 || !unlocked(cur + 1)} onClick={() => setStep(system, cur + 1)}>
            {t('next')} ›
          </button>
        </div>
      </div>
    </div>
  );
}
