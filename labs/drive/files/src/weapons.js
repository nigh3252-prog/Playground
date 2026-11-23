// Stone Wanderer weapon definitions and 3D weapon builders.
//
// weapon-lab.html imports this module directly for weapon definitions, shared
// weapon mesh builders, and optional per-weapon visual update hooks.

export const STONE_WEAPON_ORDER = [
  'longsword',
  'dagger',
  'rapier',
  'katana',
  'mace',
  'spear',
  'battleaxe',
  'warhammer',
  'claymore',
  'greatsword'
];

export const STONE_WEAPONS = {
  longsword: {
    label: 'Longsword',
    weightClass: 'Medium',
    staminaClass: 'Medium',
    kind: 'blade',
    baseLength: 1.00,
    profile: 'balanced sword; default testing weapon',
    tune: { length: 1.00, weight: 0.35, pullback: 1.00, swingWidth: 1.00, windup: 1.00, follow: 1.00, recovery: 1.00, impact: 1.00, trailBoost: 1.00 }
  },
  dagger: {
    label: 'Dagger',
    weightClass: 'Light',
    staminaClass: 'Light',
    kind: 'blade',
    baseLength: 0.55,
    profile: 'short, snappy, little recovery',
    tune: { length: 0.55, weight: 0.06, pullback: 0.28, swingWidth: 0.62, windup: 0.62, follow: 0.60, recovery: 0.55, impact: 0.48, trailBoost: 0.58 }
  },
  rapier: {
    label: 'Rapier',
    weightClass: 'Light',
    staminaClass: 'Light',
    kind: 'rapier',
    baseLength: 0.98,
    profile: 'needle tip; best on thrusts with quick recovery',
    tune: { length: 0.92, weight: 0.12, pullback: 0.55, swingWidth: 0.58, windup: 0.72, follow: 0.70, recovery: 0.62, impact: 0.62, trailBoost: 0.75 }
  },
  katana: {
    label: 'Katana',
    weightClass: 'Light',
    staminaClass: 'Light',
    kind: 'katana',
    baseLength: 0.98,
    profile: 'two-handed curved cutter; quick draw and committed edge arcs',
    tune: { length: 0.96, weight: 0.27, pullback: 0.84, swingWidth: 1.08, windup: 0.84, follow: 0.90, recovery: 0.80, impact: 0.86, trailBoost: 1.08 }
  },
  whip: {
    label: 'Whip',
    weightClass: 'Light',
    staminaClass: 'Light',
    kind: 'whip',
    baseLength: 1.65,
    profile: 'flexible lash; snaps forward near contact',
    tune: { length: 1.42, weight: 0.10, pullback: 1.25, swingWidth: 1.35, windup: 0.86, follow: 1.05, recovery: 0.86, impact: 0.70, trailBoost: 1.70 }
  },
  mace: {
    label: 'Mace',
    weightClass: 'Medium',
    staminaClass: 'Medium',
    kind: 'mace',
    baseLength: 0.82,
    profile: 'compact blunt head; chunky impact',
    tune: { length: 0.78, weight: 0.52, pullback: 1.08, swingWidth: 0.96, windup: 1.08, follow: 1.10, recovery: 1.12, impact: 1.38, trailBoost: 0.88 }
  },
  spear: {
    label: 'Spear',
    weightClass: 'Medium',
    staminaClass: 'Medium',
    kind: 'spear',
    baseLength: 1.58,
    profile: 'long shaft; big reach and direct thrusts',
    tune: { length: 1.42, weight: 0.34, pullback: 0.95, swingWidth: 0.72, windup: 0.96, follow: 0.96, recovery: 0.94, impact: 0.95, trailBoost: 0.90 }
  },
  battleaxe: {
    label: 'Battle Axe',
    weightClass: 'Heavy',
    staminaClass: 'Heavy',
    kind: 'axe',
    baseLength: 1.02,
    profile: 'top-heavy blade; committed chops',
    tune: { length: 1.02, weight: 0.64, pullback: 1.25, swingWidth: 1.22, windup: 1.22, follow: 1.34, recovery: 1.30, impact: 1.55, trailBoost: 1.05 }
  },
  warhammer: {
    label: 'War Hammer',
    weightClass: 'Heavy',
    staminaClass: 'Heavy',
    kind: 'hammer',
    baseLength: 0.98,
    profile: 'long-shafted standard hammer; broad hanging face, counterweight sign, and toothed striking edge',
    tune: { length: 0.98, weight: 0.88, pullback: 1.52, swingWidth: 1.08, windup: 1.42, follow: 1.55, recovery: 1.60, impact: 1.90, trailBoost: 0.92 }
  },
  claymore: {
    label: 'Claymore',
    weightClass: 'Medium',
    staminaClass: 'Medium',
    kind: 'blade',
    baseLength: 1.48,
    profile: 'big two-handed blade; wide arcs and deep pullback',
    tune: { length: 1.55, weight: 0.84, pullback: 1.65, swingWidth: 1.45, windup: 1.55, follow: 1.62, recovery: 1.72, impact: 1.75, trailBoost: 1.45 }
  },
  greatsword: {
    label: 'Greatsword',
    weightClass: 'Heavy',
    staminaClass: 'Heavy',
    kind: 'blade',
    baseLength: 1.70,
    profile: 'longest rigid blade; extra reach and camera room',
    tune: { length: 1.78, weight: 0.76, pullback: 1.58, swingWidth: 1.34, windup: 1.46, follow: 1.50, recovery: 1.58, impact: 1.60, trailBoost: 1.32 },
    visualVariants: {
      original: { label: 'Original Greatsword', meshBuilder: 'defaultRigidBlade' },
      redToll: {
        label: 'Red Toll',
        meshBuilder: 'redTollGreatsword',
        lengthMultiplier: 1.30,
        // Baked Red Toll yaw offsets, in degrees. These are weapon-variant data,
        // not stance/attack choreography: global is always applied, then the
        // current attack family's offset is added on top.
        attackYawOffsets: { global: 180, vertical: 90, horizontal: 0, stab: 0 },
        rotationDefaults: { global: 180, vertical: 90, horizontal: 0, stab: 0 }
      }
    }
  }
};

