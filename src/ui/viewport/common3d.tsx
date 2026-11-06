import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { V3 } from '../../core/linalg';
import { useRt, useRtVersion } from '../runtimeCtx';

/** Pointer-down handler that starts dragging a body with a virtual spring. */
export function useBodyDrag(rootRef: RefObject<THREE.Group>) {
  const rt = useRt();
  const { camera, gl, controls } = useThree();
  return (e: ThreeEvent<PointerEvent>) => {
    if (rt.replay || e.button !== 0) return;
    let o: THREE.Object3D | null = e.object;
    while (o && !o.userData.body) o = o.parent;
    if (!o || !rootRef.current) return;
    e.stopPropagation();
    const body = o.userData.body as string;
    const root = rootRef.current;
    const pw = e.point.clone();
    const pl = root.worldToLocal(pw.clone());
    const local = rt.model.bodyLocal(rt.sim.q, body, [pl.x, pl.y, pl.z], rt.params);
    rt.sim.drag = { body, local, target: [pl.x, pl.y, pl.z] };
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pw);
    if (controls) (controls as any).enabled = false;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit) && rt.sim.drag) {
        const l = root.worldToLocal(hit.clone());
        rt.sim.drag.target = [l.x, l.y, l.z];
      }
    };
    const up = () => {
      rt.sim.drag = null;
      if (controls) (controls as any).enabled = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

/** spring line from the grabbed point to the mouse target */
export function DragLine() {
  const rt = useRt();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  const line = useMemo(() => new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffcf5a', depthTest: false, transparent: true })), [geo]);
  const ball = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const d = rt.renderState().drag;
    line.visible = !!d;
    if (ball.current) ball.current.visible = !!d;
    if (!d) return;
    const a = geo.attributes.position as THREE.BufferAttribute;
    a.setXYZ(0, d.a[0], d.a[1], d.a[2]);
    a.setXYZ(1, d.b[0], d.b[1], d.b[2]);
    a.needsUpdate = true;
    ball.current?.position.set(d.b[0], d.b[1], d.b[2]);
  });
  return (
    <>
      <primitive object={line} renderOrder={10} />
      <mesh ref={ball} renderOrder={10}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color="#ffcf5a" depthTest={false} transparent />
      </mesh>
    </>
  );
}

/** draggable target gizmo (only when the diagram has a 3D target block) */
export function TargetGizmo({ axes = 'xyz', size = 0.6 }: { axes?: string; size?: number }) {
  const rt = useRt();
  useRtVersion(rt);
  const mesh = useRef<THREE.Mesh>(null);
  const show = !!rt.program?.hasTarget;
  useFrame(() => {
    const tg = rt.renderState().target ?? rt.target;
    if (mesh.current && !dragging.current) mesh.current.position.set(tg[0], tg[1], tg[2]);
  });
  const dragging = useRef(false);
  if (!show) return null;
  return (
    <>
      <mesh ref={mesh} position={rt.target as unknown as THREE.Vector3Tuple}>
        <sphereGeometry args={[0.025, 20, 20]} />
        <meshStandardMaterial color="#38e08c" emissive="#1a7a4a" transparent opacity={0.85} />
      </mesh>
      <TransformControls
        object={mesh as any}
        mode="translate"
        size={size}
        showX={axes.includes('x')}
        showY={axes.includes('y')}
        showZ={axes.includes('z')}
        enabled={!rt.replay}
        onMouseDown={() => (dragging.current = true)}
        onMouseUp={() => (dragging.current = false)}
        onObjectChange={() => {
          const p = mesh.current!.position;
          rt.target = [p.x, p.y, p.z] as V3;
        }}
      />
    </>
  );
}

export const mat = {
  body: new THREE.MeshStandardMaterial({ color: '#e8edf2', roughness: 0.45, metalness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: '#2b333d', roughness: 0.6, metalness: 0.3 }),
  accent: new THREE.MeshStandardMaterial({ color: '#76e4c3', roughness: 0.4, metalness: 0.2 }),
  blue: new THREE.MeshStandardMaterial({ color: '#4a8fd8', roughness: 0.5, metalness: 0.2 }),
  orange: new THREE.MeshStandardMaterial({ color: '#ff9f5a', roughness: 0.4, metalness: 0.1 }),
  metal: new THREE.MeshStandardMaterial({ color: '#8d99a6', roughness: 0.35, metalness: 0.8 }),
  ghost: new THREE.MeshStandardMaterial({ color: '#b48cff', transparent: true, opacity: 0.35, depthWrite: false, emissive: '#3d2a66' }),
  block: new THREE.MeshStandardMaterial({ color: '#41597a', roughness: 0.8 }),
  table: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.9 }),
};
