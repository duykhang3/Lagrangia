// Exports the block-diagram controller + plant model as a self-contained MATLAB/Octave function file.
import { compile } from '../blocks/compiler';
import { flat } from '../blocks/library';
import type { BlockCtx, BlockIO, Model } from '../blocks/types';
import { Mat } from '../linalg';
import { runScript, Value, valueToString } from '../matlab/interp';
import { linearize } from '../sim/simulator';
import { paramScope, SYSTEMS } from '../systems';
import { buildLinks, DH, Q_MAX, Q_MIN, TAU_MAX, TCP_OFFSET } from '../systems/panda';
import type { Params, SystemId } from '../types';

const isIdent = (s: string) => /^[A-Za-z]\w*$/.test(s);
const KEYWORDS = new Set(['end', 'if', 'for', 'while', 'function', 'return', 'break', 'else', 'elseif', 'switch', 'case', 'otherwise', 'try', 'catch', 'global', 'persistent', 'continue']);

function mlValue(v: Value): string {
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === 'number') return fmtNum(v);
  if (v.numel === 0) return '[]';
  return '[' + v.toRows().map((r) => r.map(fmtNum).join(' ')).join('; ') + ']';
}
function fmtNum(x: number) {
  if (x === Infinity) return 'Inf';
  if (x === -Infinity) return '-Inf';
  if (Number.isNaN(x)) return 'NaN';
  return String(+x.toPrecision(15));
}

function functionHasEnd(code: string): boolean {
  const lines = code
    .split('\n')
    .map((l) => l.replace(/%.*$/, '').trim())
    .filter(Boolean);
  let open = 0,
    ends = 0;
  for (const l of lines) {
    for (const st of l.split(/[;,]/)) {
      const s = st.trim();
      if (/^(if|for|while|switch|try|parfor|function)\b/.test(s)) open++;
      if (/^end\b/.test(s)) ends++;
    }
  }
  return ends >= open && open > 0;
}