export function cloneWeaponDefinitions() {
  return JSON.parse(JSON.stringify(STONE_WEAPONS));
}

export function normalizeStoneWeaponId(id) {
  return id === 'saber' ? 'katana' : id;
}

export function getStoneWeapon(id) {
  return STONE_WEAPONS[normalizeStoneWeaponId(id)] || STONE_WEAPONS.longsword;
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function getActiveVisualVariant(weaponDef) {
  if (!weaponDef || !weaponDef.visualVariants) return null;
  return weaponDef.visualVariants[weaponDef.visualVariant] || null;
}

export function updateAttackYawOffsetVisual(ctx) {
  const { THREE, visualVariant, weaponParts = {}, combatState } = ctx || {};
  if (!THREE || !visualVariant || !weaponParts) return;
  const offsets = visualVariant.runtimeAttackYawOffsets
    || visualVariant.attackYawOffsets
    || visualVariant.rotationDefaults
    || {};
  const group = combatState?.attack?.group || combatState?.attackGroup || combatState?.last || 'vertical';
  const degrees = numberOr(offsets.global, 0)
    + (group === 'horizontal'
      ? numberOr(offsets.horizontal, 0)
      : group === 'stab'
        ? numberOr(offsets.stab, 0)
        : numberOr(offsets.vertical, 0));
  const target = weaponParts.attackYawRoot || weaponParts.redTollSword;
  if (target) target.rotation.y = THREE.MathUtils.degToRad(degrees);
}

function updateWhipVisual(ctx) {
  const { RIG, weaponParts = {}, combatState, weaponBaseLocal, weaponTipLocal, time = 0, helpers = {} } = ctx || {};
  const { smoothstep, work = {} } = helpers;
  if (!RIG || !weaponParts.whipPos || !weaponBaseLocal || !weaponTipLocal || typeof smoothstep !== 'function') return;
  const arr = weaponParts.whipPos, N = weaponParts.whipN || 22;
  const bladeLen = Math.max(.08, RIG.bladeTip - RIG.bladeBase);
  const contact = combatState?.attack ? Math.max(.001, combatState.attack.contactAt) : .001;
  const t = combatState?.attack ? combatState.t : 0;
  const pre = combatState?.attack ? 1 - smoothstep(contact * .12, contact * .98, t) : .55;
  const crack = combatState?.attack ? smoothstep(contact * .55, contact * 1.02, t) * (1 - smoothstep(contact + .08, contact + .30, t)) : 0;
  const follow = combatState?.attack ? smoothstep(contact, combatState.attack.total, t) : 0;
  const group = combatState?.attack ? (combatState.attack.group || combatState.attackGroup) : 'idle';
  const side = group === 'horizontal' ? Math.sign(work.hold?.x || 1) : 1;
  const amp = (.16 + combatState.tune.swingWidth * .11) * (.55 + pre * .75) * (1 - crack * .72), wave = time * 11 + t * 22;
  for (let i = 0; i < N; i++) {
    const ss = i / (N - 1), tail = Math.pow(ss, .85), snap = smoothstep(.45, 1, ss) * crack;
    const x = Math.sin(wave - ss * 7) * amp * tail * side + side * snap * .10;
    const z = (-pre * .22 + snap * .35 + follow * .10) * tail + Math.sin(wave * .63 + ss * 5) * amp * .35 * tail;
    const y = RIG.bladeBase + bladeLen * ss * (.92 + crack * .10);
    arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    if (i === N - 1) weaponTipLocal.set(x, y, z);
  }
  if (weaponParts.beads) {
    for (let b = 0; b < weaponParts.beads.length; b++) {
      const i = Math.min(N - 1, Math.round(b * (N - 1) / (weaponParts.beads.length - 1)));
      weaponParts.beads[b].position.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    }
  }
  if (weaponParts.tipBead) weaponParts.tipBead.position.copy(weaponTipLocal);
  weaponParts.whipLine.geometry.attributes.position.needsUpdate = true;
}

function buildWhip(ctx) {
  const { THREE, weaponRoot, bladeLen, base, materials = {}, helpers = {}, weaponParts = {} } = ctx;
  const { matSilver, matGlow } = materials;
  const { addGrip, addGuard } = helpers;
  addGrip(.024, .34); addGuard(.18);
  const N = 22, arr = new Float32Array(N * 3), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: .95, blending: THREE.AdditiveBlending }));
  weaponRoot.add(line); Object.assign(weaponParts, { whipLine: line, whipPos: arr, whipN: N, beads: [] });
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(.020 * (1 - i * .08), 8, 6), matSilver); b.position.y = base + bladeLen * (i / 4); weaponRoot.add(b); weaponParts.beads.push(b); }
  weaponParts.tipBead = new THREE.Mesh(new THREE.SphereGeometry(.038, 10, 8), matGlow); weaponRoot.add(weaponParts.tipBead);
  weaponParts.visualUpdate = updateWhipVisual;
}

