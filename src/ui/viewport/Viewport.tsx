import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { SystemId } from '../../core/types';
import { useT } from '../i18n';
import { useRt, useRtVersion } from '../runtimeCtx';
import { CartPoleScene, FurutaScene, PandaScene } from './scenes';

const CAM: Record<SystemId, { pos: [number, number, number]; target: [number, number, number]; fov: number }> = {
  cartpole: { pos: [0.2, 1.0, 2.6], target: [0, 0.55, 0], fov: 45 },
  furuta: { pos: [0.55, 0.62, 0.75], target: [0, 0.38, 0], fov: 45 },
  panda: { pos: [1.55, 1.05, 1.35], target: [0.25, 0.35, 0], fov: 45 },
};

function ReplayBar() {
  const rt = useRt();
  const t = useT();
  useRtVersion(rt);
  const [, force] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (ref.current && rt.replay) ref.current.value = String(rt.replay.t);
      force((x) => (x + 1) % 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rt]);
  if (!rt.replay) return null;
  const fr = rt.replay.rec.frames;
  const t0 = fr[0]?.t ?? 0,
    t1 = fr[fr.length - 1]?.t ?? 0;
  return (
    <div className="replaybar">
      <button onClick={() => rt.replay && ((rt.replay.playing = !rt.replay.playing), rt.replay.t >= t1 && rt.replay.playing && (rt.replay.t = t0))}>{rt.replay.playing ? '⏸' : '▶'}</button>
      <input ref={ref} type="range" min={t0} max={t1} step={0.01} defaultValue={t0} onChange={(e) => rt.replay && ((rt.replay.t = Number(e.target.value)), (rt.replay.playing = false))} />
      <span className="mono small">{rt.replay.t.toFixed(2)} s</span>
      <button onClick={() => rt.stopReplay()}>✕ {t('exitReplay')}</button>
    </div>
  );
}

export function Viewport({ system }: { system: SystemId }) {
  const rt = useRt();
  const t = useT();
  useRtVersion(rt);
  const cam = CAM[system];
  const err = rt.simError ? `${t('simDiverged')}: ${rt.simError}` : rt.program?.runtimeError ? `${t('controllerError')}: ${rt.program.runtimeError.msg}` : null;
  return (
    <>
      <Canvas shadows camera={{ position: cam.pos, fov: cam.fov, near: 0.01, far: 50 }} dpr={[1, 2]} onCreated={({ gl }) => gl.setClearColor('#0b0f14')}>
        <fog attach="fog" args={['#0b0f14', 4, 12]} />
        <hemisphereLight args={['#cfe6ff', '#1a1f26', 0.7]} />
        <directionalLight position={[2.5, 4, 2]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-2} shadow-camera-right={2} shadow-camera-top={2} shadow-camera-bottom={-2} />
        <directionalLight position={[-3, 2, -2]} intensity={0.4} />
        <Grid args={[20, 20]} position={[0, 0, 0]} cellSize={0.1} cellThickness={0.6} cellColor="#1f2a36" sectionSize={1} sectionThickness={1.1} sectionColor="#2f4157" fadeDistance={10} infiniteGrid />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <shadowMaterial opacity={0.35} />
        </mesh>
        <axesHelper args={[0.15]} position={[-0.001, 0.001, 0]} />
        {system === 'cartpole' && <CartPoleScene />}
        {system === 'furuta' && <FurutaScene />}
        {system === 'panda' && <PandaScene />}
        <OrbitControls makeDefault target={cam.target} enableDamping dampingFactor={0.12} />
      </Canvas>
      <div className="hud">
        <span>
          <span className="badge">{rt.replay ? t('replaying') : t('live')}</span> {rt.recording && <span className="recdot" />}
        </span>
        {rt.realistic && <span className="small">📡 {t('realistic')}</span>}
        {rt.ghostEnabled && rt.sim.ghostError && <span className="small err">👻 {rt.sim.ghostError}</span>}
      </div>
      {err && <div className="banner">{err}</div>}
      <div className="hint-bar">{t('dragHint')}</div>
      <ReplayBar />
    </>
  );
}
