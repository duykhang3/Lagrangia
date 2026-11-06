import { MathfieldElement } from 'mathlive';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

MathfieldElement.fontsDirectory = import.meta.env.BASE_URL + 'mathlive-fonts';
MathfieldElement.soundsDirectory = null;

export interface MathFieldHandle {
  insert(tex: string): void;
}

export const MathField = forwardRef<MathFieldHandle, { value: string; onChange: (v: string) => void; onEnter?: () => void; placeholder?: string }>(function MathField(
  { value, onChange, onEnter, placeholder },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const mf = useRef<MathfieldElement | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const enter = useRef(onEnter);
  enter.current = onEnter;

  useEffect(() => {
    const el = new MathfieldElement();
    el.mathVirtualKeyboardPolicy = 'manual';
    el.smartFence = true;
    el.smartSuperscript = true;
    if (placeholder) el.setAttribute('placeholder', placeholder);
    el.value = value;
    el.addEventListener('input', () => cb.current(el.getValue('latex')));
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && ((e as KeyboardEvent).ctrlKey || (e as KeyboardEvent).metaKey)) enter.current?.();
    });
    host.current!.appendChild(el);
    mf.current = el;
    return () => {
      el.remove();
      mf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = mf.current;
    if (el && el.getValue('latex') !== value) el.setValue(value, { silenceNotifications: true });
  }, [value]);

  useImperativeHandle(ref, () => ({
    insert(tex: string) {
      const el = mf.current;
      if (!el) return;
      el.focus();
      el.insert(tex, { format: 'latex', focus: true, insertionMode: 'replaceSelection' });
      cb.current(el.getValue('latex'));
    },
  }));

  return <div ref={host} style={{ flex: 1, minWidth: 0, display: 'flex' }} />;
});
