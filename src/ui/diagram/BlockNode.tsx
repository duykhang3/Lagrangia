import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { BLOCK_MAP } from '../../core/blocks/library';
import { valueToString } from '../../core/matlab/interp';
import { Tex } from '../common';
import { useRt } from '../runtimeCtx';

export interface BlockData extends Record<string, unknown> {
  type: string;
  name: string;
  params: Record<string, any>;
  fullId: string;
  bad?: boolean;
  onParam?: (key: string, value: any) => void;
}

export function blockSize(type: string, params: Record<string, any>) {
  const def = BLOCK_MAP[type];
  let ports = { in: [] as string[], out: [] as string[] };
  try {
    ports = def.ports(params);
  } catch {
    /* ignore */
  }
  const n = Math.max(ports.in.length, ports.out.length, 1);
  const w = type === 'slider' ? 150 : type === 'display' ? 130 : type === 'matlabfn' ? 130 : type === 'subsystem' ? 120 : type === 'tf' ? 110 : type === 'state' ? 80 : 70;
  const h = Math.max(type === 'slider' ? 50 : 40, n * 22 + 10);
  return { w, h, ports };
}

function DisplayFace({ fullId }: { fullId: string }) {
  const rt = useRt();
  const [txt, setTxt] = useState('—');
  useEffect(() => {
    const id = setInterval(() => {
      const v = rt.displays.get(fullId);
      setTxt(v ? v.map((x) => valueToString(x, 4)).join(', ') : '—');
    }, 150);
    return () => clearInterval(id);
  }, [rt, fullId]);
  return <span className="mono" style={{ fontSize: 11, fontWeight: 400, whiteSpace: 'normal', wordBreak: 'break-all' }}>{txt}</span>;
}

function SliderFace({ fullId, params, onParam }: { fullId: string; params: Record<string, any>; onParam?: (k: string, v: any) => void }) {
  const rt = useRt();
  const min = parseFloat(params.min) || 0,
    max = parseFloat(params.max) || 1;
  const [v, setV] = useState(() => rt.sliders.get(fullId) ?? (parseFloat(params.value) || 0));
  const last = useRef(v);
  return (
    <div style={{ width: '100%', padding: '0 4px' }} className="nodrag">
      <input
        className="slider-in nodrag"
        type="range"
        min={min}
        max={max}
        step={(max - min) / 200}
        value={v}
        onChange={(e) => {
          const x = Number(e.target.value);
          setV(x);
          last.current = x;
          rt.sliders.set(fullId, x);
        }}
        onPointerUp={() => onParam?.('value', String(+last.current.toPrecision(4)))}
      />
      <div className="mono" style={{ fontSize: 10, textAlign: 'center' }}>
        {v.toFixed(3)}
      </div>
    </div>
  );
}

export const BlockNode = memo(function BlockNode({ data, selected }: NodeProps) {
  const d = data as BlockData;
  const def = BLOCK_MAP[d.type];
  if (!def) return <div className="blk bad">?</div>;
  const { w, h, ports } = blockSize(d.type, d.params);
  const face = def.face?.(d.params) ?? '';
  return (
    <div className={`blk cat-${def.category} ${selected ? 'sel' : ''} ${d.bad ? 'bad' : ''}`} style={{ width: w, height: h }} title={def.desc.en}>
      {ports.in.map((p, i) => {
        const top = ((i + 1) * h) / (ports.in.length + 1);
        return (
          <div key={`i${i}`}>
            <Handle type="target" position={Position.Left} id={`i${i}`} style={{ top }} />
            {ports.in.length > 1 || d.type === 'matlabfn' || d.type === 'subsystem' || d.type === 'lqr' ? (
              <span className="plab" style={{ left: 5, top: top - 7 }}>
                {p}
              </span>
            ) : null}
          </div>
        );
      })}
      <div className="face">
        {d.type === 'display' ? (
          <DisplayFace fullId={d.fullId} />
        ) : d.type === 'slider' ? (
          <SliderFace fullId={d.fullId} params={d.params} onParam={d.onParam} />
        ) : face.startsWith('$') && face.endsWith('$') ? (
          <Tex tex={face.slice(1, -1)} />
        ) : (
          <span style={{ maxWidth: w - 30, overflow: 'hidden', textOverflow: 'ellipsis' }}>{face}</span>
        )}
      </div>
      {ports.out.map((p, i) => {
        const top = ((i + 1) * h) / (ports.out.length + 1);
        return (
          <div key={`o${i}`}>
            <Handle type="source" position={Position.Right} id={`o${i}`} style={{ top }} />
            {ports.out.length > 1 || d.type === 'matlabfn' || d.type === 'subsystem' ? (
              <span className="plab" style={{ right: 5, top: top - 7 }}>
                {p}
              </span>
            ) : null}
          </div>
        );
      })}
      <div className="bname">{d.name}</div>
    </div>
  );
});
