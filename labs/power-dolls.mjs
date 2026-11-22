import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view'),
  sheet = $('#sheet'),
  stage = $('section'),
  mode = $('#mode'),
  preset = $('#camera');
const status = $('.status'),
  relief = $('#bump'),
  reference = $('#ref'),
  page = $('#page');
const assets = new URL('./power-dolls/', import.meta.url);

async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9eeef);
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 50);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.55;
  controls.maxZoom = 6;
  controls.maxPolarAngle = Math.PI * 0.57;
  const sunlight = new THREE.DirectionalLight(0xfff7ed, 2.25);
  sunlight.position.set(-4, 8, 6);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(1024, 1024);
  sunlight.shadow.normalBias = 0.015;
  Object.assign(sunlight.shadow.camera, { left: -3, right: 3, top: 4, bottom: -3, far: 20 });
  scene.add(sunlight, new THREE.HemisphereLight(0xf2f7ff, 0xd4d1ca, 1.65));
  const rim = new THREE.DirectionalLight(0xd4e4ff, 1.5);
  rim.position.set(3, 4, -4);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ opacity: 0.13 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const loader = new GLTFLoader(),
    cache = new Map();
  let active,
    wanted,
    normal,
    meshes = [],
    material;
  function draw() {
    if (!canvas.hidden) renderer.render(scene, camera);
  }
  function resize() {
    const { width, height } = stage.getBoundingClientRect(),
      aspect = width / Math.max(height, 1);
    const half = Math.max(2.22, 1.62 / aspect);
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }
  const direction = {
    reference: [0, 8, 8],
    three: [4.5, 3.3, 8],
    front: [0, 0, 8],
    side: [8, 0, 0],
    rear: [0, 1, -8],
  };
  function aim() {
    const dir = direction[preset.value];
    if (!dir) return;
    controls.target.set(0, 2.06, 0);
    camera.position.copy(controls.target).add(new THREE.Vector3(...dir));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    draw();
  }
  controls.addEventListener('change', draw);
  controls.addEventListener('start', () => {
    preset.value = 'orbit';
  });
  preset.onchange = aim;
  new ResizeObserver(resize).observe(stage);
  function update() {
    const flat = mode.value !== 'model';
    sheet.hidden = !flat;
    canvas.hidden = flat;
    preset.hidden = relief.hidden = reference.hidden = flat;
    page.hidden = !flat;
    $('figure').hidden = flat || reference.getAttribute('aria-pressed') !== 'true';
    if (!active) return;
    if (!flat) {
      resize();
      return;
    }
    const img = (mode.value === 'normal' ? normal : material.map).image;
    const off = (Number(page.value) * img.width) / 2,
      width = img.width / 2;
    sheet.width = width;
    sheet.height = img.height;
    const ctx = sheet.getContext('2d');
    ctx.drawImage(img, off, 0, width, img.height, 0, 0, width, img.height);
    if (mode.value !== 'uv') return;
    ctx.fillStyle = 'rgba(8,19,25,.55)';
    ctx.fillRect(0, 0, width, img.height);
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = '#a7fff3';
    ctx.beginPath();
    for (const { geometry } of meshes) {
      const { uv } = geometry.attributes,
        ix = geometry.index;
      for (let i = 0; i < ix.count; i += 3) {
        for (let j = 0; j < 3; j++) {
          const k = ix.getX(i + j),
            x = uv.getX(k) * img.width - off,
            y = uv.getY(k) * img.height;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  }
  reference.onclick = () => {
    reference.setAttribute(
      'aria-pressed',
      String(reference.getAttribute('aria-pressed') !== 'true'),
    );
    update();
  };
  relief.onclick = () => {
    if (!material) return;
    const on = !material.normalMap;
    relief.setAttribute('aria-pressed', String(on));
    material.normalMap = on ? normal : null;
    material.needsUpdate = true;
    draw();
  };
  mode.onchange = page.onchange = update;
  async function select(id) {
    wanted = id;
    for (const button of document.querySelectorAll('[data-id]'))
      button.setAttribute('aria-pressed', String(button.dataset.id === id));
    const url = new URL(id + '.glb', assets);
    const link = $('#download');
    link.href = url;
    link.download = id + '.glb';
    $('figure img').src = new URL(id + '.png', assets);
    status.textContent = 'Loading model…';
    if (active) {
      scene.remove(active);
      active = null;
      material = null;
      draw();
    }
    sheet.getContext('2d').clearRect(0, 0, sheet.width, sheet.height);
    try {
      if (!cache.has(id))
        cache.set(
          id,
          loader
            .loadAsync(url.href)
            .then(({ scene: root }) => {
              root.traverse((m) => {
                if (m.isMesh) {
                  m.castShadow = m.receiveShadow = true;
                  m.material.userData.originalNormal = m.material.normalMap;
                }
              });
              return root;
            })
            .catch((err) => {
              cache.delete(id);
              throw err;
            }),
        );
      const root = await cache.get(id);
      if (wanted !== id) return;
      if (active) scene.remove(active);
      active = root;
      scene.add(root);
      meshes = [];
      root.traverse((m) => {
        if (m.isMesh) meshes.push(m);
      });
      material = meshes[0].material;
      normal = material.userData.originalNormal;
      material.normalMap = relief.getAttribute('aria-pressed') === 'true' ? normal : null;
      material.needsUpdate = true;
      status.textContent = '';
      update();
    } catch (err) {
      if (wanted === id)
        status.textContent = 'Could not load this model. Select it again to retry.';
      console.error(err);
    }
  }
  for (const button of document.querySelectorAll('[data-id]'))
    button.onclick = () => select(button.dataset.id);
  aim();
  resize();
  await select('cannon');
}
start().catch((err) => {
  status.textContent = 'The 3D viewer requires WebGL 2.';
  console.error(err);
});
