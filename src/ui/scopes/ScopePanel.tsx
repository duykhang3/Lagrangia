import { useEffect, useRef, useState } from 'react';
import type { ScopeBuf } from '../../core/sim/runtime';
import type { SystemId } from '../../core/types';
import { useT } from '../i18n';
import { useRt, useRtVersion } from '../runtimeCtx';

const COLORS = ['#5aa9ff', '#76e4c3', '#ffb454', '#ff6b9b', '#b48cff', '#e8e36b', '#5ae0e8', '#ff8a5a', '#9ad35a', '#d8d8d8'];

function ScopePlot({ get, height, windowS }: { get: () => { buf: ScopeBuf | undefined; tEnd: number }; height: number; windowS: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const [labels, setLabels] = useState<string[]>([]);
  const labelsRef = useRef<string[]>([]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth,
        H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const { buf, tEnd } = get();
      if (buf && buf.labels.join('|') !== labelsRef.current.join('|')) {
        labelsRef.current = buf.labels.slice();
        setLabels(buf.labels.slice());
      }
      const L = 46,
        R = 8,
        T = 6,
        B = 18;
      const pw = W - L - R,
        ph = H - T - B;
      ctx.fillStyle = '#0f151c';
      ctx.fillRect(L, T, pw, ph);
      const t1 = Math.max(tEnd, windowS * 0.02),
        t0 = Math.max(0, t1 - windowS);
      let lo = 0;
      const ts = buf?.t ?? [];
      // binary search start index
      let a = 0,
        b = ts.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (ts[m] < t0) a = m + 1;
        else b = m;
      }
      lo = Math.max(0, a - 1);
      let hiIdx = ts.length;
      while (hiIdx > lo && ts[hiIdx - 1] > t1) hiIdx--;
      let ymin = Infinity,
        ymax = -Infinity;
      const ch = buf?.ch ?? [];
      ch.forEach((arr, k) => {
        if (hiddenRef.current.has(k)) return;
        for (let i = lo; i < hiIdx; i++) {
          const v = arr[i];
          if (!isFinite(v)) continue;
          if (v < ymin) ymin = v;
          if (v > ymax) ymax = v;
        }
      });
      if (!isFinite(ymin)) {
        ymin = -1;
        ymax = 1;
      }
      if (ymax - ymin < 1e-9) {
        ymin -= 0.5;
        ymax += 0.5;
      }
      const pad = (ymax - ymin) * 0.08;
      ymin -= pad;
      ymax += pad;
      const X = (t: number) => L + ((t - t0) / (t1 - t0)) * pw;
      const Y = (v: number) => T + (1 - (v - ymin) / (ymax - ymin)) * ph;
      // grid
      ctx.strokeStyle = '#1e2936';
      ctx.fillStyle = '#7f8ea3';
      ctx.font = '10px Consolas, monospace';
      ctx.lineWidth = 1;
      const ystep = niceStep((ymax - ymin) / 4);
      for (let y = Math.ceil(ymin / ystep) * ystep; y <= ymax; y += ystep) {
        ctx.beginPath();
        ctx.moveTo(L, Y(y));
        ctx.lineTo(L + pw, Y(y));
        ctx.stroke();
        ctx.fillText(fmt(y), 2, Y(y) + 3);
      }
      const tstep = niceStep((t1 - t0) / 5);
      for (let tt = Math.ceil(t0 / tstep) * tstep; tt <= t1; tt += tstep) {
        ctx.beginPath();
        ctx.moveTo(X(tt), T);
        ctx.lineTo(X(tt), T + ph);
        ctx.stroke();
        ctx.fillText(fmt(tt), X(tt) - 8, H - 4);
      }
      if (ymin < 0 && ymax > 0) {
        ctx.strokeStyle = '#33465f';
        ctx.beginPath();
        ctx.moveTo(L, Y(0));
        ctx.lineTo(L + pw, Y(0));
        ctx.stroke();
      }
      // traces
      ch.forEach((arr, k) => {
        if (hiddenRef.current.has(k)) return;
        ctx.strokeStyle = COLORS[k % COLORS.length];
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const step = Math.max(1, Math.floor((hiIdx - lo) / (pw * 2)));
        let started = false;
        for (let i = lo; i < hiIdx; i += step) {
          const v = arr[i];
          if (!isFinite(v)) continue;
          const x = X(ts[i]),
            y = Y(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [get, windowS]);

  return (
    <>
      <div className="legend">
        {labels.map((l, k) => (
          <span
            key={k}
            className={hidden.has(k) ? 'off' : ''}
            style={{ color: COLORS[k % COLORS.length] }}
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                n.has(k) ? n.delete(k) : n.add(k);
                return n;
              })
            }
          >
            ━ {l}
          </span>
        ))}
      </div>
      <canvas ref={canvas} style={{ width: '100%', height, display: 'block' }} />
    </>
  );
}

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-12))));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function fmt(v: number) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return String(+v.toFixed(3));
}

export function ScopePanel({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  useRtVersion(rt);
  const [windowS, setWindowS] = useState(10);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const ids = ['__plant', ...(rt.program?.blocks.filter((b) => b.node.type === 'scope').map((b) => b.node.id) ?? [])];
  const getters = useRef(new Map<string, () => { buf: ScopeBuf | undefined; tEnd: number }>());
  const getterRt = useRef(rt);
  if (getterRt.current !== rt) {
    getterRt.current = rt;
    getters.current.clear();
  }
  const getter = (id: string) => {
    let g = getters.current.get(id);
    if (!g) {
      g = () => {
        if (rt.replay) return { buf: rt.replay.rec.scopes[id], tEnd: rt.replay.t };
        return { buf: id === '__plant' ? rt.plantScope : rt.scopes.get(id), tEnd: rt.sim.t };
      };
      getters.current.set(id, g);
    }
    return g;
  };
  void system;
  return (
    <div className="scopes">
      <div className="scope-head" style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
        <b>📈 {t('scopes')}</b>
        <span className="spacer" />
        <span className="muted small">{t('window')}</span>
        <select value={windowS} onChange={(e) => setWindowS(Number(e.target.value))} style={{ width: 'auto' }}>
          {[2, 5, 10, 20, 60].map((w) => (
            <option key={w} value={w}>
              {w} s
            </option>
          ))}
        </select>
      </div>
      {ids.map((id) => {
        const name = id === '__plant' ? t('plantSignals') : rt.program?.byId.get(id)?.node.name ?? id;
        const isCol = collapsed[id] ?? false;
        return (
          <div className="scope" key={id}>
            <div className="scope-head">
              <button className="ghostbtn" style={{ padding: '0 4px' }} onClick={() => setCollapsed((c) => ({ ...c, [id]: !isCol }))}>
                {isCol ? '▸' : '▾'}
              </button>
              <span>{name}</span>
            </div>
            {!isCol && <ScopePlot get={getter(id)} height={130} windowS={windowS} />}
          </div>
        );
      })}
      {ids.length === 1 && <div className="muted small" style={{ padding: 8 }}>{t('noScopes')}</div>}
    </div>
  );
}
