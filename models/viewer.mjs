import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createSelection, modelURL, resolveModel, stepModel} from './navigation.mjs';
import {defaultFilters, filterModels, modelFacetOptions} from './filters.mjs';
import {assetURL, fetchSplitGLB} from './asset-paths.mjs';
import {parseSelectedGLB} from './parse-selected-glb.mjs';
import {createSkeletonOverlay} from './skeleton-overlay.mjs';

const el = id => document.getElementById(id);
const stage = el('stage');
const picker = el('model-picker');
const clipPicker = el('clip');
const play = el('play');
const scrub = el('scrub');
const loop = el('loop');
const controls = ['fit','turn-left','turn-right'].map(el);
const meshGroup = new THREE.Group();
const skeletonOverlay = createSkeletonOverlay(THREE);
const skeletonCheckbox = el('show-skeleton');
const rigControl = el('skeleton-control');
const filterForm = el('model-filters');
const sectionButtons = [...el('browse-sections').querySelectorAll('button')];
const panelEntries = [
  [el('filter-toggle'),el('filter-panel')],
  [el('details-toggle'),el('metadata')],
  [el('animation-toggle'),el('animation')],
];
let openPanel = null;
let jointCount = 0, matches = [], filters = defaultFilters;
const loader = new GLTFLoader();
let catalog, current, renderer, scene, camera, orbit, active, mixer, action, playing;
let lastFrame = 0, frameRequest = 0, fit = 1;

function showStatus(message, recoverable = false) {
  el('message').hidden = !message;
  el('status').textContent = message;
  el('retry').hidden = !recoverable;
  el('reset-empty').hidden = true;
}

function initStage() {
  renderer = new THREE.WebGLRenderer({alpha:true, antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.append(renderer.domElement);
  scene = new THREE.Scene();
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reflection = pmrem.fromScene(room, .05);
  scene.environment = reflection.texture;
  scene.environmentIntensity = .75;
  room.dispose();
  pmrem.dispose();
  camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.enablePan = true;
  orbit.minDistance = .24;
  orbit.maxDistance = 18;
  orbit.enabled = false;
  orbit.addEventListener('change', requestDraw);
  orbit.target.set(0,.15,0);
  scene.add(meshGroup, skeletonOverlay.group);
  scene.add(new THREE.HemisphereLight(0xd4edff, 0x56473d, 1.9));
  const key = new THREE.DirectionalLight(0xfff1dd, 2.3);
  key.position.set(3,5,4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x80b9ff, 1.8);
  rim.position.set(-3,2,-4);
  scene.add(rim);
  const floor = new THREE.GridHelper(12, 24, 0x83a1b1, 0x566d7e);
  floor.position.y = -.9;
  floor.material.transparent = true;
  floor.material.opacity = .32;
  scene.add(floor);
  const resize = () => {
    const {clientWidth:w,clientHeight:h} = stage;
    if (!w || !h) return;
    renderer.setSize(w,h,false);
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
    if (active) fitStage();
    requestDraw();
  };
  new ResizeObserver(resize).observe(stage);
  resize();
}

function requestDraw() {
  if (!frameRequest) frameRequest = requestAnimationFrame(draw);
}
function draw(now) {
  frameRequest = 0;
  const delta = Math.min(lastFrame ? (now-lastFrame)/1000 : 0, .05);
  lastFrame = playing ? now : 0;
  if (playing && action) {
    mixer.update(delta);
    syncTime();
  }
  // The controls' change event requests the next damping frame only when needed.
  orbit.update(delta);
  skeletonOverlay.update();
  renderer.render(scene,camera);
  if (playing) requestDraw();
}

function fitStage() {
  const distance = fit / (Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * Math.min(camera.aspect, 1));
  orbit.target.set(0,0,0);
  camera.position.copy(new THREE.Vector3(1.1,.65,1.7).normalize().multiplyScalar(distance));
  orbit.update();
  requestDraw();
}

function rotateStage(angle) {
  if (!active) return;
  const offset = camera.position.clone().sub(orbit.target);
  offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);
  camera.position.copy(orbit.target).add(offset);
  orbit.update();
}

function dispose(gltf) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  gltf.scenes.forEach(root => root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    const entries = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of entries) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  }));
  const images = new Set([...textures].map(texture => texture.source?.data));
  textures.forEach(texture => texture.dispose());
  images.forEach(image => image?.close?.());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  skeletons.forEach(skeleton => skeleton.dispose());
}

