import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {SHELF_DEPTH, SHELF_HEIGHT, TRAY_HEIGHT, TRAY_CLOSED, slots} from './layout.mjs';

const mat = (color, roughness = .75) => new THREE.MeshStandardMaterial({color, roughness});
const walnut = mat(0x6e4630);
const edge = mat(0x926745);
const caseMetal = mat(0x293635);
const pad = mat(0x202b2a);
const brass = mat(0xb08d56, .43);
const board = mat(0x39403a);
const lamp = new THREE.MeshBasicMaterial({color: 0xffd79c});

function mesh(parent, geometry, material, x, y, z) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  parent.add(item);
  return item;
}

function box(parent, material, width, height, depth, x, y, z) {
  return mesh(parent, new THREE.BoxGeometry(width, height, depth), material, x, y, z);
}

function plaque(parent, rows, width, height, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round(1024 * height / width);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#232d2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#9b7950';
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  rows.forEach(({text, size, color = '#f7dfb9'}, index) => {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, 512, canvas.height * (index + 1) / (rows.length + 1), 970);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return mesh(parent, new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({map, toneMapped: false}), x, y, z);
}

export function buildWorkshop(renderer, scene) {
  scene.background = new THREE.Color(0x2e3733);
  scene.fog = new THREE.Fog(0x2e3733, 2.8, 7);
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  scene.environment = generator.fromScene(environment, .05).texture;
  scene.environmentIntensity = .76;
  environment.dispose();
  generator.dispose();

  const sky = new THREE.HemisphereLight(0xfff0d6, 0x4b555c, 1.25);
  const key = new THREE.DirectionalLight(0xffe3ba, 2.05);
  key.position.set(-1.2, 2.4, 1.25);
  const fill = new THREE.DirectionalLight(0xafdcdd, .7);
  fill.position.set(2, 1.5, -.65);
  scene.add(sky, key, fill);
  box(scene, mat(0x3d443d), 14, .04, 14, 0, -.023, 0);

  const workshop = new THREE.Group();
  scene.add(workshop);
  box(workshop, walnut, 1.2, .065, .79, 0, -.043, -.68);
  box(workshop, edge, 1.21, .017, .014, 0, -.021, -.279);
  for (const x of [-.52, .52]) {
    for (const z of [-.36, -.99]) {
      box(workshop, caseMetal, .045, 1.4, .047, x, -.752, z);
    }
  }

  box(workshop, board, .78, .435, .025, 0, .207, -.786);
  box(workshop, walnut, .79, .03, .365, 0, SHELF_HEIGHT - .015, SHELF_DEPTH);
  box(workshop, edge, .792, .018, .012, 0, SHELF_HEIGHT - .014, -.416);
  box(workshop, walnut, .79, .035, .27, 0, .411, -.675);
  box(workshop, lamp, .58, .007, .013, 0, .390, -.552);
  box(workshop, lamp, .58, .006, .012, 0, .177, -.448);
  for (const x of [-.385, .385]) {
    box(workshop, caseMetal, .031, .435, .37, x, .207, -.607);
    box(workshop, brass, .017, .435, .009, x, .207, -.418);
  }

  plaque(workshop, [{text: 'REFERENCE BENCH', size: 65}], .47, .062, 0, .335, -.767);
  plaque(workshop, [
    {text: 'Grip the handle and pull the tray', size: 51},
    {text: 'Grip a base · Turn it · Set it down', size: 49, color: '#c5d8cc'},
  ], .39, .061, 0, .271, -.766);
  plaque(workshop, [{text: 'DISPLAY SHELF', size: 70}], .17, .015, 0, .193, -.409);

  const tray = new THREE.Group();
  tray.position.z = TRAY_CLOSED;
  workshop.add(tray);
  box(tray, pad, .68, .026, .285, 0, 0, 0);
  box(tray, edge, .716, .05, .026, 0, .012, .137);
  box(tray, walnut, .712, .031, .018, 0, .015, -.143);
  for (const x of [-.35, .35]) box(tray, walnut, .025, .031, .27, x, .015, 0);
  for (const x of [-.061, .061]) box(tray, brass, .014, .016, .026, x, .012, .161);
  const handle = box(tray, brass, .137, .016, .016, 0, .012, .181);
  plaque(tray, [{text: 'MODEL TRAY', size: 69}], .15, .015, .216, .013, .152);

  for (const {surface, x, y, z} of Object.values(slots)) {
    const parent = surface === 'tray' ? tray : workshop;
    mesh(parent, new THREE.RingGeometry(.060, .062, 40),
      new THREE.MeshBasicMaterial({color: 0x9b8159, transparent: true, opacity: .78}), x, y + .001, z).rotation.x = -Math.PI / 2;
  }

  const marker = mesh(workshop, new THREE.RingGeometry(.059, .070, 40),
    new THREE.MeshBasicMaterial({color: 0xafe9be}), 0, TRAY_HEIGHT, 0);
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  return {workshop, tray, handle, marker};
}

export function makeMiniature(piece, model) {
  const root = new THREE.Group();
  const base = mesh(root, new THREE.CylinderGeometry(.053, .055, .013, 32), caseMetal, 0, .0065, 0);
  mesh(root, new THREE.CylinderGeometry(.050, .053, .003, 32), mat(piece.color), 0, .013, 0);
  plaque(root, [{text: piece.label.toUpperCase(), size: 91}], .073, .010, 0, .008, .0435);

  const bounds = new THREE.Box3().setFromObject(model, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.lengthSq() === 0) throw Error(`Empty model: ${piece.label}`);
  const scale = Math.min(.140 / Math.max(size.y, .0001), .109 / Math.max(size.x, size.z, .0001));
  const display = new THREE.Group();
  display.scale.setScalar(scale);
  display.position.set(-center.x * scale, .016 - bounds.min.y * scale, -center.z * scale);
  display.add(model);
  root.add(display);
  return {root, base};
}

export function controllerVisual() {
  const group = new THREE.Group();
  box(group, caseMetal, .037, .035, .083, 0, -.009, .014);
  box(group, brass, .039, .006, .038, 0, .01, -.008);
  return group;
}