function rtBladeTexture(THREE) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#66716a'); grad.addColorStop(.5, '#75806f'); grad.addColorStop(1, '#8d9484'); g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 460; i++) { const x = Math.random() * 1024, y = Math.random() * 512, r = 4 + Math.random() * 28, v = 38 + Math.random() * 46 | 0; g.fillStyle = 'rgba(' + v + ',' + (v + 6) + ',' + (v - 2) + ',' + (0.05 + Math.random() * 0.09) + ')'; g.beginPath(); g.ellipse(x, y, r, r * (.3 + Math.random() * .7), Math.random() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 90; i++) { const x = Math.random() * 1024, y = Math.random() * 512, r = 5 + Math.random() * 18; g.fillStyle = 'rgba(' + (110 + Math.random() * 40 | 0) + ',' + (70 + Math.random() * 25 | 0) + ',40,' + (0.05 + Math.random() * 0.08) + ')'; g.beginPath(); g.ellipse(x, y, r, r * .5, Math.random() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 60; i++) { const y = Math.random() * 512, x = Math.random() * 800, len = 60 + Math.random() * 260; g.strokeStyle = 'rgba(210,214,200,' + (0.04 + Math.random() * 0.07) + ')'; g.lineWidth = .6 + Math.random() * 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (Math.random() - .5) * 4); g.stroke(); }
  g.fillStyle = 'rgba(226,230,216,0.18)'; g.fillRect(0, 250, 1024, 10); g.fillStyle = '#5c110b'; g.fillRect(0, 0, 1024, 22); g.fillStyle = 'rgba(122,22,13,0.85)'; g.fillRect(0, 22, 1024, 10);
  for (let i = 0; i < 46; i++) { const x = Math.pow(Math.random(), 1.7) * 1024, len = 40 + Math.random() * Math.random() * 300, w = 3 + Math.random() * 9, dg = g.createLinearGradient(0, 0, 0, len); dg.addColorStop(0, 'rgba(112,20,12,0.95)'); dg.addColorStop(.8, 'rgba(140,32,18,0.8)'); dg.addColorStop(1, 'rgba(140,32,18,0)'); g.save(); g.translate(x, 18); g.fillStyle = dg; g.beginPath(); g.moveTo(-w / 2, 0); g.quadraticCurveTo(-w * .28, len * .6, 0, len); g.quadraticCurveTo(w * .28, len * .6, w / 2, 0); g.closePath(); g.fill(); g.restore(); }
  for (let i = 0; i < 70; i++) { const x = Math.pow(Math.random(), 1.5) * 1024, y = Math.random() * 70; g.fillStyle = 'rgba(' + (100 + Math.random() * 50 | 0) + ',' + (16 + Math.random() * 14 | 0) + ',10,' + (0.2 + Math.random() * 0.4) + ')'; g.beginPath(); g.ellipse(x, y, 2 + Math.random() * 9, 1.5 + Math.random() * 5, Math.random() * 3, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(58,52,44,0.35)'; g.fillRect(0, 496, 1024, 16); const t = new THREE.CanvasTexture(c); t.flipY = false; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function rtGuardTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), cx = 128, cy = 128;
  g.fillStyle = '#7c5f34'; g.fillRect(0, 0, 256, 256); [[118, '#5c4423', 7], [104, '#8d6d3c', 3], [86, '#54401f', 6], [66, '#8d6d3c', 3], [46, '#4c3a1c', 8], [26, '#8a6a38', 4]].forEach(q => { g.strokeStyle = q[1]; g.lineWidth = q[2]; g.beginPath(); g.arc(cx, cy, q[0], 0, 7); g.stroke(); });
  g.strokeStyle = '#4a3819'; g.lineWidth = 3; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70); g.lineTo(cx + Math.cos(a) * 112, cy + Math.sin(a) * 112); g.stroke(); }
  for (let i = 0; i < 380; i++) { g.fillStyle = 'rgba(' + (60 + Math.random() * 120 | 0) + ',' + (50 + Math.random() * 80 | 0) + ',30,' + (0.06 + Math.random() * 0.12) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function rtWrapTexture(THREE) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#b08a5e'; x.fillRect(0, 0, 32, 26); x.fillStyle = '#2c2622'; x.fillRect(0, 26, 32, 6); x.fillStyle = '#83291c'; x.fillRect(0, 32, 32, 26); x.fillStyle = '#2c2622'; x.fillRect(0, 58, 32, 6);
  for (let i = 0; i < 70; i++) { x.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.15) + ')'; x.fillRect(Math.random() * 32, Math.random() * 64, 2, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 7); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeRedTollGreatsword(THREE) {
  const root = new THREE.Group(), L = 6.4, HALF_W = .975, BASE_T = .17, N = 30, pos = [], uv = [], idx = [];
  const eF = t => HALF_W * (1 - t) + .015, eB = t => -(HALF_W * (1 - t) + .015), th = t => BASE_T * (1 - t) + .010, mid = () => 0;
  const strips = [{ a: t => [eF(t), t * L, 0], b: t => [mid(t), t * L, th(t)], va: 0, vb: .5 }, { a: t => [mid(t), t * L, th(t)], b: t => [eB(t), t * L, 0], va: .5, vb: 1 }, { a: t => [eB(t), t * L, 0], b: t => [mid(t), t * L, -th(t)], va: 1, vb: .5 }, { a: t => [mid(t), t * L, -th(t)], b: t => [eF(t), t * L, 0], va: .5, vb: 0 }];
  for (const strip of strips) { const start = pos.length / 3; for (let r = 0; r <= N; r++) { const t = r / N; pos.push(...strip.a(t)); uv.push(t, strip.va); pos.push(...strip.b(t)); uv.push(t, strip.vb); } for (let r = 0; r < N; r++) { const i = start + r * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); } }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx); bg.computeVertexNormals();
  const blade = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: rtBladeTexture(THREE), side: THREE.DoubleSide })); blade.position.y = .14; root.add(blade);
  const bronze = new THREE.MeshLambertMaterial({ color: 0x8a6a3a }), dark = new THREE.MeshLambertMaterial({ color: 0x53401f }), guard = new THREE.Group(), disc = new THREE.Mesh(new THREE.CylinderGeometry(.95, .95, .10, 40), new THREE.MeshLambertMaterial({ map: rtGuardTexture(THREE) }));
  disc.rotation.x = Math.PI / 2; guard.add(disc); guard.add(new THREE.Mesh(new THREE.TorusGeometry(.95, .06, 10, 44), dark)); guard.add(new THREE.Mesh(new THREE.TorusGeometry(.55, .045, 10, 36), bronze));
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, sp = new THREE.Mesh(new THREE.BoxGeometry(.06, .60, .17), bronze); sp.position.set(Math.cos(a) * .58, Math.sin(a) * .58, 0); sp.rotation.z = a + Math.PI / 2; guard.add(sp); }
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(.20, .20, .17, 20), dark); boss.rotation.x = Math.PI / 2; guard.add(boss); const collar = new THREE.Mesh(new THREE.BoxGeometry(1.15, .30, .20), dark); collar.position.set(0, .16, 0); guard.add(collar); guard.scale.set(.70, .70, 1); root.add(guard);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.085, .092, 2.25, 10), new THREE.MeshLambertMaterial({ map: rtWrapTexture(THREE) })); handle.position.y = -1.375; root.add(handle);
  const pom = new THREE.Group(), ring = new THREE.Mesh(new THREE.TorusGeometry(.10, .022, 8, 20), dark); ring.rotation.x = Math.PI / 2; ring.position.y = -2.44; pom.add(ring); const pd = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .07, 16), bronze); pd.position.y = -2.53; pom.add(pd); const pk = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 10), dark); pk.position.y = -2.61; pom.add(pk); root.add(pom);
  root.userData = { blade, guard, handle, pommel: pom, bladeLength: L }; root.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); return root;
}