let splitDownloadURL;
function clearActive() {
  if (splitDownloadURL) {
    URL.revokeObjectURL(splitDownloadURL);
    splitDownloadURL = null;
    el('download').removeAttribute('href');
    el('download').hidden = true;
  }
  mixer?.stopAllAction();
  if (active && mixer) mixer.uncacheRoot(active.scene);
  skeletonOverlay.clear();
  jointCount = 0;
  rigControl.hidden = true;
  skeletonCheckbox.checked = false;
  delete stage.dataset.skeleton;
  meshGroup.clear();
  if (active) dispose(active);
  active = mixer = action = null;
  playing = false;
  el('animation').hidden = el('animation-toggle').hidden = el('static-label').hidden = true;
  if (openPanel === el('animation')) setPanel(null);
  stage.dataset.model = '';
  delete stage.dataset.version;
  orbit.enabled = false;
  controls.forEach(button => button.disabled = true);
  requestDraw();
}

function syncTime() {
  const time = action?.time ?? 0;
  scrub.value = time;
  el('time').value = `${time.toFixed(2)} s`;
}

function setPlaying(value) {
  playing = value;
  if (action) action.paused = !value;
  play.textContent = value ? 'Pause' : 'Play';
  play.setAttribute('aria-label', value ? 'Pause animation' : 'Play animation');
  if (!value) lastFrame = 0;
  requestDraw();
}

function setLoop() {
  if (!action) return;
  action.setLoop(loop.checked ? THREE.LoopRepeat : THREE.LoopOnce, loop.checked ? Infinity : 1);
  action.clampWhenFinished = !loop.checked;
}
function chooseClip(index) {
  const clip = active.animations[index];
  if (!clip) return;
  mixer.stopAllAction();
  action = mixer.clipAction(clip).reset();
  setLoop();
  action.play();
  scrub.max = clip.duration;
  setPlaying(false);
  mixer.update(0);
  syncTime();
}
function seek(time) {
  if (!action) return;
  action.time = time;
  mixer.update(0);
  syncTime();
  requestDraw();
}

function install(entry, gltf) {
  gltf.scene.updateMatrixWorld(true);
  const orientation = new THREE.Group();
  orientation.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(orientation,true);
  if (entry.sourceCollection === 'armory') {
    const original = box.getSize(new THREE.Vector3());
    // Match Armory's default display orientation without changing the GLB or its clips.
    if (original.z > original.x && original.z > original.y) orientation.rotation.y = Math.PI / 2;
    else if (original.y > original.x && original.y > original.z) orientation.rotation.z = -Math.PI / 2;
    box.setFromObject(orientation,true);
  }
  if (box.isEmpty()) throw Error('Model has no visible geometry');
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const scale = 1.75/Math.max(size.x,size.y,size.z,.0001);
  // Inspection-only transform. The GLB remains untouched, including its scale and clips.
  const framing = new THREE.Group();
  framing.position.copy(center).multiplyScalar(-scale);
  framing.scale.setScalar(scale);
  framing.add(orientation);
  meshGroup.add(framing);
  active = gltf;
  jointCount = skeletonOverlay.setModel(gltf.scene);
  skeletonCheckbox.checked = false;
  rigControl.hidden = !jointCount;
  fit = Math.max(.94, size.length()*scale*.56);
  fitStage();
  const clips = gltf.animations;
  if (clips.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.addEventListener('finished', () => setPlaying(false));
    clipPicker.replaceChildren(...clips.map((clip,i) => new Option(clip.name.replaceAll('_',' ') || `Clip ${i+1}`, i)));
    chooseClip(0);
    el('animation').hidden = el('animation-toggle').hidden = false;
  } else el('static-label').hidden = false;
  orbit.enabled = true;
  controls.forEach(button => button.disabled = false);
  stage.dataset.model = entry.id;
  stage.dataset.version = entry.version;
  showStatus('');
}
const select = createSelection({
  async load(entry, signal) {
    if (!entry) return null;
    if (entry.parts != null) {
      const bytes = await fetchSplitGLB(entry, location.href, signal);
      signal.throwIfAborted();
      const gltf = await parseSelectedGLB(loader, bytes, new URL('./assets/',location.href).href, entry.compression);
      return {gltf, bytes};
    }
    const url = assetURL(entry, location.href);
    const response = await fetch(url, {signal,redirect:'error'});
    if (!response.ok) throw Error(`Model request returned ${response.status}`);
    return {gltf: await parseSelectedGLB(loader, await response.arrayBuffer(), new URL('.',url).href, entry.compression)};
  },
  install(entry,result) {
    if (!result) return;
    const {gltf:glTF, bytes} = result;
    try {
      install(entry,glTF);
      if (bytes) {
        splitDownloadURL = URL.createObjectURL(new Blob([bytes], {type:'model/gltf-binary'}));
        const download = el('download');
        download.href = splitDownloadURL;
        download.download = entry.originalFile;
        download.hidden = false;
      }
    } catch(error) {
      if (active === glTF) clearActive();
      else dispose(glTF);
      throw error;
    }
  },
  discard:result => {if (result) dispose(result.gltf);},
  fail(entry) {showStatus(`Could not open ${entry.name}. You can retry or choose another model.`,true);},
});

