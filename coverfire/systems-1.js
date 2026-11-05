'use strict';
// =====================================================================
//  COVERFIRE PROGRESSION SYSTEMS 1-15 (+ shared helpers)
//  A system is: defineSystem({ id, name, inspo, tagline,
//     setup(), preRoom(go), onExit(next), update(dt), hudLines(), drawHud(ctx, box),
//     drawWorld(layer), onSlot(i), onInteract(), summary() })
//  Per-run state lives in run.s. Listeners registered with Bus.on() in setup() are
//  cleared automatically at the start of the next run.
// =====================================================================

// ---------- shared helpers -------------------------------------------
const STAT_REWARDS = [
  { name: 'Hot Loads', desc: '+15% damage.', apply: () => mod('damage', { mul: 1.15 }) },
  { name: 'Light Trigger', desc: '+12% fire rate, +10% bloom per shot.', apply: () => { mod('fireRate', { mul: 1.12 }); mod('bloomPerShot', { mul: 1.1 }); } },
  { name: 'Steady Hands', desc: 'Settled spread ×0.75.', apply: () => mod('settleMul', { mul: 0.75 }) },
  { name: 'Cool Barrel', desc: '-25% heat per shot.', apply: () => mod('heatPerShot', { mul: 0.75 }) },
  { name: 'Extended Mag', desc: '+6 magazine size.', apply: () => mod('magSize', { add: 6 }) },
  { name: 'Quick Hands', desc: '-15% reload time.', apply: () => mod('reloadTime', { mul: 0.85 }) },
  { name: 'Plating', desc: '+20 max armor.', apply: () => { mod('maxArmor', { add: 20 }); addArmor(20, true); } },
  { name: 'Vitality', desc: '+20 max HP and heal 20.', apply: () => { mod('maxHp', { add: 20 }); healPlayer(20, true); } },
  { name: 'Fleet Foot', desc: '+10% move speed, -15% dodge cooldown.', apply: () => { mod('moveSpeed', { mul: 1.1 }); mod('dodgeCooldown', { mul: 0.85 }); } },
  { name: 'Compensator', desc: '-20% bloom per shot.', apply: () => mod('bloomPerShot', { mul: 0.8 }) },
  { name: 'Focus Lens', desc: '+8% crit chance.', apply: () => mod('critChance', { add: 0.08 }) },
  { name: 'Capacitors', desc: '-15% ability cooldowns.', apply: () => mod('cdr', { mul: 0.85 }) },
  { name: 'Amplifier', desc: '+20% ability power.', apply: () => mod('abilityPower', { mul: 1.2 }) },
  { name: 'Perfectionist', unique: true, kind: 'perk', desc: 'Perfect reloads restore 12 armor.', apply: () => Bus.on('reload', e => { if (e.perfect) addArmor(12); }) },
  { name: 'Composure', unique: true, kind: 'perk', desc: 'Kills while braced vent 40% heat and clear bloom.', apply: () => Bus.on('kill', e => { if (e.braced) { player.heat *= 0.6; player.bloom = 0; } }) },
  { name: 'Field Medic', unique: true, kind: 'perk', desc: 'Clearing a room heals 15 HP.', apply: () => Bus.on('roomClear', () => healPlayer(15)) },
  { name: 'Adrenaline', unique: true, kind: 'perk', desc: 'Dodging resets bloom.', apply: () => Bus.on('dodge', () => { player.bloom = 0; }) },
  { name: 'Momentum', unique: true, kind: 'perk', desc: 'Kills reduce ability cooldowns by 1s.', apply: () => Bus.on('kill', () => reduceCooldowns(1)) },
];
function rewardOpt(r, after) { return { name: r.name, desc: r.desc, tag: r.kind || 'stat', onPick: () => { r.apply(); addPerk(r.name, r.desc); after(); } }; }
function statPool() { const taken = new Set(run.perks.map(p => p.name)); return STAT_REWARDS.filter(r => !(r.unique && taken.has(r.name))); }
function statDraft(after, title = 'Pick one', n = 3, sub = '') { openChoice({ title, sub, options: sampleN(statPool(), n).map(r => rewardOpt(r, after)) }); }
function slotName(i) { const s = player.slots[i]; if (!s) return 'empty'; return ABILITIES[s.id]?.name || s.label || '?'; }
function grantAbility(id, after, opts = {}) {
  const free = firstFreeSlot(), name = ABILITIES[id].name;
  if (free >= 0) { giveAbility(free, id, opts); addPerk(name, ABILITIES[id].desc); after(); return; }
  openChoice({ title: `Equip ${name}`, sub: 'All slots are full. Replace one, or skip.', list: true,
    options: [0, 1, 2].map(i => ({ name: `${SLOT_LABELS[i]}: replace ${slotName(i)}`, onPick: () => { giveAbility(i, id, opts); addPerk(name, ABILITIES[id].desc); after(); } }))
      .concat([{ name: 'Skip', onPick: after }]) });
}
const DRAFTABLE = ABILITY_IDS.filter(id => !['kinetic', 'sniperShot', 'shotgunBlast'].includes(id));
function abilityDraft(after, title = 'Pick an ability', pool = DRAFTABLE, n = 3) {
  const owned = new Set(player.slots.filter(Boolean).map(s => s.id));
  const ch = sampleN(pool.filter(id => !owned.has(id)), n);
  openChoice({ title, options: ch.map(id => ({ name: ABILITIES[id].name, desc: ABILITIES[id].desc, tag: ABILITIES[id].from, onPick: () => grantAbility(id, after) })).concat([{ name: 'Skip', desc: 'Keep your current kit.', onPick: after }]) });
}
function autoCast(id, power = 1, from = player) {
  const t = nearestEnemy(from.x, from.y, 900, true);
  if (!t && !['bubble', 'healZone', 'drone', 'fortify', 'stim', 'overcharge', 'adrenaline', 'timeStop', 'rally', 'groundSlam', 'nova', 'pulseScan'].includes(id)) return false;
  return castAbility(id, { x: from.x, y: from.y, aim: t ? Math.atan2(t.y - from.y, t.x - from.x) : player.aim, power: power * stat('abilityPower'), owner: 'auto', target: t }) !== false;
}
function fmtTime(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
function pct(x) { return Math.round(x * 100) + '%'; }

// ============================================================ 1. DRAFT
defineSystem({ id: 'draft', name: 'Draft', inspo: 'Hades / Synthetik', tagline: 'The control group: pick 1 of 3 upgrades after each room, and a new ability every other room.',
  setup() { giveAbility(0, 'grenade'); },
  onExit(next) { if (run.roomIdx % 2 === 0) abilityDraft(next, 'Room cleared: pick an ability'); else statDraft(next, 'Room cleared: pick one'); },
});

// ============================================================ 2. RISK OF RAIN
const ROR_ITEMS = {
  syringe: { tier: 'w', name: "Soldier's Syringe", desc: '+15% fire rate', stats: n => mod('fireRate', { mul: 1 + 0.15 * n }, 'ror') },
  tougher: { tier: 'w', name: 'Tougher Times', desc: '15% chance to block a hit (hyperbolic)' },
  lens: { tier: 'w', name: "Lens-Maker's Glasses", desc: '+10% crit chance', stats: n => mod('critChance', { add: 0.1 * n }, 'ror') },
  fungus: { tier: 'w', name: 'Bustling Fungus', desc: 'Stand still 1s: heal 4.5% max HP per second' },
  hoof: { tier: 'w', name: "Paul's Goat Hoof", desc: '+14% move speed', stats: n => mod('moveSpeed', { mul: 1 + 0.14 * n }, 'ror') },
  sticky: { tier: 'w', name: 'Sticky Bomb', desc: '5% on hit: attach a bomb (180%)' },
  crowbar: { tier: 'w', name: 'Crowbar', desc: '+75% damage to enemies above 90% HP' },
  topaz: { tier: 'w', name: 'Topaz Brooch', desc: 'Kills give 15 armor' },
  tooth: { tier: 'w', name: 'Monster Tooth', desc: 'Kills drop a healing orb' },
  ukulele: { tier: 'g', name: 'Ukulele', desc: '25% on hit: chain lightning (80%)' },
  atg: { tier: 'g', name: 'AtG Missile Mk. 1', desc: '10% on hit: fire a missile (300%)' },
  feather: { tier: 'g', name: 'Hopoo Feather', desc: '+1 dodge charge', stats: n => mod('dodgeCharges', { add: n }, 'ror') },
  fuel: { tier: 'g', name: 'Fuel Cell', desc: '-15% ability cooldowns', stats: n => mod('cdr', { mul: Math.pow(0.85, n) }, 'ror') },
  wisp: { tier: 'g', name: "Will-o'-the-wisp", desc: 'Kills explode (350%)' },
  harvester: { tier: 'g', name: "Harvester's Scythe", desc: 'Crits heal 8. +5% crit', stats: n => mod('critChance', { add: 0.05 }, 'ror') },
  predatory: { tier: 'g', name: 'Predatory Instincts', desc: 'Crits: +12% fire rate for 2s. +5% crit', stats: n => mod('critChance', { add: 0.05 }, 'ror') },
  behemoth: { tier: 'r', name: 'Brilliant Behemoth', desc: 'All your bullets explode', stats: n => mod('explodeRadius', { add: 45 + 25 * n }, 'ror') },
  dagger: { tier: 'r', name: 'Ceremonial Dagger', desc: 'Kills fire 3 homing daggers' },
  clover: { tier: 'r', name: '57 Leaf Clover', desc: 'Random effects get rerolled in your favor' },
  brainstalks: { tier: 'r', name: 'Brainstalks', desc: 'Elite kills: no cooldowns for 4s' },
  glass: { tier: 'l', name: 'Shaped Glass', desc: 'LUNAR: ×2 damage, ×0.5 max HP', stats: n => { mod('damage', { mul: Math.pow(2, n) }, 'ror'); mod('maxHp', { mul: Math.pow(0.5, n) }, 'ror'); } },
};
const ROR_COLORS = { w: '#e5e7eb', g: '#4ade80', r: '#f87171', l: '#60a5fa' };
const ROR_DIFF = ['Easy', 'Medium', 'Hard', 'Very Hard', 'Insane', 'Impossible', 'I SEE YOU', "I'M COMING FOR YOU", 'HAHAHAHA'];
defineSystem({ id: 'ror', name: 'Item Stacks', inspo: 'Risk of Rain 1 & 2', tagline: 'No choices, just accumulation. Buy chests with gold, stack proc items. The clock makes everything harder.',
  setup() {
    const S = run.s; S.items = {}; run.useGold = true;
    giveAbility(0, 'phaseRound'); giveAbility(1, 'suppress'); giveAbility(2, 'missiles');
    const n = id => S.items[id] || 0;
    const roll = p => { for (let i = 0; i <= n('clover'); i++) if (Math.random() < p) return true; return false; };
    S.n = n;
    Bus.on('hit', ev => {
      if (ev.source !== 'bullet') return; const e = ev.enemy;
      if (n('ukulele') && roll(0.25)) { const t = nearestEnemy(e.x, e.y, 320, false, new Set([e])); if (t) chain(t, 1 + n('ukulele') * 2, 300, ev.dmg * 0.8, { source: 'item', x0: e.x, y0: e.y, quiet: true }); }
      if (n('sticky') && roll(0.05 * n('sticky'))) { const tgt = e, dmg = ev.dmg * 1.8; addObject({ t: 0, update(dt) { this.t += dt; if (this.t > 1.5) { explode(tgt.x, tgt.y, 70, dmg, { source: 'item', color: '#fbbf24' }); return false; } }, draw() { ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(tgt.x + 6, tgt.y - 6, 4, 0, TAU); ctx.fill(); } }); }
      if (n('atg') && roll(0.1 * n('atg'))) { const a = player.aim - Math.PI / 2; addBullet({ x: player.x, y: player.y, vx: Math.cos(a) * 600, vy: Math.sin(a) * 600, owner: 'player', src: 'item', dmg: stat('damage') * 3, homing: 8, color: '#f87171', w: 4, range: 1600, ignoresCover: true, explode: { r: 50, dmg: 0.3 } }); }
      if (ev.crit && n('harvester')) healPlayer(8 * n('harvester'), true);
      if (ev.crit && n('predatory')) addBuff('predatory', 2, [{ stat: 'fireRate', mul: 1 + 0.12 * n('predatory') }], { label: 'PREDATORY', color: '#4ade80' });
    });
    Bus.on('beforeHit', ev => { if (n('crowbar') && ev.enemy.hp >= ev.enemy.maxHp * 0.9) ev.dmg *= 1 + 0.75 * n('crowbar'); });
    Bus.on('beforeDamage', ev => { const k = n('tougher'); if (k && Math.random() < 1 - 1 / (1 + 0.15 * k)) { ev.cancel = true; floater(player.x, player.y - 30, 'BLOCKED', '#93c5fd'); } });
    Bus.on('kill', ev => {
      const e = ev.enemy;
      if (n('topaz')) addArmor(15 * n('topaz'), true);
      if (n('tooth')) spawnPickup({ x: e.x, y: e.y, kind: 'orb', r: 7, color: '#4ade80', magnet: true, onPick: () => { healPlayer(8 * n('tooth')); } });
      if (n('wisp')) explode(e.x, e.y, 90 + 12 * n('wisp'), stat('damage') * 3.5 * n('wisp') * 0.5, { source: 'item', color: '#fb923c' });
      if (n('dagger')) for (let i = 0; i < 3 * n('dagger'); i++) { const a = rand(0, TAU); addBullet({ x: e.x, y: e.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, owner: 'player', src: 'item', dmg: stat('damage') * 1.5, homing: 9, color: '#e5e7eb', w: 3, range: 1500, ignoresCover: true }); }
      if (e.elite && n('brainstalks')) addBuff('brainstalks', 4 * n('brainstalks'), [], { label: 'BRAINSTALKS', color: '#f87171', tick: () => resetCooldowns() });
    });
    Bus.on('tick', ({ dt }) => {
      S.coef = 1 + run.time / 60 * 0.35 + (run.floor - 1) * 0.2;
      run.mods.enemyHp = 1 + (S.coef - 1) * 0.7; run.mods.enemyDmg = 1 + (S.coef - 1) * 0.35; run.mods.eliteChance = Math.min(0.35, (S.coef - 1) * 0.12); run.goldScale = S.coef;
      S.fungus = n('fungus') && player.stillTime > 1;
      if (S.fungus) healPlayer(stat('maxHp') * 0.045 * n('fungus') * dt, true);
    });
    Bus.on('roomBuild', () => {
      const count = 2 + (run.floor > 1 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        let x, y, tries = 0; do { x = grand(300, ROOM_W - 150); y = grand(80, ROOM_H - 80); } while (blocked(x, y, 24) && tries++ < 60);
        const big = genRng() < 0.2, cost = () => Math.round((big ? 50 : 25) * (S.coef || 1));
        spawnPickup({ x, y, vx: 0, vy: 0, kind: 'chest', r: big ? 18 : 14, interact: '', big, color: big ? '#4ade80' : '#a16207',
          draw(p) { ctx.fillStyle = p.color; ctx.fillRect(p.x - p.r, p.y - p.r * 0.7, p.r * 2, p.r * 1.4); ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2; ctx.strokeRect(p.x - p.r, p.y - p.r * 0.7, p.r * 2, p.r * 1.4); ctx.fillStyle = '#facc15'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('● ' + cost(), p.x, p.y + p.r + 12); p.interact = `Open chest (● ${cost()})`; },
          onInteract(p) {
            if (run.gold < cost()) { floater(p.x, p.y - 30, 'Not enough gold', '#f87171'); sfx.click(); return false; }
            run.gold -= cost();
            const r = Math.random(); let tier;
            if (big) tier = r < 0.8 ? 'g' : 'r'; else tier = r < 0.02 ? 'l' : r < 0.04 ? 'r' : r < 0.24 ? 'g' : 'w';
            const pool = Object.keys(ROR_ITEMS).filter(k => ROR_ITEMS[k].tier === tier), id = rpick(pool);
            S.items[id] = (S.items[id] || 0) + 1; clearMods('ror');
            for (const k in S.items) ROR_ITEMS[k].stats?.(S.items[k]);
            addPerk(ROR_ITEMS[id].name, ROR_ITEMS[id].desc); sfx.level();
            floater(p.x, p.y - 30, ROR_ITEMS[id].name, ROR_COLORS[tier], 2); floater(p.x, p.y - 12, ROR_ITEMS[id].desc, '#cbd5e1', 2);
          } });
      }
    });
  },
  drawWorld(layer) { if (layer === 'under' && run.s.fungus) { ctx.fillStyle = 'rgba(74,222,128,.12)'; ctx.beginPath(); ctx.arc(player.x, player.y, 70, 0, TAU); ctx.fill(); } },
  hudLines() {
    const S = run.s, idx = Math.min(ROR_DIFF.length - 1, Math.floor(((S.coef || 1) - 1) / 0.5));
    const lines = [{ t: `${ROR_DIFF[idx]} · ${fmtTime(run.time)} · difficulty ×${(S.coef || 1).toFixed(2)}`, c: idx > 4 ? '#f87171' : '#fde68a' }];
    const items = Object.entries(S.items).map(([k, v]) => ({ t: `${ROR_ITEMS[k].name} ×${v}`, c: ROR_COLORS[ROR_ITEMS[k].tier] }));
    return lines.concat(items);
  },
});

// ============================================================ 3. MASS EFFECT 3
const ME3_CLASSES = {
  soldier: { name: 'Soldier', desc: 'Adrenaline Rush · Concussive Shot · Frag Grenade. +20 HP, +10% weapon damage.', powers: ['adrenaline', 'concussive', 'grenade'], stats: () => { mod('maxHp', { add: 20 }, 'class'); mod('damage', { mul: 1.1 }, 'class'); } },
  adept: { name: 'Adept', desc: 'Pull · Warp · Shockwave. Prime with Pull, detonate with Warp or Shockwave. +20% power.', powers: ['pull', 'warp', 'shockwave'], stats: () => mod('abilityPower', { mul: 1.2 }, 'class') },
  engineer: { name: 'Engineer', desc: 'Overload · Incinerate · Turret. Tech + fire combos. -15% cooldowns.', powers: ['overload', 'incinerate', 'turret'], stats: () => mod('cdr', { mul: 0.85 }, 'class') },
  infiltrator: { name: 'Infiltrator', desc: 'Tactical Cloak · Cryo Blast · Marksman Shot. +10% crit.', powers: ['cloak', 'cryo', 'sniperShot'], stats: () => mod('critChance', { add: 0.1 }, 'class') },
  vanguard: { name: 'Vanguard', desc: 'Biotic Charge · Nova · Pull. Charge in, Nova out. +25 armor.', powers: ['charge', 'nova', 'pull'], stats: () => mod('maxArmor', { add: 25 }, 'class') },
  sentinel: { name: 'Sentinel', desc: 'Tech Armor · Warp · Overload. Durable caster.', powers: ['fortify', 'warp', 'overload'], stats: () => { mod('maxArmor', { add: 15 }, 'class'); mod('abilityPower', { mul: 1.1 }, 'class'); } },
};
const ME3_RANKS = {
  2: [{ k: 'A', name: '+15% power', fx: s => { s.power *= 1.15; } }],
  3: [{ k: 'A', name: '-15% recharge', fx: s => { s.cdMul *= 0.85; } }],
  4: [{ k: 'A', name: 'Damage: +35% power', fx: s => { s.power *= 1.35; } }, { k: 'B', name: 'Recharge: -30% cooldown', fx: s => { s.cdMul *= 0.7; } }],
  5: [{ k: 'A', name: 'Capacity: +1 charge', fx: s => { s.maxCharges++; s.charges++; } }, { k: 'B', name: 'Shields: each use restores 10 armor', fx: s => { s.armorOnUse = true; } }],
  6: [{ k: 'A', name: 'Overwhelm: +50% power', fx: s => { s.power *= 1.5; } }, { k: 'B', name: 'Power Synergy: using it gives +30% weapon damage for 5s', fx: s => { s.synergy = true; } }],
};
defineSystem({ id: 'me3', name: 'Class & Power Ranks', inspo: 'Mass Effect 3', tagline: 'Pick a class and a weapon weight. XP ranks up 3 powers with A/B evolutions. Prime enemies, then detonate for combos.',
  setup() {
    const S = run.s; S.xp = 0; S.level = 1; S.points = 1; S.fitness = 0;
    Bus.on('kill', ev => { S.xp += (ev.enemy.elite ? 30 : 10) * stat('xpMul'); while (S.xp >= 30 + 20 * S.level) { S.xp -= 30 + 20 * S.level; S.level++; S.points++; sfx.level(); floater(player.x, player.y - 50, 'LEVEL UP · ' + S.level, '#a78bfa', 1.5); } });
    Bus.on('ability', ev => { const s = ev.ctx.slot; if (!s) return; if (s.armorOnUse) addArmor(10, true); if (s.synergy) addBuff('synergy', 5, [{ stat: 'damage', mul: 1.3 }], { label: 'SYNERGY', color: '#a78bfa' }); });
    Bus.on('combo', ev => floater(ev.enemy.x, ev.enemy.y - 44, 'COMBO!', '#fde047', 1));
    openChoice({ title: 'Choose your class', sub: 'Mass Effect-style: abilities prime enemies (dashed ring) and others detonate them for big combo explosions.',
      options: Object.values(ME3_CLASSES).map(c => ({ name: c.name, desc: c.desc, onPick: () => {
        c.stats(); c.powers.forEach((p, i) => giveAbility(i, p)); addPerk(c.name);
        openChoice({ title: 'Weapon weight', sub: 'Lighter loadouts recharge powers faster.', options: [
          { name: 'Light: Heavy Pistol', desc: 'Semi-auto, 38 dmg, 12-round mag. Powers recharge 2× faster.', onPick: () => { setWeapon({ name: 'Heavy Pistol', stats: { damage: 38, fireRate: 5, magSize: 12, reloadTime: 1.2, spreadMove: 7 }, flags: { semi: true } }); mod('cdr', { mul: 0.5 }, 'weight'); resumePlay(); } },
          { name: 'Medium: Assault Rifle', desc: 'The standard rifle. Normal recharge.', onPick: () => resumePlay() },
          { name: 'Heavy: Heavy Rifle', desc: '30 dmg, 40-round mag. Powers recharge 60% slower.', onPick: () => { setWeapon({ name: 'Heavy Rifle', stats: { damage: 30, fireRate: 9, magSize: 40, reloadTime: 2.2, bloomPerShot: 1.3 } }); mod('cdr', { mul: 1.6 }, 'weight'); resumePlay(); } },
        ] });
      } })) });
  },
  onExit(next) { this.spend(next); },
  spend(next) {
    const S = run.s, P = player;
    if (S.points <= 0) { next(); return; }
    const opts = [];
    P.slots.forEach((s, i) => {
      if (!s || s.level >= 6) return;
      const nr = s.level + 1, name = ABILITIES[s.id].name;
      for (const r of ME3_RANKS[nr]) opts.push({ name: `${name} → Rank ${nr}${ME3_RANKS[nr].length > 1 ? ' ' + r.k : ''}`, desc: r.name, onPick: () => { s.level = nr; r.fx(s); S.points--; addPerk(`${name} R${nr}${ME3_RANKS[nr].length > 1 ? r.k : ''}`); this.spend(next); } });
    });
    if (S.fitness < 6) opts.push({ name: `Fitness → Rank ${S.fitness + 1}`, desc: '+15 max HP, +10 max armor, +5% weapon damage', onPick: () => { S.fitness++; mod('maxHp', { add: 15 }, 'fit'); mod('maxArmor', { add: 10 }, 'fit'); mod('damage', { mul: 1.05 }, 'fit'); healPlayer(15, true); S.points--; this.spend(next); } });
    opts.push({ name: `Continue (save ${S.points} point${S.points > 1 ? 's' : ''})`, onPick: next });
    openChoice({ title: `Squad screen: ${S.points} skill point${S.points > 1 ? 's' : ''}`, sub: `Level ${S.level}. Rank up a power or Fitness.`, list: true, options: opts });
  },
  hudLines() { const S = run.s; return [{ t: `Level ${S.level} · XP ${Math.floor(S.xp)}/${30 + 20 * S.level}${S.points ? ` · ${S.points} pts (spend at door)` : ''}`, c: '#c4b5fd' }]; },
});

// ============================================================ 4. ONE STEP FROM EDEN
const OSFE_CARDS = { kinetic: 0, blink: 0, grenade: 1, concussive: 1, overload: 1, pull: 1, incinerate: 1, cryo: 1, siphon: 1, groundSlam: 1, flamethrower: 1, mine: 1, seeker: 1,
  warp: 2, arrowRain: 2, turret: 2, bubble: 2, phaseRound: 2, ionSurge: 2, shockwave: 2, nova: 2, lightsOut: 2, missiles: 3, singularity: 3, timeStop: 3, manaShard: 0 };
const OSFE_ARTIFACTS = [
  { id: 'well', name: 'Mana Well', desc: '+1 max mana.' }, { id: 'quick', name: 'Quickening', desc: '+40% mana regen.' },
  { id: 'cantrip', name: 'Cantrip', desc: 'Casting a 0-cost card gives 0.4 mana.' }, { id: 'sharp', name: 'Sharpened Focus', desc: 'Cards cast while braced get +30% power.' },
  { id: 'echo', name: 'Echo Chamber', desc: '20% chance a cast card stays in your hand.' }, { id: 'flow', name: 'Flow', desc: 'Kills give 0.4 mana.' },
];
function osfeCardName(c) { return c.ab === 'manaShard' ? 'Mana Shard' : ABILITIES[c.ab].name; }
function osfeCardShort(c) { return (c.ab === 'manaShard' ? 'MANA' : ABILITIES[c.ab].short) + (c.plus ? '+' : ''); }
function osfeCost(c) { return Math.max(0, OSFE_CARDS[c.ab] - (c.plus && OSFE_CARDS[c.ab] > 0 ? 1 : 0)); }
defineSystem({ id: 'osfe', name: 'Spell Deck', inspo: 'One Step From Eden', tagline: 'Abilities are cards. Two in hand (L1/R1), a mana bar, a deck to build and thin. △ reshuffles.',
  slotsAlways: true,
  setup() {
    const S = run.s; S.deck = ['kinetic', 'kinetic', 'grenade', 'concussive', 'blink', 'overload'].map(ab => ({ ab, plus: false }));
    S.manaMax = 3; S.mana = 3; S.regen = 0.6; S.arts = new Set(); S.hand = [null, null]; S.draw = []; S.discard = []; S.shuffleT = 0;
    for (let i = 0; i < 2; i++) player.slots[i] = { onUse: () => this.play(i), label: '-', sub: '' };
    player.slots[2] = { onUse: () => this.reshuffle(), label: 'SHUF', sub: '' };
    Bus.on('roomBuild', () => this.resetDeck());
    Bus.on('kill', () => { if (S.arts.has('flow')) S.mana = Math.min(S.manaMax, S.mana + 0.4); });
  },
  resetDeck() { const S = run.s; S.draw = shuffle(S.deck.slice(), Math.random); S.discard = []; S.hand = [null, null]; S.mana = S.manaMax; S.shuffleT = 0; this.drawTo(0); this.drawTo(1); },
  drawTo(i) { const S = run.s; if (S.draw.length) S.hand[i] = S.draw.pop(); else { S.hand[i] = null; if (!S.hand[0] && !S.hand[1] && S.shuffleT <= 0) this.startShuffle(); } },
  startShuffle() { const S = run.s; S.shuffleT = 1.5; },
  reshuffle() { const S = run.s; if (S.shuffleT > 0) return; for (let i = 0; i < 2; i++) if (S.hand[i]) { S.discard.push(S.hand[i]); S.hand[i] = null; } this.startShuffle(); sfx.reload(); },
  play(i) {
    const S = run.s, c = S.hand[i];
    if (!c || S.shuffleT > 0) { sfx.click(); return; }
    const cost = osfeCost(c);
    if (S.mana < cost) { sfx.click(); floater(player.x, player.y - 40, 'no mana', '#60a5fa', 0.6); return; }
    let ok = true;
    if (c.ab === 'manaShard') S.mana = Math.min(S.manaMax + 2, S.mana + 2);
    else ok = castAbility(c.ab, abilityCtx({ power: stat('abilityPower') * (c.plus ? 1.5 : 1) * (S.arts.has('sharp') && player.bracing ? 1.3 : 1) })) !== false;
    if (!ok) { sfx.click(); return; }
    sfx.ability(); S.mana -= cost;
    if (cost === 0 && S.arts.has('cantrip')) S.mana = Math.min(S.manaMax, S.mana + 0.4);
    if (S.arts.has('echo') && Math.random() < 0.2) { floater(player.x, player.y - 40, 'ECHO', '#c4b5fd', 0.6); return; }
    S.discard.push(c); this.drawTo(i);
  },
  update(dt) {
    const S = run.s;
    if (S.mana < S.manaMax) S.mana = Math.min(S.manaMax, S.mana + S.regen * (S.arts.has('quick') ? 1.4 : 1) * dt);
    if (S.shuffleT > 0) { S.shuffleT -= dt; if (S.shuffleT <= 0) { S.draw = shuffle(S.draw.concat(S.discard), Math.random); S.discard = []; for (let i = 0; i < 2; i++) if (!S.hand[i]) this.drawTo(i); } }
    for (let i = 0; i < 2; i++) { const c = S.hand[i], sl = player.slots[i]; sl.label = S.shuffleT > 0 ? '…' : c ? osfeCardShort(c) : '-'; sl.sub = c ? osfeCost(c) + '◆' : ''; sl.disabled = !c || S.mana < (c ? osfeCost(c) : 99); sl.color = c && c.ab !== 'manaShard' ? ABILITIES[c.ab].color : '#60a5fa'; }
    player.slots[2].sub = S.shuffleT > 0 ? S.shuffleT.toFixed(1) : '';
  },
  hudLines() { const S = run.s; const next = S.draw.length ? osfeCardName(S.draw[S.draw.length - 1]) : '(reshuffle)'; return [{ t: `Mana ${'◆'.repeat(Math.floor(S.mana))}${'◇'.repeat(Math.max(0, Math.ceil(S.manaMax - Math.floor(S.mana))))} ${S.mana.toFixed(1)}/${S.manaMax}`, c: '#60a5fa' }, `Deck ${S.draw.length} · Discard ${S.discard.length} · Next: ${next}`]; },
  onExit(next) {
    const S = run.s;
    if (run.roomIdx === RUN_CONFIG.roomsPerFloor) {
      const pool = OSFE_ARTIFACTS.filter(a => !S.arts.has(a.id));
      openChoice({ title: 'Artifact', sub: 'End of floor: pick a permanent artifact.', options: sampleN(pool, 3).map(a => ({ name: a.name, desc: a.desc, tag: 'artifact', onPick: () => { S.arts.add(a.id); if (a.id === 'well') S.manaMax++; addPerk(a.name, a.desc); next(); } })) });
      return;
    }
    const offers = sampleN(Object.keys(OSFE_CARDS), 3).map(ab => ({ ab, plus: Math.random() < 0.15 }));
    openChoice({ title: 'Add a card to your deck', sub: `Deck (${S.deck.length}): ${S.deck.map(osfeCardShort).join(' · ')}`,
      options: offers.map(c => ({ name: osfeCardName(c) + (c.plus ? '+' : ''), desc: `${osfeCost(c)}◆ · ${c.ab === 'manaShard' ? '+2 mana instantly.' : ABILITIES[c.ab].desc}`, tag: c.plus ? 'upgraded' : 'card', onPick: () => { S.deck.push(c); addPerk(osfeCardName(c) + (c.plus ? '+' : '')); next(); } }))
        .concat([{ name: 'Remove a card', desc: 'Thin your deck.', tag: 'deck', onPick: () => this.pickCard('Remove which card?', i => { S.deck.splice(i, 1); }, next) },
                 { name: 'Upgrade a card', desc: '+50% power, -1 cost.', tag: 'deck', onPick: () => this.pickCard('Upgrade which card?', i => { S.deck[i].plus = true; }, next, true) },
                 { name: 'Skip', onPick: next }]) });
  },
  pickCard(title, fn, next, upgrade) {
    const S = run.s;
    openChoice({ title, list: true, options: S.deck.map((c, i) => ({ name: osfeCardName(c) + (c.plus ? '+' : ''), desc: `${osfeCost(c)}◆`, disabled: upgrade && c.plus, onPick: () => { fn(i); next(); } })).concat([{ name: 'Cancel', onPick: () => this.onExit(next) }]) });
  },
});

// ============================================================ 5. THE BAZAAR
const BZ_ITEMS = {
  frag: { name: 'Frag Pouch', short: 'FRAG', size: 1, cd: 6, price: 4, desc: 'Lob a grenade at the nearest enemy.', act: m => autoCast('grenade', m) },
  sentry: { name: 'Sentry Case', short: 'SENTRY', size: 2, cd: 14, price: 7, desc: 'Deploy a 12s turret.', act: m => { makeTurret(player.x + rand(-30, 30), player.y + rand(-30, 30), { dmg: 9 * m, life: 12 }); return true; } },
  medkit: { name: 'Med Kit', short: 'MED', size: 1, cd: 9, price: 3, desc: 'Heal 8 HP.', act: m => { healPlayer(8 * m); return true; } },
  battery: { name: 'Shield Battery', short: 'SHLD', size: 1, cd: 8, price: 3, desc: 'Restore 12 armor.', act: m => { addArmor(12 * m); return true; } },
  coil: { name: 'Arc Coil', short: 'ARC', size: 2, cd: 5, price: 6, desc: 'Overload the nearest enemy.', act: m => autoCast('overload', m) },
  dronebay: { name: 'Drone Bay', short: 'DRONES', size: 3, cd: 22, price: 9, desc: 'Launch a gunner drone.', act: m => { makeDrone({ dmg: 8 * m, life: 20 }); return true; } },
  coolant: { name: 'Coolant Pump', short: 'COOL', size: 1, cd: 4, price: 3, desc: 'Vent 50% heat, clear bloom and jams.', act: m => { player.heat *= 0.5; player.bloom = 0; player.jammed = false; return true; } },
  flame: { name: 'Flame Jet', short: 'FLAME', size: 2, cd: 7, price: 5, desc: 'Incinerate the nearest enemy.', act: m => autoCast('incinerate', m) },
  cryo: { name: 'Cryo Canister', short: 'CRYO', size: 1, cd: 8, price: 4, desc: 'Cryo blast the nearest enemy.', act: m => autoCast('cryo', m) },
  pod: { name: 'Missile Pod', short: 'MISSILE', size: 2, cd: 12, price: 7, desc: 'Fire a missile barrage.', act: m => autoCast('missiles', m) },
  dome: { name: 'Dome Projector', short: 'DOME', size: 2, cd: 16, price: 6, desc: 'Bubble shield on you.', act: m => autoCast('bubble', m) },
  stasis: { name: 'Stasis Watch', short: 'STASIS', size: 1, cd: 15, price: 6, desc: 'Enemies at 30% speed for 1.5s.', act: m => { addTimeSlow(1.5 * Math.min(2, m), 0.3); return true; } },
  gear: { name: 'Clockwork Gear', short: 'GEAR', size: 1, cd: 0, price: 4, desc: 'Passive: adjacent items charge 15% faster per tier.' },
  rod: { name: 'Charging Rod', short: 'ROD', size: 1, cd: 5, price: 4, desc: 'Charge adjacent items by 1s per tier.', act: () => true },
  belt: { name: 'Ammo Belt', short: 'BELT', size: 1, cd: 0, price: 3, desc: 'Passive: +4 magazine per tier.' },
  lucky: { name: 'Lucky Coin', short: 'COIN', size: 1, cd: 0, price: 3, desc: 'Passive: +25% gold per tier.' },
};
const BZ_TIER = ['', 'Bronze', 'Silver', 'Gold', 'Diamond'], BZ_TCOL = ['', '#cd7f32', '#cbd5e1', '#facc15', '#67e8f9'], BZ_MULT = [0, 1, 1.5, 2.2, 3];
defineSystem({ id: 'bazaar', name: 'Auto Board', inspo: 'The Bazaar', tagline: 'Your build is a 10-slot board of items that fire by themselves on cooldowns. Duplicates upgrade tiers, and neighbors matter.',
  setup() { const S = run.s; run.useGold = true; S.board = [{ id: 'frag', tier: 1, t: 0 }, { id: 'medkit', tier: 1, t: 0 }]; S.offers = null; S.reroll = 2; run.gold = 5; this.recompute(); },
  size() { return run.s.board.reduce((s, it) => s + BZ_ITEMS[it.id].size, 0); },
  recompute() { clearMods('bz'); for (const it of run.s.board) { if (it.id === 'belt') mod('magSize', { add: 4 * it.tier }, 'bz'); if (it.id === 'lucky') mod('goldMul', { mul: 1 + 0.25 * it.tier }, 'bz'); } },
  update(dt) {
    if (!room.combat || room.cleared) return;
    const B = run.s.board;
    B.forEach((it, i) => {
      const def = BZ_ITEMS[it.id]; it.flash = Math.max(0, (it.flash || 0) - dt);
      if (!def.cd) return;
      let haste = 1; for (const j of [i - 1, i + 1]) if (B[j] && B[j].id === 'gear') haste += 0.15 * B[j].tier;
      it.t += dt * haste;
      if (it.t >= def.cd) {
        const ok = def.act(BZ_MULT[it.tier]) !== false;
        if (ok) { it.t = 0; it.flash = 0.3; if (it.id === 'rod') for (const j of [i - 1, i + 1]) if (B[j]) B[j].t += it.tier; } else it.t = def.cd;
      }
    });
  },
  drawHud(c, box) {
    const B = run.s.board, bw = Math.min(200, cw * 0.26), U = Math.max(24, Math.min(44, (cw - 2 * (bw + 40)) / 10)), H = 36, x0 = cw / 2 - 10 * U / 2, y = ch - safe.b - H - 12;
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x0 - 3, y - 3, 10 * U + 6, H + 6);
    let x = x0;
    for (const it of B) {
      const def = BZ_ITEMS[it.id], w = def.size * U - 3;
      c.fillStyle = it.flash > 0 ? '#fef9c3' : '#1f2937'; c.fillRect(x, y, w, H);
      if (def.cd) { c.fillStyle = 'rgba(96,165,250,.35)'; c.fillRect(x, y + H * (1 - Math.min(1, it.t / def.cd)), w, H * Math.min(1, it.t / def.cd)); }
      c.strokeStyle = BZ_TCOL[it.tier]; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, H - 2);
      c.fillStyle = it.flash > 0 ? '#111' : '#f8fafc'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.fillText(def.short, x + w / 2, y + H / 2 + 4, w - 4);
      x += def.size * U;
    }
  },
  onExit(next) { const S = run.s; const income = 6 + run.floor * 2; run.gold += income; S.offers = null; S.reroll = 2; floaterScreen(`Income: +${income} gold`); this.shop(next, 0); },
  shop(next, focus) {
    const S = run.s;
    if (!S.offers) S.offers = sampleN(Object.keys(BZ_ITEMS), 4, Math.random).map(id => ({ id, tier: run.floor >= 3 && Math.random() < 0.3 ? 2 : 1 }));
    const space = 10 - this.size(), g = Math.floor(run.gold);
    const boardHtml = `<div style="display:flex;gap:3px;margin:6px 0 10px">${S.board.map(it => { const d = BZ_ITEMS[it.id]; return `<div style="flex:${d.size} 0 0;border:2px solid ${BZ_TCOL[it.tier]};border-radius:6px;padding:4px;font-size:11px;background:#111827;text-align:center"><b style="color:#fde68a">${d.name}</b><br>${BZ_TIER[it.tier]} · ${d.cd ? d.cd + 's' : 'passive'}</div>`; }).join('')}${space > 0 ? `<div style="flex:${space} 0 0;border:2px dashed #334155;border-radius:6px;font-size:11px;color:#64748b;display:flex;align-items:center;justify-content:center">${space} free</div>` : ''}</div>`;
    const opts = [];
    S.offers.forEach((o, k) => {
      const d = BZ_ITEMS[o.id], price = d.price * o.tier, owned = S.board.find(it => it.id === o.id);
      const can = g >= price && (owned ? owned.tier < 4 : d.size <= space);
      opts.push({ name: `Buy ${d.name} (${BZ_TIER[o.tier]}) · ● ${price}`, desc: `${d.desc} Size ${d.size}${d.cd ? `, ${d.cd}s` : ''}.${owned ? ' Owned: upgrades to ' + BZ_TIER[Math.min(4, owned.tier + o.tier)] + '.' : ''}`, disabled: !can,
        onPick: () => { run.gold -= price; if (owned) owned.tier = Math.min(4, owned.tier + o.tier); else S.board.push({ id: o.id, tier: o.tier, t: 0 }); S.offers.splice(k, 1); addPerk(d.name); this.recompute(); sfx.coin(); this.shop(next, k); } });
    });
    opts.push({ name: `Reroll shop · ● ${S.reroll}`, disabled: g < S.reroll, onPick: () => { run.gold -= S.reroll; S.reroll++; S.offers = null; this.shop(next, 4); } });
    S.board.forEach((it, i) => {
      const d = BZ_ITEMS[it.id], val = Math.max(1, Math.floor(d.price * it.tier / 2));
      if (i > 0) opts.push({ name: `Move ${d.name} left`, onPick: () => { [S.board[i - 1], S.board[i]] = [S.board[i], S.board[i - 1]]; this.shop(next, focus); } });
      opts.push({ name: `Sell ${d.name} (+● ${val})`, onPick: () => { S.board.splice(i, 1); run.gold += val; this.recompute(); this.shop(next, 0); } });
    });
    opts.push({ name: 'Leave shop →', onPick: () => { S.offers = null; next(); } });
    openChoice({ title: `Merchant · ● ${g} gold`, sub: 'Items trigger automatically in combat. Clockwork Gear and Charging Rod affect their neighbors.', html: boardHtml, list: true, options: opts, focus: Math.min(focus, opts.length - 1) });
  },
  hudLines() { return []; },
});