function buildRedTollGreatsword(ctx) {
  const { THREE, weaponRoot, bladeLen, base, weaponParts = {} } = ctx;
  const sword = makeRedTollGreatsword(THREE), scale = Math.max(.001, bladeLen / (sword.userData.bladeLength || 6.4));
  sword.scale.setScalar(scale); sword.position.set(0, base, 0);
  weaponRoot.add(sword); weaponParts.attackYawRoot = sword; weaponParts.visualUpdate = updateAttackYawOffsetVisual;
}

function makeHazardTexture(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8d95a2'; g.fillRect(0, 0, 128, 64);
  g.save(); g.translate(16, 32); g.rotate(-.52); g.fillStyle = '#e8e5dc';
  for (let x = -24; x < 154; x += 38) g.fillRect(x, -60, 14, 120);
  g.restore();
  g.strokeStyle = '#5c6470'; g.lineWidth = 5; g.strokeRect(2, 2, 124, 60);
  const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeHammerCrestTexture(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#c0a232'; g.beginPath(); g.moveTo(6, 4); g.lineTo(58, 4); g.lineTo(58, 38); g.quadraticCurveTo(58, 58, 32, 62); g.quadraticCurveTo(6, 58, 6, 38); g.closePath(); g.fill();
  g.strokeStyle = '#6e5a14'; g.lineWidth = 3; g.stroke(); g.fillStyle = '#6e5a14'; g.fillRect(16, 14, 32, 6); g.fillRect(28, 20, 8, 26); g.fillRect(20, 44, 24, 5);
  const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildMace(ctx) {
  const { THREE, weaponRoot, bladeLen, base, materials = {}, helpers = {} } = ctx;
  const { matSilver, matBronze } = materials, { addGrip, addGuard, meshLocalIco } = helpers;
  addGrip(.026, .50); addGuard(.22);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.018, .023, bladeLen * .86, 7), matBronze); shaft.position.y = base + bladeLen * .43; weaponRoot.add(shaft);
  weaponRoot.add(meshLocalIco(.15, matSilver, [0, base + bladeLen * .92, 0]));
}

