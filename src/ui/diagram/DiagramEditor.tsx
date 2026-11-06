import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { examplesFor } from '../../core/blocks/examples';
import { BLOCK_MAP, BLOCKS, CATEGORIES, defaultBlockParams } from '../../core/blocks/library';
import type { Diagram, DiagramEdge, DiagramNode, Model } from '../../core/blocks/types';
import { valueToString } from '../../core/matlab/interp';
import type { SystemId } from '../../core/types';
import { Modal } from '../common';
import { useT } from '../i18n';
import { useRt, useRtVersion } from '../runtimeCtx';
import { useApp } from '../store';
import { BlockNode, type BlockData } from './BlockNode';
import { getLevel, groupIntoSubsystem, setLevel, uid } from './graphUtils';

const nodeTypes = { block: BlockNode };
let clipboard: { nodes: DiagramNode[]; edges: DiagramEdge[] } | null = null;

const toRFEdge = (e: DiagramEdge): Edge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: `o${e.sourcePort}`,
  targetHandle: `i${e.targetPort}`,
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#7d93ad' },
});
const fromRFEdge = (e: Edge): DiagramEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourcePort: Number((e.sourceHandle ?? 'o0').slice(1)),
  targetPort: Number((e.targetHandle ?? 'i0').slice(1)),
});
const fromRF = (n: Node): DiagramNode => {
  const d = n.data as BlockData;
  return { id: n.id, type: d.type, x: Math.round(n.position.x), y: Math.round(n.position.y), name: d.name, params: d.params };
};

export function DiagramEditor({ system }: { system: SystemId }) {
  return (
    <ReactFlowProvider>
      <EditorInner system={system} />
    </ReactFlowProvider>
  );
}