// ============================================================ 6. LUCK BE A LANDLORD
const LB = {
  coin: { e: '🪙', name: 'Coin', r: 'c', desc: '+1 coin.' }, cherry: { e: '🍒', name: 'Cherry', r: 'c', desc: '+1 coin, +1 per adjacent Cherry.' },
  flower: { e: '🌸', name: 'Flower', r: 'c', desc: '+1 coin.' }, milk: { e: '🥛', name: 'Milk', r: 'c', desc: '+1 coin. Cats love it.' },
  bee: { e: '🐝', name: 'Bee', r: 'c', desc: '+1 coin. Adjacent Flowers give ×3.' }, bullet: { e: '🔫', name: 'Bullet', r: 'c', desc: '+8% damage this room.' },
  shield: { e: '🛡️', name: 'Shield', r: 'c', desc: '+12 bonus armor this room.' }, heart: { e: '❤️', name: 'Heart', r: 'c', desc: 'Heal 6 HP.' },
  bomb: { e: '💣', name: 'Bomb', r: 'c', desc: '+1 grenade this room (grenades only come from Bombs).' }, boot: { e: '👢', name: 'Boot', r: 'c', desc: '+7% move speed this room.' },
  clover: { e: '🍀', name: 'Clover', r: 'u', desc: 'Adjacent symbols count double.' }, magnet: { e: '🧲', name: 'Magnet', r: 'u', desc: 'Adjacent Coins give +2.' },
  cat: { e: '🐱', name: 'Cat', r: 'u', desc: 'Drinks adjacent Milk (destroys it): +9 coins each.' }, dice: { e: '🎲', name: 'Dice', r: 'u', desc: 'Copies a random other symbol.' },
  hourglass: { e: '⏳', name: 'Hourglass', r: 'u', desc: '-12% ability cooldowns this room.' }, eye: { e: '👁️', name: 'Eye', r: 'u', desc: '+10% crit this room.' },
  fire: { e: '🔥', name: 'Fire', r: 'u', desc: '+15% burn chance this room.' }, bolt: { e: '⚡', name: 'Bolt', r: 'u', desc: '+15% fire rate this room.' },
  ghost: { e: '👻', name: 'Ghost', r: 'u', desc: 'Blocks the next hit this room.' }, skull: { e: '💀', name: 'Skull', r: 'r', desc: '+30% damage, -15 max HP this room.' },
  diamond: { e: '💎', name: 'Diamond', r: 'r', desc: '+4 coins, +3 per adjacent Diamond.' }, ufo: { e: '🛸', name: 'UFO', r: 'r', desc: 'A gunner drone flies with you this room.' },
  crown: { e: '👑', name: 'Crown', r: 'v', desc: 'All coins this spin ×2.' },
};
const LB_RENT = [12, 25, 40, 60, 90, 130, 180, 250];
defineSystem({ id: 'landlord', name: 'Slot Machine', inspo: 'Luck Be a Landlord', tagline: 'Before each room you spin a 5×3 slot machine built from your symbol pool. Symbols buff you and earn coins, and rent comes due every 3 rooms.',
  setup() {
    const S = run.s; S.pool = ['coin', 'coin', 'cherry', 'cherry', 'bullet', 'shield', 'bomb', 'flower', 'heart', 'milk']; S.coins = 0; S.rentIdx = 0; S.ghost = 0; S.summary = '';
    const g = giveAbility(0, 'grenade'); g.noRecharge = true; g.charges = 0; g.maxCharges = 0;
    Bus.on('beforeDamage', ev => { if (S.ghost > 0) { S.ghost--; ev.cancel = true; floater(player.x, player.y - 30, '👻 BOO', '#e5e7eb'); } });
  },
  preRoom(go) {
    const S = run.s, ids = shuffle(S.pool.slice(), Math.random).slice(0, 15), grid = Array(15).fill(null);
    const cells = shuffle([...Array(15).keys()], Math.random); ids.forEach((id, k) => grid[cells[k]] = id);
    const nb = i => { const r = Math.floor(i / 5), c = i % 5, out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 3 && cc >= 0 && cc < 5) out.push(rr * 5 + cc); } return out; };
    const mult = Array(15).fill(1); grid.forEach((id, i) => { if (id === 'clover') nb(i).forEach(j => mult[j] *= 2); });
    const fx = {}; let coins = 0; const hot = new Set(); const add = (k, v) => fx[k] = (fx[k] || 0) + v;
    const drunk = new Set();
    grid.forEach((id, i) => { if (id === 'cat') nb(i).forEach(j => { if (grid[j] === 'milk' && !drunk.has(j)) { drunk.add(j); coins += 9 * mult[i]; hot.add(i); hot.add(j); } }); });
    const apply = (id, i, m) => {
      switch (id) {
        case 'coin': coins += m * (1 + nb(i).filter(j => grid[j] === 'magnet').length * 2); break;
        case 'cherry': coins += m * (1 + nb(i).filter(j => grid[j] === 'cherry').length); break;
        case 'flower': coins += m * (nb(i).some(j => grid[j] === 'bee') ? 3 : 1); break;
        case 'milk': if (!drunk.has(i)) coins += m; break;
        case 'bee': coins += m; break;
        case 'diamond': coins += m * (4 + 3 * nb(i).filter(j => grid[j] === 'diamond').length); break;
        case 'bullet': add('dmg', 0.08 * m); break; case 'shield': add('armor', 12 * m); break; case 'heart': add('heal', 6 * m); break;
        case 'bomb': add('bomb', m); break; case 'boot': add('speed', 0.07 * m); break; case 'hourglass': add('cdr', m); break;
        case 'eye': add('crit', 0.1 * m); break; case 'fire': add('burn', 0.15 * m); break; case 'bolt': add('rof', 0.15 * m); break;
        case 'ghost': add('ghost', m); break; case 'skull': add('skull', m); break; case 'ufo': add('ufo', m); break; case 'crown': add('crown', m); break;
      }
      if (id) hot.add(i);
    };
    grid.forEach((id, i) => { if (!id || id === 'clover' || id === 'magnet' || id === 'cat') return; if (id === 'dice') { const others = grid.map((g2, j) => j).filter(j => grid[j] && j !== i && grid[j] !== 'dice'); if (others.length) apply(grid[rpick(others)], i, mult[i]); return; } apply(id, i, mult[i]); });
    if (fx.crown) coins *= 2 * fx.crown;
    S.pool = S.pool.filter((id, k) => true); for (const j of drunk) { const k = S.pool.indexOf('milk'); if (k >= 0) S.pool.splice(k, 1); }
    S.coins += coins;
    clearMods('slot');
    if (fx.dmg) mod('damage', { mul: 1 + fx.dmg }, 'slot'); if (fx.speed) mod('moveSpeed', { mul: 1 + fx.speed }, 'slot'); if (fx.cdr) mod('cdr', { mul: Math.pow(0.88, fx.cdr) }, 'slot');
    if (fx.crit) mod('critChance', { add: fx.crit }, 'slot'); if (fx.burn) mod('burnChance', { add: fx.burn }, 'slot'); if (fx.rof) mod('fireRate', { mul: 1 + fx.rof }, 'slot');
    if (fx.skull) { mod('damage', { mul: Math.pow(1.3, fx.skull) }, 'slot'); mod('maxHp', { add: -15 * fx.skull }, 'slot'); player.hp = Math.min(player.hp, stat('maxHp')); }
    if (fx.armor) { mod('maxArmor', { add: fx.armor }, 'slot'); addArmor(fx.armor, true); }
    if (fx.heal) healPlayer(fx.heal, true);
    const g = player.slots[0]; g.charges = g.maxCharges = 1 + (fx.bomb || 0);
    S.ghost = fx.ghost || 0;
    if (fx.ufo) for (let i = 0; i < fx.ufo; i++) makeDrone({ dmg: 8, life: 600 });
    const parts = [`+${coins} coins`]; if (fx.dmg) parts.push(`+${pct(fx.dmg)} dmg`); if (fx.armor) parts.push(`+${fx.armor} armor`); if (fx.heal) parts.push(`+${fx.heal} HP`); if (fx.bomb) parts.push(`${1 + fx.bomb} grenades`);
    if (fx.speed) parts.push(`+${pct(fx.speed)} speed`); if (fx.crit) parts.push(`+${pct(fx.crit)} crit`); if (fx.rof) parts.push(`+${pct(fx.rof)} fire rate`); if (fx.burn) parts.push(`${pct(fx.burn)} burn`); if (fx.cdr) parts.push('faster cooldowns'); if (fx.skull) parts.push('💀 risk'); if (fx.ghost) parts.push(`${fx.ghost} ghost block`); if (fx.ufo) parts.push('UFO drone');
    S.summary = parts.join(' · ');
    const rentIn = 3 - ((room.index - 1) % 3);
    const html = `<div class="reels">${grid.map((id, i) => `<div class="${hot.has(i) ? 'hot' : ''}" title="${id ? LB[id].name : ''}">${id ? LB[id].e : ''}</div>`).join('')}</div><p>${S.summary}</p><p class="muted">Coins: ${S.coins} · Rent ${LB_RENT[S.rentIdx]} due in ${rentIn} room${rentIn > 1 ? 's' : ''} · Pool ${S.pool.length} symbols</p>`;
    openChoice({ title: 'Spin!', html, options: [{ name: 'Fight →', desc: 'Effects last for this room.', onPick: () => { resumePlay(); go(); } }] });
  },
  onExit(next) {
    const S = run.s;
    const weights = { c: 10, u: 5, r: 2, v: 0.6 }, ids = Object.keys(LB);
    const pickOne = () => { let t = ids.reduce((s, k) => s + weights[LB[k].r], 0), r = Math.random() * t; for (const k of ids) { r -= weights[LB[k].r]; if (r < 0) return k; } return 'coin'; };
    const offers = []; while (offers.length < 3) { const k = pickOne(); if (!offers.includes(k)) offers.push(k); }
    const finish = () => {
      if (room.index % 3 === 0) {
        const due = LB_RENT[Math.min(S.rentIdx, LB_RENT.length - 1)];
        let msg;
        if (S.coins >= due) { S.coins -= due; msg = `Rent paid: ${due} coins. ${S.coins} left.`; }
        else { mod('maxHp', { add: -25 }, 'evict'); player.hp = Math.min(player.hp, stat('maxHp')); msg = `Couldn't pay ${due}! The landlord takes 25 max HP. (Coins kept: ${S.coins})`; addPerk('Eviction notice', '-25 max HP'); }
        S.rentIdx++;
        openChoice({ title: 'Rent day', sub: msg, options: [{ name: 'Continue', onPick: next }] });
      } else next();
    };
    openChoice({ title: 'Add a symbol', sub: `Pool: ${S.pool.map(k => LB[k].e).join('')}`, options: offers.map(k => ({ name: `${LB[k].e} ${LB[k].name}`, desc: LB[k].desc, tag: { c: 'common', u: 'uncommon', r: 'rare', v: 'very rare' }[LB[k].r], onPick: () => { S.pool.push(k); addPerk(LB[k].name); finish(); } })).concat([{ name: 'Skip', onPick: finish }]) });
  },
  hudLines() { const S = run.s; return [{ t: `Coins ${S.coins} · Rent ${LB_RENT[Math.min(S.rentIdx, LB_RENT.length - 1)]} due in ${3 - ((room.index - 1) % 3)}`, c: '#facc15' }, S.summary]; },
});