// Extracted and rescaled from hammerist-beergoblin-tuned.html. The source's
// one-piece L head, hanging striking face, hazard counterweight, crest and face
// teeth are retained, while the complete silhouette is fitted to the existing
// hammer-head and pick contact volumes used by player-combat.js.
function buildHammer(ctx) {
  const { THREE, weaponRoot, bladeLen, base, materials = {}, helpers = {}, weaponParts = {} } = ctx;
  const { matSilver, matBronze, matIron, matLeather } = materials;
  const { addGrip } = helpers;
  const darkMetal = matIron || matSilver;
  addGrip(.030, .56);

  const shaftHeight = bladeLen * .91;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.026, .031, shaftHeight, 8), matSilver);
  shaft.position.y = base + shaftHeight * .5;
  weaponRoot.add(shaft);

  for (let i = 0; i < 5; i++) {
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .035, 8), matLeather || matBronze);
    wrap.position.y = base + bladeLen * (.25 + i * .045);
    weaponRoot.add(wrap);
  }

  const headY = base + bladeLen * .91;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.050, .056, .11, 8), darkMetal);
  collar.position.y = headY - .12;
  weaponRoot.add(collar);

  // Normalized transcription of the HTML's one-piece L-shaped head profile.
  const shape = new THREE.Shape();
  shape.moveTo(-.05, .09);
  shape.lineTo(.34, .09);
  shape.lineTo(.34, -.29);
  shape.lineTo(.20, -.29);
  shape.lineTo(.20, -.09);
  shape.lineTo(-.05, -.09);
  shape.closePath();
  const headGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: .16,
    steps: 1,
    curveSegments: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: .012,
    bevelThickness: .012
  });
  headGeometry.translate(0, 0, -.08);
  const head = new THREE.Mesh(headGeometry, matSilver);
  head.position.set(-.03, headY, 0);
  head.castShadow = head.receiveShadow = true;
  weaponRoot.add(head);

  const face = new THREE.Mesh(new THREE.BoxGeometry(.045, .37, .19), matSilver);
  face.position.set(.335, headY - .10, 0);
  face.castShadow = face.receiveShadow = true;
  weaponRoot.add(face);

  const toothYs = [-.26, -.19, -.12, -.05, .02, .08];
  const teeth = [];
  toothYs.forEach((offset, i) => {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(.024, .075, 5), darkMetal);
    tooth.rotation.z = -Math.PI / 2;
    tooth.position.set(.395, headY + offset, i % 2 ? .025 : -.025);
    tooth.castShadow = tooth.receiveShadow = true;
    weaponRoot.add(tooth); teeth.push(tooth);
  });

  const hazard = new THREE.Mesh(
    new THREE.BoxGeometry(.34, .13, .07),
    new THREE.MeshLambertMaterial({ map: makeHazardTexture(THREE) })
  );
  hazard.position.set(-.22, headY + .01, 0);
  hazard.rotation.z = .06;
  hazard.castShadow = hazard.receiveShadow = true;
  weaponRoot.add(hazard);

  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .19, 8), darkMetal);
  hinge.rotation.x = Math.PI / 2;
  hinge.position.set(-.045, headY + .01, 0);
  weaponRoot.add(hinge);

  const crestMaterial = new THREE.MeshLambertMaterial({ map: makeHammerCrestTexture(THREE), transparent: true, side: THREE.DoubleSide });
  const crestFront = new THREE.Mesh(new THREE.PlaneGeometry(.12, .13), crestMaterial);
  crestFront.position.set(.235, headY + .005, .094);
  weaponRoot.add(crestFront);
  const crestBack = crestFront.clone(); crestBack.position.z = -.094; crestBack.rotation.y = Math.PI; weaponRoot.add(crestBack);

  const rivetMaterial = darkMetal;
  [[.03, .07], [.17, .06], [.28, .07], [.24, -.22]].forEach(([x, y]) => {
    for (const z of [-.098, .098]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(.012, 5, 4), rivetMaterial);
      rivet.position.set(x, headY + y, z);
      weaponRoot.add(rivet);
    }
  });

  // The authored mesh points toward local +X. Spin the complete weapon root
  // clockwise around its shaft so the striking face points toward local +Z.
  // player-combat resets the authored attack quaternion immediately before this
  // hook each frame, so the yaw does not accumulate. Because swept hit zones
  // are transformed through the same weaponRoot, visuals and damage stay aligned.
  const hammerYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  const orientHammerFace = () => weaponRoot.quaternion.multiply(hammerYaw);

  Object.assign(weaponParts, {
    hammerHead: head,
    hammerFace: face,
    hammerTeeth: teeth,
    hammerCounterweight: hazard,
    visualUpdate: orientHammerFace
  });
}

