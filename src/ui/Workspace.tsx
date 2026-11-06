import { useEffect, useMemo, useRef, useState } from 'react';
import { Runtime } from '../core/sim/runtime';
import { paramScope, SYSTEMS } from '../core/systems';
import { buildGhost } from '../core/tutorials';
import type { SystemId } from '../core/types';
import { Splitter, ToastHost } from './common';
import { DiagramEditor } from './diagram/DiagramEditor';
import { useT } from './i18n';
import { ParamsPanel } from './params/ParamsPanel';
import { RecordingsPanel } from './recordings/RecordingsPanel';
import { RtCtx } from './runtimeCtx';
import { ScopePanel } from './scopes/ScopePanel';
import { useApp } from './store';
import { Toolbar } from './Toolbar';
import { TutorialPanel } from './tutorial/TutorialPanel';
import { Viewport } from './viewport/Viewport';

type SideTab = 'tutorial' | 'params' | 'recordings';

export function Workspace({ system }: { system: SystemId }) {
  const t = useT();
  const ws = useApp((s) => s.systems[system]);
  const rt = useMemo(() => {
    const st = useApp.getState().systems[system];
    const r = new Runtime(SYSTEMS[system], st.params, JSON.parse(JSON.stringify(st.model)));
    r.realistic = st.realistic;
    return r;
  }, [system]);
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window as any, { __rt: rt, __app: useApp });
    return () => rt.dispose();
  }, [rt]);

  // ---- sync store -> runtime
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return;
    rt.setParams(ws.params);
  }, [ws.params, rt]);
  useEffect(() => {
    if (first.current) return;
    const h = setTimeout(() => rt.setController(JSON.parse(JSON.stringify(ws.model))), 150);
    return () => clearTimeout(h);
  }, [ws.model, rt]);
  useEffect(() => {
    rt.realistic = ws.realistic;
    rt.notify();
  }, [ws.realistic, rt]);
  useEffect(() => {
    const g = buildGhost(system, ws.fields, {}, paramScope(SYSTEMS[system], ws.params));
    rt.setGhost(g && 'fn' in g ? g.fn : null);
    rt.notify();
  }, [ws.fields, ws.params, system, rt]);
  useEffect(() => {
    first.current = false;
  }, []);

  // ---- keyboard forces
  useEffect(() => {
    const mag = system === 'cartpole' ? 15 : system === 'furuta' ? 0.6 : 40;
    const keys = new Set<string>();
    const update = () => {
      const f: [number, number, number] = [0, 0, 0];
      if (system === 'cartpole') {
        if (keys.has('ArrowLeft')) f[0] -= mag;
        if (keys.has('ArrowRight')) f[0] += mag;
      } else if (system === 'furuta') {
        if (keys.has('ArrowLeft')) f[1] -= mag;
        if (keys.has('ArrowRight')) f[1] += mag;
      } else {
        if (keys.has('ArrowLeft')) f[1] += mag;
        if (keys.has('ArrowRight')) f[1] -= mag;
        if (keys.has('ArrowUp')) f[2] += mag;
        if (keys.has('ArrowDown')) f[2] -= mag;
      }
      rt.keyForce = f;
    };
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.tagName === 'MATH-FIELD' || a.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping() || !e.key.startsWith('Arrow')) return;
      if (document.activeElement?.closest?.('.react-flow')) return;
      keys.add(e.key);
      update();
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key);
      update();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [rt, system]);

  // ---- layout
  const [sideW, setSideW] = useState(() => Math.min(480, Math.max(340, window.innerWidth * 0.32)));
  const [bottomH, setBottomH] = useState(() => Math.max(260, window.innerHeight * 0.4));
  const [scopeW, setScopeW] = useState(() => Math.max(280, window.innerWidth * 0.22));
  const [tab, setTab] = useState<SideTab>('tutorial');

  return (
    <RtCtx.Provider value={rt}>
      <div className="ws">
        <Toolbar system={system} />
        <div className="ws-main">
          <div className="ws-left">
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <div className="viewport" style={{ flex: 1, minWidth: 0 }}>
                <Viewport system={system} />
              </div>
              <Splitter dir="v" onDrag={(d) => setScopeW((w) => Math.max(160, Math.min(900, w - d)))} />
              <div style={{ width: scopeW, display: 'flex', minWidth: 0 }}>
                <ScopePanel system={system} />
              </div>
            </div>
            <Splitter dir="h" onDrag={(d) => setBottomH((h) => Math.max(120, Math.min(window.innerHeight - 200, h - d)))} />
            <div className="bottom" style={{ height: bottomH }}>
              <DiagramEditor system={system} />
            </div>
          </div>
          <Splitter dir="v" onDrag={(d) => setSideW((w) => Math.max(280, Math.min(900, w - d)))} />
          <div className="side" style={{ width: sideW }}>
            <div className="tabs">
              {(['tutorial', 'params', 'recordings'] as SideTab[]).map((k) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {k === 'tutorial' ? '📘 ' + t('tutorial') : k === 'params' ? '⚙ ' + t('parameters') : '⏺ ' + t('recordings')}
                </button>
              ))}
            </div>
            <div className="tabbody">
              {tab === 'tutorial' && <TutorialPanel system={system} />}
              {tab === 'params' && <ParamsPanel system={system} />}
              {tab === 'recordings' && <RecordingsPanel system={system} />}
            </div>
          </div>
        </div>
        <ToastHost />
      </div>
    </RtCtx.Provider>
  );
}