export function exportMatlab(sys: SystemId, model: Model, params: Params): string {
  const m = SYSTEMS[sys];
  const fname = `lagrangia_${sys}_controller`;
  const nominal: Params = sys === 'panda' ? { ...params, payload: 0 } : params;
  // ---- workspace (same as the runtime)
  const base: Record<string, Value> = { ...paramScope(m, params), n: m.n, Ts: model.Ts };
  const lin = linearize(m, params);
  if (lin) {
    base.A_lin = lin.A;
    base.B_lin = lin.B;
  }
  let ws: Record<string, Value> = base;
  let wsErr = '';
  try {
    ws = Object.fromEntries(runScript(model.initScript || '', base).entries());
  } catch (e) {
    wsErr = (e as Error).message;
  }
  const io: BlockIO = { sensor: () => ({ q: [], dq: [] }), actuate: () => {}, target: () => [0, 0, 0], scope: () => {}, display: () => {}, slider: () => undefined, info: () => {} };
  const ctx = (id: string): BlockCtx => ({ Ts: model.Ts, model: m, params, nominal, ws, io, id });
  const prog = compile(model.diagram, ctx, 'export');

  const L: string[] = [];
  const P = (s = '') => L.push(s);
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  P(`function ${fname}()`);
  P(`%${fname.toUpperCase()}  Controller exported from Lagrangia (${date}).`);
  P(`%   System : ${m.name.en}`);
  P(`%   Simulates the plant (same model as in the app) in closed loop with the`);
  P(`%   block-diagram controller and plots the results. Works in MATLAB and Octave,`);
  P(`%   no toolboxes required (local lqr / wrapToPi implementations are included).`);
  if (sys === 'panda') P(`%   Note: environment contacts are not included in this export.`);
  P(`%   If you use 'persistent' variables in MATLAB Function blocks, run 'clear all' before re-running.`);
  if (prog.errors.length) {
    P('%');
    P('%   WARNING: the diagram had errors in Lagrangia:');
    prog.errors.forEach((e) => P(`%     - ${e.msg}`));
  }
  if (wsErr) P(`%   WARNING: init script error: ${wsErr}`);
  P();
  P('%% Plant parameters');
  for (const [k, v] of Object.entries(params)) if (isIdent(k)) P(`P.${k} = ${typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'string' ? `'${v}'` : fmtNum(v)};`);
  for (const [k, v] of Object.entries(m.derived(params))) P(`P.${k} = ${fmtNum(v)};   % derived`);
  if (sys === 'panda') P('Pn = P; Pn.payload = 0;   % nominal model used by the robotics blocks');
  else P('Pn = P;');
  P(`Ts = ${fmtNum(model.Ts)};          % controller sample time [s]`);
  P(`dt = ${fmtNum(m.dt)};          % integration step [s]`);
  P('T_end = 10;           % simulated time [s]');
  P();
  P('%% Model workspace (evaluated in Lagrangia; numeric values)');
  const wsNames: string[] = [];
  for (const [k, v] of Object.entries(ws)) {
    if (!isIdent(k) || KEYWORDS.has(k) || typeof v === 'string') continue;
    wsNames.push(k);
    P(`W.${k} = ${mlValue(v)};`);
  }
  if (model.initScript.trim()) {
    P('% Original init script:');
    model.initScript.split('\n').forEach((l) => P(`%   ${l}`));
  }
  P();
  P('%% Initial state');
  const s0 = m.initialState(params);
  P(`q = ${mlValue(Mat.col(s0.q))};`);
  P(`dq = ${mlValue(Mat.col(s0.dq))};`);
  P();
  P('%% Closed-loop simulation');
  P('S = ctrl_init(W, P, Pn, Ts);');
  P(`u = zeros(${m.nu}, 1);`);
  P('N = round(T_end/dt);');
  P('ratio = max(1, round(Ts/dt));');
  P(`log_t = zeros(1, N); log_q = zeros(${m.n}, N); log_dq = zeros(${m.n}, N); log_u = zeros(${m.nu}, N);`);
  P('scopes = {};');
  P('for k = 1:N');
  P('  t = (k-1)*dt;');
  P('  if mod(k-1, ratio) == 0');
  P('    [u, S, Y] = ctrl_step(t, q, dq, S, W, Pn, Ts);');
  P('    u = lag_saturate(u, P);');
  P('    for i = 1:numel(Y)');
  P('      if numel(scopes) < i, scopes{i} = []; end');
  P('      scopes{i}(:, end+1) = [t; Y{i}(:)];');
  P('    end');
  P('  end');
  if (m.integrator === 'rk4') {
    P('  [q, dq] = lag_rk4(q, dq, u, P, dt);');
  } else {
    P('  ddq = lag_plant_acc(q, dq, u, P);');
    P('  dq = dq + dt*ddq;');
    P('  q = q + dt*dq;');
  }
  P('  log_t(k) = t; log_q(:,k) = q; log_dq(:,k) = dq; log_u(:,k) = u;');
  P('end');
  P();
  P('%% Plots');
  P(`figure('Name', '${m.name.en}: states and input');`);
  P(`subplot(3,1,1); plot(log_t, log_q'); grid on; ylabel('q'); legend(${m.qNames.map((x) => `'${x}'`).join(', ')});`);
  P(`subplot(3,1,2); plot(log_t, log_dq'); grid on; ylabel('dq/dt');`);
  P(`subplot(3,1,3); plot(log_t, log_u'); grid on; ylabel('u'); xlabel('t [s]');`);
  const scopeBlocks = prog.blocks.filter((b) => b.node.type === 'scope');
  scopeBlocks.forEach((b, i) => {
    P(`if numel(scopes) >= ${i + 1}`);
    P(`  figure('Name', 'Scope: ${b.node.name.replace(/'/g, "''")}'); plot(scopes{${i + 1}}(1,:), scopes{${i + 1}}(2:end,:)'); grid on; xlabel('t [s]'); title('${b.node.name.replace(/'/g, "''")}');`);
    P('end');
  });
  P('end');
  P();

  // ------------------------------------------------------------ controller
  const bi = new Map<string, number>();
  prog.blocks.forEach((b, i) => bi.set(b.node.id, i + 1));
  const outVar = (i: number, port: number) => `y${i}_${port + 1}`;
  const inVar = (b: (typeof prog.blocks)[number], k: number) => {
    const src = b.inputs[k];
    return src ? outVar(src.b + 1, src.port) : '0';
  };
  const init: string[] = [];
  const out: string[] = [];
  const upd: string[] = [];
  const fcns: string[] = [];
  let scopeIdx = 0;
  const unpack = wsNames.map((k) => `${k} = W.${k}; `).join('');

  prog.blocks.forEach((b, idx) => {
    const i = idx + 1;
    const p = b.node.params;
    const Sb = `S.b${i}`;
    const u = (k: number) => inVar(b, k);
    const y = (k: number) => outVar(i, k);
    const ex = (key: string) => String(p[key] ?? '').trim() || '[]';
    out.push(`  % [${i}] ${b.node.type}: ${b.node.name}`);
    const I = (s: string) => init.push(`  ${s}`);
    const O = (s: string) => out.push(`  ${s}`);
    const U = (s: string) => upd.push(`  ${s}`);
    switch (b.node.type) {
      case 'state':
        O(`${y(0)} = q; ${y(1)} = dq; ${y(2)} = [q; dq];`);
        break;
      case 'constant':
        I(`${Sb}.value = ${ex('value')};`);
        O(`${y(0)} = ${Sb}.value;`);
        break;
      case 'step':
        I(`${Sb}.time = ${ex('time')}; ${Sb}.initial = ${ex('initial')}; ${Sb}.final = ${ex('final')};`);
        O(`if t >= ${Sb}.time, ${y(0)} = ${Sb}.final; else, ${y(0)} = ${Sb}.initial; end`);
        break;
      case 'sine':
        I(`${Sb}.amp = ${ex('amp')}; ${Sb}.freq = ${ex('freq')}; ${Sb}.phase = ${ex('phase')}; ${Sb}.bias = ${ex('bias')};`);
        O(`${y(0)} = ${Sb}.amp*sin(2*pi*${Sb}.freq*t + ${Sb}.phase) + ${Sb}.bias;`);
        break;
      case 'pulse':
        I(`${Sb}.amp = ${ex('amp')}; ${Sb}.period = ${ex('period')}; ${Sb}.duty = ${ex('duty')}; ${Sb}.delay = ${ex('delay')};`);
        O(`if t >= ${Sb}.delay && mod(t - ${Sb}.delay, ${Sb}.period)/${Sb}.period < ${Sb}.duty/100, ${y(0)} = ${Sb}.amp; else, ${y(0)} = 0*${Sb}.amp; end`);
        break;
      case 'ramp':
        I(`${Sb}.slope = ${ex('slope')}; ${Sb}.start = ${ex('start')};`);
        O(`${y(0)} = ${Sb}.slope*max(0, t - ${Sb}.start);`);
        break;
      case 'clock':
        O(`${y(0)} = t;`);
        break;
      case 'slider':
        I(`${Sb}.value = ${ex('value')};   % interactive slider exported as a constant`);
        O(`${y(0)} = ${Sb}.value;`);
        break;
      case 'target': {
        const tg = sys === 'panda' ? m.fk!(m.initialState(params).q, params).pos : [0, 0, 0];
        I(`${Sb}.p = ${mlValue(Mat.col(tg))};   % 3D target gizmo exported as its initial position`);
        O(`${y(0)} = ${Sb}.p;`);
        break;
      }
      case 'noise':
        I(`${Sb}.std = ${ex('std')};`);
        O(`${y(0)} = ${Sb}.std .* randn(size(${Sb}.std));`);
        break;
      case 'gain':
        I(`${Sb}.K = ${ex('K')};`);
        O(`${y(0)} = ${Sb}.K ${p.mode === 'elementwise' ? '.*' : '*'} ${u(0)};`);
        break;
      case 'sum': {
        const signs = String(p.signs ?? '+-').replace(/[^+-]/g, '').split('');
        O(`${y(0)} = ${signs.map((s, k) => `${k === 0 && s === '+' ? '' : s}${u(k)}`).join(' ')};`);
        break;
      }
      case 'product': {
        const ops = String(p.ops ?? '**').replace(/[^*/]/g, '').split('');
        const mat = p.mode === 'matrix';
        let e = ops[0] === '/' ? (mat ? `inv(${u(0)})` : `1./${u(0)}`) : u(0);
        for (let k = 1; k < ops.length; k++) e += mat ? (ops[k] === '*' ? ` * ${u(k)}` : ` / ${u(k)}`) : ops[k] === '*' ? ` .* ${u(k)}` : ` ./ ${u(k)}`;
        O(`${y(0)} = ${e};`);
        break;
      }
      case 'mathfn': {
        const fn = String(p.fn);
        const map: Record<string, string> = {
          square: `${u(0)}.^2`,
          wrapToPi: `wrapToPi(${u(0)})`,
          reciprocal: `1./${u(0)}`,
          norm: `norm(${u(0)})`,
          atan2: `atan2(${u(0)}, ${u(1)})`,
        };
        O(`${y(0)} = ${map[fn] ?? `${fn}(${u(0)})`};`);
        break;
      }
      case 'saturation':
        I(`${Sb}.lower = ${ex('lower')}; ${Sb}.upper = ${ex('upper')};`);
        O(`${y(0)} = min(max(${u(0)}, ${Sb}.lower), ${Sb}.upper);`);
        break;
      case 'deadzone':
        I(`${Sb}.lo = ${ex('lo')}; ${Sb}.hi = ${ex('hi')};`);
        O(`${y(0)} = (${u(0)} > ${Sb}.hi).*(${u(0)} - ${Sb}.hi) + (${u(0)} < ${Sb}.lo).*(${u(0)} - ${Sb}.lo);`);
        break;
      case 'relational':
        O(`${y(0)} = double(${u(0)} ${p.op} ${u(1)});`);
        break;
      case 'logic': {
        const op = String(p.op);
        if (op === 'NOT') O(`${y(0)} = double(~${u(0)});`);
        else {
          const n = b.nIn;
          let e = u(0);
          for (let k = 1; k < n; k++) e = op === 'XOR' ? `xor(${e}, ${u(k)})` : `(${e} ${op === 'AND' ? '&' : '|'} ${u(k)})`;
          O(`${y(0)} = double(${e});`);
        }
        break;
      }
      case 'minmax': {
        const f = p.fn === 'min' ? 'min' : 'max';
        if (b.nIn === 1) O(`${y(0)} = ${f}(${u(0)}(:));`);
        else {
          let e = u(0);
          for (let k = 1; k < b.nIn; k++) e = `${f}(${e}, ${u(k)})`;
          O(`${y(0)} = ${e};`);
        }
        break;
      }
      case 'transpose':
        O(`${y(0)} = ${u(0)}.';`);
        break;
      case 'matmul':
        O(`${y(0)} = ${u(0)} * ${u(1)};`);
        break;
      case 'mux':
        O(`${y(0)} = [${Array.from({ length: b.nIn }, (_, k) => `${u(k)}(:)`).join('; ')}];`);
        break;
      case 'demux': {
        const s = String(p.n ?? '2').trim();
        O(`tmp_ = ${u(0)}(:);`);
        if (s.startsWith('[')) {
          const sizes = s.replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
          let off = 0;
          sizes.forEach((k, j) => {
            O(`${y(j)} = tmp_(${off + 1}:${off + k});`);
            off += k;
          });
        } else {
          const n = b.nOut;
          O(`m_ = numel(tmp_)/${n};`);
          for (let j = 0; j < n; j++) O(`${y(j)} = tmp_(${j}*m_+1:${j + 1}*m_);`);
        }
        break;
      }
      case 'selector':
        I(`${Sb}.idx = ${ex('idx')};`);
        O(`${y(0)} = ${u(0)}(${Sb}.idx); ${y(0)} = ${y(0)}(:);`);
        break;
      case 'switch':
        I(`${Sb}.th = ${ex('th')};`);
        O(`if ${u(1)} >= ${Sb}.th, ${y(0)} = ${u(0)}; else, ${y(0)} = ${u(2)}; end`);
        break;
      case 'integrator':
        I(`${Sb}.x = ${ex('x0')}; ${Sb}.lo = ${String(p.lower ?? '').trim() || '-Inf'}; ${Sb}.hi = ${String(p.upper ?? '').trim() || 'Inf'};`);
        O(`${y(0)} = ${Sb}.x;`);
        U(`${Sb}.x = min(max(${Sb}.x + Ts*${u(0)}, ${Sb}.lo), ${Sb}.hi);`);
        break;
      case 'derivative':
        I(`${Sb}.N = ${ex('N')}; ${Sb}.xf = []; ${Sb}.prev = [];`);
        O(`if ${Sb}.N > 0`);
        O(`  if isempty(${Sb}.xf), ${Sb}.xf = ${u(0)}; end`);
        O(`  ${y(0)} = ${Sb}.N*(${u(0)} - ${Sb}.xf);`);
        O(`elseif isempty(${Sb}.prev), ${y(0)} = 0*${u(0)};`);
        O(`else, ${y(0)} = (${u(0)} - ${Sb}.prev)/Ts; end`);
        U(`${Sb}.prev = ${u(0)};`);
        U(`if ${Sb}.N > 0, ${Sb}.xf = ${Sb}.xf + min(1, ${Sb}.N*Ts)*(${u(0)} - ${Sb}.xf); end`);
        break;
      case 'tf':
        I(`[${Sb}.A, ${Sb}.B, ${Sb}.C, ${Sb}.D] = lag_tf2ss(${ex('num')}, ${ex('den')}); ${Sb}.x = zeros(size(${Sb}.A,1), 1);`);
        O(`${y(0)} = ${Sb}.C*${Sb}.x + ${Sb}.D*${u(0)};`);
        U(`${Sb}.x = lag_lti_step(${Sb}.A, ${Sb}.B, ${Sb}.x, ${u(0)}, Ts);`);
        break;
      case 'ss':
        I(`${Sb}.A = ${ex('A')}; ${Sb}.B = ${ex('B')}; ${Sb}.C = ${ex('C')}; ${Sb}.D = ${ex('D')}; ${Sb}.x = ${ex('x0')}(:); if numel(${Sb}.x) == 1, ${Sb}.x = ${Sb}.x*ones(size(${Sb}.A,1),1); end`);
        O(`${y(0)} = ${Sb}.C*${Sb}.x + ${Sb}.D*${u(0)};`);
        U(`${Sb}.x = lag_lti_step(${Sb}.A, ${Sb}.B, ${Sb}.x, ${u(0)}, Ts);`);
        break;
      case 'delay':
        I(`${Sb}.x = ${ex('x0')};`);
        O(`${y(0)} = ${Sb}.x;`);
        U(`${Sb}.x = ${u(0)};`);
        break;
      case 'zoh':
        I(`${Sb}.Th = max(${ex('Th')}, Ts); ${Sb}.next = 0; ${Sb}.held = 0;`);
        O(`if t + 1e-9 >= ${Sb}.next, ${Sb}.held = ${u(0)}; ${Sb}.next = t + ${Sb}.Th; end`);
        O(`${y(0)} = ${Sb}.held;`);
        break;
      case 'lowpass':
        I(`${Sb}.a = 1 - exp(-2*pi*${ex('fc')}*Ts); ${Sb}.y = [];`);
        O(`if isempty(${Sb}.y), ${Sb}.y = ${u(0)}; else, ${Sb}.y = ${Sb}.y + ${Sb}.a*(${u(0)} - ${Sb}.y); end`);
        O(`${y(0)} = ${Sb}.y;`);
        break;
      case 'pid':
        I(`${Sb}.Kp = ${ex('Kp')}; ${Sb}.Ki = ${ex('Ki')}; ${Sb}.Kd = ${ex('Kd')}; ${Sb}.N = ${ex('N')}; ${Sb}.umin = ${ex('umin')}; ${Sb}.umax = ${ex('umax')};`);
        I(`${Sb}.I = 0; ${Sb}.df = []; ${Sb}.raw = 0; ${Sb}.sat = 0;`);
        O(`if isempty(${Sb}.df), ${Sb}.df = ${u(0)}; end`);
        O(`${Sb}.raw = ${Sb}.Kp.*${u(0)} + ${Sb}.I + ${Sb}.Kd.*(${Sb}.N*(${u(0)} - ${Sb}.df));`);
        O(`${Sb}.sat = min(max(${Sb}.raw, ${Sb}.umin), ${Sb}.umax);`);
        O(`${y(0)} = ${Sb}.sat;`);
        U(`${Sb}.I = ${Sb}.I + (${Sb}.Ki.*${u(0)} + (${Sb}.sat - ${Sb}.raw))*Ts;`);
        U(`${Sb}.df = ${Sb}.df + min(1, ${Sb}.N*Ts)*(${u(0)} - ${Sb}.df);`);
        break;
      case 'lqr':
        I(`${Sb}.K = lqr(${ex('A')}, ${ex('B')}, ${ex('Q')}, ${ex('R')});`);
        O(`${y(0)} = -${Sb}.K*(${u(0)} - ${u(1)});`);
        break;
      case 'statefb':
        I(`${Sb}.K = ${ex('K')};`);
        O(`${y(0)} = -${Sb}.K*(${u(0)} - ${u(1)});`);
        break;
      case 'massmatrix':
        O(`${y(0)} = lag_M(${u(0)}, Pn);`);
        break;
      case 'coriolis':
        O(`${y(0)} = lag_Cqd(${u(0)}, ${u(1)}, Pn);`);
        break;
      case 'gravity':
        O(`${y(0)} = lag_g(${u(0)}, Pn);`);
        break;
      case 'fk':
        O(`[${y(0)}, ${y(1)}] = lag_fk(${u(0)}, Pn);`);
        break;
      case 'jacobian':
        O(`${y(0)} = lag_jac(${u(0)});`);
        break;
      case 'jdotqdot':
        O(`${y(0)} = (lag_jac(${u(0)} + 1e-6*${u(1)}) - lag_jac(${u(0)}))/1e-6*${u(1)};`);
        break;
      case 'matlabfn': {
        const code = String(p.code ?? '');
        const hm = /^\s*function\s+(?:(\[[^\]]*\]|[A-Za-z_]\w*)\s*=\s*)?[A-Za-z_]\w*\s*(?:\(([^)]*)\))?/m.exec(code);
        const outs = hm?.[1] ? hm[1].replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean) : [];
        const ins = hm?.[2] ? hm[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
        const fn = `fcn_b${i}`;
        const body = hm ? code.slice(hm.index + hm[0].length) : code;
        const unp = wsNames.filter((k) => !ins.includes(k) && !outs.includes(k) && k !== 't' && k !== 'Ts').map((k) => `${k} = W__.${k}; `).join('');
        fcns.push(`function [${outs.join(', ')}] = ${fn}(${[...ins, 't', 'Ts', 'W__'].join(', ')})`);
        fcns.push(`% MATLAB Function block "${b.node.name}"`);
        fcns.push(unp);
        fcns.push(body.replace(/\s+$/, ''));
        if (!functionHasEnd(`function x\n${body}`)) fcns.push('end');
        fcns.push('');
        O(`[${outs.map((_, k) => y(k)).join(', ')}] = ${fn}(${[...ins.map((_, k) => u(k)), 't', 'Ts', 'W'].join(', ')});`);
        break;
      }
      case 'inport':
      case 'outport':
        O(`${y(0)} = ${u(0)};`);
        break;
      case 'actuator':
        O(`u = ${u(0)}(:);`);
        break;
      case 'scope':
        scopeIdx++;
        O(`Y{${scopeIdx}} = [${Array.from({ length: b.nIn }, (_, k) => `${u(k)}(:)`).join('; ')}];`);
        break;
      default:
        O(`% (no code for this block)`);
    }
  });

  P('%% ------------------------------------------------------------------ controller');
  P('function S = ctrl_init(W, P, Pn, Ts)');
  P(`  ${unpack}`);
  P('  S = struct();');
  init.forEach((l) => P(l));
  P('end');
  P();
  P('function [u, S, Y] = ctrl_step(t, q, dq, S, W, Pn, Ts)');
  P(`  u = zeros(${m.nu}, 1);`);
  P('  Y = {};');
  out.forEach((l) => P(l));
  if (upd.length) {
    P('  % ---- state updates');
    upd.forEach((l) => P(l));
  }
  P('end');
  P();
  fcns.forEach((l) => P(l));

  // ------------------------------------------------------------ plant
  P('%% ------------------------------------------------------------------ plant model');
  P('function ddq = lag_plant_acc(q, dq, u, P)');
  P('  tau = lag_input(u, P) + lag_passive(q, dq, P);');
  P('  ddq = lag_M(q, P) \\ (tau - lag_Cqd(q, dq, P) - lag_g(q, P));');
  P('end');
  P();
  P('function [q, dq] = lag_rk4(q, dq, u, P, h)');
  P('  k1q = dq;            k1v = lag_plant_acc(q, dq, u, P);');
  P('  k2q = dq + h/2*k1v;  k2v = lag_plant_acc(q + h/2*k1q, k2q, u, P);');
  P('  k3q = dq + h/2*k2v;  k3v = lag_plant_acc(q + h/2*k2q, k3q, u, P);');
  P('  k4q = dq + h*k3v;    k4v = lag_plant_acc(q + h*k3q, k4q, u, P);');
  P('  q  = q  + h/6*(k1q + 2*k2q + 2*k3q + k4q);');
  P('  dq = dq + h/6*(k1v + 2*k2v + 2*k3v + k4v);');
  P('end');
  P();
  P('function f = lag_fric(v, b, Fc, Fs, P)');
  P("  if strcmp(P.coulomb_model, 'sign'), s = sign(v); else, s = tanh(v/max(P.coulomb_eps, 1e-6)); end");
  P('  mag = Fc;');
  P('  if Fs > Fc, mag = Fc + (Fs - Fc)*exp(-(v/max(P.stribeck_vs,1e-6))^2); end');
  P('  f = b*v + mag*s;');
  P('end');
  P();
  if (sys === 'cartpole') {
    P('function M = lag_M(q, P)');
    P('  c = cos(q(2));');
    P('  M = [P.m_c + P.m_p, P.m_p*P.l*c; P.m_p*P.l*c, P.m_p*P.l^2];');
    P('end');
    P('function h = lag_Cqd(q, dq, P)');
    P('  h = [-P.m_p*P.l*sin(q(2))*dq(2)^2; 0];');
    P('end');
    P('function g = lag_g(q, P)');
    P('  g = [0; -P.m_p*P.g*P.l*sin(q(2))];');
    P('end');
    P('function tau = lag_input(u, P)');
    P('  tau = [u(1); 0];');
    P('end');
    P('function u = lag_saturate(u, P)');
    P('  u = min(max(u, -P.u_max), P.u_max);');
    P('end');
    P('function Q = lag_passive(q, dq, P)');
    P('  Q = [-lag_fric(dq(1), P.b_c, P.F_c, P.F_s, P); -lag_fric(dq(2), P.b_p, P.F_cp, 0, P)];');
    P(`  if P.c_air > 0   % quadratic air drag on the bob, mapped with J'`);
    P('    c = cos(q(2)); s = sin(q(2));');
    P('    v = [dq(1) + P.l*c*dq(2); -P.l*s*dq(2)];');
    P('    F = -P.c_air*norm(v)*v;');
    P('    Q = Q + [1, 0; P.l*c, -P.l*s]*F;');
    P('  end');
    P(`  lim = P.track/2 - 0.15;   % end stops (penalty contact)`);
    P('  if q(1) > lim, Q(1) = Q(1) + min(0, -P.bumper_k*(q(1)-lim) - P.bumper_d*dq(1)); end');
    P('  if q(1) < -lim, Q(1) = Q(1) + max(0, -P.bumper_k*(q(1)+lim) - P.bumper_d*dq(1)); end');
    P('end');
  } else if (sys === 'furuta') {
    P('function M = lag_M(q, P)');
    P('  s = sin(q(2)); c = cos(q(2)); K = P.m_2*P.L_1*P.l_2;');
    P('  M = [P.J_0 + P.J_2*s^2, K*c; K*c, P.J_2];');
    P('end');
    P('function h = lag_Cqd(q, dq, P)');
    P('  s = sin(q(2)); c = cos(q(2)); K = P.m_2*P.L_1*P.l_2;');
    P('  h = [2*P.J_2*s*c*dq(1)*dq(2) - K*s*dq(2)^2; -P.J_2*s*c*dq(1)^2];');
    P('end');
    P('function g = lag_g(q, P)');
    P('  g = [0; -P.m_2*P.g*P.l_2*sin(q(2))];');
    P('end');
    P('function tau = lag_input(u, P)');
    P('  tau = [u(1); 0];');
    P('end');
    P('function u = lag_saturate(u, P)');
    P('  u = min(max(u, -P.u_max), P.u_max);');
    P('end');
    P('function Q = lag_passive(q, dq, P)');
    P('  Q = [-lag_fric(dq(1), P.b_1, P.F_c1, P.F_s1, P); -lag_fric(dq(2), P.b_2, P.F_c2, 0, P)];');
    P('end');
  } else {
    const links = buildLinks(Number(params.payload) || 0);
    const linksNom = buildLinks(0);
    const emitLinks = (name: string, ls: typeof links) => {
      P(`  ${name}.m = [${ls.map((l) => fmtNum(l.m)).join(' ')}];`);
      P(`  ${name}.c = [${ls.map((l) => l.c.map(fmtNum).join('; ')).join(', ')}];`);
      ls.forEach((l, k) => P(`  ${name}.I{${k + 1}} = [${[0, 1, 2].map((r) => [0, 1, 2].map((c) => fmtNum(l.I[r * 3 + c])).join(' ')).join('; ')}];`));
    };
    P('function Lk = lag_links(P)');
    P('  if P.payload > 0');
    emitLinks('Lk', links);
    P('  else');
    emitLinks('Lk', linksNom);
    P('  end');
    P('end');
    P();
    P('function [R, p, z] = lag_fk_all(q)');
    P(`  a = [${DH.a.map(fmtNum).join(' ')}]; d = [${DH.d.map(fmtNum).join(' ')}]; al = [${DH.alpha.map(fmtNum).join(' ')}];`);
    P('  R = cell(1, 8); p = cell(1, 8); z = cell(1, 8);');
    P('  R{1} = eye(3); p{1} = zeros(3,1); z{1} = [0;0;1];');
    P('  for i = 1:7');
    P('    ca = cos(al(i)); sa = sin(al(i)); cq = cos(q(i)); sq = sin(q(i));');
    P('    Rx = [1 0 0; 0 ca -sa; 0 sa ca]; Rz = [cq -sq 0; sq cq 0; 0 0 1];');
    P('    R{i+1} = R{i}*Rx*Rz;');
    P('    p{i+1} = p{i} + R{i}*[a(i); 0; 0] + R{i+1}*[0; 0; d(i)];');
    P('    z{i+1} = R{i+1}(:,3);');
    P('  end');
    P('end');
    P();
    P('function tau = lag_rnea(q, dq, ddq, P, grav)');
    P('  [R, p, z] = lag_fk_all(q); Lk = lag_links(P);');
    P('  w = zeros(3,1); wd = zeros(3,1); a = [0; 0; grav];');
    P('  F = zeros(3,7); Nm = zeros(3,7); rc = zeros(3,7);');
    P('  for i = 1:7');
    P('    zi = z{i+1}; dp = p{i+1} - p{i};');
    P('    ai = a + cross(wd, dp) + cross(w, cross(w, dp));');
    P('    wi = w + zi*dq(i);');
    P('    wdi = wd + zi*ddq(i) + cross(w, zi*dq(i));');
    P('    r = R{i+1}*Lk.c(:,i);');
    P('    ac = ai + cross(wdi, r) + cross(wi, cross(wi, r));');
    P(`    Iw = R{i+1}*Lk.I{i}*R{i+1}';`);
    P('    F(:,i) = Lk.m(i)*ac; Nm(:,i) = Iw*wdi + cross(wi, Iw*wi); rc(:,i) = r;');
    P('    w = wi; wd = wdi; a = ai;');
    P('  end');
    P('  tau = zeros(7,1); f = zeros(3,1); n = zeros(3,1);');
    P('  for i = 7:-1:1');
    P('    if i < 7, dpn = p{i+2} - p{i+1}; else, dpn = zeros(3,1); end');
    P('    n = Nm(:,i) + cross(rc(:,i), F(:,i)) + n + cross(dpn, f);');
    P('    f = F(:,i) + f;');
    P(`    tau(i) = z{i+1}'*n;`);
    P('  end');
    P('end');
    P();
    P('function M = lag_M(q, P)');
    P('  M = zeros(7);');
    P('  for j = 1:7, e = zeros(7,1); e(j) = 1; M(:,j) = lag_rnea(q, zeros(7,1), e, P, 0); end');
    P(`  M = (M + M')/2 + P.armature*eye(7);`);
    P('end');
    P('function h = lag_Cqd(q, dq, P)');
    P('  h = lag_rnea(q, dq, zeros(7,1), P, 0);');
    P('end');
    P('function g = lag_g(q, P)');
    P('  g = lag_rnea(q, zeros(7,1), zeros(7,1), P, P.g);');
    P('end');
    P('function [pos, Rt] = lag_fk(q, ~)');
    P('  [R, p] = lag_fk_all(q);');
    P(`  pos = p{8} + R{8}*[0; 0; ${fmtNum(TCP_OFFSET)}];`);
    P('  c = cos(-pi/4); s = sin(-pi/4);');
    P('  Rt = R{8}*[c -s 0; s c 0; 0 0 1];');
    P('end');
    P('function J = lag_jac(q)');
    P('  [R, p, z] = lag_fk_all(q);');
    P(`  pt = p{8} + R{8}*[0; 0; ${fmtNum(TCP_OFFSET)}];`);
    P('  J = zeros(6,7);');
    P('  for j = 1:7, J(:,j) = [cross(z{j+1}, pt - p{j+1}); z{j+1}]; end');
    P('end');
    P('function tau = lag_input(u, P)');
    P('  tau = u;');
    P('end');
    P('function u = lag_saturate(u, P)');
    P(`  lim = P.u_max*[${TAU_MAX.join('; ')}];`);
    P('  u = min(max(u, -lim), lim);');
    P('end');
    P('function Q = lag_passive(q, dq, P)');
    P(`  qmin = [${Q_MIN.join('; ')}]; qmax = [${Q_MAX.join('; ')}];`);
    P('  Q = zeros(7,1);');
    P('  for i = 1:7');
    P('    Q(i) = -lag_fric(dq(i), P.b_j, P.F_cj, P.F_sj, P);');
    P('    if q(i) > qmax(i), Q(i) = Q(i) + min(0, -3000*(q(i)-qmax(i)) - 30*dq(i)); end');
    P('    if q(i) < qmin(i), Q(i) = Q(i) + max(0, -3000*(q(i)-qmin(i)) - 30*dq(i)); end');
    P('  end');
    P('end');
  }
  P();
  P('%% ------------------------------------------------------------------ helpers');
  P('function [A, B, C, D] = lag_tf2ss(num, den)');
  P(`  num = num(:).'; den = den(:).';`);
  P('  while numel(den) > 1 && den(1) == 0, den(1) = []; end');
  P('  num = [zeros(1, numel(den) - numel(num)), num] / den(1); den = den / den(1);');
  P('  n = numel(den) - 1; D = num(1);');
  P('  if n == 0, A = zeros(0); B = zeros(0,1); C = zeros(1,0); return; end');
  P('  A = [-den(2:end); eye(n-1, n)]; B = [1; zeros(n-1,1)];');
  P('  C = num(2:end) - D*den(2:end);');
  P('end');
  P('function x = lag_lti_step(A, B, x, u, Ts)');
  P('  h = Ts/4;');
  P('  for k = 1:4');
  P('    k1 = A*x + B*u; k2 = A*(x + h/2*k1) + B*u; k3 = A*(x + h/2*k2) + B*u; k4 = A*(x + h*k3) + B*u;');
  P('    x = x + h/6*(k1 + 2*k2 + 2*k3 + k4);');
  P('  end');
  P('end');
  P('function [K, Pr] = lqr(A, B, Q, R)');
  P('% Continuous-time LQR via the Hamiltonian eigenvector method (no toolbox needed).');
  P('  n = size(A,1);');
  P(`  H = [A, -B*(R\\B.'); -Q, -A.'];`);
  P('  [V, E] = eig(H);');
  P('  [~, idx] = sort(real(diag(E)));');
  P('  V = V(:, idx(1:n));');
  P('  Pr = real(V(n+1:end,:)/V(1:n,:));');
  P(`  Pr = (Pr + Pr.')/2;`);
  P(`  K = R\\(B.'*Pr);`);
  P('end');
  P('function y = wrapToPi(x)');
  P('  y = mod(x + pi, 2*pi) - pi;');
  P('end');
  P('function y = sat(x, a, b)');
  P('  if nargin == 2, y = min(max(x, -a), a); else, y = min(max(x, a), b); end');
  P('end');
  P('function S = skew(v)');
  P('  S = [0 -v(3) v(2); v(3) 0 -v(1); -v(2) v(1) 0];');
  P('end');
  void flat;
  void valueToString;
  return L.join('\n') + '\n';
}
