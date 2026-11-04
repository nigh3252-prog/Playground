'use strict';
// =====================================================================
//  COVERFIRE ABILITY LIBRARY
//  Every ability: { name, short, color, cd, charges?, desc, from, cast(c) }
//  c = { x, y, aim, power, owner: 'player'|'ally'|'auto', target?, level?, slot? }
//  cast() returns false if it could not be used (no target etc).
//  Combos (Mass Effect 3 style): some abilities PRIME an enemy (biotic / tech / fire / cryo),
//  others DETONATE a primed enemy for a big area effect.
// =====================================================================

// ---------- helpers --------------------------------------------------
function runHook(key, ev, fn) { run.hooks = run.hooks || {}; if (run.hooks[key]) return; run.hooks[key] = true; Bus.on(ev, fn); }
function pickTarget(c, maxD = 700, cone = 30) {
  if (c.target && !c.target.dead && hyp(c.target.x - c.x, c.target.y - c.y) < maxD) return c.target;
  let best = null, bs = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = hyp(e.x - c.x, e.y - c.y); if (d > maxD) continue;
    const ad = Math.abs(angDiff(c.aim, Math.atan2(e.y - c.y, e.x - c.x))) / DEG;
    if (c.owner === 'player' && ad > cone) continue;
    if (!hasLOS(c.x, c.y, e.x, e.y)) continue;
    const s = ad * 8 + d * 0.1; if (s < bs) { bs = s; best = e; }
  }
  return best;
}
function aimPoint(c, maxD) {
  const t = c.target && !c.target.dead ? c.target : null;
  if (t && hyp(t.x - c.x, t.y - c.y) < maxD) return { x: t.x, y: t.y };
  const a = c.aim, L = Math.min(maxD, rayLen(c.x, c.y, a, maxD) - 10);
  return { x: c.x + Math.cos(a) * L, y: c.y + Math.sin(a) * L };
}
function aimAngle(c) { return c.target && !c.target.dead ? Math.atan2(c.target.y - c.y, c.target.x - c.x) : c.aim; }
function abilityShot(c, o) {
  const a = o.a ?? aimAngle(c), sp = o.speed || 1200;
  return addBullet({ x: c.x + Math.cos(a) * 18, y: c.y + Math.sin(a) * 18, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, owner: 'player', src: 'ability',
    dmg: o.dmg, range: o.range || 900, color: o.color || '#e5e7eb', w: o.w || 4, ignoresCover: o.ignoresCover ?? true, pierce: o.pierce || 0,
    onHit: o.onHit || {}, explode: o.explode || null, homing: o.homing || 0, knock: o.knock || 80, bounce: o.bounce || 0, ignore: [] });
}
function lob(c, o) {
  const p = aimPoint(c, o.range || 430), sx = c.x, sy = c.y, tt = o.flight || 0.45, fuse = o.fuse ?? 0.25;
  return addObject({ t: 0, x: sx, y: sy, update(dt) {
      this.t += dt; const f = Math.min(1, this.t / tt); this.x = lerp(sx, p.x, f); this.y = lerp(sy, p.y, f);
      if (this.t >= tt + fuse) { o.onLand(this.x, this.y); return false; }
    }, draw() {
      const f = Math.min(1, this.t / tt), h = Math.sin(f * Math.PI) * 30;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(this.x, this.y, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = o.color || '#a3e635'; ctx.beginPath(); ctx.arc(this.x, this.y - h, 7, 0, TAU); ctx.fill();
      if (f >= 1) { ctx.strokeStyle = o.color || '#a3e635'; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(this.x, this.y, o.radius || 100, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    } });
}
function zone(x, y, r, dur, o) {
  return addObject({ t: 0, x, y, r, layer: 'under', acc: 0, update(dt) {
      this.t += dt; this.acc += dt;
      if (o.follow) { this.x = o.follow.x; this.y = o.follow.y; }
      if (o.tick && this.acc >= (o.every || 0.25)) { o.tick(this, this.acc); this.acc = 0; }
      o.update?.(this, dt);
      return this.t < dur;
    }, draw() {
      ctx.globalAlpha = Math.min(1, (dur - this.t) * 2) * (o.alpha ?? 0.25); ctx.fillStyle = o.color || '#38bdf8';
      ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = Math.min(1, (dur - this.t) * 2) * 0.7; ctx.strokeStyle = o.color || '#38bdf8'; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      o.draw?.(this);
    } });
}
function chain(first, n, range, dmg, o, color = '#38bdf8') {
  const hit = new Set(); let cur = first, px = o.x0 ?? player.x, py = o.y0 ?? player.y;
  for (let i = 0; i < n && cur; i++) {
    hit.add(cur); beam(px, py, cur.x, cur.y, color, 3, 0.2);
    hitEnemy(cur, dmg, { ...o, x: px, y: py });
    px = cur.x; py = cur.y;
    let nx = null, nd = range;
    for (const e of enemies) if (!e.dead && !hit.has(e)) { const d = hyp(e.x - px, e.y - py); if (d < nd) { nd = d; nx = e; } }
    cur = nx;
  }
  sfx.zap();
}
function playerOnly(c) { return c.owner === 'player'; }
function dashPlayer(angle, distance) {
  const P = player, steps = 12; let moved = 0;
  for (let i = 0; i < steps; i++) {
    const nx = P.x + Math.cos(angle) * distance / steps, ny = P.y + Math.sin(angle) * distance / steps;
    if (blocked(nx, ny, P.r)) break;
    P.x = nx; P.y = ny; moved += distance / steps;
    particles.push({ x: P.x, y: P.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color: 'rgba(165,180,252,.5)', size: P.r * 0.8 });
  }
  return moved;
}
function makeTurret(x, y, o = {}) {
  return addAlly({ x, y, r: 12, hp: o.hp || 80, life: o.life ?? 15, aggro: 1.4, cd: 0, aim: 0, color: '#34d399', persist: false,
    update(dt) {
      if (this.life !== Infinity) { this.life -= dt; if (this.life <= 0) { this.dead = true; burst(this.x, this.y, '#34d399', 8, 120); return; } }
      this.cd -= dt;
      const t = nearestEnemy(this.x, this.y, o.range || 700, true);
      if (t) {
        this.aim = Math.atan2(t.y - this.y, t.x - this.x);
        if (this.cd <= 0) {
          this.cd = 1 / (o.rate || 4); const a = this.aim + rand(-0.05, 0.05);
          addBullet({ x: this.x + Math.cos(a) * 14, y: this.y + Math.sin(a) * 14, vx: Math.cos(a) * 1300, vy: Math.sin(a) * 1300, owner: 'player', src: 'ally', dmg: o.dmg || 9, color: '#6ee7b7', w: 2, range: 800, ignore: [] });
          if (Math.random() < 0.3) sfx.enemyShot();
        }
      }
    },
    draw() {
      ctx.fillStyle = this.flash > 0 ? '#fff' : '#065f46'; ctx.fillRect(this.x - 11, this.y - 11, 22, 22);
      ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2; ctx.strokeRect(this.x - 11, this.y - 11, 22, 22);
      ctx.strokeStyle = '#a7f3d0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + Math.cos(this.aim) * 18, this.y + Math.sin(this.aim) * 18); ctx.stroke();
      if (this.life !== Infinity) { ctx.fillStyle = '#34d399'; ctx.fillRect(this.x - 11, this.y + 14, 22 * Math.max(0, this.life) / (o.life ?? 15), 2); }
    } });
}
function makeDrone(o = {}) {
  const ang = rand(0, TAU);
  return addAlly({ x: player.x, y: player.y, r: 7, hp: 1, untargetable: true, life: o.life ?? 25, cd: 0, ang, persist: !!o.persist, hideHp: true,
    update(dt) {
      if (this.life !== Infinity) { this.life -= dt; if (this.life <= 0) { this.dead = true; return; } }
      this.ang += dt * 1.8; this.x = player.x + Math.cos(this.ang) * 42; this.y = player.y + Math.sin(this.ang) * 42;
      this.cd -= dt;
      const t = nearestEnemy(this.x, this.y, 650, true);
      if (t && this.cd <= 0) { this.cd = 1 / (o.rate || 3); const a = Math.atan2(t.y - this.y, t.x - this.x);
        addBullet({ x: this.x, y: this.y, vx: Math.cos(a) * 1400, vy: Math.sin(a) * 1400, owner: 'player', src: 'ally', dmg: o.dmg || 8, color: '#93c5fd', w: 2, range: 700, ignore: [] }); }
    },
    draw() { ctx.fillStyle = '#93c5fd'; ctx.beginPath(); ctx.moveTo(this.x, this.y - 8); ctx.lineTo(this.x + 7, this.y + 5); ctx.lineTo(this.x - 7, this.y + 5); ctx.closePath(); ctx.fill(); } });
}
function enemyGrenade(x, y, tx, ty, dmg, r = 90) {
  // hostile grenade used by some enemy traits; telegraphed by a red circle
  return addObject({ t: 0, x, y, layer: 'under', update(dt) {
      this.t += dt * enemyTime; const f = Math.min(1, this.t / 0.6); this.x = lerp(x, tx, f); this.y = lerp(y, ty, f);
      if (this.t > 1.5) { if (hyp(player.x - this.x, player.y - this.y) < r + player.r) damagePlayer(dmg); burst(this.x, this.y, '#f87171', 14, 200); sfx.boom(); cam.shake = Math.max(cam.shake, 5); return false; }
    }, draw() { ctx.strokeStyle = '#f87171'; ctx.globalAlpha = 0.3 + 0.5 * (this.t / 1.5); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, r, 0, TAU); ctx.stroke(); ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.arc(this.x, this.y, 6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; } });
}

// ---------- the abilities --------------------------------------------
Object.assign(ABILITIES, {
  // --- Mass Effect 3 ---
  concussive: { name: 'Concussive Shot', short: 'CON', color: '#fde047', cd: 5, from: 'Mass Effect 3', desc: 'Fast round that knocks down and stuns. Detonates primed enemies.',
    cast: c => { abilityShot(c, { dmg: 40 * c.power, speed: 1500, color: '#fde047', w: 5, homing: 2, onHit: { ability: 'concussive', stun: 1.4, knock: 420, detonate: true } }); } },
  overload: { name: 'Overload', short: 'OVL', color: '#38bdf8', cd: 6, from: 'Mass Effect 3', desc: 'Lightning arcs to 3 enemies, stuns. Primes TECH. Detonates.',
    cast: c => { const t = pickTarget(c, 650); if (!t) return false; chain(t, 3, 260, 45 * c.power, { ability: 'overload', stun: 0.6, prime: 'tech', detonate: true, x0: c.x, y0: c.y }); } },
  pull: { name: 'Pull', short: 'PUL', color: '#a78bfa', cd: 6, from: 'Mass Effect 3', desc: 'Lifts an enemy helplessly into the air. Primes BIOTIC.',
    cast: c => { abilityShot(c, { dmg: 15 * c.power, speed: 900, color: '#a78bfa', w: 6, homing: 4, onHit: { ability: 'pull', lift: 2.8, prime: 'biotic' } }); } },
  warp: { name: 'Warp', short: 'WRP', color: '#c084fc', cd: 6, from: 'Mass Effect 3', desc: 'Biotic bolt: damage + enemy takes +25% damage. Primes and detonates BIOTIC.',
    cast: c => { abilityShot(c, { dmg: 55 * c.power, speed: 1000, color: '#c084fc', w: 6, homing: 4, onHit: { ability: 'warp', vuln: 6, prime: 'biotic', detonate: true } }); } },
  incinerate: { name: 'Incinerate', short: 'INC', color: '#fb923c', cd: 5, from: 'Mass Effect 3', desc: 'Fire bolt that burns. Primes FIRE, detonates others.',
    cast: c => { abilityShot(c, { dmg: 40 * c.power, speed: 1000, color: '#fb923c', w: 6, homing: 4, onHit: { ability: 'incinerate', burn: { dps: 14 * c.power, t: 4 }, prime: 'fire', detonate: true } }); } },
  cryo: { name: 'Cryo Blast', short: 'CRY', color: '#a5f3fc', cd: 5, from: 'Mass Effect 3', desc: 'Freezes and heavily slows. Primes CRYO.',
    cast: c => { abilityShot(c, { dmg: 20 * c.power, speed: 1000, color: '#a5f3fc', w: 6, homing: 4, explode: { r: 60, dmg: 0.5, color: '#a5f3fc' }, onHit: { ability: 'cryo', slow: { t: 4, mul: 0.3 }, stun: 0.6, prime: 'cryo' } }); } },
  cloak: { name: 'Tactical Cloak', short: 'CLK', color: '#94a3b8', cd: 10, from: 'Mass Effect 3', desc: 'Invisible for 4s. Enemies lose you. Your next shot deals ×2 and breaks cloak.',
    cast: c => {
      addBuff('cloak', 4, [], { flags: ['cloak'], label: 'CLOAK', color: '#cbd5e1' }); addBuff('cloakShot', 4.2, [], { label: false });
      for (const e of enemies) if (e.state === 'windup') { e.state = 'hold'; e.stateT = 0; }
      runHook('cloakShot', 'bullet', b => { if (hasBuff('cloakShot') && b.src === 'bullet') { b.dmg *= 2; b.color = '#f8fafc'; b.w = 3; removeBuff('cloakShot'); setTimeout(() => removeBuff('cloak'), 0); } });
    } },
  adrenaline: { name: 'Adrenaline Rush', short: 'ADR', color: '#f472b6', cd: 14, from: 'Mass Effect 3', desc: 'Slows time for enemies for 4s, +20% fire rate.',
    cast: c => { addTimeSlow(4, 0.35); addBuff('adrenaline', 4, [{ stat: 'fireRate', mul: 1.2 }], { label: 'ADRENALINE', color: '#f472b6' }); } },
  fortify: { name: 'Tech Armor', short: 'FRT', color: '#60a5fa', cd: 12, from: 'Mass Effect 3', desc: 'Take 50% less damage for 6s.',
    cast: c => { addBuff('fortify', 6, [{ stat: 'damageTaken', mul: 0.5 }], { label: 'TECH ARMOR', color: '#60a5fa' }); } },
  charge: { name: 'Biotic Charge', short: 'CHG', color: '#818cf8', cd: 7, from: 'Mass Effect 3', desc: 'Slam into a target across the room. Restores 25 armor. Detonates.',
    cast: c => {
      if (!playerOnly(c)) return false; const t = pickTarget(c, 560, 35); if (!t) return false;
      const a = Math.atan2(t.y - player.y, t.x - player.x), d = hyp(t.x - player.x, t.y - player.y) - t.r - player.r - 4;
      dashPlayer(a, Math.max(0, d)); player.iframes = Math.max(player.iframes, 0.4);
      hitEnemy(t, 70 * c.power, { ability: 'charge', knock: 500, detonate: true, x: player.x, y: player.y });
      explode(player.x, player.y, 90, 20 * c.power, { ability: 'charge', color: '#818cf8' }); addArmor(25);
    } },
  nova: { name: 'Nova', short: 'NOV', color: '#6366f1', cd: 6, from: 'Mass Effect 3', desc: 'Biotic blast around you. Detonates primed enemies.',
    cast: c => { explode(c.x, c.y, 170, 65 * c.power, { ability: 'nova', knock: 450, detonate: true, color: '#818cf8' }); } },
  shockwave: { name: 'Shockwave', short: 'SHK', color: '#a78bfa', cd: 7, from: 'Mass Effect 3', desc: 'A line of biotic blasts that lifts enemies. Detonates.',
    cast: c => {
      const a = aimAngle(c); let i = 0, x = c.x, y = c.y;
      addObject({ t: 0, update(dt) { this.t += dt; while (this.t > i * 0.07 && i < 7) { i++; x += Math.cos(a) * 70; y += Math.sin(a) * 70; if (blocked(x, y, 2)) { i = 99; break; } explode(x, y, 60, 28 * c.power, { ability: 'shockwave', lift: 1.2, detonate: true, color: '#a78bfa' }); } return i < 7; } });
    } },
  singularity: { name: 'Singularity', short: 'SNG', color: '#7c3aed', cd: 12, from: 'Mass Effect 3', desc: 'A gravity well that drags and lifts enemies for 5s. Primes BIOTIC.',
    cast: c => { const p = aimPoint(c, 450); zone(p.x, p.y, 130, 5, { color: '#7c3aed', alpha: 0.2, every: 0.1, tick: z => { for (const e of enemiesNear(z.x, z.y, z.r)) { const dx = z.x - e.x, dy = z.y - e.y, d = hyp(dx, dy) || 1; e.vx += dx / d * 90; e.vy += dy / d * 90; hitEnemy(e, 1.2 * c.power, { ability: 'singularity', lift: 0.4, prime: 'biotic', quiet: true }); } } }); } },
  dominate: { name: 'Dominate', short: 'DOM', color: '#86efac', cd: 14, from: 'Mass Effect 3', desc: 'Turn an enemy to your side for 8s; it fights for you with double damage.',
    cast: c => { const t = pickTarget(c, 700); if (!t) return false; hitEnemy(t, 5, { ability: 'dominate', charm: 8 * c.power, quiet: true }); floater(t.x, t.y - 30, 'DOMINATED', '#86efac'); } },
  siphon: { name: 'Energy Drain', short: 'SIP', color: '#22d3ee', cd: 7, from: 'Mass Effect 3', desc: 'Drain a target: damage + restore armor equal to damage. Primes TECH.',
    cast: c => { const t = pickTarget(c, 650); if (!t) return false; beam(c.x, c.y, t.x, t.y, '#22d3ee', 4, 0.3); const d = hitEnemy(t, 50 * c.power, { ability: 'siphon', prime: 'tech' }); addArmor(d); sfx.zap(); } },

  // --- Risk of Rain 2 ---
  phaseRound: { name: 'Phase Round', short: 'PHS', color: '#fef08a', cd: 4, from: 'Risk of Rain 2', desc: 'Heavy round that pierces every enemy and flies over cover.',
    cast: c => { abilityShot(c, { dmg: 110 * c.power, speed: 2400, color: '#fef08a', w: 6, pierce: 99, range: 1400, knock: 120, onHit: { ability: 'phaseRound' } }); cam.shake = Math.max(cam.shake, 3); } },
  suppress: { name: 'Suppressive Fire', short: 'SUP', color: '#facc15', cd: 9, from: 'Risk of Rain 2', desc: '10 perfectly accurate stunning shots.',
    cast: c => { let n = 0; addObject({ t: 0, update(dt) { this.t += dt; while (this.t > n * 0.07 && n < 10) { n++; const P = player; const a = P.aim; addBullet({ x: P.x + Math.cos(a) * 18, y: P.y + Math.sin(a) * 18, vx: Math.cos(a) * 1800, vy: Math.sin(a) * 1800, owner: 'player', src: 'ability', dmg: 22 * c.power, color: '#facc15', w: 3, range: 1000, ignore: P.hug.slice(), onHit: { ability: 'suppress', stun: 0.35 } }); sfx.shot(); } return n < 10; } }); } },
  blink: { name: 'Blink', short: 'BLK', color: '#a5b4fc', cd: 3, charges: 2, from: 'Risk of Rain 2', desc: 'Teleport a short distance (2 charges).',
    cast: c => { if (!playerOnly(c)) return false; const P = player; const ml = hyp(P.vx, P.vy); const a = ml > 30 ? Math.atan2(P.vy, P.vx) : P.aim; dashPlayer(a, 230); P.iframes = Math.max(P.iframes, 0.15); sfx.dodge(); } },
  arrowRain: { name: 'Arrow Rain', short: 'RAN', color: '#4ade80', cd: 10, from: 'Risk of Rain 2', desc: 'Rain on an area: damage over time and slow.',
    cast: c => { const p = aimPoint(c, 550); zone(p.x, p.y, 120, 3, { color: '#4ade80', tick: (z, dt) => { for (const e of enemiesNear(z.x, z.y, z.r)) hitEnemy(e, 40 * c.power * dt, { ability: 'arrowRain', slow: { t: 0.5, mul: 0.5 }, quiet: true }); }, draw: z => { ctx.strokeStyle = '#86efac'; ctx.lineWidth = 1.5; for (let i = 0; i < 6; i++) { const x = z.x + rand(-z.r, z.r) * 0.7, y = z.y + rand(-z.r, z.r) * 0.7; ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(x, y); ctx.stroke(); } } }); } },
  mine: { name: 'Pressure Mine', short: 'MIN', color: '#f59e0b', cd: 6, charges: 2, from: 'Risk of Rain 2', desc: 'Drop a mine that explodes when an enemy steps near.',
    cast: c => { const x = c.x, y = c.y; addObject({ t: 0, kind: 'mine', layer: 'under', update(dt) { this.t += dt; if (this.t > 0.6 && enemiesNear(x, y, 50).length) { explode(x, y, 120, 90 * c.power, { ability: 'mine', detonate: true }); return false; } return this.t < 40; }, draw() { ctx.fillStyle = this.t > 0.6 && Math.sin(time * 8) > 0 ? '#fbbf24' : '#78350f'; ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill(); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 50, 0, TAU); ctx.globalAlpha = 0.2; ctx.stroke(); ctx.globalAlpha = 1; } }); } },
  turret: { name: 'TR-12 Turret', short: 'TUR', color: '#34d399', cd: 18, from: 'Risk of Rain 2', desc: 'Deploy an auto-turret for 15s. Enemies will target it.',
    cast: c => { const a = c.aim, x = c.x + Math.cos(a) * 34, y = c.y + Math.sin(a) * 34; const ok = !blocked(x, y, 12); makeTurret(ok ? x : c.x, ok ? y : c.y, { dmg: 9 * c.power, life: 15 }); } },
  bubble: { name: 'Bubble Shield', short: 'BUB', color: '#93c5fd', cd: 16, from: 'Risk of Rain 2', desc: 'A dome for 6s that stops all enemy bullets from outside.',
    cast: c => { const x = c.x, y = c.y, r = 125; addObject({ t: 0, update(dt) { this.t += dt; return this.t < 6; }, blockBullet(b, x1, y1) { if (hyp(b.x - x, b.y - y) <= r) return -1; return segCircle(b.x, b.y, x1, y1, x, y, r); }, draw() { ctx.globalAlpha = 0.15 + 0.05 * Math.sin(time * 6); ctx.fillStyle = '#93c5fd'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.6; ctx.strokeStyle = '#bfdbfe'; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1; } }); } },
  drone: { name: 'Gunner Drone', short: 'DRN', color: '#93c5fd', cd: 25, from: 'Risk of Rain 2', desc: 'An orbiting drone that shoots for 25s.',
    cast: c => { makeDrone({ dmg: 8 * c.power, life: 25 }); } },
  smoke: { name: 'Smoke Bomb', short: 'SMK', color: '#64748b', cd: 9, from: 'Risk of Rain 2', desc: 'Stun nearby enemies and go invisible for 3s.',
    cast: c => { if (!playerOnly(c)) return false; explode(c.x, c.y, 170, 20 * c.power, { ability: 'smoke', stun: 1.3, color: '#64748b' }); addBuff('cloak', 3, [], { flags: ['cloak'], label: 'SMOKE', color: '#94a3b8' }); for (let i = 0; i < 30; i++) particles.push({ x: c.x + rand(-90, 90), y: c.y + rand(-90, 90), vx: rand(-20, 20), vy: rand(-20, 20), life: 1.5, max: 1.5, color: 'rgba(148,163,184,.35)', size: rand(10, 22) }); } },
  lightsOut: { name: 'Lights Out', short: 'LTO', color: '#f472b6', cd: 8, from: 'Risk of Rain 2', desc: 'A huge revolver shot. A kill resets ALL your cooldowns.',
    cast: c => { runHook('lightsOut', 'kill', e => { if (e.ability === 'lightsOut') { resetCooldowns(); floater(player.x, player.y - 40, 'RESET', '#f472b6'); } }); abilityShot(c, { dmg: 150 * c.power, speed: 2600, color: '#f472b6', w: 5, onHit: { ability: 'lightsOut', canCrit: true } }); cam.shake = Math.max(cam.shake, 4); } },
  missiles: { name: 'Missile Barrage', short: 'MSL', color: '#f87171', cd: 30, from: 'Risk of Rain 2', desc: 'Fire 10 homing missiles.',
    cast: c => { let n = 0; addObject({ t: 0, update(dt) { this.t += dt; while (this.t > n * 0.06 && n < 10) { n++; const a = player.aim + rand(-1.2, 1.2); addBullet({ x: player.x, y: player.y, vx: Math.cos(a) * 650, vy: Math.sin(a) * 650, owner: 'player', src: 'ability', dmg: 30 * c.power, color: '#f87171', w: 4, homing: 7, range: 1400, ignoresCover: true, explode: { r: 55, dmg: 0.6, color: '#f87171' }, ignore: [] }); } return n < 10; } }); } },
  flamethrower: { name: 'Flamethrower', short: 'FLM', color: '#f97316', cd: 6, from: 'Risk of Rain 2', desc: 'A cone of fire that burns everything in front of you. Primes FIRE.',
    cast: c => { const a = aimAngle(c); for (const e of enemies) { if (e.dead) continue; const d = hyp(e.x - c.x, e.y - c.y); if (d > 260) continue; if (Math.abs(angDiff(a, Math.atan2(e.y - c.y, e.x - c.x))) > 32 * DEG) continue; if (!hasLOS(c.x, c.y, e.x, e.y)) continue; hitEnemy(e, 30 * c.power, { ability: 'flamethrower', burn: { dps: 16 * c.power, t: 4 }, prime: 'fire' }); } for (let i = 0; i < 40; i++) { const aa = a + rand(-0.55, 0.55), s = rand(200, 600); particles.push({ x: c.x, y: c.y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life: rand(0.2, 0.45), max: 0.45, color: rpick(['#fb923c', '#f97316', '#fde047']), size: rand(3, 7) }); } noise(0.3, 0.15, 600); } },
  ionSurge: { name: 'Ion Surge', short: 'ION', color: '#60a5fa', cd: 8, from: 'Risk of Rain 2', desc: 'Dash forward and unleash a stunning shock blast. Detonates.',
    cast: c => { if (!playerOnly(c)) return false; player.iframes = Math.max(player.iframes, 0.3); dashPlayer(player.aim, 260); explode(player.x, player.y, 140, 60 * c.power, { ability: 'ionSurge', stun: 1, detonate: true, color: '#60a5fa' }); } },
  groundSlam: { name: 'Ground Slam', short: 'SLM', color: '#fbbf24', cd: 6, from: 'Risk of Rain 2 / Titanfall', desc: 'Slam: knock back and stagger everything around you. Detonates.',
    cast: c => { explode(c.x, c.y, 175, 45 * c.power, { ability: 'groundSlam', knock: 650, stun: 0.6, detonate: true, color: '#fbbf24' }); } },

  // --- Halo / Gears / Titanfall / The Division / Quantum Break era ---
  grenade: { name: 'Frag Grenade', short: 'GRN', color: '#a3e635', cd: 7, charges: 2, from: 'Halo / Gears of War', desc: 'Lob a grenade that explodes after landing. Detonates primed enemies.',
    cast: c => { lob(c, { radius: 115, color: '#a3e635', onLand: (x, y) => explode(x, y, 115, 70 * c.power, { ability: 'grenade', detonate: true, color: '#a3e635' }) }); } },
  coverWall: { name: 'Deployable Cover', short: 'COV', color: '#9ca3af', cd: 12, charges: 2, from: 'The Division / Gears of War', desc: 'Throw down a piece of low cover in front of you.',
    cast: c => {
      if (!playerOnly(c)) return false;
      const a = player.aim, cx = player.x + Math.cos(a) * 46, cy = player.y + Math.sin(a) * 46, horiz = Math.abs(Math.cos(a)) < 0.7;
      const r = horiz ? { x: cx - 50, y: cy - 15, w: 100, h: 30, type: 'low', built: true } : { x: cx - 15, y: cy - 50, w: 30, h: 100, type: 'low', built: true };
      if (room.rects.some(o => rectGap(o, r) < 2) || r.x < 0 || r.y < 0 || r.x + r.w > ROOM_W || r.y + r.h > ROOM_H || pointRectDist(player.x, player.y, r) < player.r) return false;
      room.rects.push(r); burst(cx, cy, '#9ca3af', 10, 120);
    } },
  decoy: { name: 'Holo Decoy', short: 'DEC', color: '#67e8f9', cd: 12, from: 'Halo Reach / Titanfall', desc: 'A hologram that runs forward and draws all enemy fire for 7s.',
    cast: c => { const a = c.aim; addAlly({ x: c.x, y: c.y, r: 14, hp: 120 * c.power, aggro: 4, life: 7, t: 0, update(dt) { this.t += dt; this.life -= dt; if (this.life <= 0) { this.dead = true; return; } if (this.t < 1.2) { const nx = this.x + Math.cos(a) * 160 * dt, ny = this.y + Math.sin(a) * 160 * dt; if (!blocked(nx, ny, 14)) { this.x = nx; this.y = ny; } } }, draw() { ctx.globalAlpha = 0.45 + 0.2 * Math.sin(time * 20); ctx.fillStyle = '#67e8f9'; ctx.beginPath(); ctx.arc(this.x, this.y, 14, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; } }); } },
  armorLock: { name: 'Armor Lock', short: 'LCK', color: '#fde047', cd: 14, from: 'Halo Reach', desc: 'Invulnerable but rooted for 2.5s, then an EMP stuns nearby enemies.',
    cast: c => { if (!playerOnly(c)) return false; addBuff('armorLock', 2.5, [], { flags: ['invuln', 'root', 'noFire'], label: 'ARMOR LOCK', color: '#fde047', onEnd: () => { if (!player.dead) explode(player.x, player.y, 180, 30 * c.power, { ability: 'armorLock', stun: 1.6, color: '#fde047', label: 'EMP' }); } }); } },
  pulseScan: { name: 'Pulse Blade', short: 'SCN', color: '#f43f5e', cd: 10, from: 'Titanfall 2', desc: 'Reveal and mark every enemy in range for 6s (+25% damage taken).',
    cast: c => { for (const e of enemiesNear(c.x, c.y, 1100)) e.markT = 6 * c.power; addObject({ t: 0, update(dt) { this.t += dt; return this.t < 0.6; }, draw() { ctx.strokeStyle = '#f43f5e'; ctx.globalAlpha = 1 - this.t / 0.6; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c.x, c.y, this.t * 1800, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; } }); } },
  stim: { name: 'Stim', short: 'STM', color: '#4ade80', cd: 12, from: 'Titanfall 2', desc: '5s of +50% speed and fast health regeneration.',
    cast: c => { addBuff('stim', 5, [{ stat: 'moveSpeed', mul: 1.5 }, { stat: 'hpRegen', add: 6 * c.power }], { label: 'STIM', color: '#4ade80' }); } },
  overcharge: { name: 'Overcharge', short: 'OVC', color: '#fb7185', cd: 16, from: 'Borderlands 2 (Gunzerk)', desc: '6s: no ammo use, no bloom, no heat, +35% fire rate.',
    cast: c => { player.jammed = false; player.heat = 0; player.bloom = 0; player.reload = null; addBuff('overcharge', 6 * Math.min(1.5, c.power), [{ stat: 'fireRate', mul: 1.35 }], { flags: ['infiniteAmmo', 'noBloom'], label: 'OVERCHARGE', color: '#fb7185' }); } },
  healZone: { name: 'Healing Station', short: 'HEL', color: '#22c55e', cd: 18, from: 'The Division', desc: 'A zone that heals you 9 HP/s for 6s.',
    cast: c => { zone(c.x, c.y, 110, 6, { color: '#22c55e', every: 0.2, tick: (z, dt) => { if (hyp(player.x - z.x, player.y - z.y) < z.r) healPlayer(9 * c.power * dt, true); for (const a of allies) if (a.hp != null && hyp(a.x - z.x, a.y - z.y) < z.r) a.hp = Math.min(a.maxHp, a.hp + 12 * dt); } }); } },
  seeker: { name: 'Seeker Mine', short: 'SKR', color: '#f59e0b', cd: 9, from: 'The Division', desc: 'A rolling mine that hunts the nearest enemy and explodes.',
    cast: c => { let x = c.x, y = c.y; addObject({ t: 0, update(dt) { this.t += dt; const t = nearestEnemy(x, y, 1200); if (t) { const d = hyp(t.x - x, t.y - y) || 1; const nx = x + (t.x - x) / d * 280 * dt, ny = y + (t.y - y) / d * 280 * dt; if (!blocked(nx, ny, 6)) { x = nx; y = ny; } else { x += (t.y - y) / d * 200 * dt; y -= (t.x - x) / d * 200 * dt; } if (d < t.r + 12) { explode(x, y, 100, 75 * c.power, { ability: 'seeker', detonate: true }); return false; } } if (this.t > 7) { explode(x, y, 100, 40 * c.power, { ability: 'seeker' }); return false; } }, draw() { ctx.fillStyle = Math.sin(time * 16) > 0 ? '#f59e0b' : '#7c2d12'; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill(); } }); } },
  timeStop: { name: 'Time Stop', short: 'TSP', color: '#e0e7ff', cd: 22, from: 'Quantum Break', desc: 'Freeze every enemy and their bullets for 2.5s.',
    cast: c => { addTimeSlow(2.5 * Math.min(1.6, c.power), 0); floater(player.x, player.y - 40, 'TIME STOP', '#e0e7ff', 1.2); } },
  kinetic: { name: 'Kinetic Bolt', short: 'KIN', color: '#e5e7eb', cd: 1.5, from: 'One Step From Eden', desc: 'A quick, cheap bolt.',
    cast: c => { abilityShot(c, { dmg: 25 * c.power, speed: 1800, color: '#e5e7eb', w: 3, homing: 2, onHit: { ability: 'kinetic' } }); } },
  sniperShot: { name: 'Marksman Shot', short: 'SNP', color: '#c084fc', cd: 6, from: 'Enemy sniper', desc: 'One precise, devastating round.',
    cast: c => { abilityShot(c, { dmg: 130 * c.power, speed: 2800, color: '#c084fc', w: 3, onHit: { ability: 'sniperShot', canCrit: true } }); sfx.sniper(); } },
  shotgunBlast: { name: 'Shotgun Blast', short: 'SHT', color: '#ef4444', cd: 4, from: 'Enemy rusher', desc: 'A point-blank 8-pellet blast with knockback.',
    cast: c => { const a = aimAngle(c); for (let i = 0; i < 8; i++) { const aa = a + rand(-0.26, 0.26); addBullet({ x: c.x + Math.cos(aa) * 16, y: c.y + Math.sin(aa) * 16, vx: Math.cos(aa) * 1300, vy: Math.sin(aa) * 1300, owner: 'player', src: 'ability', dmg: 16 * c.power, color: '#fca5a5', w: 2, range: 360, knock: 220, ignore: player.hug.slice() }); } sfx.shot(); cam.shake = Math.max(cam.shake, 4); } },
  rally: { name: 'Rally Cry', short: 'RLY', color: '#fcd34d', cd: 15, from: 'Gears of War / Borderlands', desc: 'Restore 30 armor and +20% damage for 5s.',
    cast: c => { addArmor(30 * c.power); addBuff('rally', 5, [{ stat: 'damage', mul: 1.2 }], { label: 'RALLY', color: '#fcd34d' }); } },
});
const ABILITY_IDS = Object.keys(ABILITIES);
