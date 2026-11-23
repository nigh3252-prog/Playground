import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {assetURL, fetchSplitGLB} from '../asset-paths.mjs';
import {parseSelectedGLB} from '../parse-selected-glb.mjs';
import {buildWorkshop, controllerVisual, makeMiniature} from './scene.mjs';
import {PIECES, STORAGE_KEY, TRAY_CLOSED, TRAY_OPEN, nearestSlot, readLayout, slotAvailable, slots} from './layout.mjs';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const xrStatus = document.querySelector('#xr-status');
const enter = document.querySelector('#enter-vr');
const trayButton = document.querySelector('#tray');
const picker = document.querySelector('#miniature');
const rotate = document.querySelector('#rotate');
const placements = document.querySelector('#placement-controls');
const benchURL = new URL('../', import.meta.url);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(37, 1, .035, 30);
const miniature = new Map();
const loader = new GLTFLoader();
const point = new THREE.Vector3();
const heading = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const rayRotation = new THREE.Quaternion();
let renderer, orbit, room, layout, held, readyToPlace = false, alignWorkshop = false;

function restore() {
  try {
    return readLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readLayout(null);
  }
}

function save(message) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    status.textContent = `${message} Layout saved in this browser.`;
  } catch {
    status.textContent = `${message} Browser storage is unavailable.`;
  }
}

function slotMarker(key) {
  room.marker.visible = Boolean(key);
  if (!key) return;
  const {x, y, z, surface} = slots[key];
  room.marker.position.set(x, y + .002, z + (surface === 'tray' ? room.tray.position.z : 0));
}

function sync() {
  room.tray.position.z = layout.trayOpen ? TRAY_OPEN : TRAY_CLOSED;
  for (const [id, {root}] of miniature) {
    const {slot, yaw} = layout.pieces[id];
    const {x, y, z, surface} = slots[slot];
    const parent = surface === 'tray' ? room.tray : room.workshop;
    if (root.parent !== parent) parent.add(root);
    root.position.set(x, y, z);
    root.rotation.set(0, yaw, 0);
  }
  if (!layout.trayOpen && picker.value && slots[layout.pieces[picker.value].slot].surface === 'tray') {
    picker.value = '';
  }
  trayButton.textContent = layout.trayOpen ? 'Close tray' : 'Pull out tray';
  trayButton.setAttribute('aria-expanded', layout.trayOpen);
  for (const option of [...picker.options].slice(1)) {
    const location = slots[layout.pieces[option.value].slot];
    option.textContent = `${miniature.get(option.value).label} · ${location.label}`;
    option.disabled = location.surface === 'tray' && !layout.trayOpen;
  }
  rotate.disabled = !picker.value;
  for (const button of placements.children) {
    button.disabled = !picker.value || !slotAvailable(layout, picker.value, button.value);
  }
  slotMarker(!renderer.xr.isPresenting && picker.value ? layout.pieces[picker.value].slot : null);
}

function setTray(open) {
  layout.trayOpen = open;
  sync();
  save(open ? 'Tray pulled out.' : 'Tray closed.');
}

function place(id, key, yaw) {
  layout.pieces[id] = {slot: key, yaw};
  sync();
  save(`${miniature.get(id).label} placed on ${slots[key].label.toLowerCase()}.`);
}

function desktopPose() {
  room.workshop.position.set(0, .88, 0);
  room.workshop.rotation.y = 0;
  camera.position.set(.92, 1.61, 1.15);
  orbit.target.set(0, .99, -.53);
  orbit.update();
}

function alignToViewer(frame) {
  const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
  if (!pose) return;
  const {position, orientation} = pose.transform;
  heading.set(0, 0, -1).applyQuaternion(orientation);
  room.workshop.position.set(position.x, position.y - .49, position.z);
  room.workshop.rotation.y = Math.atan2(-heading.x, -heading.z);
  alignWorkshop = false;
  readyToPlace = true;
}

function pickTarget(ray, grip) {
  const targets = [room.handle];
  if (layout.trayOpen) {
    for (const [id, {base}] of miniature) {
      if (slots[layout.pieces[id].slot].surface === 'tray') targets.push(base);
    }
  }
  for (const [id, {base}] of miniature) {
    if (slots[layout.pieces[id].slot].surface === 'shelf') targets.push(base);
  }
  grip.getWorldPosition(point);
  let closest = null;
  let radius = .115;
  for (const target of targets) {
    const distance = target.getWorldPosition(heading).distanceTo(point);
    if (distance >= radius) continue;
    closest = target;
    radius = distance;
  }
  if (closest) return closest;
  ray.getWorldPosition(raycaster.ray.origin);
  ray.getWorldQuaternion(rayRotation);
  raycaster.ray.direction.set(0, 0, -1).applyQuaternion(rayRotation);
  return raycaster.intersectObjects(targets, false).find(hit => hit.distance < 1.5)?.object;
}

function beginHold(ray, grip, input) {
  if (!readyToPlace || held || !grip.visible) return;
  const target = pickTarget(ray, grip);
  if (!target) return;
  if (target === room.handle) {
    const start = room.workshop.worldToLocal(grip.getWorldPosition(point)).z;
    held = {ray, grip, input, start, trayDepth: room.tray.position.z};
    return;
  }
  const id = target.userData.pieceId;
  const {root} = miniature.get(id);
  grip.add(root);
  root.position.set(0, -.045, -.052);
  root.rotation.set(0, layout.pieces[id].yaw, 0);
  held = {ray, grip, input, id, root};
}