// ============================================================ 7. RETURNAL
const PARASITES = {
  vengeful: { name: 'Vengeful Spite', pos: '+30% damage while below 50% HP', neg: 'Enemies burst on death, hurting you if close' },
  leech: { name: 'Leech Tick', pos: 'Kills heal 4 HP', neg: '-20 max HP' },
  bloodrush: { name: 'Blood Rush', pos: '+25% fire rate', neg: 'Armor no longer refills when a room is cleared' },
  sticky: { name: 'Sticky Pod', pos: 'Perfect reloads restore 15 armor', neg: '+25% reload time' },
  spinal: { name: 'Spinal Hook', pos: '-40% dodge cooldown', neg: 'Taking damage has a 20% chance to jam your weapon' },
  phase: { name: 'Phase Shell', pos: '20% of enemy bullets pass through you', neg: 'Enemy bullets 20% faster' },
  gland: { name: 'Ammo Gland', pos: '+8 magazine', neg: '+30% heat per shot' },
  eye: { name: "Hunter's Eye", pos: '+15% crit chance', neg: '+25% spread' },
  mender: { name: 'Mender', pos: 'Regenerate 3 HP/s while standing still', neg: '-10% move speed' },
  thorn: { name: 'Thorn Sac', pos: 'Abilities recharge 30% faster', neg: 'Each ability use costs 4 HP' },
};
const MALFUNCTIONS = [
  { id: 'reload', name: 'Reload malfunction', desc: '+60% reload time', goal: 'Get 10 kills', key: 'kill', need: 10, fx: () => mod('reloadTime', { mul: 1.6 }, 'malf') },
  { id: 'abil', name: 'Ability malfunction', desc: '+100% ability cooldowns', goal: 'Get 3 perfect reloads', key: 'perfect', need: 3, fx: () => mod('cdr', { mul: 2 }, 'malf') },
  { id: 'dodge', name: 'Dodge malfunction', desc: 'Dodge cooldown ×2', goal: 'Get 4 kills while braced', key: 'bracedKill', need: 4, fx: () => mod('dodgeCooldown', { mul: 2 }, 'malf') },
];
defineSystem({ id: 'returnal', name: 'Parasites & Adrenaline', inspo: 'Returnal', tagline: 'Every boon is a parasite with a downside. Kill streaks build Adrenaline levels that vanish the moment you get hit.',
  setup() {
    const S = run.s; S.paras = []; S.adr = 0; S.adrKills = 0; S.malf = null;
    giveAbility(0, 'grenade'); giveAbility(1, 'phaseRound');
    const has = id => S.paras.includes(id);
    Bus.on('beforeHit', ev => { if (has('vengeful') && player.hp < stat('maxHp') * 0.5) ev.dmg *= 1.3; });
    Bus.on('kill', ev => {
      if (has('vengeful')) explode(ev.enemy.x, ev.enemy.y, 85, 0, { hurtsPlayer: 12, color: '#f87171' });
      if (has('leech')) healPlayer(4, true);
      S.adrKills++; if (S.adrKills >= 3 && S.adr < 5) { S.adrKills = 0; S.adr++; this.adrenaline(); floater(player.x, player.y - 50, `ADRENALINE ${S.adr}`, '#fbbf24', 1.2); sfx.level(); }
      if (S.malf) { if (S.malf.key === 'kill' || (S.malf.key === 'bracedKill' && ev.braced)) this.malfProgress(); }
    });
    Bus.on('reload', ev => { if (ev.perfect && has('sticky')) addArmor(15); if (ev.perfect && S.malf && S.malf.key === 'perfect') this.malfProgress(); });
    Bus.on('beforeDamage', ev => { if (has('phase') && Math.random() < 0.2) { ev.cancel = true; floater(player.x, player.y - 30, 'phased', '#c4b5fd', 0.6); } });
    Bus.on('damaged', () => { if (S.adr > 0) { S.adr = 0; S.adrKills = 0; this.adrenaline(); floater(player.x, player.y - 50, 'ADRENALINE LOST', '#f87171'); } if (has('spinal') && Math.random() < 0.2 && !player.jammed) { player.jammed = true; player.heat = 1; floater(player.x, player.y - 40, 'JAMMED by parasite', '#fb923c'); } });
    Bus.on('ability', () => { if (has('thorn')) { player.hp = Math.max(1, player.hp - 4); floater(player.x, player.y - 30, '-4', '#f87171', 0.5); } });
    Bus.on('tick', ({ dt }) => { if (has('mender') && player.stillTime > 0.5) healPlayer(3 * dt, true); });
  },
  adrenaline() {
    const a = run.s.adr; clearMods('adren');
    if (a >= 1) mod('moveSpeed', { mul: 1.1 }, 'adren'); if (a >= 2) mod('damage', { mul: 1.15 }, 'adren'); if (a >= 3) mod('bloomPerShot', { mul: 0.7 }, 'adren');
    if (a >= 4) mod('fireRate', { mul: 1.2 }, 'adren'); if (a >= 5) mod('pierce', { add: 1 }, 'adren');
  },
  applyParasites() {
    const S = run.s; clearMods('para'); const has = id => S.paras.includes(id);
    if (has('leech')) mod('maxHp', { add: -20 }, 'para'); if (has('bloodrush')) mod('fireRate', { mul: 1.25 }, 'para'); if (has('sticky')) mod('reloadTime', { mul: 1.25 }, 'para');
    if (has('spinal')) mod('dodgeCooldown', { mul: 0.6 }, 'para'); if (has('gland')) { mod('magSize', { add: 8 }, 'para'); mod('heatPerShot', { mul: 1.3 }, 'para'); }
    if (has('eye')) { mod('critChance', { add: 0.15 }, 'para'); mod('spreadStill', { mul: 1.25 }, 'para'); mod('spreadMove', { mul: 1.25 }, 'para'); }
    if (has('mender')) mod('moveSpeed', { mul: 0.9 }, 'para'); if (has('thorn')) mod('cdr', { mul: 0.7 }, 'para');
    run.noArmorRefill = has('bloodrush'); run.mods.enemyBulletSpeed = has('phase') ? 1.2 : 1;
    player.hp = Math.min(player.hp, stat('maxHp'));
  },
  malfProgress() { const S = run.s; S.malf.n++; if (S.malf.n >= S.malf.need) { floater(player.x, player.y - 60, 'MALFUNCTION REPAIRED', '#4ade80', 1.5); S.malf = null; clearMods('malf'); } },
  onExit(next) {
    const S = run.s, avail = Object.keys(PARASITES).filter(k => !S.paras.includes(k)), offers = sampleN(avail, 2);
    const opts = offers.map(k => ({ name: PARASITES[k].name, desc: `<span style="color:#4ade80">+ ${PARASITES[k].pos}</span><br><span style="color:#f87171">− ${PARASITES[k].neg}</span>`, tag: 'parasite', onPick: () => { S.paras.push(k); addPerk(PARASITES[k].name); this.applyParasites(); next(); } }));
    if (!S.malf && Math.random() < 0.5) {
      const m = rpick(MALFUNCTIONS), boon = rpick(statPool());
      opts.push({ name: `Malignant: ${boon.name}`, desc: `${boon.desc}<br><span style="color:#f87171">Malfunction: ${m.desc} until you ${m.goal.toLowerCase()}.</span>`, tag: 'malignant', onPick: () => { boon.apply(); addPerk(boon.name); S.malf = { ...m, n: 0 }; m.fx(); next(); } });
    }
    if (S.paras.length) opts.push({ name: 'Remove a parasite', desc: 'Costs 25 HP.', tag: 'surgery', disabled: player.hp <= 26, onPick: () => openChoice({ title: 'Remove which parasite?', list: true, options: S.paras.map((k, i) => ({ name: PARASITES[k].name, desc: PARASITES[k].neg, onPick: () => { S.paras.splice(i, 1); player.hp -= 25; this.applyParasites(); next(); } })) }) });
    opts.push({ name: 'Leave them', onPick: next });
    openChoice({ title: 'Parasites', sub: 'Every benefit has a cost.', options: opts });
  },
  hudLines() {
    const S = run.s, lines = [{ t: `Adrenaline ${'▮'.repeat(S.adr)}${'▯'.repeat(5 - S.adr)} (${S.adrKills}/3)`, c: S.adr ? '#fbbf24' : '#94a3b8' }];
    for (const k of S.paras) lines.push({ t: '🦠 ' + PARASITES[k].name, c: '#a3e635' });
    if (S.malf) lines.push({ t: `⚠ ${S.malf.name}: ${S.malf.goal} (${S.malf.n}/${S.malf.need})`, c: '#f87171' });
    return lines;
  },
});

