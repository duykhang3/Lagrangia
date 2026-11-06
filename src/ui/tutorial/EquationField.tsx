import { useRef, useState } from 'react';
import { checkField, type FieldDef } from '../../core/latex/checker';
import type { SystemId } from '../../core/types';
import { Tex, TexText } from '../common';
import { useT } from '../i18n';
import { useApp } from '../store';
import { Markdown } from './Markdown';
import { MathField, type MathFieldHandle } from './MathField';

export function EquationField({ system, field }: { system: SystemId; field: FieldDef }) {
  const t = useT();
  const value = useApp((s) => s.systems[system].fields[field.id] ?? '');
  const result = useApp((s) => s.systems[system].results[field.id]) as (ReturnType<typeof checkField> & { checked?: string }) | undefined;
  const setField = useApp((s) => s.setField);
  const setResult = useApp((s) => s.setResult);
  const globalMode = useApp((s) => s.latexMode);
  const setLatexMode = useApp((s) => s.setLatexMode);
  const [mode, setMode] = useState<'visual' | 'raw' | null>(null);
  const m = mode ?? globalMode;
  const [showHint, setShowHint] = useState(false);
  const [showSol, setShowSol] = useState(false);
  const mf = useRef<MathFieldHandle>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const check = () => {
    if (!value.trim()) {
      setResult(system, field.id, { status: 'error', messages: [{ en: t('emptyField'), nl: t('emptyField') }], checked: value } as any);
      return;
    }
    let res;
    try {
      res = checkField(field, value);
    } catch (e) {
      res = { status: 'error' as const, messages: [{ en: (e as Error).message, nl: (e as Error).message }] };
    }
    setResult(system, field.id, { ...res, checked: value } as any);
  };

  const insert = (tex: string) => {
    if (m === 'visual') mf.current?.insert(tex);
    else {
      const el = ta.current;
      if (!el) return;
      const s = el.selectionStart,
        e = el.selectionEnd;
      const v = value.slice(0, s) + tex + value.slice(e);
      setField(system, field.id, v);
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = s + tex.length;
      });
    }
  };

  const status = result?.status;
  const stale = result && result.checked !== undefined && result.checked !== value;

  return (
    <div className={`field ${status ?? ''}`}>
      <div className="flabel">
        <span>{status === 'correct' ? '✅' : status === 'incorrect' ? '❌' : status === 'error' ? '⚠️' : '◻️'}</span>
        <span>{t.l(field.label)}</span>
        <span className="spacer" />
        <div className="row" style={{ gap: 2 }}>
          <button className={m === 'visual' ? 'active' : 'ghostbtn'} style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => (setMode('visual'), setLatexMode('visual'))}>
            {t('visual')}
          </button>
          <button className={m === 'raw' ? 'active' : 'ghostbtn'} style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => (setMode('raw'), setLatexMode('raw'))}>
            {t('rawLatex')}
          </button>
        </div>
      </div>
      <div className="inputrow">
        {field.prefix && <Tex className="prefix" tex={field.prefix} />}
        {m === 'visual' ? (
          <MathField ref={mf} value={value} onChange={(v) => setField(system, field.id, v)} onEnter={check} />
        ) : (
          <textarea
            ref={ta}
            className="raw"
            spellCheck={false}
            value={value}
            placeholder={field.kind === 'equation' ? 'lhs = rhs' : '\\frac{1}{2} m \\dot{x}^2'}
            onChange={(e) => setField(system, field.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) check();
            }}
          />
        )}
      </div>
      {m === 'raw' && value.trim() && (
        <div className="preview">
          <Tex tex={(field.prefix ? field.prefix + ' ' : '') + value} display />
        </div>
      )}
      <div className="palette" title={t('symbols')}>
        {field.symbols
          .filter((s) => !s.alias)
          .map((s) => (
            <button key={s.tex} onClick={() => insert(s.tex)} title={s.desc ? t.l(s.desc) : s.tex}>
              <Tex tex={s.tex} />
            </button>
          ))}
        {[String.raw`\frac{\placeholder{}}{\placeholder{}}`, '\\sin', '\\cos', '^{2}', '\\operatorname{sign}'].map((x) => (
          <button key={x} onClick={() => insert(m === 'raw' ? x.replace(/\\placeholder\{\}/g, '') : x)} title={x}>
            <Tex tex={x.replace(/\\placeholder\{\}/g, '\\square').replace('^{2}', '\\square^2')} />
          </button>
        ))}
        {field.symbols.some((s) => s.kind === 'mat' || s.kind === 'spd' || s.kind === 'diag' || s.kind === 'symm' || s.kind === 'vec') && (
          <button onClick={() => insert('^T')} title="transpose">
            <Tex tex="\square^T" />
          </button>
        )}
        {field.symbols.some((s) => s.kind === 'mat' || s.kind === 'spd' || s.kind === 'symm') && (
          <button onClick={() => insert('^{-1}')} title="inverse">
            <Tex tex="\square^{-1}" />
          </button>
        )}
      </div>
      <div className="actions">
        <button className="primary" onClick={check}>
          ✓ {t('check')}
        </button>
        <button onClick={() => setShowHint((x) => !x)}>💡 {t('hint')}</button>
        <button onClick={() => setShowSol((x) => !x)}>👁 {t('solution')}</button>
        {stale && <span className="muted small">({t('notChecked')})</span>}
      </div>
      {showHint && (
        <div className="solution">
          <Markdown text={t.l(field.hint)} />
        </div>
      )}
      {showSol && (
        <div className="solution">
          <Tex tex={(field.prefix ? field.prefix + ' ' : '') + field.ref} display />
          <button style={{ marginTop: 4 }} onClick={() => setField(system, field.id, field.ref)}>
            ⤵ {t('useSolution')}
          </button>
        </div>
      )}
      {result && (
        <div className={`result ${result.status}`}>
          {result.messages.map((msg, i) => (
            <div key={i}>
              <TexText text={t.l(msg)} /> {msg.tex && <Tex tex={msg.tex} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
