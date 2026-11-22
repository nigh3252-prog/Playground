import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'meshopt';

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage'), canvas = $('#view'), status = $('#status');
const rootURL = new URL('./', import.meta.url);
const sourceURL = (path) => new URL(path, rootURL).href;
const embedded = window.KITBASH_EMBEDDED;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer, scene, camera, controls, studies, current = null;
let wanted = location.hash.slice(1) || 'bellows', serial = 0, playing = !reducedMotion;
let clay = false, referenceVisible = true, lineMode = false, stillMode = false;
const cache = new Map(), visibleModels = [], labels = [], markers = new THREE.Group();
const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c8bb, roughness: .78, metalness: .05 });
const bounds = new THREE.Box3(), point = new THREE.Vector3();
let warden, activeBounds = new THREE.Box3(), fitHalf = 10, cameraPreset = 'three';

function showError(error) {
  console.error(error);
  status.hidden = false;
  status.classList.add('error');
  $('#status-text').textContent = `The study could not load. ${error.message || error}`;
  $('#retry').hidden = false;
}

function arrayBuffer(base64) {
  const binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function loadGLB(path) {
  if (embedded?.assets?.[path]) return loader.parseAsync(arrayBuffer(embedded.assets[path]), '');
  return loader.loadAsync(sourceURL(path));
}

function triangleCount(object) {
  let n = 0;
  object.traverse((part) => {
    if (part.isMesh) n += (part.geometry.index?.count || part.geometry.attributes.position.count) / 3;
  });
  return Math.round(n);
}

async function getModel(study) {
  if (cache.has(study.id)) return cache.get(study.id);
  const promise = (async () => {
    const gltf = await loadGLB(study.asset);
    const model = new THREE.Group();
    model.name = study.id;
    model.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(gltf.scene, true);
    if (raw.isEmpty()) throw new Error(`${study.title}: no visible mesh geometry.`);
    const size = raw.getSize(new THREE.Vector3());
    const scale = study.height / size.y;
    model.scale.setScalar(scale);
    gltf.scene.position.x -= (raw.min.x + raw.max.x) / 2;
    gltf.scene.position.y -= raw.min.y;
    gltf.scene.position.z -= (raw.min.z + raw.max.z) / 2;
    const materials = [];
    model.traverse((part) => {
      if (!part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      part.frustumCulled = false;
      materials.push([part, part.material]);
    });
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const entry = { study, gltf, model, mixer, materials, action: null, triangles: triangleCount(model), rawHeight: size.y, width: size.x * scale, depth: size.z * scale, envelopes: new Map() };
    entry.restBounds = new THREE.Box3().setFromObject(model, true);
    if (study.id !== 'warden') sampleEnvelopes(entry);
    scene.add(model);
    model.visible = false;
    return entry;
  })();
  cache.set(study.id, promise);
  try { return await promise; }
  catch (e) { cache.delete(study.id); throw e; }
}

function sampleEnvelopes(entry) {
  // Cache every native clip's complete movement envelope before display.
  // Per-piece bounding boxes are conservative under rigid rotation and avoid
  // touching every triangle on every sample. Extra padding covers sample gaps.
  for (const clip of entry.gltf.animations) {
    entry.mixer.stopAllAction();
    const action = entry.mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const box = entry.restBounds.clone();
    const steps = Math.max(24, Math.min(120, Math.ceil(clip.duration * 12)));
    for (let i = 0; i <= steps; i++) {
      entry.mixer.setTime(clip.duration * i / steps);
      entry.model.updateMatrixWorld(true);
      box.union(new THREE.Box3().setFromObject(entry.model));
    }
    box.expandByScalar(.35);
    entry.envelopes.set(clip.name, box);
  }
  entry.mixer.stopAllAction();
  entry.model.updateMatrixWorld(true);
}

function animateEntry(entry, name) {
  entry.mixer.stopAllAction();
  entry.action = null;
  if (!name) return;
  const clip = entry.gltf.animations.find((c) => c.name === name);
  if (!clip) return;
  entry.action = entry.mixer.clipAction(clip).reset().setLoop(THREE.LoopRepeat).play();
  entry.mixer.update(0);
}

function idleClip(entry) {
  return entry.gltf.animations.find((a) => /idle|hover|breath/i.test(a.name))?.name || entry.gltf.animations[0]?.name;
}

function resetMarkers() {
  while (markers.children.length) {
    const obj = markers.children[0];
    obj.geometry?.dispose();
    obj.material?.dispose();
    markers.remove(obj);
  }
  labels.length = 0;
  $('#labels').replaceChildren();
}

function ruler(x, height, z, color = 0x61847b) {
  const vertices = [x, 0, z, x, height, z];
  for (let y = 0; y <= height; y += 2) vertices.push(x - .23, y, z, x + .23, y, z);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  markers.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .5 })));
}

