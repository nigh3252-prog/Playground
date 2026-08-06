import * as THREE from 'three';
import {
  createMantaDeltaStarFreighterModel,
  createMantaDeltaStarFreighterLookDevLights,
} from '../src/createMantaModel';
import { applyCelShading, createCelLights } from '../src/celShading';

// Review viewpoints declared in the spec's qualityTargets.reviewViewpoints.
// Ship length runs along X, so a beam elevation puts the camera on the Z axis (yaw~0),
// not on the X axis. At yaw 0 the bow (-X) falls on screen-left, matching the reference.
const VIEWS: Record<string, { yaw: number; pitch: number }> = {
  'reference-match': { yaw: 6, pitch: 16 },  // solved by IoU sweep vs the star-free reference
  'three-quarter-high': { yaw: 42, pitch: 30 },
  'planform-top': { yaw: 0, pitch: 88 },
  'bow-low': { yaw: -46, pitch: -12 },
};

const params = new URLSearchParams(location.search);
const viewName = params.get('view') ?? 'reference-match';
const W = Number(params.get('w') ?? 1600);
const H = Number(params.get('h') ?? 800);
const stripped = params.get('stripped') === '1'; // map-stripped blockout evidence

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// spec.lightingFromPhoto: NoToneMapping so the toon steps stay at the sampled hexes.
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // reference is a black space field

const model = createMantaDeltaStarFreighterModel({});
if (stripped) {
  const clay = new THREE.MeshStandardMaterial({ color: 0xb9b9b9, roughness: 0.85, metalness: 0.0 });
  model.traverse((o: any) => { if (o.isMesh || o.isInstancedMesh) o.material = clay; });
}
if (!stripped) applyCelShading(model);
scene.add(model);
scene.add(stripped ? createMantaDeltaStarFreighterLookDevLights('reference') : createCelLights());

// Orientation gizmo (debug only): red = +X (aft), blue = +Z (starboard), green = +Y (up).
if (params.get('gizmo') === '1') {
  const put = (p: [number, number, number], hex: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: hex }),
    );
    m.position.set(...p);
    scene.add(m);
  };
  put([6.2, 0, 0], 0xff2020);   // +X aft
  put([0, 3.4, 0], 0x20ff20);   // +Y up
  put([0, 0, 4.0], 0x2050ff);   // +Z starboard
}

const VFOV = 26;
const camera = new THREE.PerspectiveCamera(VFOV, W / H, 0.1, 400);
const v = { ...(VIEWS[viewName] ?? VIEWS['reference-match']) };
if (params.get('pitch')) v.pitch = Number(params.get('pitch'));
if (params.get('yaw')) v.yaw = Number(params.get('yaw'));
const yaw = (v.yaw * Math.PI) / 180;
const pitch = (v.pitch * Math.PI) / 180;

const box = new THREE.Box3().setFromObject(model);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());

// Exact fit: a bounding-sphere fit wastes most of the frame on a form this flat and wide.
// Project every bbox corner onto the camera basis and solve for the smallest distance that
// still contains all of them in both axes.
const dir = new THREE.Vector3(
  Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw),
).normalize();                                        // center -> camera
// For a near-vertical view (0,1,0) degenerates. Use -Z so that x_axis = cross(up, dir)
// lands on +X: aft stays screen-right and the bow stays screen-left, same as the beam views.
const worldUp = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
const up = new THREE.Vector3().crossVectors(dir, right).normalize();
const tanV = Math.tan((VFOV * Math.PI) / 360);
const tanH = tanV * (W / H);

let dist = 0;
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  const c = new THREE.Vector3(sx * size.x / 2, sy * size.y / 2, sz * size.z / 2);
  const depthBehind = c.dot(dir);            // toward the camera => needs more distance
  const lx = Math.abs(c.dot(right));
  const ly = Math.abs(c.dot(up));
  dist = Math.max(dist, depthBehind + Math.max(lx / tanH, ly / tanV));
}
dist *= 1.08; // margin

camera.position.copy(center).add(dir.clone().multiplyScalar(dist));
camera.up.copy(up);
camera.lookAt(center);
camera.updateProjectionMatrix();

renderer.render(scene, camera);

// --- Framing match -------------------------------------------------------
// Tier-1 silhouette IoU compares the render against the reference frame-to-frame, so a
// tight auto-fit scores the FRAMING difference rather than the shape. The reference
// subject (largest connected component) occupies 83.8% x 62.6% of frame centred at
// (53.6%, 39.3%). Converge the camera onto that rect so the gate measures geometry.
const REF_FRAME = { w: 0.838, cx: 0.536, cy: 0.393 };
const probe = document.createElement('canvas');
probe.width = W; probe.height = H;
const pctx = probe.getContext('2d', { willReadFrequently: true })!;

function measureSubject(): { w: number; cx: number; cy: number } | null {
  pctx.clearRect(0, 0, W, H);
  pctx.drawImage(renderer.domElement, 0, 0);
  const d = pctx.getImageData(0, 0, W, H).data;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] > 54) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { w: (x1 - x0) / W, cx: (x0 + x1) / 2 / W, cy: (y0 + y1) / 2 / H };
}

if (params.get('matchframe') === '1') {
  const target = center.clone();
  for (let iter = 0; iter < 6; iter++) {
    const m = measureSubject();
    if (!m) break;
    dist *= m.w / REF_FRAME.w;                       // width drives the scale
    const ndcX = (m.cx - REF_FRAME.cx) * 2;
    const ndcY = -(m.cy - REF_FRAME.cy) * 2;
    target.add(right.clone().multiplyScalar(ndcX * tanH * dist));
    target.add(up.clone().multiplyScalar(ndcY * tanV * dist));
    camera.position.copy(target).add(dir.clone().multiplyScalar(dist));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
}
const framed = measureSubject();

let tris = 0, meshes = 0, draws = 0;
model.traverse((o: any) => {
  if (o.isInstancedMesh) { meshes++; draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * o.count; }
  else if (o.isMesh) { meshes++; draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
});
(window as any).__READY__ = {
  view: viewName,
  meshes, drawCalls: draws, triangles: Math.round(tris),
  bounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() },
  nodeCount: Object.keys(model.userData.sculptRuntime?.nodes ?? {}).length,
  framing: framed,
};