function buildAxe(ctx) {
  const { THREE, weaponRoot, bladeLen, base, materials = {}, helpers = {} } = ctx;
  const { matSilver, matBronze } = materials, { addGrip, addGuard, meshLocalBox } = helpers;
  addGrip(.026, .50); addGuard(.18);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, bladeLen * .96, 7), matBronze); shaft.position.y = base + bladeLen * .48; weaponRoot.add(shaft);
  weaponRoot.add(meshLocalBox(.28, .27, .08, matSilver, .015, [.13, base + bladeLen * .88, 0]));
  const lip = new THREE.Mesh(new THREE.ConeGeometry(.12, .24, 4), matSilver); lip.position.set(.25, base + bladeLen * .88, 0); lip.rotation.z = -Math.PI / 2; lip.scale.z = .45; weaponRoot.add(lip);
}

function buildSpear(ctx) {
  const { THREE, weaponRoot, RIG, bladeLen, base, materials = {}, helpers = {} } = ctx;
  const { matSilver, matBronze } = materials, { addGrip } = helpers;
  addGrip(.021, .46);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.014, .018, bladeLen * .84, 8), matBronze); shaft.position.y = base + bladeLen * .42; weaponRoot.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.06, bladeLen * .24, 4), matSilver); tip.position.y = base + bladeLen * .96; tip.scale.set(.65, 1, 1.35); weaponRoot.add(tip);
}

