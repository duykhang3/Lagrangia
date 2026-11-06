import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { V3 } from '../../core/linalg';
import { CART_HALF_WIDTH } from '../../core/systems/cartpole';
import { DH, pandaFK, pandaLinkSegments, TCP_OFFSET } from '../../core/systems/panda';
import { useRt, useRtVersion } from '../runtimeCtx';
import { DragLine, mat, TargetGizmo, useBodyDrag } from './common3d';

// ------------------------------------------------------------------ cart-pole
const PIVOT_H = 0.42;

function CartPoleBody({ ghost, qRef }: { ghost?: boolean; qRef: (f: ReturnType<ReturnType<typeof useRt>['renderState']>) => number[] | null | undefined }) {
  const rt = useRt();
  useRtVersion(rt);
  const cart = useRef<THREE.Group>(null);
  const pole = useRef<THREE.Group>(null);
  const grp = useRef<THREE.Group>(null);
  const l = Number(rt.params.l);
  useFrame(() => {
    const q = qRef(rt.renderState());
    if (grp.current) grp.current.visible = !!q;
    if (!q) return;
    cart.current?.position.set(q[0], 0, 0);
    pole.current?.position.set(q[0], 0, 0);
    if (pole.current) pole.current.rotation.z = -q[1];
  });
  const m = ghost ? mat.ghost : undefined;
  return (
    <group ref={grp}>
      <group ref={cart} userData={{ body: ghost ? undefined : 'cart' }}>
        <mesh castShadow material={m ?? mat.blue}>
          <boxGeometry args={[CART_HALF_WIDTH * 2, 0.12, 0.2]} />
        </mesh>
        {!ghost &&
          [-0.09, 0.09].map((x) =>
            [-0.08, 0.08].map((z) => (
              <mesh key={`${x}${z}`} position={[x, -0.075, z]} rotation={[Math.PI / 2, 0, 0]} material={mat.dark}>
                <cylinderGeometry args={[0.03, 0.03, 0.025, 16]} />
              </mesh>
            )),
          )}
        <mesh position={[0, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]} material={m ?? mat.metal}>
          <cylinderGeometry args={[0.02, 0.02, 0.03, 16]} />
        </mesh>
      </group>
      <group ref={pole} position={[0, 0, 0.13]} userData={{ body: ghost ? undefined : 'pole' }}>
        <mesh position={[0, l / 2, 0.0]} castShadow material={m ?? mat.accent}>
          <cylinderGeometry args={[0.012, 0.012, l, 12]} />
        </mesh>
        <mesh position={[0, l, 0]} castShadow material={m ?? mat.orange}>
          <sphereGeometry args={[0.045, 24, 24]} />
        </mesh>
      </group>
    </group>
  );
}

function ForceArrow({ get, scale, origin }: { get: () => number; scale: number; origin: () => V3 }) {
  const ref = useRef<THREE.ArrowHelper>(null);
  const arrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.1, 0xff6b6b, 0.04, 0.03), []);
  useFrame(() => {
    const f = get();
    const o = origin();
    arrow.position.set(o[0], o[1], o[2]);
    const len = Math.min(Math.abs(f) * scale, 0.8);
    arrow.visible = len > 0.01;
    arrow.setDirection(new THREE.Vector3(Math.sign(f) || 1, 0, 0));
    if (len > 0.01) arrow.setLength(len, Math.min(0.05, len * 0.4), 0.03);
  });
  return <primitive ref={ref} object={arrow} />;
}