// ============================================================ 8. VAMPIRE SURVIVORS
const VS_W = {
  wand: { name: 'Magic Wand', desc: 'Fires at the nearest enemy.' }, knife: { name: 'Knife', desc: 'Throws knives where you aim.' },
  garlic: { name: 'Garlic', desc: 'Damaging aura around you.' }, bible: { name: 'King Bible', desc: 'Books orbit you.' },
  water: { name: 'Santa Water', desc: 'Damaging puddles on enemies.' }, lightning: { name: 'Lightning Ring', desc: 'Strikes random enemies.' },
  rune: { name: 'Runetracer', desc: 'A bouncing projectile.' }, firewand: { name: 'Fire Wand', desc: 'Fireballs at random enemies.' },
};
const VS_P = {
  spinach: { name: 'Spinach', desc: '+10% might (all damage).' }, tome: { name: 'Empty Tome', desc: '-8% cooldowns.' }, wings: { name: 'Wings', desc: '+10% move speed.' },
  heart: { name: 'Hollow Heart', desc: '+20% max HP.' }, orb: { name: 'Attractorb', desc: '+40% pickup radius.' }, armor: { name: 'Armor', desc: '-8% damage taken.' },
  duplicator: { name: 'Duplicator', desc: '+1 projectile to wands, knives and fire wands.' }, clover: { name: 'Clover', desc: '+8% crit.' },
};
const VS_EVO = [
  { w: 'wand', p: 'tome', name: 'Holy Wand', desc: 'Fires almost without pause.' }, { w: 'knife', p: 'wings', name: 'Thousand Edge', desc: 'An endless stream of knives.' },
  { w: 'garlic', p: 'heart', name: 'Soul Eater', desc: 'A bigger aura that heals you.' }, { w: 'bible', p: 'orb', name: 'Unholy Vespers', desc: 'Six books in a wide ring.' },
  { w: 'lightning', p: 'duplicator', name: 'Thunder Loop', desc: 'Every strike hits twice.' }, { w: 'water', p: 'clover', name: 'La Borra', desc: 'Huge pools that drift toward you.' },
  { w: 'firewand', p: 'spinach', name: 'Hellfire', desc: 'Huge piercing meteors.' }, { w: 'rune', p: 'armor', name: 'NO FUTURE', desc: 'Explodes on every bounce.' },
];
defineSystem({ id: 'survivors', name: 'Auto-Weapons & Level-Ups', inspo: 'Vampire Survivors', tagline: 'Swarms drop XP gems. Level-ups pause the fight mid-combat. Auto-weapons stack up and evolve with the right passive.',
  setup() {
    const S = run.s; S.xp = 0; S.lvl = 1; S.queue = 0; S.w = { wand: { L: 1, t: 0 } }; S.p = {}; S.books = 0; S.hitT = new Map();
    run.mods.enemyCount = 1.6; run.mods.enemyHp = 0.75; run.noDrops = true;
    Bus.on('kill', ev => spawnPickup({ x: ev.enemy.x, y: ev.enemy.y, kind: 'xp', value: ev.enemy.elite ? 6 : 1, magnet: true, color: ev.enemy.elite ? '#f472b6' : '#22d3ee', onPick: p => { S.xp += p.value * stat('xpMul'); while (S.xp >= this.need()) { S.xp -= this.need(); S.lvl++; S.queue++; } } }));
    Bus.on('beforeHit', ev => { if (ev.source === 'vs') ev.dmg *= this.might(); });
  },
  need() { return 4 + run.s.lvl * 3; },
  might() { return 1 + 0.1 * (run.s.p.spinach || 0); },
  cdm() { return Math.pow(0.92, run.s.p.tome || 0); },
  dup() { return run.s.p.duplicator || 0; },
  recompute() { const p = run.s.p; clearMods('vs'); if (p.wings) mod('moveSpeed', { mul: 1 + 0.1 * p.wings }, 'vs'); if (p.heart) mod('maxHp', { mul: 1 + 0.2 * p.heart }, 'vs'); if (p.orb) mod('pickupRadius', { mul: 1 + 0.4 * p.orb }, 'vs'); if (p.armor) mod('damageTaken', { mul: Math.pow(0.92, p.armor) }, 'vs'); if (p.clover) mod('critChance', { add: 0.08 * p.clover }, 'vs'); if (p.tome) mod('cdr', { mul: this.cdm() }, 'vs'); if (p.spinach) mod('damage', { mul: 1 + 0.05 * p.spinach }, 'vs'); },
  shoot(x, y, a, o) { return addBullet({ x, y, vx: Math.cos(a) * (o.speed || 900), vy: Math.sin(a) * (o.speed || 900), owner: 'player', src: 'vs', dmg: o.dmg, color: o.color, w: o.w || 3, range: o.range || 900, pierce: o.pierce || 0, bounce: o.bounce || 0, explode: o.explode, ignoresCover: true, onHit: o.onHit || {} }); },
  update(dt) {
    const S = run.s, P = player;
    if (S.queue > 0 && state === 'play') { this.levelUp(); return; }
    const combat = enemies.length > 0;
    for (const id in S.w) {
      const w = S.w[id], L = w.L, evo = w.evo; w.t -= dt;
      if (id === 'garlic') { const r = (60 + 12 * L) * (evo ? 1.5 : 1); w.r = r; if (w.t <= 0) { w.t = 0.45; for (const e of enemiesNear(P.x, P.y, r)) { hitEnemy(e, 5 + 2 * L, { source: 'vs', knock: 60, quiet: true }); if (evo) healPlayer(0.4, true); } } continue; }
      if (id === 'bible') { const n = evo ? 6 : 1 + Math.floor(L / 2), rad = evo ? 130 : 95; w.ang = (w.ang || 0) + dt * 3; w.pos = []; for (let k = 0; k < n; k++) { const a = w.ang + k * TAU / n, bx = P.x + Math.cos(a) * rad, by = P.y + Math.sin(a) * rad; w.pos.push([bx, by]); for (const e of enemiesNear(bx, by, 12)) { const last = S.hitT.get(e) || 0; if (time - last > 0.5) { S.hitT.set(e, time); hitEnemy(e, 12 + 4 * L, { source: 'vs', knock: 120, x: P.x, y: P.y }); } } } continue; }
      if (w.t > 0 || !combat) continue;
      const near = nearestEnemy(P.x, P.y, 900), rnd = () => rpick(enemies);
      switch (id) {
        case 'wand': { w.t = (evo ? 0.15 : 1.1 - 0.08 * L) * this.cdm(); const n = 1 + Math.floor(L / 3) + this.dup(); let ex = new Set(); for (let k = 0; k < n; k++) { const t = nearestEnemy(P.x, P.y, 900, false, ex) || near; if (!t) break; ex.add(t); this.shoot(P.x, P.y, Math.atan2(t.y - P.y, t.x - P.x), { dmg: 14 + 5 * L, color: '#60a5fa', speed: 800 }); } break; }
        case 'knife': { w.t = (evo ? 0.12 : 0.9) * this.cdm(); const n = 1 + Math.floor(L / 2) + this.dup(); for (let k = 0; k < n; k++) this.shoot(P.x, P.y, P.aim + (k - (n - 1) / 2) * 0.08, { dmg: 10 + 3 * L, color: '#e5e7eb', speed: 1300, pierce: L >= 4 ? 1 : 0, w: 2 }); break; }
        case 'water': { w.t = 3.2 * this.cdm(); const t = rnd(); if (t) { const r = (55 + 6 * L) * (evo ? 1.6 : 1); zone(t.x, t.y, r, 2.5, { color: '#3b82f6', alpha: 0.3, tick: (z, d) => { for (const e of enemiesNear(z.x, z.y, z.r)) hitEnemy(e, (12 + 5 * L) * d, { source: 'vs', quiet: true }); }, update: evo ? (z, d) => { z.x += (P.x - z.x) * d * 0.6; z.y += (P.y - z.y) * d * 0.6; } : null }); } break; }
        case 'lightning': { w.t = (2.6 - 0.15 * L) * this.cdm(); const n = 1 + Math.ceil(L / 2); for (let k = 0; k < n; k++) { const t = rnd(); if (!t) break; for (let rep = 0; rep < (evo ? 2 : 1); rep++) { beam(t.x, t.y - 400, t.x, t.y, '#fde047', 4, 0.2); hitEnemy(t, 25 + 8 * L, { source: 'vs', stun: 0.2 }); } } sfx.zap(); break; }
        case 'rune': { w.t = 2.2 * this.cdm(); this.shoot(P.x, P.y, rand(0, TAU), { dmg: 18 + 4 * L, color: '#c084fc', speed: 700, bounce: 3 + L, range: 3000, pierce: 99, w: 5, explode: evo ? { r: 70, dmg: 1 } : null }); break; }
        case 'firewand': { w.t = 2.4 * this.cdm(); const n = 1 + this.dup(); for (let k = 0; k < n; k++) { const t = rnd(); if (!t) break; this.shoot(P.x, P.y, Math.atan2(t.y - P.y, t.x - P.x), { dmg: 22 + 7 * L, color: '#f97316', speed: 600, w: evo ? 10 : 6, pierce: evo ? 5 : 0, explode: { r: evo ? 110 : 70, dmg: 0.8, color: '#f97316' } }); } break; }
      }
    }
  },
  drawWorld(layer) {
    const S = run.s;
    if (layer === 'under' && S.w.garlic) { ctx.fillStyle = S.w.garlic.evo ? 'rgba(244,114,182,.12)' : 'rgba(253,230,138,.1)'; ctx.beginPath(); ctx.arc(player.x, player.y, S.w.garlic.r || 70, 0, TAU); ctx.fill(); }
    if (layer === 'over' && S.w.bible && S.w.bible.pos) { ctx.fillStyle = '#fde68a'; for (const [x, y] of S.w.bible.pos) ctx.fillRect(x - 6, y - 8, 12, 16); }
  },
  levelUp() {
    const S = run.s, opts = [];
    for (const ev of VS_EVO) { const w = S.w[ev.w]; if (w && w.L >= 5 && !w.evo && S.p[ev.p]) opts.push({ name: '★ ' + ev.name, desc: `Evolve ${VS_W[ev.w].name}: ${ev.desc}`, tag: 'evolution', onPick: () => { w.evo = true; addPerk(ev.name); this.after(); } }); }
    const pool = [];
    for (const id in VS_W) { const w = S.w[id]; if (w && w.L < 5) pool.push({ name: `${VS_W[id].name} → Lv ${w.L + 1}`, desc: VS_W[id].desc, tag: 'weapon', onPick: () => { w.L++; this.after(); } }); else if (!w && Object.keys(S.w).length < 6) pool.push({ name: `${VS_W[id].name} (new)`, desc: VS_W[id].desc, tag: 'weapon', onPick: () => { S.w[id] = { L: 1, t: 0 }; addPerk(VS_W[id].name); this.after(); } }); }
    for (const id in VS_P) { const n = S.p[id] || 0; if (n < 5 && (n > 0 || Object.keys(S.p).length < 6)) pool.push({ name: `${VS_P[id].name}${n ? ' → Lv ' + (n + 1) : ' (new)'}`, desc: VS_P[id].desc, tag: 'passive', onPick: () => { S.p[id] = n + 1; if (!n) addPerk(VS_P[id].name); this.recompute(); this.after(); } }); }
    opts.push(...sampleN(pool, Math.max(0, 4 - opts.length), Math.random));
    if (!opts.length) opts.push({ name: 'Floor Chicken', desc: 'Heal 30 HP.', onPick: () => { healPlayer(30); this.after(); } });
    sfx.level();
    openChoice({ title: `LEVEL UP! (Lv ${S.lvl - S.queue + 1})`, sub: 'Evolutions need a weapon at level 5 plus its matching passive.', options: opts });
  },
  after() { run.s.queue--; resumePlay(); },
  hudLines() {
    const S = run.s;
    return [{ t: `Lv ${S.lvl} · XP ${Math.floor(S.xp)}/${this.need()}`, c: '#22d3ee' }, Object.entries(S.w).map(([k, w]) => (w.evo ? '★' : '') + VS_W[k].name + ' ' + w.L).join(' · '), Object.entries(S.p).map(([k, n]) => VS_P[k].name + ' ' + n).join(' · ')].filter(Boolean);
  },
});