function metadata(entry) {
  const data = {
    Triangles:entry.triangles,
    Meshes:entry.meshes,
    Textures:entry.textures,
    'File size':Number.isFinite(entry.bytes) ? `${(entry.bytes/1e6).toFixed(2)} MB` : null,
    Rig:entry.rig,
    ...(entry.pack ? {Pack:entry.pack} : {}),
    Clips:entry.clips?.length,
    Credits:entry.credits,
    License:entry.license,
  };
  el('stats').replaceChildren(...Object.entries(data).flatMap(([title,value])=>{
    const term=document.createElement('dt'), definition=document.createElement('dd');
    term.textContent=title;
    definition.textContent=Array.isArray(value) ? value.join(', ') : (typeof value === 'number' ? value.toLocaleString() : value ?? 'Unknown');
    return [term,definition];
  }));
  const download = el('download');
  try {
    const url = assetURL(entry, location.href);
    download.href = url.href;
    download.download = url.pathname.split('/').pop();
    download.hidden = false;
  } catch {
    download.removeAttribute('href');
    download.hidden = true;
  }
}
function setPanel(panel, returnFocus = false) {
  const previous = openPanel;
  openPanel = panel;
  for (const [trigger,entry] of panelEntries) {
    trigger.setAttribute('aria-expanded', String(entry === panel));
    entry.classList.toggle('panel-open',entry === panel);
    if (entry !== el('animation')) entry.hidden = entry !== panel;
  }
  el('panel-scrim').hidden = !panel;
  if (panel) panel.querySelector('[data-close-panel]').focus({preventScroll:true});
  else if (returnFocus && previous) panelEntries.find(([,entry]) => entry === previous)?.[0].focus({preventScroll:true});
}
for (const [trigger,panel] of panelEntries) {
  trigger.onclick = () => setPanel(openPanel === panel ? null : panel);
  panel.querySelector('[data-close-panel]').onclick = () => setPanel(null,true);
}
el('panel-scrim').onclick = () => setPanel(null,true);
window.addEventListener('keydown',event=>{
  if (event.key === 'Escape' && openPanel) { event.preventDefault(); setPanel(null,true); }
});