export function CartPoleScene() {
  const rt = useRt();
  useRtVersion(rt);
  const root = useRef<THREE.Group>(null);
  const onDown = useBodyDrag(root);
  const track = Number(rt.params.track);
  return (
    <group ref={root} position={[0, PIVOT_H, 0]} onPointerDown={onDown}>
      <mesh position={[0, -0.1, 0]} receiveShadow castShadow material={mat.metal}>
        <boxGeometry args={[track, 0.025, 0.06]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[(s * track) / 2, -0.06, 0]} material={mat.dark} castShadow>
            <boxGeometry args={[0.03, 0.1, 0.1]} />
          </mesh>
          <mesh position={[(s * track) / 2.2, -PIVOT_H / 2 - 0.06, 0]} material={mat.dark} castShadow>
            <boxGeometry args={[0.04, PIVOT_H - 0.12, 0.04]} />
          </mesh>
        </group>
      ))}
      <CartPoleBody qRef={(f) => f.q} />
      {rt.ghostEnabled && <CartPoleBody ghost qRef={(f) => f.gq} />}
      <ForceArrow get={() => rt.renderState().u[0] ?? 0} scale={0.03} origin={() => [rt.renderState().q[0] - Math.sign(rt.renderState().u[0] || 1) * 0.16, 0, 0.12]} />
      <DragLine />
      <TargetGizmo axes="x" size={0.5} />
    </group>
  );
}

// ------------------------------------------------------------------ furuta
const FURUTA_H = 0.32;

function FurutaBody({ ghost, qRef }: { ghost?: boolean; qRef: (f: ReturnType<ReturnType<typeof useRt>['renderState']>) => number[] | null | undefined }) {
  const rt = useRt();
  useRtVersion(rt);
  const arm = useRef<THREE.Group>(null);
  const pend = useRef<THREE.Group>(null);
  const grp = useRef<THREE.Group>(null);
  const L1 = Number(rt.params.L_1),
    L2 = Number(rt.params.L_2);
  useFrame(() => {
    const q = qRef(rt.renderState());
    if (grp.current) grp.current.visible = !!q;
    if (!q) return;
    if (arm.current) arm.current.rotation.z = q[0];
    if (pend.current) pend.current.rotation.x = -q[1];
  });
  const m = ghost ? mat.ghost : undefined;
  return (
    <group ref={grp}>
      <group ref={arm} userData={{ body: ghost ? undefined : 'arm' }}>
        <mesh position={[0, 0, 0]} material={m ?? mat.dark} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.03, 20]} />
        </mesh>
        <mesh position={[L1 / 2, 0, 0]} castShadow material={m ?? mat.blue}>
          <boxGeometry args={[L1, 0.022, 0.022]} />
        </mesh>
        <group ref={pend} position={[L1 + 0.012, 0, 0]} userData={{ body: ghost ? undefined : 'pendulum' }}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={m ?? mat.metal}>
            <cylinderGeometry args={[0.012, 0.012, 0.03, 16]} />
          </mesh>
          <mesh position={[0.005, 0, L2 / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow material={m ?? mat.accent}>
            <cylinderGeometry args={[0.008, 0.008, L2, 12]} />
          </mesh>
          <mesh position={[0.005, 0, L2]} material={m ?? mat.orange}>
            <sphereGeometry args={[0.014, 16, 16]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function FurutaScene() {
  const rt = useRt();
  const root = useRef<THREE.Group>(null);
  const onDown = useBodyDrag(root);
  return (
    <group ref={root} position={[0, FURUTA_H, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onDown}>
      <mesh position={[0, 0, -FURUTA_H / 2 - 0.016]} rotation={[Math.PI / 2, 0, 0]} material={mat.dark} castShadow receiveShadow>
        <cylinderGeometry args={[0.05, 0.08, FURUTA_H - 0.03, 32]} />
      </mesh>
      <mesh position={[0, 0, -0.022]} rotation={[Math.PI / 2, 0, 0]} material={mat.metal}>
        <cylinderGeometry args={[0.04, 0.04, 0.015, 32]} />
      </mesh>
      <FurutaBody qRef={(f) => f.q} />
      {rt.ghostEnabled && <FurutaBody ghost qRef={(f) => f.gq} />}
      <DragLine />
      <TargetGizmo size={0.4} />
    </group>
  );
}

// ------------------------------------------------------------------ panda
function Capsule({ a, b, r, material }: { a: V3; b: V3; r: number; material: THREE.Material }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a),
      vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const len = d.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    return { pos: va.add(vb).multiplyScalar(0.5), quat, len };
  }, [a, b]);
  return (
    <mesh position={pos} quaternion={quat} material={material} castShadow>
      <capsuleGeometry args={[r, len, 8, 20]} />
    </mesh>
  );
}

function PandaLinkGeom({ L }: { L: number }) {
  const segs = pandaLinkSegments(L);
  const r = L <= 1 ? 0.06 : L <= 4 ? 0.055 : 0.045;
  return (
    <>
      {L >= 1 && (
        <mesh material={mat.dark} castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * 1.12, r * 1.12, r * 2.4, 28]} />
        </mesh>
      )}
      {segs.map(([a, b], i) => (
        <Capsule key={i} a={a} b={b} r={r} material={mat.body} />
      ))}
      {L === 7 && (
        <group position={[0, 0, DH.flange]} rotation={[0, 0, -Math.PI / 4]}>
          <mesh position={[0, 0, 0.005]} rotation={[Math.PI / 2, 0, 0]} material={mat.metal}>
            <cylinderGeometry args={[0.04, 0.04, 0.01, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.04]} material={mat.body} castShadow>
            <boxGeometry args={[0.05, 0.2, 0.06]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, s * 0.03, TCP_OFFSET - DH.flange - 0.022]} material={mat.dark} castShadow>
              <boxGeometry args={[0.018, 0.012, 0.05]} />
            </mesh>
          ))}
        </group>
      )}
    </>
  );
}