// ============================================================ 9. PATH OF EXILE PASSIVE TREE
const POE_BRANCHES = [
  { name: 'Offense', color: '#f87171', small: ['+6% damage', () => mod('damage', { mul: 1.06 }, 'tree')], notable: ['Heavy Rounds', '+20% damage, +10% bloom', () => { mod('damage', { mul: 1.2 }, 'tree'); mod('bloomPerShot', { mul: 1.1 }, 'tree'); }], key: ['Point Blank', 'KEYSTONE: +50% bullet damage within 300 range, -40% beyond 600', 'pointBlank'], gem: 'phaseRound' },
  { name: 'Precision', color: '#fde68a', small: ['-6% spread', () => { mod('spreadStill', { mul: 0.94 }, 'tree'); mod('spreadMove', { mul: 0.94 }, 'tree'); }], notable: ['Deadeye', '+15% crit chance', () => mod('critChance', { add: 0.15 }, 'tree')], key: ['Resolute Technique', 'KEYSTONE: your shots never spread, but you can never crit', 'resolute'], gem: 'pulseScan' },
  { name: 'Defense', color: '#60a5fa', small: ['+8 max armor', () => mod('maxArmor', { add: 8 }, 'tree')], notable: ['Bulwark', '+30 max armor, +3 armor/s regen', () => { mod('maxArmor', { add: 30 }, 'tree'); mod('armorRegen', { add: 3 }, 'tree'); }], key: ['Chaos Inoculation', 'KEYSTONE: max HP becomes 1. Max armor ×3, +10 armor/s regen', 'ci'], gem: 'coverWall' },
  { name: 'Mobility', color: '#4ade80', small: ['+5% move speed', () => mod('moveSpeed', { mul: 1.05 }, 'tree')], notable: ['Fleet', '+1 dodge charge', () => mod('dodgeCharges', { add: 1 }, 'tree')], key: ['Acrobatics', 'KEYSTONE: 30% of hits miss you, -50% max armor', 'acro'], gem: 'blink' },
  { name: 'Tech', color: '#a78bfa', small: ['-6% cooldowns', () => mod('cdr', { mul: 0.94 }, 'tree')], notable: ['Overcharged', '+25% ability power', () => mod('abilityPower', { mul: 1.25 }, 'tree')], key: ['Blood Magic', 'KEYSTONE: abilities have almost no cooldown but cost 12 HP each', 'blood'], gem: 'overload' },
  { name: 'Gunsmith', color: '#fbbf24', small: ['+2 magazine', () => mod('magSize', { add: 2 }, 'tree')], notable: ['Speed Loader', '-20% reload time, bigger perfect window', () => { mod('reloadTime', { mul: 0.8 }, 'tree'); mod('perfectLen', { add: 0.05 }, 'tree'); }], key: ['Perfect Rhythm', 'KEYSTONE: perfect reloads give +40% damage for 5s; fumbles root you for 0.6s', 'rhythm'], gem: 'overcharge' },
];
function buildPoeTree() {
  const nodes = [{ id: 0, x: 0, y: 0, type: 'start', name: 'Start', links: [] }];
  const link = (a, b) => { nodes[a].links.push(b); nodes[b].links.push(a); };
  const ring = [];
  POE_BRANCHES.forEach((br, b) => {
    const a0 = b * TAU / 6 - Math.PI / 2; let prev = 0;
    for (let k = 1; k <= 6; k++) {
      const r = 34 + k * 38, type = k === 3 ? 'notable' : k === 6 ? 'key' : 'small';
      const n = { id: nodes.length, x: Math.cos(a0) * r, y: Math.sin(a0) * r, type, b, links: [] };
      nodes.push(n); link(prev, n.id); prev = n.id;
      if (k === 2) ring.push(n.id);
      if (k === 2 || k === 4) {
        const side = { id: nodes.length, x: Math.cos(a0 + (k === 2 ? 0.32 : -0.22)) * (r + 18), y: Math.sin(a0 + (k === 2 ? 0.32 : -0.22)) * (r + 18), type: k === 2 ? 'gem' : 'small', b, links: [] };
        nodes.push(side); link(n.id, side.id);
      }
    }
  });
  for (let i = 0; i < ring.length; i++) link(ring[i], ring[(i + 1) % ring.length]);
  for (const n of nodes) {
    if (n.type === 'start') continue; const br = POE_BRANCHES[n.b];
    if (n.type === 'small') { n.name = br.small[0]; n.desc = 'small passive'; n.fx = br.small[1]; }
    else if (n.type === 'notable') { n.name = br.notable[0]; n.desc = br.notable[1]; n.fx = br.notable[2]; }
    else if (n.type === 'key') { n.name = br.key[0]; n.desc = br.key[1]; n.key = br.key[2]; }
    else if (n.type === 'gem') { n.name = 'Skill Gem: ' + ABILITIES[br.gem].name; n.desc = ABILITIES[br.gem].desc; n.gem = br.gem; }
  }
  return nodes;
}
defineSystem({ id: 'poe', name: 'Passive Web', inspo: 'Path of Exile', tagline: 'A giant passive tree. Path toward notables, skill gems and rule-breaking keystones. 2 points per room.',
  setup() {
    const S = run.s; S.tree = buildPoeTree(); S.alloc = new Set([0]); S.points = 2; S.keys = new Set();
    giveAbility(0, 'grenade');
    Bus.on('beforeHit', ev => { if (S.keys.has('pointBlank') && ev.source === 'bullet') { const d = hyp(ev.enemy.x - player.x, ev.enemy.y - player.y); if (d < 300) ev.dmg *= 1.5; else if (d > 600) ev.dmg *= 0.6; } });
    Bus.on('beforeDamage', ev => { if (S.keys.has('acro') && Math.random() < 0.3) { ev.cancel = true; floater(player.x, player.y - 30, 'evaded', '#4ade80', 0.6); } });
    Bus.on('beforeAbility', ev => { if (S.keys.has('blood')) { if (player.hp <= 13) { ev.cancel = true; floater(player.x, player.y - 30, 'not enough blood', '#f87171', 0.7); } else { player.hp -= 12; floater(player.x, player.y - 30, '-12', '#f87171', 0.5); } } });
    Bus.on('reload', ev => { if (!S.keys.has('rhythm')) return; if (ev.perfect) addBuff('rhythm', 5, [{ stat: 'damage', mul: 1.4 }], { label: 'RHYTHM', color: '#fbbf24' }); if (ev.fumble) addBuff('fumbleRoot', 0.6, [], { flags: ['root'], label: 'FUMBLED', color: '#f87171' }); });
  },
  recompute() {
    const S = run.s; clearMods('tree'); S.keys.clear();
    for (const id of S.alloc) { const n = S.tree[id]; n.fx?.(); if (n.key) S.keys.add(n.key); }
    if (S.keys.has('resolute')) { mod('spreadStill', { mul: 0 }, 'tree'); mod('spreadMove', { mul: 0 }, 'tree'); mod('bloomPerShot', { mul: 0 }, 'tree'); mod('critChance', { mul: 0 }, 'tree'); }
    if (S.keys.has('ci')) { mod('maxHp', { mul: 0.01 }, 'tree'); mod('maxArmor', { mul: 3 }, 'tree'); mod('armorRegen', { add: 10 }, 'tree'); }
    if (S.keys.has('acro')) mod('maxArmor', { mul: 0.5 }, 'tree');
    if (S.keys.has('blood')) mod('cdr', { mul: 0.08 }, 'tree');
    player.hp = Math.min(player.hp, stat('maxHp')); player.armor = Math.min(player.armor, stat('maxArmor'));
  },
  svg() {
    const S = run.s, T = S.tree, front = this.frontier();
    let s = `<svg viewBox="-290 -290 580 580" style="display:block;margin:0 auto;height:64vh;max-width:100%;background:#0b0f14;border-radius:10px">`;
    for (const n of T) for (const l of n.links) if (l > n.id) { const m = T[l], on = S.alloc.has(n.id) && S.alloc.has(l); s += `<line x1="${n.x}" y1="${n.y}" x2="${m.x}" y2="${m.y}" stroke="${on ? '#fbbf24' : '#334155'}" stroke-width="${on ? 3 : 1.5}"/>`; }
    for (const n of T) { const r = n.type === 'key' ? 11 : n.type === 'notable' ? 8 : n.type === 'start' ? 9 : 5, col = n.b != null ? POE_BRANCHES[n.b].color : '#fff', on = S.alloc.has(n.id), fr = front.includes(n); s += `<circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${on ? col : '#111827'}" stroke="${fr ? '#fde68a' : on ? col : '#475569'}" stroke-width="${fr ? 2.5 : 1.5}"/>`; if (n.type === 'gem') s += `<rect x="${n.x - 3}" y="${n.y - 3}" width="6" height="6" fill="${on ? '#111' : col}"/>`; }
    POE_BRANCHES.forEach((br, b) => { const a = b * TAU / 6 - Math.PI / 2; s += `<text x="${Math.cos(a) * 278}" y="${Math.sin(a) * 278 + 4}" fill="${br.color}" font-size="15" text-anchor="middle" font-family="system-ui">${br.name}</text>`; });
    return s + '</svg>';
  },
  frontier() { const S = run.s; const out = new Set(); for (const id of S.alloc) for (const l of S.tree[id].links) if (!S.alloc.has(l)) out.add(l); return [...out].map(i => S.tree[i]); },
  onExit(next) { run.s.points += 2; this.alloc(next); },
  alloc(next) {
    const S = run.s;
    if (S.points <= 0) { next(); return; }
    const front = this.frontier().sort((a, b) => ({ key: 0, notable: 1, gem: 2, small: 3 }[a.type] - { key: 0, notable: 1, gem: 2, small: 3 }[b.type]));
    openChoice({ title: `Passive tree: ${S.points} point${S.points > 1 ? 's' : ''}`, sub: 'Gold = allocated, yellow outline = you can take it. Big circles are notables and keystones, squares are skill gems.', html: this.svg(), list: true,
      options: front.map(n => ({ name: `${n.type === 'key' ? '◆ ' : n.type === 'notable' ? '● ' : n.type === 'gem' ? '■ ' : ''}${n.name}`, desc: `${POE_BRANCHES[n.b].name} · ${n.desc}`, onPick: () => {
        S.alloc.add(n.id); S.points--; if (n.type !== 'small') addPerk(n.name, n.desc);
        if (n.gem) { const i = firstFreeSlot(); if (i >= 0) giveAbility(i, n.gem); else giveAbility(2, n.gem); }
        this.recompute(); this.alloc(next);
      } })).concat([{ name: `Save ${S.points} point${S.points > 1 ? 's' : ''} and continue`, onPick: next }]) });
  },
  hudLines() { const S = run.s; return [{ t: `Passives ${S.alloc.size - 1}${S.keys.size ? ' · ' + [...S.keys].map(k => S.tree.find(n => n.key === k).name).join(', ') : ''}`, c: '#fbbf24' }]; },
});