function buildRapier(ctx) {
  const { THREE, weaponRoot, RIG, bladeLen, base, materials = {}, helpers = {} } = ctx;
  const { matSilver, matBronze } = materials, { addGrip } = helpers;
  addGrip(.019, .38);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.11, .008, 6, 24), matBronze); guard.position.y = base; guard.rotation.x = Math.PI / 2; weaponRoot.add(guard);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(.008, .014, bladeLen, 5), matSilver); blade.position.y = base + bladeLen / 2; blade.scale.set(.55, 1, .55); weaponRoot.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.022, .10, 5), matSilver); tip.position.y = RIG.bladeTip + .02; weaponRoot.add(tip);
}

function buildKatana(ctx) {
  const { THREE, weaponRoot, RIG, bladeLen, base, materials = {}, helpers = {} } = ctx;
  const { matSilver, matBronze, matIron } = materials, { addGrip } = helpers;
  addGrip(.024, .58);
  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .026, 12), matIron || matBronze);
  tsuba.position.y = base; tsuba.rotation.x = Math.PI / 2; tsuba.scale.x = 1.18; weaponRoot.add(tsuba);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.035, .040, .075, 8), matBronze);
  collar.position.y = base + .045; weaponRoot.add(collar);
  const sections = 7, curve = bladeLen * .115;
  for (let i = 0; i < sections; i++) {
    const t0 = i / sections, t1 = (i + 1) / sections, mid = (t0 + t1) * .5;
    const y0 = base + bladeLen * t0, y1 = base + bladeLen * t1;
    const x0 = curve * t0 * t0, x1 = curve * t1 * t1;
    const len = Math.hypot(y1 - y0, x1 - x0) * 1.08;
    const width = .050 * (1 - mid * .58);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(width, len, .026), matSilver);
    seg.position.set((x0 + x1) * .5, (y0 + y1) * .5, 0);
    seg.rotation.z = -Math.atan2(x1 - x0, y1 - y0);
    seg.scale.z = 1.35;
    weaponRoot.add(seg);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.035, .13, 5), matSilver);
  tip.position.set(curve + .025, RIG.bladeTip + .035, 0);
  tip.rotation.z = -.20; tip.scale.set(.72, 1, 1.35); weaponRoot.add(tip);
}

