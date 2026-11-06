import katex from 'katex';
import { memo, useEffect, useState } from 'react';
import type { Lang } from '../core/types';
import { useApp } from './store';

export const Tex = memo(function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  let html = '';
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false });
  } catch {
    html = tex;
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** text with $...$ inline math */
export function TexText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('$') && p.endsWith('$') && p.length > 2 ? <Tex key={i} tex={p.slice(1, -1)} /> : <span key={i}>{p}</span>))}
    </>
  );
}

export function LangSwitch() {
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  return (
    <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} title="Language / Taal" style={{ width: 'auto' }}>
      <option value="en">🇬🇧 English</option>
      <option value="nl">🇳🇱 Nederlands</option>
    </select>
  );
}

export function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    inp.click();
  });
}

let toastSetter: ((s: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSetter?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast">{msg}</div> : null;
}

export function Modal({ title, onClose, children, footer }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          {title}
          <span className="spacer" />
          <button className="ghostbtn" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="mbody">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** drag handle for resizable panels */
export function Splitter({ dir, onDrag }: { dir: 'h' | 'v'; onDrag: (delta: number) => void }) {
  return (
    <div
      className={dir === 'h' ? 'splitter-h' : 'splitter-v'}
      onPointerDown={(e) => {
        e.preventDefault();
        let last = dir === 'h' ? e.clientY : e.clientX;
        const move = (ev: PointerEvent) => {
          const cur = dir === 'h' ? ev.clientY : ev.clientX;
          onDrag(cur - last);
          last = cur;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}