function addLabel(entry) {
  const el = document.createElement('div');
  el.className = 'model-label';
  const name = document.createElement('strong'); name.textContent = entry.study.title;
  const height = document.createElement('span'); height.textContent = `${entry.study.height} METERS`;
  el.append(name, height); $('#labels').append(el);
  labels.push({ el, position: new THREE.Vector3(entry.model.position.x, -.15, entry.depth * .48 + .7) });
}

function layoutModels() {
  resetMarkers();
  let left = 0;
  const all = referenceVisible && warden ? [warden, ...visibleModels] : [...visibleModels];
  const spacing = lineMode ? 3.5 : 2;
  for (const entry of all) {
    entry.model.position.set(left + entry.width / 2, 0, 0);
    entry.model.rotation.y = 0;
    entry.model.visible = true;
    left += entry.width + spacing;
  }
  const center = Math.max(0, left - spacing) / 2;
  activeBounds.makeEmpty();
  for (const entry of all) {
    entry.model.position.x -= center;
    entry.model.updateMatrixWorld(true);
    bounds.setFromObject(entry.model, true);
    activeBounds.union(bounds);
    ruler(bounds.max.x + .5, entry.study.height, -entry.depth * .42);
    addLabel(entry);
  }
  if (warden) warden.model.visible = referenceVisible;
  setCamera(cameraPreset);
  applyClay();
}

function setCamera(preset = 'three') {
  cameraPreset = preset;
  const clipName = $('#clip').value;
  activeBounds.makeEmpty();
  for (const entry of [...visibleModels, ...(warden?.model.visible ? [warden] : [])]) {
    const name = lineMode && clipName ? idleClip(entry) : clipName;
    const box = (entry.envelopes.get(name) || entry.restBounds).clone();
    box.translate(entry.model.position);
    activeBounds.union(box);
  }
  if (activeBounds.isEmpty()) return;
  const size = activeBounds.getSize(new THREE.Vector3());
  const center = activeBounds.getCenter(new THREE.Vector3());
  const aspect = Math.max(stage.clientWidth / stage.clientHeight, .1);
  const vectors = { three: [1, .45, 1.8], front: [0, .12, 1], side: [1, .1, .08] };
  const direction = new THREE.Vector3(...(vectors[preset] || vectors.three)).normalize();
  const projectedWidth = Math.abs(direction.z) * size.x + Math.abs(direction.x) * size.z;
  const projectedHeight = size.y + Math.abs(direction.y) * Math.max(size.z, size.x) * .5;
  fitHalf = Math.max(projectedHeight * .65, projectedWidth / aspect * .59, 6);
  camera.left = -fitHalf * aspect; camera.right = fitHalf * aspect;
  camera.top = fitHalf; camera.bottom = -fitHalf;
  camera.position.copy(center).addScaledVector(direction, Math.max(size.length() * 2, 60));
  controls.target.copy(center).add(new THREE.Vector3(0, -.4, 0));
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
}

function resize() {
  const width = stage.clientWidth, height = stage.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  const aspect = width / height;
  camera.left = -fitHalf * aspect; camera.right = fitHalf * aspect;
  camera.updateProjectionMatrix();
  if (!activeBounds.isEmpty()) setCamera(cameraPreset);
}

function applyClay() {
  const entries = [...visibleModels, ...(warden ? [warden] : [])];
  for (const entry of entries) for (const [part, original] of entry.materials) part.material = clay ? clayMaterial : original;
}

function downloadURL(path, mime) {
  if (embedded?.assets?.[path]) return URL.createObjectURL(new Blob([arrayBuffer(embedded.assets[path])], { type: mime }));
  if (embedded?.recipes?.[path]) return URL.createObjectURL(new Blob([JSON.stringify(embedded.recipes[path], null, 2)], { type: mime }));
  return sourceURL(path);
}

function posterURL(path) {
  if (embedded?.images?.[path]) return 'data:image/jpeg;base64,' + embedded.images[path];
  return sourceURL(path);
}