// ============================================================ 10. LEARN BY DOING
const SKILLS = {
  marksman: { name: 'Marksman', how: 'land hits', fx: L => mod('damage', { mul: 1 + 0.03 * L }, 'skill'), perk: 'Unlocks Phase Round (△)' },
  steady: { name: 'Steadiness', how: 'fire while braced', fx: L => mod('braceSpreadMul', { mul: Math.pow(0.96, L) }, 'skill'), perk: 'Braced shots pierce 1 enemy' },
  reflexes: { name: 'Reflexes', how: 'dodge', fx: L => mod('dodgeCooldown', { mul: Math.pow(0.95, L) }, 'skill'), perk: 'Dodging drops a decoy (6s cooldown)' },
  endurance: { name: 'Endurance', how: 'take damage', fx: L => mod('maxHp', { add: 6 * L }, 'skill'), perk: 'Second Wind: survive a lethal hit once per room' },
  sleight: { name: 'Sleight of Hand', how: 'reload (perfect counts ×3)', fx: L => { mod('reloadTime', { mul: Math.pow(0.96, L) }, 'skill'); mod('perfectLen', { add: 0.008 * L }, 'skill'); }, perk: 'Perfect reloads give 2s of free ammo' },
  athletics: { name: 'Athletics', how: 'move around', fx: L => mod('moveSpeed', { mul: 1 + 0.02 * L }, 'skill'), perk: 'Unlocks Blink (R1)' },
  demolition: { name: 'Demolition', how: 'use abilities', fx: L => { mod('cdr', { mul: Math.pow(0.96, L) }, 'skill'); mod('abilityPower', { mul: 1 + 0.03 * L }, 'skill'); }, perk: 'Grenade gets +1 charge' },
  composure: { name: 'Composure', how: 'kill from cover', fx: L => mod('maxArmor', { add: 4 * L }, 'skill'), perk: 'Cover kills restore 6 armor' },
};
defineSystem({ id: 'skyrim', name: 'Learn by Doing', inspo: 'Skyrim / Final Fantasy II', tagline: 'No menus at all. Each skill levels up from doing that thing, and level 5 unlocks a perk.',
  setup() {
    const S = run.s; S.sk = {}; for (const k in SKILLS) S.sk[k] = { L: 0, xp: 0 }; S.recent = null; S.secondWind = true; S.decoyT = 0;
    giveAbility(0, 'grenade');
    const gain = (k, v) => { const s = S.sk[k]; s.xp += v; let need = 8 + s.L * 7; while (s.xp >= need) { s.xp -= need; s.L++; need = 8 + s.L * 7; this.levelUp(k); } S.recent = k; S.recentT = 2; };
    S.gain = gain;
    Bus.on('hit', ev => { if (ev.source === 'bullet') gain('marksman', 1); });
    Bus.on('shot', () => { if (player.bracing) gain('steady', 0.6); });
    Bus.on('dodge', () => { gain('reflexes', 3); if (S.sk.reflexes.L >= 5 && S.decoyT <= 0) { S.decoyT = 6; castAbility('decoy', abilityCtx()); } });
    Bus.on('damaged', ev => gain('endurance', ev.dmg / 4));
    Bus.on('reload', ev => { gain('sleight', ev.perfect ? 6 : 2); if (ev.perfect && S.sk.sleight.L >= 5) addBuff('freeAmmo', 2, [], { flags: ['infiniteAmmo'], label: 'FREE AMMO', color: '#fde68a' }); });
    Bus.on('ability', () => gain('demolition', 3));
    Bus.on('kill', ev => { if (ev.hugging) { gain('composure', 4); if (S.sk.composure.L >= 5) addArmor(6); } if (ev.source === 'ability') gain('demolition', 3); });
    Bus.on('bullet', b => { if (player.bracing && S.sk.steady.L >= 5 && b.src === 'bullet') b.pierce += 1; });
    Bus.on('beforeDeath', ev => { if (S.sk.endurance.L >= 5 && S.secondWind) { S.secondWind = false; ev.cancel = true; player.hp = 1; healPlayer(30); floater(player.x, player.y - 50, 'SECOND WIND', '#4ade80', 1.5); } });
    Bus.on('roomBuild', () => { S.secondWind = true; });
    Bus.on('tick', ({ dt }) => { S.decoyT -= dt; S.recentT -= dt; if (player.moving) gain('athletics', hyp(player.vx, player.vy) * dt / 60); });
  },
  levelUp(k) {
    const S = run.s, L = S.sk[k].L; clearMods('skill'); for (const kk in SKILLS) if (S.sk[kk].L) SKILLS[kk].fx(S.sk[kk].L);
    floater(player.x, player.y - 50, `${SKILLS[k].name} ${L}`, '#c4b5fd', 1.4); sfx.level();
    if (L === 5) {
      floater(player.x, player.y - 68, 'PERK: ' + SKILLS[k].perk, '#fde68a', 2.5); addPerk(SKILLS[k].name + ' perk', SKILLS[k].perk);
      if (k === 'marksman') giveAbility(2, 'phaseRound'); if (k === 'athletics') giveAbility(1, 'blink');
      if (k === 'demolition' && player.slots[0]) { player.slots[0].maxCharges++; player.slots[0].charges++; }
    }
  },
  hudLines() {
    const S = run.s;
    return Object.entries(S.sk).filter(([k, s]) => s.L > 0 || s.xp > 0).map(([k, s]) => ({ t: `${SKILLS[k].name} ${s.L} ${'▮'.repeat(Math.floor(s.xp / (8 + s.L * 7) * 5))}${'▯'.repeat(5 - Math.floor(s.xp / (8 + s.L * 7) * 5))}`, c: S.recent === k && S.recentT > 0 ? '#fde68a' : '#cbd5e1' }));
  },
});

// ============================================================ 11. BORDERLANDS LOOT
const BL_TYPES = {
  Pistol: { damage: 30, fireRate: 6, magSize: 12, reloadTime: 1.1, spreadStill: 1, spreadMove: 6, bulletSpeed: 1500, bloomPerShot: 1.2 },
  SMG: { damage: 15, fireRate: 13, magSize: 36, reloadTime: 1.4, spreadStill: 2, spreadMove: 8, bulletSpeed: 1300, bloomPerShot: 0.6, heatPerShot: 0.03 },
  Rifle: { damage: 24, fireRate: 8, magSize: 26, reloadTime: 1.6 },
  Shotgun: { damage: 11, fireRate: 2, magSize: 6, reloadTime: 1.8, pellets: 7, spreadStill: 6, spreadMove: 10, bulletSpeed: 1200, range: 520, bloomPerShot: 2 },
  Sniper: { damage: 90, fireRate: 1.4, magSize: 5, reloadTime: 2.2, spreadStill: 0.3, spreadMove: 12, bulletSpeed: 2600, range: 1600, bloomPerShot: 4 },
};
const BL_MAKERS = {
  Jakobs: { col: '#b45309', desc: 'semi-auto, hits hard', fx: (s, f) => { s.damage *= 1.35; f.semi = true; } },
  Maliwan: { col: '#22d3ee', desc: 'always elemental', fx: (s, f) => { s.damage *= 0.9; s.bulletSpeed = (s.bulletSpeed || 1500) * 0.7; f.element = rpick(['fire', 'shock', 'slag']); } },
  Torgue: { col: '#ef4444', desc: 'explosive rounds', fx: (s, f) => { f.explode = 55; s.spreadStill = (s.spreadStill || 1.2) * 1.5; s.bulletSpeed = (s.bulletSpeed || 1500) * 0.6; } },
  Hyperion: { col: '#fde68a', desc: 'gets MORE accurate as you fire', fx: (s, f) => { f.reverseBloom = true; s.bloomMax = 10; s.bloomDecay = 18; } },
  Tediore: { col: '#a3e635', desc: 'reloading throws the gun as a grenade', fx: (s, f) => { f.tediore = true; s.reloadTime = (s.reloadTime || 1.6) * 0.7; } },
  Vladof: { col: '#dc2626', desc: 'huge fire rate and magazine', fx: (s, f) => { s.fireRate = (s.fireRate || 8) * 1.4; s.magSize = Math.round((s.magSize || 24) * 1.5); s.damage *= 0.85; } },
  Dahl: { col: '#65a30d', desc: 'burst fire while braced', fx: (s, f) => { f.burstBraced = true; s.spreadStill = (s.spreadStill || 1.2) * 0.8; } },
  Atlas: { col: '#94a3b8', desc: 'tracking rounds', fx: (s, f) => { f.homing = 2.5; s.damage *= 0.9; } },
};
const BL_RAR = [{ n: 'Common', c: '#e5e7eb', m: 1, w: 50 }, { n: 'Uncommon', c: '#4ade80', m: 1.12, w: 30 }, { n: 'Rare', c: '#60a5fa', m: 1.25, w: 14 }, { n: 'Epic', c: '#a855f7', m: 1.42, w: 5 }, { n: 'Legendary', c: '#f97316', m: 1.65, w: 1.2 }];
const BL_PREFIX = { Pistol: ['Hand Cannon', 'Pocket Rocket', 'Peashooter', 'Equalizer'], SMG: ['Hornet', 'Spitter', 'Chatterbox', 'Buzzsaw'], Rifle: ['Lancer', 'Warhorse', 'Sawtooth', 'Vanguard'], Shotgun: ['Boomstick', 'Thunderball', 'Door Knocker', 'Twelve Gauge'], Sniper: ['Longbow', 'Skullpiercer', 'Widowmaker', 'Far Sight'] };
function blGenGun(minRar = 0) {
  const type = rpick(Object.keys(BL_TYPES)), maker = rpick(Object.keys(BL_MAKERS));
  let tw = BL_RAR.reduce((s, r, i) => s + (i >= minRar ? r.w * (1 + (run.floor - 1) * 0.3 * i) : 0), 0), roll = Math.random() * tw, ri = minRar;
  for (let i = minRar; i < BL_RAR.length; i++) { roll -= BL_RAR[i].w * (1 + (run.floor - 1) * 0.3 * i); if (roll < 0) { ri = i; break; } }
  const s = { ...TUNE.weapon, ...BL_TYPES[type] }, f = {};
  BL_MAKERS[maker].fx(s, f);
  const rar = BL_RAR[ri]; s.damage *= rar.m * (1 + (run.floor - 1) * 0.1) * rand(0.92, 1.08); s.magSize = Math.round(s.magSize);
  if (ri === 4) { const u = rpick(['split', 'bottomless', 'homewrecker']); if (u === 'split') { s.pellets = (s.pellets || 1) * 3; s.spreadStill = (s.spreadStill || 1) + 3; f.unique = 'Splits every shot into three'; } if (u === 'bottomless') { f.infinite = true; f.unique = 'Never needs reloading'; } if (u === 'homewrecker') { f.explode = 110; f.unique = 'Massive explosions'; } }
  const name = `${rar.n === 'Common' ? '' : rar.n + ' '}${maker} ${rpick(BL_PREFIX[type])}`;
  return { name, type, maker, rar: ri, stats: s, flags: f, color: rar.c };
}
function blDesc(g) { const s = g.stats; return `${g.type} · ${Math.round(s.damage)}${s.pellets > 1 ? '×' + s.pellets : ''} dmg · ${s.fireRate.toFixed(1)}/s · mag ${s.magSize} · ${BL_MAKERS[g.maker].desc}${g.flags.element ? ' (' + g.flags.element + ')' : ''}${g.flags.unique ? ' · ★ ' + g.flags.unique : ''}`; }
defineSystem({ id: 'borderlands', name: 'Loot Guns', inspo: 'Borderlands / Diablo', tagline: 'Enemies drop procedurally generated guns. Each manufacturer has its own quirk. Carry two and swap with △.',
  setup() {
    const S = run.s; S.guns = [blGenGun(), null]; S.active = 0; S.guns[0].name = 'Starter ' + S.guns[0].name;
    giveAbility(0, 'overcharge'); giveAbility(1, 'grenade');
    player.slots[2] = { onUse: () => this.swap(), label: 'SWAP', sub: '' };
    this.equip();
    Bus.on('bullet', b => {
      const f = player.wflags; if (b.src !== 'bullet') return;
      if (f.explode) b.explode = { r: f.explode, dmg: 0.6, color: '#ef4444' };
      if (f.homing) b.homing = f.homing;
      if (f.element === 'fire') { b.onHit.burn = { dps: b.dmg * 0.4, t: 3 }; b.color = '#fb923c'; }
      if (f.element === 'shock') { b.onHit.stun = 0.15; b.color = '#38bdf8'; b.shock = true; }
      if (f.element === 'slag') { b.onHit.vuln = 4; b.color = '#c084fc'; }
    });
    Bus.on('hit', ev => { if (ev.source === 'bullet' && player.wflags.element === 'shock' && Math.random() < 0.3) { const t = nearestEnemy(ev.enemy.x, ev.enemy.y, 220, false, new Set([ev.enemy])); if (t) chain(t, 1, 200, ev.dmg * 0.5, { source: 'item', x0: ev.enemy.x, y0: ev.enemy.y, quiet: true }); } });
    Bus.on('reloadStart', ev => { if (player.wflags.tediore && !ev.jam) { const left = ev.magLeft, dmg = Math.max(20, left * stat('damage') * 0.8); lob(abilityCtx(), { radius: 100, color: '#a3e635', onLand: (x, y) => explode(x, y, 100, dmg, { source: 'item', color: '#a3e635' }) }); floater(player.x, player.y - 40, 'THROW!', '#a3e635', 0.6); } });
    Bus.on('kill', ev => { if (Math.random() < (ev.enemy.elite ? 1 : 0.16)) this.drop(ev.enemy.x, ev.enemy.y, blGenGun(ev.enemy.elite ? 2 : 0)); });
    Bus.on('roomClear', () => this.drop(ROOM_W - 120, ROOM_H / 2 - 120, blGenGun(1), true));
  },
  equip() { const S = run.s, g = S.guns[S.active]; setWeapon(g); player.weaponColor = g.color; if (g.flags.reverseBloom) player.bloom = stat('bloomMax'); player.slots[2].sub = S.guns[1 - S.active] ? 'other' : '—'; },
  swap() { const S = run.s; if (!S.guns[1 - S.active]) { sfx.click(); return; } S.guns[S.active].mag = player.mag; S.active = 1 - S.active; const g = S.guns[S.active]; setWeapon({ ...g, fill: g.mag == null }); if (g.mag != null) player.mag = g.mag; player.weaponColor = g.color; sfx.reload(); },
  drop(x, y, g, chest) {
    spawnPickup({ x, y, vx: 0, vy: 0, kind: 'gun', r: chest ? 16 : 10, gun: g, interact: (chest ? 'Chest: ' : 'Take ') + g.name,
      draw(p, bob) { ctx.save(); ctx.translate(p.x, p.y + bob); ctx.fillStyle = g.color; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ctx.fillRect(-12, -3, 24, 6); ctx.fillRect(-12, 0, 6, 8); if (chest) { ctx.strokeStyle = g.color; ctx.lineWidth = 2; ctx.strokeRect(-18, -14, 36, 28); } ctx.restore(); },
      onInteract: () => {
        const S = run.s;
        if (!S.guns[1]) { S.guns[1] = g; if (S.active === 1) this.equip(); }
        else { const old = S.guns[S.active]; this.drop(player.x + rand(-30, 30), player.y + rand(-30, 30), old); S.guns[S.active] = g; this.equip(); }
        player.slots[2].sub = S.guns[1] ? 'other' : '—';
        floater(player.x, player.y - 40, g.name, g.color, 1.5); addPerk(g.name); sfx.level();
      } });
  },
  hudLines() {
    const S = run.s, lines = [];
    S.guns.forEach((g, i) => { if (g) lines.push({ t: `${i === S.active ? '▶' : '  '} ${g.name}`, c: g.color }); });
    const near = run.nearInteract;
    if (near && near.gun) { lines.push({ t: `On ground: ${near.gun.name}`, c: near.gun.color }); lines.push({ t: blDesc(near.gun), c: '#cbd5e1' }); const cur = S.guns[S.active]; lines.push({ t: `Yours: ${blDesc(cur)}`, c: '#94a3b8' }); }
    return lines;
  },
});