function buildDefaultRigidBlade(ctx) {
  const { THREE, weaponRoot, RIG, bladeLen, base, materials = {}, helpers = {}, weaponDef } = ctx;
  const { matSilver } = materials, { addGrip, addGuard } = helpers;
  addGrip(.023, .42); addGuard(weaponDef.weightClass === 'Heavy' ? .46 : .34);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(.012, .05, bladeLen, 4), matSilver); blade.position.y = base + bladeLen / 2; blade.scale.set(.5, 1, 1.7); weaponRoot.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.05, .14, 4), matSilver); tip.position.y = RIG.bladeTip + .02; tip.scale.set(.5, 1, 1.7); weaponRoot.add(tip);
}

export const WEAPON_MESH_BUILDERS = {
  whip: buildWhip,
  mace: buildMace,
  hammer: buildHammer,
  axe: buildAxe,
  spear: buildSpear,
  rapier: buildRapier,
  katana: buildKatana,
  blade: buildDefaultRigidBlade,
  defaultRigidBlade: buildDefaultRigidBlade,
  redTollGreatsword: buildRedTollGreatsword
};

export function buildStoneWeaponMesh(ctx) {
  const { THREE, weaponRoot, RIG, weaponDef, weaponParts = {} } = ctx || {};
  if (!THREE || !weaponRoot || !RIG || !weaponDef) return;
  const visualVariant = getActiveVisualVariant(weaponDef);
  const builderName = visualVariant?.meshBuilder || weaponDef.meshBuilder || weaponDef.kind || 'defaultRigidBlade';
  const builder = WEAPON_MESH_BUILDERS[builderName] || WEAPON_MESH_BUILDERS.defaultRigidBlade;
  builder({ ...ctx, visualVariant, weaponParts });
}

// Installs Red Toll as the active greatsword visual variant and wires its
// tuning controls into the shared visual-update lifecycle. This no longer
// overrides the host rebuild function: Red Toll is built by buildStoneWeaponMesh
// like every other weapon.
export function installRedTollGreatsword(api) {
  const { WEAPONS, combatState, settings = null } = api;
  const redTollVariant = WEAPONS?.greatsword?.visualVariants?.redToll
    || STONE_WEAPONS.greatsword.visualVariants.redToll;
  const bakedRotation = redTollVariant.attackYawOffsets || redTollVariant.rotationDefaults || {};
  const runtimeOffsets = redTollVariant.runtimeAttackYawOffsets = {
    global: numberOr(bakedRotation.global, 180),
    vertical: numberOr(bakedRotation.vertical, 90),
    horizontal: numberOr(bakedRotation.horizontal, 0),
    stab: numberOr(bakedRotation.stab, 0)
  };

  if (WEAPONS?.greatsword?.tune) {
    const redTollLength = WEAPONS.greatsword.tune.length * numberOr(redTollVariant.lengthMultiplier, 1.30);
    WEAPONS.greatsword.tune.length = Math.min(2.45, redTollLength);
    WEAPONS.greatsword.baseLength = WEAPONS.greatsword.tune.length;
    WEAPONS.greatsword.visualVariant = 'redToll';
  }

  function bindRedTollTuning() {
    const rows = [
      ['rtRotGlobal', 'global', 'rtRotGlobalReadout'],
      ['rtRotVertical', 'vertical', 'rtRotVerticalReadout'],
      ['rtRotHorizontal', 'horizontal', 'rtRotHorizontalReadout'],
      ['rtRotStab', 'stab', 'rtRotStabReadout']
    ];
    rows.forEach(([id, key, outId]) => {
      const el = document.getElementById(id), out = document.getElementById(outId);
      if (!el || !out) return;
      el.value = String(settings?.get?.('combat.redToll.' + key, runtimeOffsets[key] || 0) ?? (runtimeOffsets[key] || 0));
      const update = () => {
        const value = Number(el.value) || 0;
        runtimeOffsets[key] = value;
        settings?.set?.('combat.redToll.' + key, el.value);
        out.textContent = Math.round(value) + '°';
        api.updateWeaponDynamicVisual?.(0, 0);
      };
      el.addEventListener('input', update);
      update();
    });
  }
  bindRedTollTuning();
  if (combatState?.weapon === 'greatsword') api.applyCombatWeaponTuning?.();
}
