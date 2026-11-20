// Show joints that actually participate in skins, not every animated node.
export function createSkeletonOverlay(THREE) {
  const group = new THREE.Group();
  group.visible = false;
  let root, joints = [], edges = [], points, links;
  const point = new THREE.Vector3();
  function shape(count, draw, material, order) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)
      .setUsage(THREE.DynamicDrawUsage));
    const object = new draw(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = order;
    group.add(object);
    return geometry.getAttribute('position');
  }
  function clear() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    group.visible = false;
    root = points = links = null;
    joints = [];
    edges = [];
  }
  function setModel(model) {
    clear();
    const skinJoints = new Set();
    model.traverse(object => {
      if (object.isSkinnedMesh) {
        for (const bone of object.skeleton?.bones ?? []) if (bone?.isBone) skinJoints.add(bone);
      }
    });
    if (!skinJoints.size) return 0;
    root = model;
    joints = [...skinJoints];
    for (const bone of joints) {
      let parent = bone.parent;
      while (parent && parent !== model && !skinJoints.has(parent)) parent = parent.parent;
      if (skinJoints.has(parent)) edges.push(parent,bone);
    }
    const ink = {color:0x6ef4ff, depthTest:false, depthWrite:false, transparent:true, opacity:.95, toneMapped:false};
    points = shape(joints.length, THREE.Points, new THREE.PointsMaterial({...ink, size:5, sizeAttenuation:false}), 21);
    if (edges.length) links = shape(edges.length, THREE.LineSegments, new THREE.LineBasicMaterial(ink), 20);
    return joints.length;
  }
  function write(nodes, target) {
    nodes.forEach((bone,i) => {
      point.setFromMatrixPosition(bone.matrixWorld);
      target.setXYZ(i,point.x,point.y,point.z);
    });
    target.needsUpdate = true;
  }
  function update() {
    if (!group.visible || !root) return;
    root.updateWorldMatrix(true,true);
    write(joints, points);
    if (links) write(edges, links);
  }
  return {group, setModel, clear, setVisible(value) {group.visible = Boolean(value && joints.length);}, update};
}