function updateHold() {
  if (!held) return null;
  const {grip, root, id, start, trayDepth} = held;
  if (!root) {
    const position = room.workshop.worldToLocal(grip.getWorldPosition(point));
    room.tray.position.z = THREE.MathUtils.clamp(trayDepth + position.z - start, TRAY_CLOSED, TRAY_OPEN);
    return null;
  }
  const position = room.workshop.worldToLocal(root.getWorldPosition(point));
  const slot = nearestSlot(layout, id, position, room.tray.position.z);
  slotMarker(slot);
  return slot;
}

function release(ray, input) {
  if (held?.ray !== ray || held.input !== input) return;
  const key = updateHold();
  const {id, root, trayDepth} = held;
  held = null;
  if (!root) {
    const current = room.tray.position.z;
    const open = Math.abs(current - trayDepth) < .035
      ? !layout.trayOpen
      : current > (TRAY_OPEN + TRAY_CLOSED) / 2;
    setTray(open);
    return;
  }
  if (!key) {
    sync();
    return;
  }
  room.workshop.attach(root);
  heading.set(0, 0, 1).applyQuaternion(root.quaternion);
  const yaw = Math.hypot(heading.x, heading.z) > .05
    ? Math.atan2(heading.x, heading.z)
    : layout.pieces[id].yaw;
  place(id, key, yaw);
}

function setUpControllers() {
  for (let index = 0; index < 2; index++) {
    const ray = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    grip.add(controllerVisual());
    scene.add(grip, ray);
    for (const input of ['squeeze', 'select']) {
      ray.addEventListener(`${input}start`, () => beginHold(ray, grip, input));
      ray.addEventListener(`${input}end`, () => release(ray, input));
    }
    ray.addEventListener('disconnected', () => {
      if (held?.ray !== ray) return;
      held = null;
      sync();
    });
  }
}

async function setUpVR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) {
    xrStatus.textContent = 'Immersive VR is unavailable in this browser. The desktop controls work below.';
    return;
  }
  enter.disabled = false;
  xrStatus.textContent = 'In VR, use either controller’s grip button to pull the tray and pick up a miniature.';
  enter.addEventListener('click', async () => {
    enter.disabled = true;
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {requiredFeatures: ['local-floor']});
      await renderer.xr.setSession(session);
    } catch {
      if (session) await session.end().catch(() => {});
      xrStatus.textContent = 'Could not enter VR. Try again from your headset browser.';
      enter.disabled = false;
    }
  });
}

async function loadMiniature(piece, entry, signal) {
  if (!entry) throw Error(`Missing catalog entry: ${piece.label}`);
  let bytes, base;
  if (entry.parts) {
    bytes = await fetchSplitGLB(entry, benchURL, signal);
    base = new URL('assets/', benchURL);
  } else {
    const url = assetURL(entry, benchURL);
    const response = await fetch(url, {signal, redirect: 'error'});
    if (!response.ok) throw Error(`Could not fetch ${piece.label}`);
    bytes = await response.arrayBuffer();
    base = new URL('.', url);
  }
  const gltf = await parseSelectedGLB(loader, bytes, base.href, entry.compression);
  const model = makeMiniature(piece, gltf.scene);
  model.base.userData.pieceId = piece.id;
  return [piece.id, {...model, label: piece.label}];
}

async function start() {
  renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  stage.append(renderer.domElement);
  room = buildWorkshop(renderer, scene);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.minDistance = .6;
  orbit.maxDistance = 4;
  orbit.maxPolarAngle = 1.57;
  desktopPose();
  const resize = () => {
    if (renderer.xr.isPresenting) return;
    const {clientWidth, clientHeight} = stage;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight, false);
  };
  new ResizeObserver(resize).observe(stage);
  resize();
  setUpControllers();
  renderer.xr.addEventListener('sessionstart', () => {
    picker.value = '';
    sync();
    orbit.enabled = false;
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    alignWorkshop = true;
  });
  renderer.xr.addEventListener('sessionend', () => {
    held = null;
    readyToPlace = false;
    alignWorkshop = false;
    orbit.enabled = true;
    desktopPose();
    resize();
    sync();
    enter.disabled = false;
  });
  renderer.setAnimationLoop((time, frame) => {
    if (alignWorkshop && frame) alignToViewer(frame);
    if (held) updateHold();
    renderer.render(scene, camera);
  });

  const response = await fetch(new URL('catalog.json', benchURL));
  if (!response.ok) throw Error('Could not open the model catalog');
  const {models} = await response.json();
  const controller = new AbortController();
  try {
    const loaded = await Promise.all(PIECES.map(piece => loadMiniature(piece,
      models.find(entry => entry.id === piece.id && entry.version === piece.version), controller.signal)));
    for (const [id, model] of loaded) {
      miniature.set(id, model);
      picker.add(new Option(model.label, id));
    }
  } catch (error) {
    controller.abort();
    throw error;
  }

  layout = restore();
  for (const [key, slot] of Object.entries(slots)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.value = key;
    button.textContent = `Place on ${slot.label.toLowerCase()}`;
    button.addEventListener('click', () => place(picker.value, key, layout.pieces[picker.value].yaw));
    placements.append(button);
  }
  trayButton.disabled = false;
  picker.disabled = false;
  trayButton.addEventListener('click', () => setTray(!layout.trayOpen));
  picker.addEventListener('change', sync);
  rotate.addEventListener('click', () => {
    const {slot, yaw} = layout.pieces[picker.value];
    place(picker.value, slot, (yaw + Math.PI / 4) % (Math.PI * 2));
  });
  sync();
  status.textContent = 'Mike, Warden, and Keraunos are ready.';
  await setUpVR();
}

start().catch(error => {
  console.error(error);
  status.textContent = 'Could not load the VR Reference Bench. Reload the page to retry.';
  xrStatus.textContent = '';
});