// ============================================================ 12. NOITA WAND
const WAND_CARDS = {
  spark: { name: 'Spark Bolt', t: 'proj', desc: 'Fast, weak bolt.', dmg: 12, speed: 1500, delay: 0.05, color: '#c4b5fd' },
  arrow: { name: 'Magic Arrow', t: 'proj', desc: 'Strong, fast arrow.', dmg: 28, speed: 1900, delay: 0.1, color: '#e5e7eb' },
  bouncy: { name: 'Bouncing Burst', t: 'proj', desc: 'Bounces off walls 4 times.', dmg: 14, speed: 1300, delay: 0.04, bounce: 4, color: '#86efac' },
  orb: { name: 'Energy Orb', t: 'proj', desc: 'Slow, piercing orb.', dmg: 32, speed: 600, delay: 0.15, pierce: 3, w: 9, color: '#38bdf8' },
  firebolt: { name: 'Firebolt', t: 'proj', desc: 'Explodes and burns.', dmg: 20, speed: 1000, delay: 0.15, explode: 55, burn: true, color: '#fb923c' },
  chainsaw: { name: 'Chainsaw', t: 'proj', desc: 'Very short range, no cast delay. Speeds up the whole cast.', dmg: 9, speed: 1600, delay: -0.17, range: 130, color: '#f87171' },
  bomb: { name: 'Bomb', t: 'proj', desc: 'Slow lob with a big blast.', dmg: 60, speed: 450, delay: 0.4, explode: 110, range: 500, w: 10, color: '#facc15' },
  dmgplus: { name: 'Damage Plus', t: 'mod', desc: '+12 damage to the cast.', delay: 0.05 }, speedup: { name: 'Speed Up', t: 'mod', desc: '×1.6 projectile speed.', delay: 0 },
  homing: { name: 'Homing', t: 'mod', desc: 'Projectiles seek enemies.', delay: 0.05 }, pierce: { name: 'Piercing Shot', t: 'mod', desc: '+2 pierce.', delay: 0.05 },
  explosive: { name: 'Explosive', t: 'mod', desc: 'Projectiles explode (r 45).', delay: 0.1 }, heavy: { name: 'Heavy Shot', t: 'mod', desc: '×1.8 damage, ×0.6 speed.', delay: 0.15 },
  double: { name: 'Double Spell', t: 'multi', n: 2, desc: 'Casts the next 2 projectiles together.', delay: 0 }, triple: { name: 'Triple Spell', t: 'multi', n: 3, desc: 'Casts the next 3 projectiles together.', delay: 0.05 },
};
defineSystem({ id: 'noita', name: 'Wand Programming', inspo: 'Noita', tagline: "Your gun is a programmable wand. Cards fire in order. Modifiers and multicasts stack onto the next projectiles. Order is everything.",
  setup() { const S = run.s; S.cards = ['double', 'spark', 'spark', 'arrow']; S.cap = 4; S.delay = 0.12; S.recharge = 1.0; this.apply(); player.fireOverride = I => this.cast(); },
  apply() { const S = run.s; setWeapon({ name: 'Wand', stats: { magSize: S.cards.length, reloadTime: S.recharge, heatPerShot: 0 } }); player.mag = S.cards.length; },
  cast() {
    const S = run.s, P = player; if (P.fireCd > 0) return; if (P.mag <= 0) { startReload(); return; }
    let idx = S.cards.length - P.mag, draws = 1, delay = S.delay; const mods = [], projs = [];
    while (draws > 0 && idx < S.cards.length) {
      const id = S.cards[idx++], c = WAND_CARDS[id]; draws--; delay += c.delay || 0;
      if (c.t === 'mod') { mods.push(id); draws++; } else if (c.t === 'multi') draws += c.n; else projs.push(id);
    }
    P.mag = S.cards.length - idx;
    const spread = currentSpread(P) * DEG;
    projs.forEach((id, k) => {
      const c = WAND_CARDS[id]; let dmg = c.dmg, sp = c.speed, pierce = c.pierce || 0, homing = 0, explode = c.explode ? { r: c.explode, dmg: 0.8, color: c.color } : null;
      for (const m of mods) { if (m === 'dmgplus') dmg += 12; if (m === 'speedup') sp *= 1.6; if (m === 'homing') homing = 5; if (m === 'pierce') pierce += 2; if (m === 'explosive' && !explode) explode = { r: 45, dmg: 0.7 }; if (m === 'heavy') { dmg *= 1.8; sp *= 0.6; } }
      const a = P.aim + (Math.random() + Math.random() - 1) * spread + (k - (projs.length - 1) / 2) * 0.07;
      spawnPlayerBullet(a, { dmg: dmg * (stat('damage') / 24), speed: sp, pierce, homing, explode, bounce: c.bounce || 0, range: c.range || 1000, color: c.color, w: c.w || 3, onHit: c.burn ? { burn: { dps: 10, t: 3 } } : {} });
    });
    P.fireCd = Math.max(0.03, delay); P.sinceShot = 0; P.bloom = Math.min(stat('bloomMax'), P.bloom + stat('bloomPerShot') * Math.max(1, projs.length) * 0.7);
    run.stats.shots++; sfx.shot(); Bus.emit('shot', { angle: P.aim });
    if (P.mag <= 0) startReload();
  },
  wandHtml(hl = -1) { const S = run.s; return `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:6px 0">${S.cards.map((id, i) => { const c = WAND_CARDS[id]; const col = c.t === 'proj' ? '#60a5fa' : c.t === 'mod' ? '#4ade80' : '#facc15'; return `<div style="border:2px solid ${i === hl ? '#fbbf24' : col};border-radius:6px;padding:4px 6px;font-size:11px;background:#111827">${i + 1}. ${c.name}</div>`; }).join('')}${Array(Math.max(0, S.cap - S.cards.length)).fill('<div style="border:2px dashed #334155;border-radius:6px;padding:4px 10px;font-size:11px;color:#475569">empty</div>').join('')}</div><p class="muted">Blue = projectile · Green = modifier (applies to the whole cast) · Yellow = multicast. Cast delay ${S.delay.toFixed(2)}s · Recharge ${S.recharge.toFixed(2)}s (the reload; perfect reloads work)</p>`; },
  onExit(next) {
    const S = run.s, offers = sampleN(Object.keys(WAND_CARDS), 3, Math.random);
    const opts = offers.map(id => ({ name: WAND_CARDS[id].name, desc: WAND_CARDS[id].desc, tag: WAND_CARDS[id].t === 'proj' ? 'projectile' : WAND_CARDS[id].t === 'mod' ? 'modifier' : 'multicast', onPick: () => this.addCard(id, next) }));
    const up = rpick([{ name: 'Wand: +1 capacity', desc: 'One more card slot.', fx: () => S.cap++ }, { name: 'Wand: -25% recharge', desc: 'Faster reload.', fx: () => S.recharge *= 0.75 }, { name: 'Wand: -25% cast delay', desc: 'Faster casting.', fx: () => S.delay *= 0.75 }]);
    opts.push({ name: up.name, desc: up.desc, tag: 'wand', onPick: () => { up.fx(); this.apply(); this.arrange(next); } });
    openChoice({ title: 'New spell', html: this.wandHtml(), options: opts.concat([{ name: 'Just rearrange', onPick: () => this.arrange(next) }]) });
  },
  addCard(id, next) {
    const S = run.s;
    if (S.cards.length < S.cap) { S.cards.push(id); addPerk(WAND_CARDS[id].name); this.apply(); this.arrange(next); return; }
    openChoice({ title: 'Wand is full: replace which card?', html: this.wandHtml(), list: true, options: S.cards.map((c, i) => ({ name: `${i + 1}. ${WAND_CARDS[c].name}`, onPick: () => { S.cards[i] = id; addPerk(WAND_CARDS[id].name); this.apply(); this.arrange(next); } })).concat([{ name: 'Discard new card', onPick: () => this.arrange(next) }]) });
  },
  arrange(next, focus = 0) {
    const S = run.s, opts = [];
    S.cards.forEach((id, i) => { if (i > 0) opts.push({ name: `Move ${WAND_CARDS[id].name} left`, desc: `slot ${i + 1} → ${i}`, onPick: () => { [S.cards[i - 1], S.cards[i]] = [S.cards[i], S.cards[i - 1]]; this.arrange(next, Math.max(0, i - 2)); } }); });
    opts.push({ name: 'Done →', onPick: () => { this.apply(); next(); } });
    openChoice({ title: 'Arrange your wand', sub: 'Cards fire left to right. Put modifiers and multicasts BEFORE the projectiles they should affect.', html: this.wandHtml(), list: true, options: opts, focus: Math.min(focus, opts.length - 1) });
  },
  hudLines() { const S = run.s, i = S.cards.length - player.mag; return [{ t: 'Wand: ' + S.cards.map((id, k) => (k === i ? '▶' : '') + WAND_CARDS[id].name).join(' · '), c: '#c4b5fd' }]; },
});

// ============================================================ 13. CYBERWARE
const CYBER = {
  kiroshi: { slot: 'Ocular', name: 'Kiroshi Optics', cost: 2, desc: '+10% crit. Enemies you aim at get marked.' },
  coproc: { slot: 'Ocular', name: 'Ballistic Coprocessor', cost: 3, desc: 'Bullets ricochet off walls once.' },
  synaptic: { slot: 'Frontal Cortex', name: 'Synaptic Accelerator', cost: 4, desc: '-25% ability cooldowns.' },
  ram: { slot: 'Frontal Cortex', name: 'RAM Upgrade', cost: 3, desc: '+30% ability power.' },
  launcher: { slot: 'Arms', name: 'Projectile Launch System', cost: 4, desc: 'Grants Frag Grenade (L1).', ability: 'grenade' },
  gorilla: { slot: 'Arms', name: 'Gorilla Arms', cost: 3, desc: 'Grants Ground Slam (L1).', ability: 'groundSlam' },
  monowire: { slot: 'Arms', name: 'Monowire', cost: 4, desc: 'Grants Overload (L1).', ability: 'overload' },
  tendons: { slot: 'Legs', name: 'Reinforced Tendons', cost: 3, desc: '+1 dodge charge.' },
  lynx: { slot: 'Legs', name: 'Lynx Paws', cost: 2, desc: '+12% move speed, +40% braced move speed.' },
  bones: { slot: 'Skeleton', name: 'Titanium Bones', cost: 3, desc: '+30 max HP.' },
  lungs: { slot: 'Skeleton', name: 'Bionic Lungs', cost: 2, desc: '-30% dodge cooldown.' },
  subdermal: { slot: 'Integumentary', name: 'Subdermal Armor', cost: 3, desc: '+40 max armor.' },
  camo: { slot: 'Integumentary', name: 'Optical Camo', cost: 4, desc: 'Grants Tactical Cloak (R1).', ability: 'cloak' },
  sandy: { slot: 'Nervous System', name: 'Sandevistan', cost: 6, desc: 'Grants Adrenaline Rush slow-mo (△).', ability: 'adrenaline' },
  kerenzikov: { slot: 'Nervous System', name: 'Kerenzikov', cost: 3, desc: 'Dodging slows time for 1s.' },
  reflex: { slot: 'Nervous System', name: 'Reflex Tuner', cost: 3, desc: 'Below 30% HP, time slows for 3s (once per room).' },
  biomon: { slot: 'Circulatory', name: 'Biomonitor', cost: 3, desc: 'Below 30% HP, heal 35 (once per room).' },
  adrenal: { slot: 'Circulatory', name: 'Adrenal Booster', cost: 2, desc: 'Kills restore 5 armor.' },
};
const CYBER_SLOTS = ['Ocular', 'Frontal Cortex', 'Arms', 'Legs', 'Skeleton', 'Integumentary', 'Nervous System', 'Circulatory'];
const CYBER_ABILITY_SLOT = { Arms: 0, Integumentary: 1, 'Nervous System': 2 };
defineSystem({ id: 'cyber', name: 'Cyberware Capacity', inspo: 'Cyberpunk 2077 / Armored Core', tagline: 'Body slots plus a capacity budget. Collect chrome, then freely reinstall your whole build between rooms.',
  setup() {
    const S = run.s; S.stash = ['launcher', 'lynx']; S.inst = {}; S.cap = 8; S.flags = {};
    this.install('launcher'); this.install('lynx');
    const on = id => Object.values(S.inst).includes(id);
    Bus.on('tick', () => { if (on('kiroshi') && player.assistTarget) player.assistTarget.markT = Math.max(player.assistTarget.markT, 0.3); const low = player.hp < stat('maxHp') * 0.3 && !player.dead; if (low && on('reflex') && !S.flags.reflex) { S.flags.reflex = true; addTimeSlow(3, 0.3); floater(player.x, player.y - 50, 'REFLEX TUNER', '#38bdf8'); } if (low && on('biomon') && !S.flags.biomon) { S.flags.biomon = true; healPlayer(35); floater(player.x, player.y - 60, 'BIOMONITOR', '#4ade80'); } });
    Bus.on('bullet', b => { if (on('coproc') && b.src === 'bullet') b.bounce = (b.bounce || 0) + 1; });
    Bus.on('dodge', () => { if (on('kerenzikov')) addTimeSlow(1, 0.25); });
    Bus.on('kill', () => { if (on('adrenal')) addArmor(5, true); });
    Bus.on('roomBuild', () => { S.flags = {}; });
  },
  used() { return Object.values(run.s.inst).reduce((s, id) => s + CYBER[id].cost, 0); },
  install(id) { const S = run.s; S.inst[CYBER[id].slot] = id; this.recompute(); },
  recompute() {
    const S = run.s, on = id => Object.values(S.inst).includes(id); clearMods('cyber');
    if (on('kiroshi')) mod('critChance', { add: 0.1 }, 'cyber'); if (on('synaptic')) mod('cdr', { mul: 0.75 }, 'cyber'); if (on('ram')) mod('abilityPower', { mul: 1.3 }, 'cyber');
    if (on('tendons')) mod('dodgeCharges', { add: 1 }, 'cyber'); if (on('lynx')) { mod('moveSpeed', { mul: 1.12 }, 'cyber'); mod('braceSpeedMul', { mul: 1.4 }, 'cyber'); }
    if (on('bones')) mod('maxHp', { add: 30 }, 'cyber'); if (on('lungs')) mod('dodgeCooldown', { mul: 0.7 }, 'cyber'); if (on('subdermal')) mod('maxArmor', { add: 40 }, 'cyber');
    for (const [slot, i] of Object.entries(CYBER_ABILITY_SLOT)) { const id = S.inst[slot]; const ab = id && CYBER[id].ability; if (ab) { if (!player.slots[i] || player.slots[i].id !== ab) giveAbility(i, ab); } else player.slots[i] = null; }
    player.hp = Math.min(player.hp, stat('maxHp')); player.armor = Math.min(player.armor, stat('maxArmor'));
  },
  onExit(next) {
    const S = run.s; S.cap += 2;
    const offers = sampleN(Object.keys(CYBER).filter(k => !S.stash.includes(k)), 3, Math.random);
    openChoice({ title: 'Loot: new cyberware', sub: `Capacity is now ${S.cap}. New chrome goes to your stash.`, options: offers.map(k => ({ name: CYBER[k].name, desc: `${CYBER[k].slot} · cost ${CYBER[k].cost} · ${CYBER[k].desc}`, tag: CYBER[k].slot, onPick: () => { S.stash.push(k); addPerk(CYBER[k].name); this.ripper(next); } })) });
  },
  ripper(next, focus = 0) {
    const S = run.s, used = this.used(), opts = [];
    const html = `<div class="slotgrid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${CYBER_SLOTS.map(sl => `<div class="cell"><span class="muted">${sl}</span><b>${S.inst[sl] ? CYBER[S.inst[sl]].name : '—'}</b></div>`).join('')}</div><p>Capacity <b style="color:${used > S.cap ? '#f87171' : '#4ade80'}">${used} / ${S.cap}</b></p>`;
    for (const k of S.stash) {
      const c = CYBER[k], cur = S.inst[c.slot];
      if (cur === k) { opts.push({ name: `Uninstall ${c.name}`, desc: `${c.slot} · frees ${c.cost}`, onPick: () => { delete S.inst[c.slot]; this.recompute(); this.ripper(next, opts.length); } }); continue; }
      const after = used - (cur ? CYBER[cur].cost : 0) + c.cost;
      opts.push({ name: `Install ${c.name}`, desc: `${c.slot} · cost ${c.cost}${cur ? ' · replaces ' + CYBER[cur].name : ''} · ${c.desc}`, disabled: after > S.cap, onPick: () => { this.install(k); this.ripper(next, 0); } });
    }
    opts.push({ name: 'Leave the ripperdoc →', onPick: next });
    openChoice({ title: 'Ripperdoc', sub: 'Install anything from your stash as long as it fits your capacity. Swapping is free.', html, list: true, options: opts, focus: Math.min(focus, opts.length - 1) });
  },
  hudLines() { const S = run.s; return [{ t: `Chrome ${this.used()}/${S.cap}: ` + Object.values(S.inst).map(k => CYBER[k].name).join(', '), c: '#67e8f9' }]; },
});

