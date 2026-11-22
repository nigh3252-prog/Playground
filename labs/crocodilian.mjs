import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#view');
const sheet = document.querySelector('#sheet');
const status = document.querySelector('.status');
const mode = document.querySelector('#mode');
const relief = document.querySelector('#relief');
const reset = document.querySelector('#reset');
const download = document.querySelector('#download');

async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e8de);
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 75);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.55;
  controls.maxZoom = 7;
  controls.maxPolarAngle = Math.PI * 0.54;
  const hemi = new THREE.HemisphereLight(0xfff9e8, 0xd5d2cb, 1.7);
  scene.add(hemi);
  const light = new THREE.DirectionalLight(0xfff0d8, 2.25);
  light.position.set(4.5, 8, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, far: 22 });
  light.shadow.normalBias = 0.014;
  light.shadow.bias = -0.00025;
  light.target.position.y = 1.9;
  scene.add(light, light.target);
  const rim = new THREE.DirectionalLight(0xd4edff, 1.45);
  rim.position.set(-2, 5, -4);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.003;
  floor.receiveShadow = true;
  scene.add(floor);
  const gltf = await new GLTFLoader().loadAsync(download.href);
  scene.add(gltf.scene);
  const meshes = [];
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) {
      meshes.push(obj);
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  const material = meshes[0].material;
  const normal = material.normalMap;
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const focus = box.getCenter(new THREE.Vector3());
  const draw = () => {
    if (!canvas.hidden) renderer.render(scene, camera);
  };
  function resize() {
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    const aspect = width / height;
    const half = Math.max(2.54, 2.95 / aspect);
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }
  function home() {
    controls.target.copy(focus);
    camera.position.copy(focus).add(new THREE.Vector3(9.8, 2.35, 3.05));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    draw();
  }
  controls.addEventListener('change', draw);
  new ResizeObserver(resize).observe(canvas.parentElement);
  reset.onclick = home;
  relief.onclick = () => {
    const on = !material.normalMap;
    material.normalMap = on ? normal : null;
    material.needsUpdate = true;
    relief.setAttribute('aria-pressed', String(on));
    draw();
  };
  const ctx = sheet.getContext('2d');
  function showSheet() {
    const showing = mode.value !== 'model';
    sheet.hidden = !showing;
    canvas.hidden = showing;
    relief.hidden = showing;
    reset.hidden = showing;
    document.querySelector('.hint').hidden = showing;
    if (!showing) {
      resize();
      return;
    }
    const tex = mode.value === 'normal' ? normal : material.map;
    const im = tex.image;
    sheet.width = im.width;
    sheet.height = im.height;
    ctx.drawImage(im, 0, 0);
    if (mode.value !== 'uv') return;
    ctx.fillStyle = 'rgba(20,27,23,.75)';
    ctx.fillRect(0, 0, im.width, im.height);
    ctx.strokeStyle = '#d7e8c2';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const { geometry } of meshes) {
      const uv = geometry.attributes.uv,
        index = geometry.index;
      for (let i = 0; i < index.count; i += 3) {
        for (let j = 0; j < 3; j++) {
          const k = index.getX(i + j),
            x = uv.getX(k) * im.width,
            y = uv.getY(k) * im.height;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  }
  mode.onchange = showSheet;
  home();
  showSheet();
  status.textContent = '';
}
start().catch((err) => {
  status.textContent = 'The 3D preview could not load. The GLB download is available above.';
  console.error(err);
});