function EditorInner({ system }: { system: SystemId }) {
  const t = useT();
  const rt = useRt();
  useRtVersion(rt);
  const model = useApp((s) => s.systems[system].model);
  const setModel = useApp((s) => s.setModel);
  const [path, setPath] = useState<string[]>([]);
  const level = useMemo(() => getLevel(model.diagram, path), [model.diagram, path]);
  useEffect(() => {
    if (!level) setPath([]);
  }, [level]);
  const rf = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const modelRef = useRef(model);
  modelRef.current = model;
  const pathRef = useRef(path);
  pathRef.current = path;
  const lastWritten = useRef<Diagram | null>(null);
  const prefix = path.length ? path.join('/') + '/' : '';
  const [codeEdit, setCodeEdit] = useState<string | null>(null);

  const commit = useCallback(
    (ns: Node[], es: Edge[]) => {
      const lvl: Diagram = { nodes: ns.map(fromRF), edges: es.map(fromRFEdge) };
      lastWritten.current = lvl;
      const root = setLevel(modelRef.current.diagram, pathRef.current, lvl);
      setModel(system, { ...modelRef.current, diagram: root });
    },
    [setModel, system],
  );

  const updateParam = useCallback(
    (id: string, key: string, value: any) => {
      const ns = nodesRef.current.map((n) => (n.id === id ? { ...n, data: { ...n.data, params: { ...(n.data as BlockData).params, [key]: value } } } : n));
      setNodes(ns);
      commit(ns, edgesRef.current);
    },
    [commit],
  );

  const toRF = useCallback(
    (n: DiagramNode): Node => ({
      id: n.id,
      type: 'block',
      position: { x: n.x, y: n.y },
      data: { type: n.type, name: n.name ?? BLOCK_MAP[n.type]?.name.en ?? n.type, params: n.params, fullId: prefix + n.id, onParam: (k: string, v: any) => updateParam(n.id, k, v) } as BlockData,
    }),
    [prefix, updateParam],
  );

  useEffect(() => {
    if (!level || level === lastWritten.current) return;
    setNodes(level.nodes.map(toRF));
    setEdges(level.edges.map(toRFEdge));
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 200 }), 30);
  }, [level, toRF, rf]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const ns = applyNodeChanges(changes, nodesRef.current);
      setNodes(ns);
      if (changes.some((c) => c.type === 'remove' || (c.type === 'position' && c.dragging === false))) commit(ns, edgesRef.current);
    },
    [commit],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const es = applyEdgeChanges(changes, edgesRef.current);
      setEdges(es);
      if (changes.some((c) => c.type === 'remove')) commit(nodesRef.current, es);
    },
    [commit],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      const filtered = edgesRef.current.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle));
      const es = addEdge({ ...toRFEdge({ id: uid('e'), source: c.source!, target: c.target!, sourcePort: Number(c.sourceHandle!.slice(1)), targetPort: Number(c.targetHandle!.slice(1)) }) }, filtered);
      setEdges(es);
      commit(nodesRef.current, es);
    },
    [commit],
  );

  const uniqueName = (base: string) => {
    const names = new Set(nodesRef.current.map((n) => (n.data as BlockData).name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  };

  const addBlock = (type: string, pos?: { x: number; y: number }) => {
    const def = BLOCK_MAP[type];
    const p = pos ?? rf.screenToFlowPosition({ x: window.innerWidth * 0.35, y: window.innerHeight * 0.75 });
    const params = defaultBlockParams(type);
    if (type === 'inport' || type === 'outport') params.index = String(nodesRef.current.filter((n) => (n.data as BlockData).type === type).length + 1);
    const n: DiagramNode = { id: uid(), type, x: p.x, y: p.y, name: uniqueName(def.name[t.lang]), params };
    const ns = [...nodesRef.current.map((x) => ({ ...x, selected: false })), { ...toRF(n), selected: true }];
    setNodes(ns);
    commit(ns, edgesRef.current);
  };

  const selected = nodes.filter((n) => n.selected);

  const groupSel = () => {
    if (selected.length < 1) return;
    const lvl: Diagram = { nodes: nodesRef.current.map(fromRF), edges: edgesRef.current.map(fromRFEdge) };
    const g = groupIntoSubsystem(lvl, new Set(selected.map((n) => n.id)), uniqueName('Subsystem'));
    lastWritten.current = null;
    setModel(system, { ...modelRef.current, diagram: setLevel(modelRef.current.diagram, pathRef.current, g) });
  };
  const deleteSel = () => onNodesChange(selected.map((n) => ({ type: 'remove', id: n.id })));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selected.length) {
      const ids = new Set(selected.map((n) => n.id));
      clipboard = { nodes: selected.map(fromRF), edges: edgesRef.current.filter((x) => ids.has(x.source) && ids.has(x.target)).map(fromRFEdge) };
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard) {
      const map = new Map<string, string>();
      const newNodes = clipboard.nodes.map((n) => {
        const id = uid();
        map.set(n.id, id);
        return { ...toRF({ ...n, id, x: n.x + 40, y: n.y + 40, name: uniqueName(n.name ?? n.type), params: JSON.parse(JSON.stringify(n.params)) }), selected: true };
      });
      const newEdges = clipboard.edges.map((x) => toRFEdge({ ...x, id: uid('e'), source: map.get(x.source)!, target: map.get(x.target)! }));
      const ns = [...nodesRef.current.map((x) => ({ ...x, selected: false })), ...newNodes];
      const es = [...edgesRef.current, ...newEdges];
      setNodes(ns);
      setEdges(es);
      commit(ns, es);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      groupSel();
    }
  };

  const errorIds = new Set<string>();
  rt.program?.errors.forEach((x) => x.nodeId && errorIds.add(x.nodeId));
  if (rt.program?.runtimeError?.nodeId) errorIds.add(rt.program.runtimeError.nodeId);
  const viewNodes = nodes.map((n) => {
    const bad = errorIds.has((n.data as BlockData).fullId);
    return (n.data as BlockData).bad === bad ? n : { ...n, data: { ...n.data, bad } };
  });

  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: t('root') }];
  {
    let d: Diagram | null = model.diagram;
    for (const id of path) {
      const n: DiagramNode | undefined = d?.nodes.find((x) => x.id === id);
      crumbs.push({ id, name: n?.name ?? id });
      d = n?.params.diagram ?? null;
    }
  }

  const sel = selected.length === 1 ? selected[0] : null;

  return (
    <div className="editor" onKeyDown={onKeyDown} tabIndex={-1}>
      <Palette system={system} inSubsystem={path.length > 0} onAdd={(type) => addBlock(type)} />
      <div
        className="canvas-wrap"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          const type = e.dataTransfer.getData('application/lagrangia-block');
          if (type) addBlock(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
      >
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <button key={i} className={i === crumbs.length - 1 ? 'active' : ''} onClick={() => setPath(path.slice(0, i))} style={{ padding: '2px 8px' }}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="canvas-tools">
          <button onClick={groupSel} disabled={!selected.length} title={t('groupSubsystem')}>
            ⧉
          </button>
          <button onClick={deleteSel} disabled={!selected.length} title={t('deleteSel')}>
            🗑
          </button>
        </div>
        <ReactFlow
          nodes={viewNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, n) => {
            const d = n.data as BlockData;
            if (d.type === 'subsystem') setPath([...path, n.id]);
            else if (d.type === 'matlabfn') setCodeEdit(n.id);
          }}
          deleteKeyCode={['Delete', 'Backspace']}
          multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
          snapToGrid
          snapGrid={[10, 10]}
          minZoom={0.2}
          maxZoom={3}
          colorMode="dark"
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a3646" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <Inspector
        system={system}
        node={sel}
        prefix={prefix}
        model={model}
        onRename={(name) => {
          if (!sel) return;
          const ns = nodesRef.current.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, name } } : n));
          setNodes(ns);
          commit(ns, edgesRef.current);
        }}
        onParam={(k, v) => sel && updateParam(sel.id, k, v)}
        onEditCode={() => sel && setCodeEdit(sel.id)}
        onOpenSub={() => sel && setPath([...path, sel.id])}
        onModel={(m) => setModel(system, m)}
        onLoadExample={(m) => {
          lastWritten.current = null;
          setPath([]);
          setModel(system, JSON.parse(JSON.stringify(m)));
        }}
        onSelectIssue={(fullId) => {
          const parts = fullId.split('/');
          const target = parts.pop()!;
          setPath(parts);
          setTimeout(() => setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === target }))), 50);
        }}
      />
      {codeEdit && (
        <CodeModal
          initial={String((nodes.find((n) => n.id === codeEdit)?.data as BlockData | undefined)?.params.code ?? '')}
          title={(nodes.find((n) => n.id === codeEdit)?.data as BlockData | undefined)?.name ?? ''}
          onClose={() => setCodeEdit(null)}
          onApply={(code) => {
            updateParam(codeEdit, 'code', code);
            setCodeEdit(null);
          }}
        />
      )}
    </div>
  );
}