function updateDetails(study, entry) {
  const lineup = !study;
  $('#study-number').textContent = lineup ? 'ALL THREE / SAME GROUND PLANE' : `STUDY ${study.number} / ${study.kind}`;
  $('#study-title').textContent = lineup ? 'The 12-meter tier' : study.title;
  $('#view-label').textContent = lineup ? 'SCALE LINEUP / METERS' : `${study.title.toUpperCase()} / STUDY ${study.number}`;
  $('#study-description').textContent = lineup ? 'One height, three different masses. Bellows carries its weight low, Brood Loom stands above its legs, and Shutter Wraith leaves open space inside its armor.' : study.description;
  $('#height').innerHTML = '12.0 <span>m</span>';
  $('#ratio').innerHTML = '3.0<span>×</span>';
  $('#triangles').textContent = lineup ? `${visibleModels.reduce((n, e) => n + e.triangles, 0).toLocaleString()} triangles total` : `${entry.triangles.toLocaleString()} triangles`;
  const list = $('#donor-list'); list.replaceChildren();
  const donors = lineup ? studies.models.map((s) => ({ name: s.title, part: s.kind.toLowerCase() })) : study.donors;
  for (const donor of donors) { const li = document.createElement('li'); li.append(document.createTextNode(donor.name)); const small = document.createElement('small'); small.textContent = donor.part; li.append(small); list.append(li); }
  $('#design-note').textContent = lineup ? 'Warden is shown at 4 m. Heights refer to the neutral geometry; animated jumps, leg movement and hovering may change the visible envelope.' : study.note;
  $('#downloads').hidden = lineup;
  if (!lineup) {
    const modelLink = $('#download-model'), recipeLink = $('#download-recipe');
    for (const link of [modelLink, recipeLink]) if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
    modelLink.href = downloadURL(study.asset, 'model/gltf-binary'); modelLink.download = `${study.id}.glb`;
    recipeLink.href = downloadURL(study.recipe, 'application/json'); recipeLink.download = `${study.id}-recipe.json`;
  }
}

function updateClips(entry) {
  const select = $('#clip'); select.replaceChildren();
  const neutral = new Option('Neutral pose', ''); select.add(neutral);
  if (lineMode) {
    select.add(new Option('All idle motions', 'all-idle'));
    select.value = reducedMotion ? '' : 'all-idle';
  } else {
    for (const clip of entry.gltf.animations) select.add(new Option(clip.name.replace(/_/g, ' '), clip.name));
    select.value = reducedMotion ? '' : (idleClip(entry) || '');
  }
  changeClip();
}

function changeClip() {
  const name = $('#clip').value;
  if (lineMode) for (const entry of visibleModels) animateEntry(entry, name ? idleClip(entry) : '');
  else if (current) animateEntry(current, name);
  if (warden) animateEntry(warden, name ? idleClip(warden) : '');
  playing = !!name;
  $('#play').textContent = playing ? 'Pause' : 'Play';
  $('#play').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
  if (visibleModels.length) setCamera(cameraPreset);
}

async function choose(id) {
  const token = ++serial;
  wanted = id;
  status.classList.remove('error'); status.hidden = false;
  $('#retry').hidden = true;
  $('#status-text').textContent = id === 'lineup' ? 'Assembling the scale lineup…' : 'Opening the creature study…';
  try {
    const chosen = id === 'lineup' ? studies.models : studies.models.filter((s) => s.id === id);
    if (!chosen.length) return choose('bellows');
    if (stillMode) {
      visibleModels.splice(0, visibleModels.length, ...chosen.map(study => ({ study, triangles: study.triangles })));
      current = visibleModels[0]; lineMode = id === 'lineup';
      updateDetails(lineMode ? null : chosen[0], current);
      const still = $('#still-preview');
      still.alt = lineMode ? 'Warden at 4 meters beside Bellows, Brood Loom and Shutter Wraith at 12 meters on one shared scale' : `${chosen[0].title}: rendered neutral view of the 12-meter kitbash`;
      still.src = posterURL(lineMode ? studies.lineupPoster : chosen[0].poster);
      await still.decode();
      if (token !== serial) return;
      $('#view').hidden = true; still.hidden = false; $('#still-note').hidden = false;
      stage.classList.add('still-mode'); $('.motion-bar').hidden = true;
      $('#scale-note').textContent = lineMode ? 'Neutral poses · shared meter scale' : 'Dimensions measured from the exported GLB';
      for (const button of document.querySelectorAll('[data-study]')) button.setAttribute('aria-pressed', String(button.dataset.study === id));
      history.replaceState(null, '', `#${id}`); status.hidden = true;
      window.KITBASH_STATE = { ready: true, mode: 'still-preview', study: id };
      return;
    }
    const results = await Promise.all(chosen.map(getModel));
    if (token !== serial) return;
    for (const old of visibleModels) { old.model.visible = false; old.mixer.stopAllAction(); }
    visibleModels.splice(0, visibleModels.length, ...results);
    current = results[0]; lineMode = id === 'lineup';
    for (const button of document.querySelectorAll('[data-study]')) button.setAttribute('aria-pressed', String(button.dataset.study === id));
    updateClips(current);
    layoutModels();
    updateDetails(lineMode ? null : chosen[0], current);
    history.replaceState(null, '', `#${id}`);
    status.hidden = true;
    window.KITBASH_STATE = { ready: true, study: id, models: results.map((entry) => ({ id: entry.study.id, triangles: entry.triangles, rawHeight: entry.rawHeight, clips: entry.gltf.animations.map((a) => a.name) })) };
  } catch (error) { if (token === serial) showError(error); }
}