function ContactArrows() {
  const rt = useRt();
  const N = 24;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    return g;
  }, []);
  const lines = useMemo(() => new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#ff5a5a', depthTest: false })), [geo]);
  useFrame(() => {
    const a = geo.attributes.position as THREE.BufferAttribute;
    const cs = rt.replay ? [] : rt.sim.contacts;
    for (let i = 0; i < N; i++) {
      const c = cs[i];
      if (!c) {
        a.setXYZ(2 * i, 0, 0, 0);
        a.setXYZ(2 * i + 1, 0, 0, 0);
        continue;
      }
      const s = 0.004;
      a.setXYZ(2 * i, c.point[0], c.point[1], c.point[2]);
      a.setXYZ(2 * i + 1, c.point[0] + c.force[0] * s, c.point[1] + c.force[1] * s, c.point[2] + c.force[2] * s);
    }
    a.needsUpdate = true;
  });
  return <primitive object={lines} renderOrder={11} />;
}

export function PandaScene() {
  const rt = useRt();
  useRtVersion(rt);
  const root = useRef<THREE.Group>(null);
  const links = useRef<(THREE.Group | null)[]>([]);
  const onDown = useBodyDrag(root);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  useFrame(() => {
    const F = pandaFK(rt.renderState().q);
    for (let L = 0; L <= 7; L++) {
      const g = links.current[L];
      if (!g) continue;
      const R = F.R[L],
        p = F.p[L];
      m4.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
      g.matrix.copy(m4);
      g.matrixWorldNeedsUpdate = true;
    }
  });
  const boxes = rt.model.envBoxes?.(rt.params) ?? [];
  return (
    <group ref={root} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onDown}>
      {/* table */}
      <mesh position={[0.25, 0, -0.025]} receiveShadow material={mat.table}>
        <boxGeometry args={[1.6, 1.4, 0.05]} />
      </mesh>
      {boxes.map((b, i) => (
        <mesh key={i} position={b.center} receiveShadow castShadow material={mat.block}>
          <boxGeometry args={[b.half[0] * 2, b.half[1] * 2, b.half[2] * 2]} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((L) => (
        <group key={L} ref={(el) => (links.current[L] = el)} matrixAutoUpdate={false} userData={{ body: L >= 1 ? `link${L}` : undefined }}>
          <PandaLinkGeom L={L} />
        </group>
      ))}
      <ContactArrows />
      <DragLine />
      <TargetGizmo size={0.6} />
    </group>
  );
}