function Palette({ system, inSubsystem, onAdd }: { system: SystemId; inSubsystem: boolean; onAdd: (type: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const avail = BLOCKS.filter((b) => (!b.systems || b.systems.includes(system)) && (inSubsystem || (b.type !== 'inport' && b.type !== 'outport')));
  const match = (b: (typeof BLOCKS)[number]) => !q || (b.name.en + ' ' + b.name.nl + ' ' + b.type).toLowerCase().includes(q.toLowerCase());
  return (
    <div className="palette-pane">
      <input placeholder={t('searchBlocks')} value={q} onChange={(e) => setQ(e.target.value)} />
      {CATEGORIES.map((c) => {
        const items = avail.filter((b) => b.category === c.id && match(b));
        if (!items.length) return null;
        return (
          <div key={c.id}>
            <div className="pcat">{t.l(c.name)}</div>
            {items.map((b) => (
              <div
                key={b.type}
                className="pitem"
                draggable
                title={t.l(b.desc)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/lagrangia-block', b.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDoubleClick={() => onAdd(b.type)}
              >
                {t.l(b.name)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CodeModal({ initial, title, onClose, onApply }: { initial: string; title: string; onClose: () => void; onApply: (code: string) => void }) {
  const t = useT();
  const [code, setCode] = useState(initial);
  return (
    <Modal
      title={`MATLAB Function — ${title}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            function [y1, y2] = fcn(u1, u2) · t, Ts, parameters & workspace variables available · persistent supported
          </span>
          <button onClick={onClose}>{t('close')}</button>
          <button className="primary" onClick={() => onApply(code)}>
            {t('apply')}
          </button>
        </>
      }
    >
      <textarea
        className="code"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const s = ta.selectionStart,
              en = ta.selectionEnd;
            const v = code.slice(0, s) + '  ' + code.slice(en);
            setCode(v);
            requestAnimationFrame(() => (ta.selectionStart = ta.selectionEnd = s + 2));
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onApply(code);
        }}
      />
    </Modal>
  );
}

function Inspector(props: {
  system: SystemId;
  node: Node | null;
  prefix: string;
  model: Model;
  onRename: (n: string) => void;
  onParam: (k: string, v: any) => void;
  onEditCode: () => void;
  onOpenSub: () => void;
  onModel: (m: Model) => void;
  onLoadExample: (m: Model) => void;
  onSelectIssue: (fullId: string) => void;
}) {
  const t = useT();
  const rt = useRt();
  useRtVersion(rt);
  const { node, model } = props;
  const [script, setScript] = useState(model.initScript);
  useEffect(() => setScript(model.initScript), [model.initScript]);

  if (node) {
    const d = node.data as BlockData;
    const def = BLOCK_MAP[d.type];
    const info = rt.infos.get(props.prefix + node.id);
    return (
      <div className="inspector">
        <h3>{t.l(def.name)}</h3>
        <div className="muted small">{t.l(def.desc)}</div>
        <label>{t('blockName')}</label>
        <input value={d.name} onChange={(e) => props.onRename(e.target.value)} />
        {def.params.map((p) => (
          <div key={p.key}>
            <label title={p.help ? t.l(p.help) : undefined}>{t.l(p.label)}</label>
            {p.kind === 'select' ? (
              <select value={d.params[p.key]} onChange={(e) => props.onParam(p.key, e.target.value)}>
                {p.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t.l(o.label)}
                  </option>
                ))}
              </select>
            ) : p.kind === 'code' ? (
              <>
                <pre className="mono small" style={{ maxHeight: 160, overflow: 'auto', background: '#0b1016', padding: 6, borderRadius: 6, margin: 0 }}>
                  {String(d.params[p.key]).split('\n').slice(0, 12).join('\n')}
                </pre>
                <button style={{ marginTop: 6 }} onClick={props.onEditCode}>
                  ✎ {t('editCode')}
                </button>
              </>
            ) : (
              <ParamInput value={String(d.params[p.key] ?? '')} onCommit={(v) => props.onParam(p.key, v)} mono={p.kind === 'expr'} />
            )}
          </div>
        ))}
        {d.type === 'subsystem' && (
          <button style={{ marginTop: 10 }} onClick={props.onOpenSub}>
            ⧉ {t('openSubsystem')}
          </button>
        )}
        {info && (
          <>
            <label>{t('computed')}</label>
            <div className="mono small" style={{ wordBreak: 'break-all' }}>
              {info}
            </div>
          </>
        )}
      </div>
    );
  }

  const prog = rt.program;
  const issues = [...(prog?.errors ?? []).map((e) => ({ ...e, k: 'e' })), ...(prog?.runtimeError ? [{ ...prog.runtimeError, k: 'e' }] : []), ...(prog?.warnings ?? []).map((w) => ({ ...w, k: 'w' }))];
  const wsVars = Object.entries(rt.ws).filter(([k]) => !k.startsWith('_'));
  return (
    <div className="inspector">
      <h3>{t('modelSettings')}</h3>
      <select
        value=""
        onChange={(e) => {
          const ex = examplesFor(props.system).find((x) => x.id === e.target.value);
          if (ex && confirm(t('confirmLoad'))) props.onLoadExample(ex.model);
        }}
      >
        <option value="">📂 {t('examples')}</option>
        {examplesFor(props.system).map((ex) => (
          <option key={ex.id} value={ex.id} title={t.l(ex.desc)}>
            {t.l(ex.name)}
          </option>
        ))}
      </select>
      <label>{t('sampleTime')}</label>
      <select value={model.Ts} onChange={(e) => props.onModel({ ...model, Ts: Number(e.target.value) })}>
        {[0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05].filter((v) => v >= rt.model.dt - 1e-12).map((v) => (
          <option key={v} value={v}>
            {v} s ({Math.round(1 / v)} Hz)
          </option>
        ))}
      </select>
      <label title={t('initScriptHelp')}>{t('initScript')}</label>
      <textarea className="mono small" rows={6} value={script} spellCheck={false} onChange={(e) => setScript(e.target.value)} onBlur={() => script !== model.initScript && props.onModel({ ...model, initScript: script })} />
      <div className="muted small">{t('initScriptHelp')}</div>
      {rt.wsError && <div className="issue e">init: {rt.wsError}</div>}
      <div className="issues">
        {issues.length === 0 && <div className="okc">✔ {t('noErrors')}</div>}
        {issues.map((i, k) => (
          <div key={k} className={`issue ${i.k}`} onClick={() => i.nodeId && props.onSelectIssue(i.nodeId)}>
            {i.k === 'e' ? '⛔' : '⚠'} {i.msg}
          </div>
        ))}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small">{t('workspaceVars')}</summary>
        <div className="mono small" style={{ maxHeight: 220, overflow: 'auto' }}>
          {wsVars.map(([k, v]) => (
            <div key={k} title={valueToString(v, 5)}>
              <b>{k}</b> = {valueToString(v, 3).slice(0, 60)}
            </div>
          ))}
        </div>
      </details>
      <p className="muted small" style={{ marginTop: 10 }}>
        {t('diagramHelp')}
      </p>
      <button className="danger" onClick={() => confirm(t('confirmClear')) && props.onLoadExample({ ...model, diagram: { nodes: [], edges: [] } })}>
        🗑 {t('clearDiagram')}
      </button>
    </div>
  );
}

function ParamInput({ value, onCommit, mono }: { value: string; onCommit: (v: string) => void; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={mono ? 'mono' : ''}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
