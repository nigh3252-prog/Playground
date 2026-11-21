import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../armory/vendor/three.module.min.js';
import {createSkeletonOverlay} from '../skeleton-overlay.mjs';

test('uses only skin joints, follows world space, and clears overlay resources', () => {
  const overlay = createSkeletonOverlay(THREE);
  const scene = new THREE.Group(), root = new THREE.Group(), wrapper = new THREE.Group();
  const hip = new THREE.Bone(), knee = new THREE.Bone(), unused = new THREE.Bone();
  const bridge = new THREE.Group();
  const first = new THREE.SkinnedMesh(), second = new THREE.SkinnedMesh();
  hip.add(bridge); bridge.add(knee);
  knee.position.y = -1;
  wrapper.add(hip, unused, first, second);
  wrapper.position.set(0,3,0);
  root.scale.setScalar(2);
  root.add(wrapper); scene.add(root, overlay.group);
  first.bind(new THREE.Skeleton([hip,knee]));
  second.bind(new THREE.Skeleton([hip,knee]));
  assert.equal(overlay.setModel(wrapper),2);
  assert.equal(overlay.group.visible,false);
  overlay.setVisible(true);
  overlay.update();
  const line = overlay.group.children.find(x => x.isLineSegments);
  const dots = overlay.group.children.find(x => x.isPoints);
  const xyz = object => [...object.geometry.attributes.position.array];
  assert.deepEqual(xyz(line),[0,6,0,0,4,0]);
  assert.deepEqual(xyz(dots),[0,6,0,0,4,0]);
  knee.position.x = 2;
  overlay.update();
  assert.deepEqual(xyz(line),[0,6,0,4,4,0]);
  let disposed = 0;
  for (const obj of [line,dots]) {
    obj.geometry.addEventListener('dispose',()=>disposed++);
    obj.material.addEventListener('dispose',()=>disposed++);
  }
  overlay.clear();
  assert.equal(disposed,4);
  assert.equal(overlay.group.children.length,0);
  overlay.setVisible(true);
  assert.equal(overlay.group.visible,false);
});

test('animation without a skin does not produce an overlay', () => {
  const root = new THREE.Group();
  root.add(new THREE.Bone(), new THREE.Mesh());
  const overlay = createSkeletonOverlay(THREE);
  assert.equal(overlay.setModel(root),0);
  overlay.setVisible(true);
  overlay.update();
  assert.equal(overlay.group.visible,false);
  assert.equal(overlay.group.children.length,0);
});