// ============================================================ 14. STYLE METER + JOKERS
const RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'], RANK_AT = [0, 100, 250, 450, 700, 1000, 1400], RANK_COL = ['#94a3b8', '#60a5fa', '#4ade80', '#facc15', '#fb923c', '#f87171', '#f472b6'];
const JOKERS = {
  showboat: { name: 'Showboat', desc: 'Style ×1.5 while moving.', cost: 20 }, stoic: { name: 'Stoic', desc: "Style doesn't decay while braced.", cost: 20 },
  gunslinger: { name: 'Gunslinger', desc: 'Perfect reloads are worth as much style as kills.', cost: 15 }, glass: { name: 'Glass Joker', desc: 'Rank bonuses ×2, but any hit resets you to D.', cost: 25 },
  encore: { name: 'Encore', desc: 'Reaching SSS heals 25 HP (once per room).', cost: 20 }, crowd: { name: 'Crowd Pleaser', desc: 'Variety bonus doubled.', cost: 15 },
  bloodlust: { name: 'Bloodlust', desc: 'Kills at S rank or above heal 3 HP.', cost: 20 }, wallflower: { name: 'Wallflower', desc: 'Kills from cover give ×2 style.', cost: 15 },
  flourish: { name: 'Flourish', desc: 'Every dodge gives style (+30).', cost: 15 }, mult: { name: 'Mult Joker', desc: 'Rank thresholds -25%.', cost: 25 },
};
defineSystem({ id: 'style', name: 'Style Rank + Jokers', inspo: 'Devil May Cry × Balatro', tagline: 'A live D→SSS style meter buffs you, and variety scores more. Bank style to buy Jokers that change what counts as stylish.',
  setup() {
    const S = run.s; S.style = 0; S.rank = 0; S.bank = 0; S.jokers = []; S.recent = []; S.lastKill = -9; S.encore = false;
    giveAbility(0, 'grenade'); giveAbility(1, 'blink');
    const j = id => S.jokers.includes(id);
    const add = (type, v) => {
      let m = 1; const reps = S.recent.slice(-3).filter(t => t === type).length; m *= reps >= 2 ? 0.4 : reps === 1 ? 0.8 : 1;
      const uniq = new Set(S.recent.slice(-4)).size; if (!reps) m *= 1 + (j('crowd') ? 0.5 : 0.25) * (uniq / 4);
      if (j('showboat') && player.moving) m *= 1.5;
      S.recent.push(type); if (S.recent.length > 8) S.recent.shift();
      S.style += v * m; S.bank += v * m / 25; S.lastType = type; S.lastT = 1;
    };
    S.add = add;
    Bus.on('kill', ev => {
      let v = 60; if (ev.braced) add('braced kill', 40); if (ev.source === 'ability') v += 30; if (ev.dist > 600) add('long shot', 40); if (ev.hugging && j('wallflower')) v *= 2;
      if (time - S.lastKill < 1.2) add('multi kill', 80); S.lastKill = time;
      add(ev.source === 'ability' ? 'ability kill' : 'kill', v);
      if (j('bloodlust') && S.rank >= 4) healPlayer(3, true);
    });
    Bus.on('hit', ev => { if (ev.source === 'bullet') S.style += 3; });
    Bus.on('reload', ev => { if (ev.perfect) add('perfect reload', j('gunslinger') ? 60 : 40); });
    Bus.on('dodge', () => { const close = bullets.some(b => b.owner === 'enemy' && hyp(b.x - player.x, b.y - player.y) < 90); if (close) add('close call', 60); else if (j('flourish')) add('flourish', 30); });
    Bus.on('combo', () => add('combo', 70));
    Bus.on('damaged', () => { S.style = j('glass') ? 0 : S.style * 0.4; });
    Bus.on('roomBuild', () => { S.encore = false; });
  },
  update(dt) {
    const S = run.s, j = id => S.jokers.includes(id);
    if (!(j('stoic') && player.bracing)) S.style = Math.max(0, S.style - (10 + S.style * 0.06) * dt);
    S.lastT -= dt;
    const th = RANK_AT.map(v => v * (j('mult') ? 0.75 : 1)); let r = 0; for (let i = 0; i < th.length; i++) if (S.style >= th[i]) r = i;
    if (r !== S.rank) { if (r > S.rank) sfx.level(); S.rank = r; const k = j('glass') ? 2 : 1; clearMods('style'); mod('damage', { mul: 1 + 0.06 * r * k }, 'style'); mod('fireRate', { mul: 1 + 0.04 * r * k }, 'style'); if (r >= 4) mod('armorRegen', { add: 4 * k }, 'style'); if (r >= 6) mod('cdr', { mul: 0.5 }, 'style'); if (r === 6 && j('encore') && !S.encore) { S.encore = true; healPlayer(25); } }
  },
  drawHud(c, box) {
    const S = run.s, r = S.rank, th = RANK_AT.map(v => v * (S.jokers.includes('mult') ? 0.75 : 1)), next = th[r + 1] || th[r] * 1.3, f = clamp((S.style - th[r]) / (next - th[r]), 0, 1);
    const x = box.R - 70, y = ch * 0.38;
    c.textAlign = 'center'; c.font = `900 ${r >= 4 ? 46 : 38}px system-ui`; c.fillStyle = RANK_COL[r]; c.fillText(RANKS[r], x + 35, y);
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, y + 8, 70, 6); c.fillStyle = RANK_COL[r]; c.fillRect(x, y + 8, 70 * f, 6);
    if (S.lastT > 0) { c.font = 'bold 11px system-ui'; c.fillStyle = '#fde68a'; c.globalAlpha = S.lastT; c.fillText(S.lastType, x + 35, y + 28); c.globalAlpha = 1; }
  },
  onExit(next, focus = 0) {
    const S = run.s; if (!S.offers) S.offers = sampleN(Object.keys(JOKERS).filter(k => !S.jokers.includes(k)), 3, Math.random);
    const b = Math.floor(S.bank), opts = S.offers.map((k, i) => ({ name: `${JOKERS[k].name} · ★${JOKERS[k].cost}`, desc: JOKERS[k].desc, disabled: b < JOKERS[k].cost || S.jokers.length >= 5, onPick: () => { S.bank -= JOKERS[k].cost; S.jokers.push(k); S.offers.splice(i, 1); addPerk(JOKERS[k].name); this.onExit(next, i); } }));
    S.jokers.forEach((k, i) => opts.push({ name: `Sell ${JOKERS[k].name} (+★${Math.floor(JOKERS[k].cost / 2)})`, onPick: () => { S.bank += Math.floor(JOKERS[k].cost / 2); S.jokers.splice(i, 1); this.onExit(next, 0); } }));
    opts.push({ name: 'Leave →', onPick: () => { S.offers = null; next(); } });
    openChoice({ title: `Joker shop · ★ ${b} style banked`, sub: `Jokers (${S.jokers.length}/5): ${S.jokers.map(k => JOKERS[k].name).join(', ') || 'none'}. Style earned in a room gets banked.`, list: true, options: opts, focus: Math.min(focus, opts.length - 1) });
  },
  hudLines() { const S = run.s; return [{ t: `Style ${Math.floor(S.style)} · ★${Math.floor(S.bank)} banked`, c: RANK_COL[S.rank] }, ...(S.jokers.length ? [{ t: '🃏 ' + S.jokers.map(k => JOKERS[k].name).join(', '), c: '#fde68a' }] : [])]; },
});

// ============================================================ 15. SQUAD
const SQUADMATES = {
  vex: { name: 'Vex', role: 'Marksman', color: '#38bdf8', power: 'overload', dmg: 20, rate: 1.2, hp: 110, desc: 'Precise rifle shots. Power: Overload.' },
  mara: { name: 'Mara', role: 'Adept', color: '#a78bfa', power: 'warp', dmg: 10, rate: 3, hp: 100, desc: 'Biotic support. Power: Warp (detonates your primes).' },
  brick: { name: 'Brick', role: 'Vanguard', color: '#f59e0b', power: 'groundSlam', dmg: 9, rate: 1.5, pellets: 5, hp: 170, desc: 'Shotgun tank who pushes in. Power: Ground Slam.' },
  juno: { name: 'Juno', role: 'Engineer', color: '#34d399', power: 'turret', dmg: 8, rate: 3.5, hp: 110, desc: 'SMG and gadgets. Power: deploys a turret.' },
  kestrel: { name: 'Kestrel', role: 'Infiltrator', color: '#f472b6', power: 'incinerate', dmg: 30, rate: 0.8, hp: 90, desc: 'Sniper. Power: Incinerate.' },
};
function makeMate(id) {
  const d = SQUADMATES[id];
  return addAlly({ id, x: player.x, y: player.y + 30, r: 13, hp: d.hp, maxHp: d.hp, aggro: 0.9, persist: true, cd: 0, aim: 0, color: d.color, rank: 1, powerCd: 0, downed: false, revive: 0, side: Object.keys(run.s.mates || {}).length ? 1 : -1, hold: null,
    update(dt) {
      const P = player;
      if (this.downed) { if (hyp(P.x - this.x, P.y - this.y) < 50) { this.revive += dt; if (this.revive > 2) { this.downed = false; this.untargetable = false; this.hp = this.maxHp * 0.5; floater(this.x, this.y - 30, 'REVIVED', '#4ade80'); } } else this.revive = Math.max(0, this.revive - dt); return; }
      this.powerCd -= dt; this.cd -= dt;
      const goal = this.hold || { x: P.x - Math.cos(P.aim) * 60 + Math.cos(P.aim + Math.PI / 2) * 55 * this.side, y: P.y - Math.sin(P.aim) * 60 + Math.sin(P.aim + Math.PI / 2) * 55 * this.side };
      const dx = goal.x - this.x, dy = goal.y - this.y, dd = hyp(dx, dy), sp = 190;
      if (dd > 20) { this.vx = dx / dd * sp; this.vy = dy / dd * sp; } else { this.vx *= 0.8; this.vy *= 0.8; }
      this.x += this.vx * dt; this.y += this.vy * dt; for (const r of room.rects) circleRectResolve(this, r);
      const t = nearestEnemy(this.x, this.y, d.role === 'Vanguard' ? 400 : 800, true);
      if (t) { this.aim = Math.atan2(t.y - this.y, t.x - this.x); if (this.cd <= 0) { this.cd = 1 / d.rate * rand(0.85, 1.15); for (let k = 0; k < (d.pellets || 1); k++) { const a = this.aim + rand(-0.06, 0.06) * (d.pellets ? 3 : 1); addBullet({ x: this.x, y: this.y, vx: Math.cos(a) * 1400, vy: Math.sin(a) * 1400, owner: 'player', src: 'ally', dmg: d.dmg * (1 + 0.3 * (this.rank - 1)), color: d.color, w: 2, range: 900, ignore: [] }); } } }
    },
    onDeath() { this.dead = false; this.downed = true; this.untargetable = true; this.hp = 0; this.revive = 0; floater(this.x, this.y - 30, d.name + ' DOWN · stand near to revive', '#f87171', 2); },
    draw() { ctx.globalAlpha = this.downed ? 0.4 : 1; ctx.fillStyle = this.flash > 0 ? '#fff' : d.color; ctx.beginPath(); ctx.arc(this.x, this.y, 13, 0, TAU); ctx.fill(); ctx.strokeStyle = '#0b0d10'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + Math.cos(this.aim) * 20, this.y + Math.sin(this.aim) * 20); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#e5e7eb'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(d.name + (this.rank > 1 ? ' ' + this.rank : ''), this.x, this.y + 26); if (this.downed) { ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(this.x, this.y, 20, -Math.PI / 2, -Math.PI / 2 + TAU * this.revive / 2); ctx.stroke(); } } });
}
defineSystem({ id: 'squad', name: 'Squad Command', inspo: 'Mass Effect / Dragon Age', tagline: "You barely upgrade yourself. Recruit squadmates, rank them up, and fire THEIR powers with L1/R1 like ME's power wheel.",
  slotsAlways: true,
  setup() {
    const S = run.s; S.mates = {}; S.order = [];
    player.slots[0] = { onUse: () => this.command(0), label: '—', sub: '' }; player.slots[1] = { onUse: () => this.command(1), label: '—', sub: '' };
    player.slots[2] = { onUse: () => this.hold(), label: 'HOLD', sub: 'follow' };
    Bus.on('roomClear', () => { for (const a of allies) if (a.downed) { a.downed = false; a.untargetable = false; a.hp = a.maxHp * 0.5; } else if (a.id) a.hp = a.maxHp; });
    openChoice({ title: 'Recruit your first squadmate', options: sampleN(Object.keys(SQUADMATES), 3, Math.random).map(k => ({ name: `${SQUADMATES[k].name} (${SQUADMATES[k].role})`, desc: SQUADMATES[k].desc, onPick: () => { this.recruit(k); resumePlay(); } })) });
  },
  recruit(k) { const S = run.s; S.mates[k] = makeMate(k); S.order.push(k); addPerk(SQUADMATES[k].name); },
  command(i) {
    const S = run.s, k = S.order[i]; if (!k) return; const a = S.mates[k], d = SQUADMATES[k];
    if (a.downed || a.powerCd > 0) { sfx.click(); return; }
    const t = player.assistTarget || pickTarget(abilityCtx(), 900, 45) || nearestEnemy(a.x, a.y, 900, true);
    const ok = castAbility(d.power, { x: a.x, y: a.y, aim: t ? Math.atan2(t.y - a.y, t.x - a.x) : player.aim, power: 1 + 0.25 * (a.rank - 1), owner: 'ally', target: t });
    if (ok === false) { sfx.click(); return; }
    sfx.ability(); a.powerCd = ABILITIES[d.power].cd * (a.cdMul || 1) * 1.2; floater(a.x, a.y - 30, ABILITIES[d.power].name.toUpperCase(), d.color, 0.8);
  },
  hold() { const S = run.s, holding = S.order.some(k => S.mates[k].hold); for (const k of S.order) S.mates[k].hold = holding ? null : { ...aimPoint(abilityCtx(), 300) }; player.slots[2].sub = holding ? 'follow' : 'holding'; sfx.click(); },
  update() { const S = run.s; for (let i = 0; i < 2; i++) { const k = S.order[i], sl = player.slots[i]; if (!k) { sl.label = '—'; sl.sub = ''; continue; } const a = S.mates[k], d = SQUADMATES[k]; sl.label = ABILITIES[d.power].short; sl.color = d.color; sl.sub = a.downed ? 'DOWN' : a.powerCd > 0 ? a.powerCd.toFixed(1) : d.name; } },
  onExit(next) {
    const S = run.s, opts = [];
    if (S.order.length < 2 && run.roomIdx >= 1) { const k = rpick(Object.keys(SQUADMATES).filter(x => !S.mates[x])); opts.push({ name: `Recruit ${SQUADMATES[k].name}`, desc: `${SQUADMATES[k].role}. ${SQUADMATES[k].desc}`, tag: 'recruit', onPick: () => { this.recruit(k); next(); } }); }
    for (const k of S.order) { const a = S.mates[k]; opts.push({ name: `Train ${SQUADMATES[k].name} → rank ${a.rank + 1}`, desc: '+30% weapon damage, +25% power, +25 HP, -10% power cooldown.', tag: 'squad', onPick: () => { a.rank++; a.maxHp += 25; a.hp = a.maxHp; a.cdMul = (a.cdMul || 1) * 0.9; next(); } }); }
    opts.push(rewardOpt(rpick(statPool()), next));
    openChoice({ title: 'Squad debrief', sub: 'Upgrade your people.', options: sampleN(opts, 3, Math.random) });
  },
  hudLines() { const S = run.s; return S.order.map(k => { const a = S.mates[k]; return { t: `${SQUADMATES[k].name} R${a.rank} · ${a.downed ? 'DOWN' : Math.ceil(a.hp) + ' HP'}`, c: SQUADMATES[k].color }; }); },
});
