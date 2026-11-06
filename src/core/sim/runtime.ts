import type { V3 } from '../linalg';
import { compile, Program } from '../blocks/compiler';
import { flat } from '../blocks/library';
import type { BlockCtx, BlockIO, Model } from '../blocks/types';
import { runScript, Value } from '../matlab/interp';
import { paramScope } from '../systems';
import type { Params, SystemModel } from '../types';
import { GhostAccel, linearize, Simulator } from './simulator';

export interface ScopeBuf {
  id: string;
  name: string;
  t: number[];
  ch: number[][];
  labels: string[];
}

export interface Frame {
  t: number;
  q: number[];
  dq: number[];
  u: number[];
  gq?: number[] | null;
  drag?: { a: V3; b: V3 } | null;
  target?: V3;
}

export interface Recording {
  id: string;
  name: string;
  system: string;
  created: number;
  frames: Frame[];
  scopes: Record<string, ScopeBuf>;
  params: Params;
}

const MAX_SCOPE_SAMPLES = 12000;

function pushSample(buf: ScopeBuf, t: number, vals: number[], max = MAX_SCOPE_SAMPLES) {
  if (buf.ch.length !== vals.length) {
    buf.t = [];
    buf.ch = vals.map(() => []);
  }
  buf.t.push(t);
  vals.forEach((v, i) => buf.ch[i].push(v));
  if (max && buf.t.length > max) {
    const cut = Math.floor(max / 4);
    buf.t.splice(0, cut);
    buf.ch.forEach((c) => c.splice(0, cut));
  }
}

export class Runtime {
  model: SystemModel;
  params: Params;
  sim: Simulator;
  program: Program | null = null;
  ctrlModel: Model;
  ws: Record<string, Value> = {};
  wsError: string | null = null;
  wsKey = '';
  realistic = false;
  controllerOn = true;
  playing = false;
  speed = 1;
  realtimeFactor = 1;
  simError: string | null = null;
  target: V3 = [0, 0, 0];
  scopes = new Map<string, ScopeBuf>();
  plantScope: ScopeBuf;
  displays = new Map<string, Value[]>();
  infos = new Map<string, string>();
  sliders = new Map<string, number>();
  recording: Recording | null = null;
  replay: { rec: Recording; t: number; playing: boolean } | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  private nextCtrl = 0;
  private raf = 0;
  private lastWall = 0;
  private decim = 1;
  private ctrlCount = 0;
  private lastRecT = -1;
  private uLast: number[];
  ghostEnabled = false;
  private ghostFn: GhostAccel | null = null;
  keyForce: V3 = [0, 0, 0];

  constructor(model: SystemModel, params: Params, ctrl: Model) {
    this.model = model;
    this.params = { ...params };
    this.sim = new Simulator(model, this.params);
    this.ctrlModel = ctrl;
    this.uLast = new Array(model.nu).fill(0);
    this.plantScope = this.makePlantScope();
    const fk = model.fk?.(this.sim.q, this.params);
    this.target = fk ? (fk.pos.slice() as V3) : [0, 0, 0];
    if (model.id === 'cartpole') this.target = [0, 0, 0];
    this.rebuildWorkspace();
  }

