import { useEffect, useState } from 'react';
import { SYSTEMS } from '../../core/systems';
import type { ParamGroup, ParamSpec, SystemId } from '../../core/types';
import { Tex } from '../common';
import { useT } from '../i18n';
import { useRt } from '../runtimeCtx';
import { useApp } from '../store';

const ORDER: ParamGroup[] = ['physical', 'friction', 'environment', 'contact', 'actuator', 'sensing', 'initial'];

function NumberParam({ spec, value, onChange }: { spec: ParamSpec; value: number; onChange: (v: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const hasRange = spec.min !== undefined && spec.max !== undefined;
  return (
    <>
      <input
        type="number"
        value={txt}
        step={spec.step ?? 'any'}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = parseFloat(e.target.value);
          if (isFinite(v)) onChange(v);
        }}
      />
      {hasRange && <input type="range" min={spec.min} max={spec.max} step={spec.step ?? (spec.max! - spec.min!) / 200} value={value} onChange={(e) => onChange(Number(e.target.value))} />}
    </>
  );
}

export function ParamsPanel({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  const params = useApp((s) => s.systems[system].params);
  const patch = useApp((s) => s.patchParams);
  const reset = useApp((s) => s.resetParams);
  const model = SYSTEMS[system];
  const derived = model.derived(params);
  return (
    <div>
      <div className="row panel-pad" style={{ paddingBottom: 4 }}>
        <span className="muted small">{t('saved')}</span>
        <span className="spacer" />
        <button onClick={() => (reset(system), setTimeout(() => rt.reset(), 30))}>⟲ {t('resetDefaults')}</button>
      </div>
      {ORDER.map((g) => {
        const specs = model.paramSpecs.filter((s) => s.group === g);
        if (!specs.length) return null;
        return (
          <details key={g} className="pgroup" open={g !== 'sensing'}>
            <summary>{t.l(t.groups[g])}</summary>
            {specs.map((s) => (
              <div className="prow" key={s.key} title={s.help ? t.l(s.help) : undefined}>
                <span className="plabel">
                  {s.symbol && <Tex tex={s.symbol} />} {t.l(s.label)} {s.unit && <span className="muted">[{s.unit}]</span>} {s.help && <span className="muted">ⓘ</span>}
                </span>
                {s.kind === 'bool' ? (
                  <input type="checkbox" checked={!!params[s.key]} onChange={(e) => patch(system, { [s.key]: e.target.checked })} style={{ justifySelf: 'start' }} />
                ) : s.kind === 'select' ? (
                  <select value={String(params[s.key])} onChange={(e) => patch(system, { [s.key]: e.target.value })}>
                    {s.options!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t.l(o.label)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <NumberParam spec={s} value={Number(params[s.key])} onChange={(v) => patch(system, { [s.key]: v })} />
                )}
              </div>
            ))}
            {g === 'initial' && (
              <div className="panel-pad" style={{ paddingTop: 0 }}>
                <button onClick={() => rt.reset()}>⟲ {t('reset')}</button>
              </div>
            )}
          </details>
        );
      })}
      {Object.keys(derived).length > 0 && (
        <details className="pgroup" open>
          <summary>{t('derived')}</summary>
          <div className="panel-pad mono small">
            {Object.entries(derived).map(([k, v]) => (
              <div key={k}>
                <Tex tex={k} /> = {v.toPrecision(5)}
              </div>
            ))}
            {system === 'furuta' && (
              <div className="muted" style={{ marginTop: 6, fontFamily: 'var(--sans)' }}>
                <Tex tex={String.raw`J_0 = J_h + \tfrac13 m_1L_1^2 + m_2L_1^2,\ \ J_2 = \tfrac13 m_2L_2^2,\ \ l_2 = L_2/2`} />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
