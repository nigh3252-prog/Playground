import * as THREE from 'three';
import {
  createMantaDeltaStarFreighterModel,
} from '../src/createMantaModel';
import { applyCelShading, createCelLights, PALETTE } from '../src/celShading';

/**
 * Manta Delta Star Freighter - interactive viewer.
 * Reconstructed in code from a single reference image via the img2threejs pipeline.
 * The model is a THREE.Group factory generated from object-sculpt-spec.json; nothing here
 * loads a mesh file.
 */

const app = document.getElementById('app') as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;   // flat cel steps, no highlight rolloff
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);

// --- starfield, matching the reference's black space field -------------------
{
  const N = 900;
  const pos = new Float32Array(N * 3);
  let seed = 7331;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    const r = 60 + rnd() * 90, t = rnd() * Math.PI * 2, p = Math.acos(2 * rnd() - 1);
    pos[i * 3] = r * Math.sin(p) * Math.cos(t);
    pos[i * 3 + 1] = r * Math.cos(p);
    pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.32, sizeAttenuation: true })));
}

const model = createMantaDeltaStarFreighterModel({});
applyCelShading(model);
scene.add(model);
scene.add(createCelLights());

const runtime = model.userData.sculptRuntime ?? { nodes: {}, meshes: {} };
const box = new THREE.Box3().setFromObject(model);
const centre = box.getCenter(new THREE.Vector3());
const radius = box.getSize(new THREE.Vector3()).length() / 2;

// --- camera + orbit ----------------------------------------------------------
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
let yaw = 0.32, pitch = 0.30, dist = radius * 2.5;
function place() {
  camera.position.set(
    centre.x + Math.cos(pitch) * Math.sin(yaw) * dist,
    centre.y + Math.sin(pitch) * dist,
    centre.z + Math.cos(pitch) * Math.cos(yaw) * dist,
  );
  camera.lookAt(centre);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let dragging = false, lastX = 0, lastY = 0, pinch = 0;
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); });
el.addEventListener('pointerup', (e) => { dragging = false; el.releasePointerCapture(e.pointerId); });
el.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.006;
  pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - lastY) * 0.005));
  lastX = e.clientX; lastY = e.clientY;
});
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist = Math.max(radius * 1.1, Math.min(radius * 7, dist * (1 + Math.sign(e.deltaY) * 0.09)));
}, { passive: false });
el.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (pinch) dist = Math.max(radius * 1.1, Math.min(radius * 7, dist * (pinch / d)));
  pinch = d;
}, { passive: true });
el.addEventListener('touchend', () => { pinch = 0; });

// --- explode -----------------------------------------------------------------
// The assembly gate requires explode and part-picking to share one definition of "a part",
// and requires separating parts by SCALING the layout about the model centre rather than
// pushing every part the same distance (which translates the arrangement without opening gaps).
type Part = { node: THREE.Object3D; home: THREE.Vector3; worldHome: THREE.Vector3 };
const parts: Part[] = [];
for (const [id, node] of Object.entries(runtime.nodes ?? {})) {
  const n = node as THREE.Object3D;
  if (id === 'root') continue;
  const world = new THREE.Vector3();
  n.getWorldPosition(world);
  parts.push({ node: n, home: n.position.clone(), worldHome: world });
}
let explode = 0;
function applyExplode() {
  for (const p of parts) {
    const offset = p.worldHome.clone().sub(centre).multiplyScalar(explode * 0.9);
    p.node.position.copy(p.home).add(offset);
  }
}

// --- part picking ------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickable: THREE.Mesh[] = [];
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if ((m as any).isMesh && !m.userData.isInk) pickable.push(m);
});
const label = document.getElementById('label') as HTMLDivElement;
let highlighted: THREE.Mesh | null = null;
let savedColor: THREE.Color | null = null;

el.addEventListener('click', (e) => {
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickable, false)[0];
  if (highlighted && savedColor) {
    (highlighted.material as THREE.MeshToonMaterial).color.copy(savedColor);
    highlighted = null; savedColor = null;
  }
  if (!hit) { label.style.display = 'none'; return; }
  const mesh = hit.object as THREE.Mesh;
  const comp = mesh.userData.sculptComponent ?? mesh.parent?.userData?.sculptComponent;
  const mat = mesh.material as THREE.MeshToonMaterial;
  savedColor = mat.color.clone();
  highlighted = mesh;
  mat.color.offsetHSL(0, 0, 0.22);
  label.style.display = 'block';
  label.innerHTML = comp
    ? `<b>${comp.name}</b><br><span class="dim">${comp.level} &middot; ${comp.role} &middot; ${comp.primitive}` +
      ` &middot; material ${comp.material}<br>confidence ${comp.confidence}</span>`
    : `<b>${mesh.name || 'part'}</b>`;
});

// --- animated mechanisms (spec.animationAnchors) -----------------------------
const mast = (runtime.nodes ?? {})['dorsal-mast-fin'] as THREE.Object3D | undefined;
const mastRest = mast ? mast.rotation.z : 0;
let mastFold = 0;
const podNodes = Array.from({ length: 7 }, (_, i) => (runtime.nodes ?? {})[`bladder-pod-${String(i + 1).padStart(2, '0')}`] as THREE.Object3D | undefined).filter(Boolean) as THREE.Object3D[];
const podHome = podNodes.map((n) => n.position.clone());
let jettison = 0;

// --- HUD ---------------------------------------------------------------------
const bind = (id: string, fn: (v: number) => void) => {
  const input = document.getElementById(id) as HTMLInputElement;
  const out = document.getElementById(id + 'v') as HTMLSpanElement;
  const upd = () => { fn(Number(input.value) / 100); if (out) out.textContent = input.value + '%'; };
  input.addEventListener('input', upd); upd();
};
bind('explode', (v) => { explode = v; applyExplode(); });
bind('fold', (v) => { mastFold = v; });
bind('jettison', (v) => { jettison = v; });

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
  b.addEventListener('click', () => {
    const [y, p] = b.dataset.view!.split(',').map(Number);
    yaw = (y * Math.PI) / 180; pitch = (p * Math.PI) / 180;
  });
});
const panel = document.getElementById('panel') as HTMLDivElement;
document.getElementById('settingsBtn')!.addEventListener('click', () => panel.classList.toggle('open'));
document.getElementById('closeBtn')!.addEventListener('click', () => panel.classList.remove('open'));

// legend from the spec palette
const legend = document.getElementById('legend') as HTMLDivElement;
legend.innerHTML = Object.entries(PALETTE)
  .map(([id, c]) => `<span class="sw"><i style="background:${c.base}"></i>${id}</span>`)
  .join('');

// --- loop --------------------------------------------------------------------
let spin = true;
document.getElementById('spinBtn')!.addEventListener('click', (e) => {
  spin = !spin;
  (e.target as HTMLButtonElement).classList.toggle('active', spin);
});
let t = 0;
renderer.setAnimationLoop((ms) => {
  const now = ms / 1000;
  const dt = Math.min(0.05, now - t); t = now;
  if (spin && !dragging) yaw += dt * 0.16;
  if (mast) mast.rotation.z = mastRest - mastFold * (84 * Math.PI) / 180;
  podNodes.forEach((n, i) => { n.position.copy(podHome[i]).add(new THREE.Vector3(0, -jettison * 3.2, 0)); });
  place();
  renderer.render(scene, camera);
});

(window as any).__SCENE__ = scene;
(window as any).__READY__ = { meshes: pickable.length, parts: parts.length };
