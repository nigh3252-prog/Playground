// Bent Horizon world module — ported from bent_horizon_camera_prototype_v7 and
// merged with the Stone Wanderer lab's A Link Between Worlds presentation.
//
// This is a real ES module: the host page (weapon-lab.html) calls
// installBentWorld(api) once during setup and gets back a small surface:
//   BentWorld.makeStandingLeanPivot(mesh)  — call while building static geometry
//   BentWorld.applyLean()                  — call after Character lean changes
//   BentWorld.bendAllMaterials()           — call once, after the scene is built
//   BentWorld.updateCamera()               — call after Ground tip / Zoom / View yaw change
//   BentWorld.update(dt)                   — call every frame, before rendering
//   BentWorld.renderFrame()                — call every frame, instead of renderer.render(scene, camera)
//
// `api` is the host's dependency surface. Everything it exposes is read through
// getters, so it is safe to build this object from live page state:
//   { THREE, scene, camera, renderer, worldRoot, actorRoot,
//     get camYaw(), get camDistance(), get groundTiltDeg(), get leanDeg(),
//     get horizonRollPct(), get rollStartDist() }

export function installBentWorld(api) {
  const { THREE, scene, camera, renderer, worldRoot } = api;
  // actorRoot does not exist yet when this runs (it is created after the
  // dungeon) — read it lazily through api.actorRoot inside update()/seedFocus(),
  // never destructured up front.

  /* --- Standing-element lean ---------------------------------------------
     Every standing piece gets the SAME camera-relative lean as the character:
     the mesh is wrapped in a pivot at its floor point and rotated back about X
     by the Character lean angle. Collision and gameplay positions are
     untouched (the pivot keeps the original XZ), and because the lean is a
     real rotation the bend shader tips leaned pieces over the horizon
     correctly instead of the old vertex-shear approach, which read wrong. */
  const xAxis = new THREE.Vector3(1, 0, 0);
  const leanPivots = [];
  const standingLeanQ = new THREE.Quaternion();
  function makeStandingLeanPivot(mesh) {
    if (!mesh || !mesh.isMesh || !mesh.parent) return mesh;
    const pivot = new THREE.Group();
    pivot.position.set(mesh.position.x, 0, mesh.position.z);
    mesh.parent.add(pivot);
    mesh.position.set(0, mesh.position.y, 0);
    pivot.add(mesh);
    leanPivots.push(pivot);
    return pivot;
  }
  function applyLean() {
    standingLeanQ.setFromAxisAngle(xAxis, THREE.MathUtils.degToRad(-api.leanDeg));
    for (const p of leanPivots) p.quaternion.copy(standingLeanQ);
  }

  /* --- Cylinder-world bend ("rolling log"), v7 ------------------------------
     - Camera-relative: pivot = smoothed camera focus, direction = camera
       forward on XZ, so the horizon is a stable screen-space band.
     - Geometry past uBendStart wraps onto a cylinder of radius uRadius whose
       axis is horizontal, R below the bend-start line. Vertex height joins
       the radius (r = R + y), so tall/leaned objects tip back over the
       horizon naturally.
     - Wrap angle caps at uThetaMax; anything beyond slides down the tangent
       and dives cleanly under the horizon. uThetaMax = 0 disables the bend.
     - Bends the WORLD position inside project_vertex, so it is correct for
       every mesh regardless of rotation. Materials here use flatShading, so
       three.js derives normals from screen derivatives of the bent positions,
       and lighting on the curved band is correct for free.
     - Fog is keyed to PRE-bend depth: wrapped geometry gets closer to the
       camera in view space, which would otherwise de-fog the horizon band. */
  const bendUniforms = {
    uPivotXZ: { value: new THREE.Vector2(0, 0) },
    uForwardXZ: { value: new THREE.Vector2(0, -1) },
    uBendStart: { value: 12.0 },
    uRadius: { value: 24.0 },
    uThetaMax: { value: 0.0 }
  };
  const BEND_GLOBALS = `
    uniform vec2 uPivotXZ;
    uniform vec2 uForwardXZ;
    uniform float uBendStart;
    uniform float uRadius;
    uniform float uThetaMax;
    float gBendFogDepth = 0.0;`;
  const BEND_PROJECT = `
    vec4 bendWorld = modelMatrix * vec4(transformed, 1.0);
    gBendFogDepth = -(viewMatrix * bendWorld).z;
    if (uThetaMax > 0.0005) {
      vec2 bendFwd = normalize(uForwardXZ);
      float bendT = dot(bendWorld.xz - uPivotXZ, bendFwd) - uBendStart;
      if (bendT > 0.0) {
        float theta = min(bendT / uRadius, uThetaMax);
        float extra = max(bendT - uThetaMax * uRadius, 0.0);
        float r = uRadius + bendWorld.y;
        float newT = sin(theta) * r + cos(theta) * extra;
        bendWorld.y = (cos(theta) * r - uRadius) - sin(theta) * extra;
        bendWorld.xz += bendFwd * (newT - bendT);
      }
    }
    vec4 mvPosition = viewMatrix * bendWorld;
    gl_Position = projectionMatrix * mvPosition;`;
  const BEND_FOG = `
    #ifdef USE_FOG
      vFogDepth = gBendFogDepth;
    #endif`;
  function applyBendToMaterial(mat) {
    if (!mat || mat.userData.__bendApplied) return mat;
    mat.userData.__bendApplied = true;
    const prevCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, rendererArg) => {
      if (prevCompile) prevCompile(shader, rendererArg);
      shader.uniforms.uPivotXZ = bendUniforms.uPivotXZ;
      shader.uniforms.uForwardXZ = bendUniforms.uForwardXZ;
      shader.uniforms.uBendStart = bendUniforms.uBendStart;
      shader.uniforms.uRadius = bendUniforms.uRadius;
      shader.uniforms.uThetaMax = bendUniforms.uThetaMax;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>' + BEND_GLOBALS)
        .replace('#include <project_vertex>', BEND_PROJECT)
        .replace('#include <fog_vertex>', BEND_FOG);
      mat.userData.shader = shader;
    };
    const prevKey = typeof mat.customProgramCacheKey === 'function' ? mat.customProgramCacheKey.bind(mat) : null;
    mat.customProgramCacheKey = () => 'bent-cylinder-v7|' + (prevKey ? prevKey() : '');
    mat.needsUpdate = true;
    return mat;
  }
  // Patch every mesh material currently in the scene. Call once right before
  // the animate loop starts, after the dungeon, actor, and dummy are built.
  // Transient effect materials created later (hit rings, gibs) live near the
  // player where the bend is zero, so they are intentionally left unpatched.
  function bendAllMaterials() {
    scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) applyBendToMaterial(m);
    });
  }

  /* --- 2D sky pass -----------------------------------------------------------
     Rendered before the 3D scene each frame (renderer.autoClear is off; the
     host clears, draws sky, clears depth, draws world). The sky never moves
     with the camera; the rolled ground reveals or hides it. Palette matches
     the dungeon fog color so the wrap fades seamlessly. */
  const skyScene2D = new THREE.Scene();
  const skyCamera2D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  skyCamera2D.position.z = 1;
  function makeSkyGradientTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0.00, '#04070d');
    g.addColorStop(0.45, '#0d1a2c');
    g.addColorStop(0.78, '#26425e');
    g.addColorStop(1.00, '#16283a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  skyScene2D.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: makeSkyGradientTexture(), depthWrite: false, depthTest: false })
  ));
  const moon2D = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 64),
    new THREE.MeshBasicMaterial({ color: 0x9fc4ee, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false })
  );
  moon2D.position.set(0.55, 0.55, 0.01);
  skyScene2D.add(moon2D);
  renderer.autoClear = false;

  /* --- Outer ground sheet + far landmarks -------------------------------------
     One continuous, well-segmented floor handles the bend, so the horizon
     falls away as a single sheet. Standing landmarks past the arena make the
     scroll and the roll readable; they lean with the character like
     everything else. */
  function makeOuterGroundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b1420';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 340; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * 512;
      const y = (Math.sin(i * 78.233) * 12578.1459 % 1 + 1) % 1 * 512;
      const s = 8 + ((Math.sin(i * 3.7) * 951.135 % 1 + 1) % 1) * 30;
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.018)' : 'rgba(80,140,220,.03)';
      ctx.fillRect(x, y, s, s);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 10);
    return tex;
  }
  const outerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 420, 72, 140),
    new THREE.MeshStandardMaterial({ map: makeOuterGroundTexture(), color: 0xaebfd4, roughness: 0.96, metalness: 0.0 })
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.06;
  outerGround.receiveShadow = true;
  worldRoot.add(outerGround);
  {
    const monoMat = new THREE.MeshStandardMaterial({ color: 0x2b3a4e, roughness: 0.9, metalness: 0.03, flatShading: true });
    const monoMat2 = new THREE.MeshStandardMaterial({ color: 0x1f2c3d, roughness: 0.94, metalness: 0.02, flatShading: true });
    const rnd = n => (Math.sin(n * 12.9898) * 43758.5453 % 1 + 1) % 1;
    for (let i = 0; i < 46; i++) {
      const ang = rnd(i * 7 + 1) * Math.PI * 2;
      const rad = 48 + rnd(i * 13 + 5) * 120;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const h = 2.5 + rnd(i * 3 + 2) * 9;
      const w = 0.9 + rnd(i * 5 + 3) * 2.4;
      const mono = i % 4 === 0
        ? new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.7, h, 6), monoMat2)
        : new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + rnd(i) * 0.6), 1, Math.max(2, Math.round(h)), 1), monoMat);
      mono.position.set(x, h / 2, z);
      mono.rotation.y = rnd(i * 11) * Math.PI;
      mono.castShadow = mono.receiveShadow = true;
      worldRoot.add(mono);
      makeStandingLeanPivot(mono);
    }
  }

  /* --- Camera ------------------------------------------------------------------
     v7 "mode C" long telephoto lens. Near the player it reads almost
     orthographic, but the horizon gets real perspective convergence. The
     world stays flat and Y-up (the bend needs true world height); Ground tip
     pitches the CAMERA instead of rotating the world — same image, but only
     one of them keeps the bend math correct.
     Old lab camera was fov 44 sitting at camDistance with pitch atan(0.72) ~=
     36deg; framing is matched so the existing zoom slider values mean the
     same on-screen size, and the old implicit pitch is folded into the base
     so Ground tip 0 looks like the original lab. */
  const camFocus = new THREE.Vector3(0, 0, 0);
  const camTmp = new THREE.Vector3();
  const LEGACY_FOV = 44;
  const BASE_PITCH_DEG = 36;
  function updateCamera(dt = 0) {
    const pitchDeg = THREE.MathUtils.clamp(BASE_PITCH_DEG + api.groundTiltDeg, 10, 86);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const fovMatch = Math.tan(THREE.MathUtils.degToRad(LEGACY_FOV * 0.5)) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const dist = api.camDistance * fovMatch;
    const sy = Math.sin(api.camYaw), cy = Math.cos(api.camYaw), cp = Math.cos(pitch);
    camTmp.set(camFocus.x + sy * cp * dist, camFocus.y + Math.sin(pitch) * dist, camFocus.z + cy * cp * dist);
    if (dt > 0) camera.position.lerp(camTmp, 1 - Math.exp(-9 * dt));
    else camera.position.copy(camTmp);
    // Aim a touch ahead of the focus: sits the character low on screen,
    // leaving the top band for the rolled horizon and sky.
    const ahead = 3.2;
    camera.lookAt(camFocus.x - sy * ahead, 0.6, camFocus.z - cy * ahead);
    bendUniforms.uPivotXZ.value.set(camFocus.x, camFocus.z);
    bendUniforms.uForwardXZ.value.set(-sy, -cy);
    bendUniforms.uBendStart.value = api.rollStartDist;
    const roll01 = THREE.MathUtils.clamp(api.horizonRollPct / 100, 0, 1);
    bendUniforms.uRadius.value = THREE.MathUtils.lerp(78, 7, Math.pow(roll01, 0.85));
    bendUniforms.uThetaMax.value = roll01 <= 0.001 ? 0.0 : 1.35;
    scene.fog.near = dist + api.rollStartDist * 0.75;
    scene.fog.far = dist + api.rollStartDist + 30 + bendUniforms.uRadius.value * 1.5;
    renderer.toneMappingExposure = 1.18 + Math.min(api.camDistance, 90) * 0.0025;
  }

  const focusTmp = new THREE.Vector3();
  function update(dt) {
    const actor = api.actorRoot;
    focusTmp.set(actor.position.x, 0, actor.position.z);
    camFocus.lerp(focusTmp, 1 - Math.exp(-8 * dt));
    updateCamera(dt);
  }
  // Snap the focus straight to the actor's position (no lerp). Call once,
  // after the actor exists, right before the first animate() frame, so the
  // camera doesn't pan in from the origin on load.
  function seedFocus() {
    const actor = api.actorRoot;
    if (actor) camFocus.set(actor.position.x, 0, actor.position.z);
  }

  function renderFrame() {
    renderer.clear();
    renderer.render(skyScene2D, skyCamera2D);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  return { makeStandingLeanPivot, applyLean, bendAllMaterials, updateCamera, update, seedFocus, renderFrame };
}