function syncSelection() {
  const index = matches.indexOf(current);
  picker.value = index < 0 ? '' : String(index);
  if (index >= 0) {
    el('ordinal').textContent = `${index+1} of ${matches.length}`;
  } else el('ordinal').textContent = '0 matches';
  el('copy').disabled = el('details-toggle').disabled = index < 0;
  const chips = el('model-chips');
  [...chips.children].forEach((button,i) => button.setAttribute('aria-pressed',String(i === index)));
}
function updateResults() {
  matches = filterModels(catalog, filters);
  for (const button of sectionButtons) {
    button.disabled = false;
    button.setAttribute('aria-pressed',String(button.dataset.section === filters.section));
  }
  const count = matches.length;
  const summary = `${count} of ${catalog.length} models`;
  el('filter-count').textContent = summary;
  const filterToggle = el('filter-toggle');
  const activeFilter = filters.type !== 'all' || filters.complexity !== 'all' || filters.latest || filters.motion.length || filters.family || filters.collection;
  filterToggle.textContent = activeFilter ? `Filters · ${count}` : 'Filters';
  filterToggle.setAttribute('aria-label',activeFilter ? `Filters, ${summary}` : 'Filters');
  filterToggle.disabled = false;
  el('prev').disabled = el('next').disabled = count < 2;
  picker.disabled = !count;
  picker.replaceChildren(...matches.map((entry,index)=>new Option(`${entry.name} · ${entry.version}`,index)));
  if (!count) picker.append(new Option('No matching models',''));
  el('model-chips').replaceChildren(...matches.map((entry,index)=>{
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${entry.name} · ${entry.version}`;
    button.setAttribute('aria-pressed',String(entry === current));
    button.onclick = () => choose(matches[index],'push');
    return button;
  }));
}
function choose(entry, historyMode = 'none', fallback = false, force = false) {
  if (!entry) return;
  const same = current === entry;
  current = entry;
  const url = modelURL(location.href,entry);
  if (historyMode === 'push' && url.href !== location.href) history.pushState({benchFilters:filters},'',url);
  else if (historyMode !== 'none') rememberBrowse(url);
  syncSelection();
  el('lookup-note').hidden = !fallback;
  el('lookup-note').textContent = fallback ? 'That model version is not in the catalog. Showing the first model instead.' : '';
  if (same && !force && !fallback) return;
  clearActive();
  el('model-name').textContent = entry.name;
  el('model-version').textContent = entry.version;
  el('copy').textContent = 'Copy link';
  document.title = `${entry.name} ${entry.version} · Model Review Bench`;
  metadata(entry);
  showStatus(`Loading ${entry.name}…`);
  return select(entry);
}
function setEmpty() {
  select(null);
  current = null;
  syncSelection();
  clearActive();
  if (openPanel === el('metadata')) setPanel(null);
  el('model-name').textContent = 'No matching models';
  el('model-version').textContent = '';
  el('lookup-note').hidden = true;
  document.title = 'Model Review Bench · Playground';
  showStatus('Try removing a filter or clearing all filters.');
  el('reset-empty').hidden = false;
}
function filterFromControls() {
  const values = new FormData(filterForm);
  filters = {
    section:filters.section,
    family:values.get('family'),
    collection:values.get('collection'),
    type:values.get('type'),
    complexity:values.get('complexity'),
    motion:values.getAll('motion'),
    latest:values.has('latest'),
  };
  applyBrowse();
}
function applyBrowse() {
  updateResults();
  if (!matches.length) setEmpty();
  else if (!matches.includes(current)) choose(matches[0],'push');
  else {
    syncSelection();
    rememberBrowse();
  }
}
function rememberBrowse(url = location.href) {
  history.replaceState({...history.state,benchFilters:filters},'',url);
}
function resetFilters() {
  filterForm.reset();
  filterFromControls();
}
for (const button of sectionButtons) {
  button.onclick = () => {
    if (filters.section === button.dataset.section) return;
    filters = {...filters,section:button.dataset.section};
    applyBrowse();
  };
}
filterForm.onchange = filterFromControls;
filterForm.onsubmit = event => event.preventDefault();
el('clear-filters').onclick = el('reset-empty').onclick = resetFilters;
function chooseFromLocation() {
  const {model, fallback} = resolveModel(catalog,location.search);
  // Restore this entry's local browse state, but always honor the explicit model URL.
  const saved = history.state?.benchFilters;
  filters = saved ? {...defaultFilters,...saved} : defaultFilters;
  updateResults();
  if (!matches.includes(model)) {
    filters = defaultFilters;
    updateResults();
  }
  for (const field of ['type','complexity','family','collection']) {
    filterForm.elements.namedItem(field).value = filters[field];
  }
  for (const check of filterForm.querySelectorAll('[name="motion"]')) {
    check.checked = filters.motion.includes(check.value);
  }
  filterForm.elements.namedItem('latest').checked = filters.latest;
  choose(model, fallback || !location.search ? 'replace':'none',fallback);
  if (!saved) rememberBrowse();
}
async function start() {
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) throw Error('Catalog unavailable');
    const document = await response.json();
    if (document.schemaVersion !== 1 || !Array.isArray(document.models) || !document.models.length) throw Error('Catalog is empty or unsupported');
    catalog = document.models;
    for (const facet of ['family','collection']) {
      filterForm.elements.namedItem(facet).append(...modelFacetOptions(catalog,facet).map(value=>new Option(value,value)));
    }
    initStage();
    updateResults();
    chooseFromLocation();
  } catch {
    showStatus('The viewer could not start. Check that WebGL is enabled, or open the model catalog.');
    const catalogLink = document.createElement('a');
    catalogLink.href = './catalog.json';
    catalogLink.textContent = 'Open model catalog';
    el('message').append(catalogLink);
  }
}
el('prev').onclick = () => choose(stepModel(matches,current,-1),'push');
el('next').onclick = () => choose(stepModel(matches,current,1),'push');
picker.onchange = () => choose(matches[Number(picker.value)],'push');
el('retry').onclick = () => choose(current,'none',false,true);
skeletonCheckbox.onchange = () => {
  const visible = skeletonCheckbox.checked && jointCount > 0;
  skeletonOverlay.setVisible(visible);
  if (visible) stage.dataset.skeleton = String(jointCount);
  else delete stage.dataset.skeleton;
  requestDraw();
};
el('fit').onclick = fitStage;
el('turn-left').onclick = () => rotateStage(-Math.PI/8);
el('turn-right').onclick = () => rotateStage(Math.PI/8);
window.addEventListener('popstate',()=>{if (catalog && orbit) chooseFromLocation();});
el('copy').onclick = async () => {
  const entry = current;
  const url = modelURL(location.href,entry).href;
  try {
    await navigator.clipboard.writeText(url);
    if (entry === current) el('copy').textContent = 'Copied';
  } catch { window.prompt('Copy model link',url); }
};
clipPicker.onchange = () => chooseClip(Number(clipPicker.value));
scrub.oninput = () => seek(Number(scrub.value));
loop.onchange = setLoop;
play.onclick = () => {
  if (!action) return;
  if (!playing && action.time >= action.getClip().duration - .005) {
    action.reset().play();
    setLoop();
    syncTime();
  }
  setPlaying(!playing);
};
start();