  private makePlantScope(): ScopeBuf {
    const m = this.model;
    return {
      id: '__plant',
      name: 'Plant',
      t: [],
      ch: [],
      labels: [...m.qNames, ...m.qNames.map((n) => `d${n}`), ...m.uNames],
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ------------------------------------------------------------ configuration
  setParams(p: Params) {
    this.params = { ...p };
    this.sim.params = this.params;
    this.rebuildWorkspace();
  }

  setController(m: Model) {
    const scriptChanged = m.initScript !== this.ctrlModel.initScript || m.Ts !== this.ctrlModel.Ts;
    this.ctrlModel = m;
    if (scriptChanged) this.rebuildWorkspace();
    else this.recompile();
  }

  rebuildWorkspace() {
    const base: Record<string, Value> = { ...paramScope(this.model, this.params), n: this.model.n, Ts: this.ctrlModel.Ts };
    try {
      const lin = linearize(this.model, this.params);
      if (lin) {
        base.A_lin = lin.A;
        base.B_lin = lin.B;
      }
    } catch {
      /* ignore */
    }
    this.wsError = null;
    try {
      const env = runScript(this.ctrlModel.initScript || '', base);
      this.ws = Object.fromEntries(env.entries());
    } catch (e) {
      this.ws = base;
      this.wsError = (e as Error).message;
    }
    this.wsKey = JSON.stringify(this.params) + '|' + this.ctrlModel.initScript + '|' + this.ctrlModel.Ts;
    this.recompile();
  }

  nominalParams(): Params {
    return this.model.id === 'panda' ? { ...this.params, payload: 0 } : this.params;
  }

  private io: BlockIO = {
    sensor: () => this.currentMeas,
    actuate: (u) => {
      this.pendingU = u;
    },
    target: () => this.target.slice(),
    scope: (id, t, vals) => {
      let buf = this.scopes.get(id);
      const node = this.program?.byId.get(id)?.node;
      if (!buf) {
        buf = { id, name: node?.name ?? id, t: [], ch: [], labels: [] };
        this.scopes.set(id, buf);
      }
      if (this.ctrlCount % this.decim !== 0) return;
      const fl = vals.map(flat);
      const labels: string[] = [];
      fl.forEach((arr, i) => arr.forEach((_, j) => labels.push(arr.length > 1 ? `u${i + 1}(${j + 1})` : `u${i + 1}`)));
      buf.labels = labels;
      const all = fl.flat();
      pushSample(buf, t, all);
      if (this.recording) {
        const rb = (this.recording.scopes[id] ??= { id, name: buf.name, t: [], ch: [], labels });
        rb.labels = labels;
        pushSample(rb, t, all, 0);
      }
    },
    display: (id, vals) => {
      this.displays.set(id, vals);
    },
    slider: (id) => this.sliders.get(id),
    info: (id, text) => {
      this.infos.set(id, text);
    },
  };
  private currentMeas: { q: number[]; dq: number[] } = { q: [], dq: [] };
  private pendingU: number[] | null = null;

  recompile() {
    const ctxFor = (id: string): BlockCtx => ({
      Ts: this.ctrlModel.Ts,
      model: this.model,
      params: this.params,
      nominal: this.nominalParams(),
      ws: this.ws,
      io: this.io,
      id,
    });
    this.program = compile(this.ctrlModel.diagram, ctxFor, this.wsKey, this.program);
    const live = new Set(this.program.blocks.filter((b) => b.node.type === 'scope').map((b) => b.node.id));
    for (const id of [...this.scopes.keys()]) if (!live.has(id)) this.scopes.delete(id);
    this.program.blocks.forEach((b) => {
      const s = this.scopes.get(b.node.id);
      if (s) s.name = b.node.name;
    });
    this.notify();
  }

  setGhost(fn: GhostAccel | null) {
    this.ghostFn = fn;
    this.sim.ghostAccel = this.ghostEnabled ? fn : null;
    this.sim.resetGhost();
  }
  setGhostEnabled(on: boolean) {
    this.ghostEnabled = on;
    this.sim.ghostAccel = on ? this.ghostFn : null;
    this.sim.resetGhost();
    this.notify();
  }
  hasGhostModel() {
    return !!this.ghostFn;
  }

  // ------------------------------------------------------------ execution
  reset() {
    this.sim.reset();
    this.simError = null;
    this.nextCtrl = 0;
    this.ctrlCount = 0;
    this.scopes.forEach((s) => {
      s.t = [];
      s.ch = [];
    });
    this.plantScope.t = [];
    this.plantScope.ch = [];
    this.displays.clear();
    this.uLast = new Array(this.model.nu).fill(0);
    this.lastRecT = -1;
    // recreate block instances so integrators etc. start fresh
    this.program = null;
    if (this.program === null) this.recompile();
    this.notify();
  }

  private controllerStep() {
    const Ts = this.ctrlModel.Ts;
    this.decim = Math.max(1, Math.round(0.002 / Ts));
    this.currentMeas = this.sim.measure(this.realistic, Ts);
    this.pendingU = null;
    const t = this.sim.t;
    if (this.controllerOn && this.program && this.program.errors.length === 0 && !this.program.runtimeError) {
      this.program.step(t);
      if (this.program.runtimeError) this.notify();
    }
    const u = this.controllerOn && this.pendingU ? this.pendingU : new Array(this.model.nu).fill(0);
    this.sim.command(u);
    this.uLast = this.sim.uApplied;
    if (this.ctrlCount % this.decim === 0) {
      pushSample(this.plantScope, t, [...this.sim.q, ...this.sim.dq, ...this.sim.uApplied]);
      if (this.recording) {
        const rb = (this.recording.scopes.__plant ??= { ...this.plantScope, t: [], ch: [] });
        pushSample(rb, t, [...this.sim.q, ...this.sim.dq, ...this.sim.uApplied], 0);
      }
    }
    this.ctrlCount++;
  }

  /** advance one physics step (runs the controller when due) */
  physicsStep() {
    const dt = this.model.dt;
    if (this.sim.t + 1e-9 >= this.nextCtrl) {
      this.controllerStep();
      this.nextCtrl += this.ctrlModel.Ts;
      if (this.nextCtrl < this.sim.t) this.nextCtrl = this.sim.t + this.ctrlModel.Ts;
    }
    if (this.keyForce.some((v) => v !== 0)) {
      const body = this.model.id === 'cartpole' ? 'cart' : this.model.id === 'furuta' ? 'pendulum' : 'link7';
      const local: V3 = this.model.id === 'furuta' ? [Number(this.params.L_2), 0, 0] : this.model.id === 'panda' ? [0, 0, 0.2] : [0, 0, 0];
      this.sim.kick(body, local, this.keyForce, dt * 1.5);
    }
    this.sim.step();
    if (this.recording && this.sim.t - this.lastRecT >= 0.01 - 1e-9) {
      this.lastRecT = this.sim.t;
      this.recording.frames.push(this.snapshot());
    }
  }

  snapshot(): Frame {
    const d = this.sim.drag;
    return {
      t: this.sim.t,
      q: this.sim.q.slice(),
      dq: this.sim.dq.slice(),
      u: this.sim.uApplied.slice(),
      gq: this.sim.ghostQ ? this.sim.ghostQ.slice() : null,
      drag: d ? { a: this.model.bodyPoint(this.sim.q, d.body, d.local, this.params), b: d.target.slice() as V3 } : null,
      target: this.target.slice() as V3,
    };
  }

  /** advance simulated time by `dt` seconds (bounded by a wall-clock budget) */
  advance(dt: number, budgetMs = 30) {
    const steps = Math.round(dt / this.model.dt);
    const t0 = performance.now();
    let done = 0;
    try {
      for (; done < steps; done++) {
        this.physicsStep();
        if ((done & 31) === 0 && performance.now() - t0 > budgetMs) break;
      }
    } catch (e) {
      this.simError = (e as Error).message;
      this.playing = false;
      this.notify();
    }
    return done / Math.max(steps, 1);
  }

  stepOnce() {
    const n = Math.max(1, Math.round(this.ctrlModel.Ts / this.model.dt));
    for (let i = 0; i < n; i++) this.physicsStep();
    this.notify();
  }

  start() {
    if (this.playing) return;
    if (this.replay) this.replay = null;
    this.playing = true;
    this.lastWall = performance.now();
    const loop = () => {
      if (!this.playing) return;
      const now = performance.now();
      const wall = Math.min((now - this.lastWall) / 1000, 0.05);
      this.lastWall = now;
      const frac = this.advance(wall * this.speed);
      this.realtimeFactor = 0.9 * this.realtimeFactor + 0.1 * frac * this.speed;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.notify();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.notify();
  }

  dispose() {
    this.pause();
    this.listeners.clear();
  }

  // ------------------------------------------------------------ recording / replay
  startRecording(name: string) {
    this.recording = {
      id: `rec-${Date.now()}`,
      name,
      system: this.model.id,
      created: Date.now(),
      frames: [this.snapshot()],
      scopes: {},
      params: { ...this.params },
    };
    this.lastRecT = this.sim.t;
    this.notify();
  }
  stopRecording(): Recording | null {
    const r = this.recording;
    this.recording = null;
    this.notify();
    return r;
  }
  startReplay(rec: Recording) {
    this.pause();
    this.replay = { rec, t: rec.frames[0]?.t ?? 0, playing: true };
    let last = performance.now();
    const loop = () => {
      if (!this.replay) return;
      const now = performance.now();
      if (this.replay.playing) {
        this.replay.t += ((now - last) / 1000) * this.speed;
        const end = this.replay.rec.frames[this.replay.rec.frames.length - 1]?.t ?? 0;
        if (this.replay.t >= end) {
          this.replay.t = end;
          this.replay.playing = false;
        }
      }
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.notify();
  }
  stopReplay() {
    this.replay = null;
    this.notify();
  }

  /** state to render (live or replay) */
  renderState(): Frame {
    if (this.replay) {
      const fr = this.replay.rec.frames;
      const t = this.replay.t;
      let lo = 0,
        hi = fr.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fr[mid].t <= t) lo = mid;
        else hi = mid;
      }
      const a = fr[lo],
        b = fr[hi] ?? a;
      const s = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      const lerp = (x: number[], y: number[]) => x.map((v, i) => v + s * ((y[i] ?? v) - v));
      return { ...a, t, q: lerp(a.q, b.q), dq: lerp(a.dq, b.dq), gq: a.gq && b.gq ? lerp(a.gq, b.gq) : a.gq };
    }
    return this.snapshot();
  }
}