async function start() {
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
  catch (error) {
    console.warn('Using rendered previews because WebGL is unavailable.', error.message);
    stillMode = true;
    await openRequestedStudy();
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x172328);
  scene.fog = new THREE.Fog(0x172328, 100, 250);
  scene.add(markers);
  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 400);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minZoom = .35; controls.maxZoom = 5;
  controls.maxPolarAngle = Math.PI * .49;
  controls.autoRotateSpeed = .6;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, .04).texture;
  scene.environmentIntensity = .7;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe4eeef, 0x293534, 2));
  const key = new THREE.DirectionalLight(0xffe7c6, 3.5); key.position.set(12, 28, 20); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.00008; key.shadow.normalBias = .035;
  Object.assign(key.shadow.camera, { left: -65, right: 65, top: 40, bottom: -40, near: 1, far: 110 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8ed4d8, 3); rim.position.set(-20, 16, -15); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xe7d9c2, 1); fill.position.set(-12, 8, 20); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x1b2b2e, roughness: .98, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(160, 80, 0x436261, 0x314849); grid.position.y = -.065;
  grid.material.transparent = true; grid.material.opacity = .35; scene.add(grid);
  new ResizeObserver(resize).observe(stage);
  resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), .05);
    if (playing && !document.hidden) for (const entry of [...visibleModels, ...(warden?.model.visible ? [warden] : [])]) entry.mixer.update(dt);
    controls.update(); renderer.render(scene, camera);
    for (const label of labels) {
      point.copy(label.position).project(camera);
      label.el.style.left = `${(point.x + 1) * .5 * stage.clientWidth}px`;
      label.el.style.top = `${(-point.y + 1) * .5 * stage.clientHeight + 7}px`;
      label.el.hidden = Math.abs(point.x) > .95 || Math.abs(point.y) > .9 || point.z > 1;
    }
  });
  await openRequestedStudy();
}

async function openRequestedStudy() {
  status.classList.remove('error'); status.hidden = false; $('#retry').hidden = true;
  $('#status-text').textContent = 'Opening the model workshop…';
  try {
    if (!studies) {
      if (embedded?.studies) studies = embedded.studies;
      else {
        const response = await fetch(sourceURL('studies.json'));
        if (!response.ok) throw new Error(`Study manifest: HTTP ${response.status}`);
        studies = await response.json();
      }
    }
    $('#trex-note').textContent = studies.scaleNote;
    if (!stillMode && !warden) warden = await getModel({ id: 'warden', title: 'Warden', height: 4, asset: '../../models/assets/warden-v1.glb' });
    await choose(wanted);
  } catch (error) { showError(error); }
}

for (const button of document.querySelectorAll('[data-study]')) button.addEventListener('click', () => choose(button.dataset.study));
$('#fit').onclick = () => setCamera('three');
$('#front').onclick = () => setCamera('front');
$('#side').onclick = () => setCamera('side');
$('#clip').onchange = changeClip;
$('#play').onclick = () => {
  if (!$('#clip').value) { $('#clip').selectedIndex = Math.min(1, $('#clip').options.length - 1); changeClip(); return; }
  playing = !playing;
  $('#play').textContent = playing ? 'Pause' : 'Play';
  $('#play').setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
};
$('#reference-toggle').onclick = (event) => { referenceVisible = !referenceVisible; event.currentTarget.setAttribute('aria-pressed', String(referenceVisible)); layoutModels(); };
$('#neutral-toggle').onclick = (event) => { clay = !clay; event.currentTarget.setAttribute('aria-pressed', String(clay)); applyClay(); };
$('#spin-toggle').onclick = (event) => { controls.autoRotate = !controls.autoRotate; event.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate)); };
$('#retry').onclick = () => { if (renderer || stillMode) openRequestedStudy(); else location.reload(); };
window.addEventListener('hashchange', () => choose(location.hash.slice(1)));
start().catch(showError);
