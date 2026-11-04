'use strict';
// =====================================================================
//  COVERFIRE PROGRESSION SYSTEMS 16-30
// =====================================================================

// ============================================================ 16. NEMESIS
const CAPTAIN_TRAITS = {
  ironclad: { name: 'Ironclad', enemy: 'Takes 50% less damage from the front', trophy: 'Take 25% less damage while braced' },
  regen: { name: 'Regenerator', enemy: 'Regenerates 4% HP per second', trophy: 'Regenerate 1.5 HP/s' },
  grenadier: { name: 'Grenadier', enemy: 'Lobs grenades at you', trophy: 'Gain Frag Grenade', ability: 'grenade' },
  blinker: { name: 'Blinker', enemy: 'Teleports away when hit', trophy: 'Gain Blink', ability: 'blink' },
  warlord: { name: 'Warlord', enemy: 'Calls 2 rushers at half HP', trophy: 'Gain Holo Decoy', ability: 'decoy' },
  deadeye: { name: 'Deadeye', enemy: 'Faster windup, +30% damage', trophy: '+20% crit chance' },
  berserker: { name: 'Berserker', enemy: 'Below 40% HP: much faster and more aggressive', trophy: '+40% damage while below 40% HP' },
  vampiric: { name: 'Vampiric', enemy: 'Heals when it damages you', trophy: '5% lifesteal' },
  shielded: { name: 'Shield Bearer', enemy: 'Invulnerable for 2.5s out of every 8s', trophy: 'Gain Tech Armor', ability: 'fortify' },
  marksman: { name: 'Marksman', enemy: 'Fights as a sniper', trophy: 'Gain Marksman Shot', ability: 'sniperShot' },
};
const CAPTAIN_WEAK = { fire: 'Burns deal ×3', ability: 'Abilities deal ×2', crit: 'Crits deal ×2', back: '×2 damage when it is not facing you' };
const CAP_FIRST = ['Ruk', 'Vorza', 'Hask', 'Mog', 'Teln', 'Kurga', 'Zarn', 'Ivek', 'Oskel', 'Brann', 'Dacha', 'Pell'];
const CAP_EPI = ['the Unkillable', 'Iron-Eye', 'the Flayer', 'Two-Shots', 'the Patient', 'Ash-Hand', 'the Coward', 'Bone-Grinder', 'the Collector', 'Quickfuse'];
defineSystem({ id: 'nemesis', name: 'Nemesis Trophies', inspo: 'Shadow of Mordor', tagline: 'Every room has a named Captain with traits and a weakness. Kill him to steal a trait. If he hurts you enough, he escapes and comes back stronger.',
  setup() {
    const S = run.s; S.trophies = []; S.pending = []; S.nemesis = null; S.cap = null;
    const isCap = e => e && e.data && e.data.captain;
    const has = (e, t) => isCap(e) && e.data.traits.includes(t);
    Bus.on('roomStart', () => this.spawnCaptain());
    Bus.on('beforeHit', ev => {
      const e = ev.enemy; if (!isCap(e)) return;
      if (has(e, 'shielded') && e.data.shieldOn) { ev.dmg = 0; sparks(e.x, e.y, '#93c5fd', 4); return; }
      const facing = Math.abs(angDiff(e.aim, Math.atan2(player.y - e.y, player.x - e.x))) < 1.0;
      if (has(e, 'ironclad') && facing && ev.source === 'bullet') ev.dmg *= 0.5;
      const w = e.data.weak;
      if (w === 'fire' && ev.source === 'dot') ev.dmg *= 3;
      if (w === 'ability' && (ev.source === 'ability' || ev.source === 'combo')) ev.dmg *= 2;
      if (w === 'crit' && ev.crit) ev.dmg *= 2;
      if (w === 'back' && !facing) ev.dmg *= 2;
    });
    Bus.on('hit', ev => { const e = ev.enemy; if (has(e, 'blinker') && (e.data.blinkCd || 0) <= 0 && !e.dead) { e.data.blinkCd = 2.5; for (let i = 0; i < 20; i++) { const x = rand(ROOM_W * 0.4, ROOM_W - 80), y = rand(80, ROOM_H - 80); if (!blocked(x, y, e.r + 4)) { burst(e.x, e.y, '#c4b5fd', 10, 150); e.x = x; e.y = y; e.state = 'move'; e.wantMove = true; break; } } } });
    Bus.on('enemyTick', ({ enemy: e, dt }) => {
      if (!isCap(e)) return; const d = e.data;
      d.blinkCd = (d.blinkCd || 0) - dt;
      if (has(e, 'regen')) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.04 * dt);
      if (has(e, 'grenadier')) { d.gT = (d.gT ?? 4) - dt; if (d.gT <= 0 && hasLOS(e.x, e.y, player.x, player.y) && !player.dead) { d.gT = 5; enemyGrenade(e.x, e.y, player.x + rand(-40, 40), player.y + rand(-40, 40), 30 * run.mods.enemyDmg * TUNE.enemy.damageMul); } }
      if (has(e, 'berserker') && e.hp < e.maxHp * 0.4) { e.speedMul = 1.6; e.windupMul = 0.55; e.shootTimer = Math.min(e.shootTimer, 0.6); }
      if (has(e, 'shielded')) { d.sT = (d.sT || 0) + dt; d.shieldOn = (d.sT % 8) > 5.5; }
      if (has(e, 'warlord') && !d.called && e.hp < e.maxHp * 0.5) { d.called = true; for (let i = 0; i < 2; i++) spawnEnemy('rusher', { x: e.x + rand(-60, 60), y: e.y + rand(-60, 60) }); floater(e.x, e.y - 40, 'TO ME!', '#facc15'); }
      if (d.hitsOnYou >= 2 && e.hp < e.maxHp * 0.35 && !d.escaped && !d.isNemesisFinal) {
        d.escaped = true; e.dead = true; burst(e.x, e.y, '#facc15', 20, 200);
        S.nemesis = { name: e.name, traits: d.traits.slice(), weak: d.weak, level: (d.level || 1) + 1, type: e.type };
        floater(e.x, e.y - 40, `${e.name} ESCAPED!`, '#facc15', 2.5); floaterScreen(`${e.name} escaped. He'll be back, and stronger.`);
      }
    });
    Bus.on('damaged', ev => { const sh = ev.source && ev.source.shooter; if (isCap(sh)) { sh.data.hitsOnYou = (sh.data.hitsOnYou || 0) + 1; if (has(sh, 'vampiric')) sh.hp = Math.min(sh.maxHp, sh.hp + ev.dmg * 2); } });
    Bus.on('kill', ev => { if (isCap(ev.enemy)) { const d = ev.enemy.data; S.pending.push({ name: ev.enemy.name, traits: d.traits, picks: d.level > 1 ? 2 : 1 }); floater(ev.enemy.x, ev.enemy.y - 40, `${ev.enemy.name} SLAIN`, '#facc15', 2); if (S.nemesis && S.nemesis.name === ev.enemy.name) S.nemesis = null; } });
    Bus.on('beforeDamage', ev => { if (S.trophies.includes('ironclad') && player.bracing) ev.dmg *= 0.75; });
    Bus.on('beforeHit', ev => { if (S.trophies.includes('berserker') && player.hp < stat('maxHp') * 0.4) ev.dmg *= 1.4; });
  },
  spawnCaptain() {
    const S = run.s; let c;
    if (S.nemesis) {
      const n = S.nemesis, extra = rpick(Object.keys(CAPTAIN_TRAITS).filter(t => !n.traits.includes(t)));
      c = { name: n.name, traits: n.traits.concat(extra ? [extra] : []), weak: n.weak, level: n.level, hpMul: 1 + 0.3 * (n.level - 1) };
      floaterScreen(`NEMESIS: ${n.name} returns (level ${n.level}) with ${CAPTAIN_TRAITS[extra]?.name || 'a grudge'}!`);
    } else {
      const k = 1 + (run.floor >= 2 ? 1 : 0) + (run.floor >= 4 ? 1 : 0);
      c = { name: `${rpick(CAP_FIRST)} ${rpick(CAP_EPI)}`, traits: sampleN(Object.keys(CAPTAIN_TRAITS), k, Math.random), weak: rpick(Object.keys(CAPTAIN_WEAK)), level: 1, hpMul: 1 };
    }
    const type = c.traits.includes('marksman') ? 'sniper' : 'rifleman';
    const e = spawnEnemy(type, { elite: true, name: c.name, hpMul: c.hpMul, dmgMul: c.traits.includes('deadeye') ? 1.3 : 1, color: '#eab308' });
    if (!e) return;
    e.data = { captain: true, traits: c.traits, weak: c.weak, level: c.level, hitsOnYou: 0, isNemesisFinal: c.level >= 3 };
    if (c.traits.includes('deadeye')) e.windupMul = 0.6;
    S.cap = e;
  },
  onExit(next) {
    const S = run.s, p = S.pending.shift();
    if (!p) { next(); return; }
    const opts = p.traits.filter(t => !S.trophies.includes(t)).map(t => ({ name: CAPTAIN_TRAITS[t].name, desc: CAPTAIN_TRAITS[t].trophy, tag: 'trophy', onPick: () => {
      S.trophies.push(t); addPerk(CAPTAIN_TRAITS[t].name + ' trophy', CAPTAIN_TRAITS[t].trophy);
      const after = () => { p.picks--; if (p.picks > 0 && p.traits.some(x => !S.trophies.includes(x))) { S.pending.unshift(p); } this.onExit(next); };
      if (t === 'regen') mod('hpRegen', { add: 1.5 }, 'trophy'); if (t === 'deadeye') mod('critChance', { add: 0.2 }, 'trophy'); if (t === 'vampiric') mod('lifesteal', { add: 0.05 }, 'trophy');
      if (CAPTAIN_TRAITS[t].ability) grantAbility(CAPTAIN_TRAITS[t].ability, after); else after();
    } }));
    if (!opts.length) { this.onExit(next); return; }
    openChoice({ title: `Trophy from ${p.name}`, sub: p.picks > 1 ? 'A Nemesis: you take 2 trophies.' : 'Take one of his traits.', options: opts });
  },
  hudLines() {
    const S = run.s, e = S.cap, lines = [];
    if (e && !e.dead) { lines.push({ t: `⚔ ${e.name}${e.data.level > 1 ? ' (NEMESIS L' + e.data.level + ')' : ''}`, c: '#facc15' }); lines.push(`Traits: ${e.data.traits.map(t => CAPTAIN_TRAITS[t].name).join(', ')}`); lines.push({ t: `Weakness: ${CAPTAIN_WEAK[e.data.weak]}`, c: '#4ade80' }); if (e.data.hitsOnYou >= 2) lines.push({ t: 'He will flee at low HP!', c: '#f87171' }); }
    else if (S.nemesis) lines.push({ t: `Nemesis at large: ${S.nemesis.name}`, c: '#f87171' });
    if (S.trophies.length) lines.push({ t: 'Trophies: ' + S.trophies.map(t => CAPTAIN_TRAITS[t].name).join(', '), c: '#fde68a' });
    return lines;
  },
});

// ============================================================ 17. TRAIT SYNERGIES
const SYN_TAGS = { Fire: '#fb923c', Tech: '#38bdf8', Biotic: '#a78bfa', Shadow: '#94a3b8', Iron: '#9ca3af', Hunter: '#4ade80' };
const SYN_BONUS = {
  Fire: ['15% burn chance', 'Burning enemies explode on death', 'Every hit ignites'],
  Tech: ['-15% cooldowns', '25% chance an ability use is free', 'A permanent gunner drone'],
  Biotic: ['+25% ability power', 'Bullets 12% chance to prime BIOTIC', 'Combos deal ×2 and refund 2s of cooldowns'],
  Shadow: ['Dodging cloaks you for 1s', 'Shots fired while cloaked deal ×2.5', 'Kills cloak you for 1.5s'],
  Iron: ['+25 max armor', '+4 armor regen/s', 'Take 50% less damage while hugging cover'],
  Hunter: ['+10% crit', 'Kills mark enemies within 300', 'Crits ricochet to another enemy'],
};
const SYN_ITEMS = [
  { name: 'Tracer Rounds', tags: ['Fire'], desc: '+6% damage', fx: () => mod('damage', { mul: 1.06 }, 'synitem') },
  { name: 'Napalm Mag', tags: ['Fire'], desc: '+10% burn chance', fx: () => mod('burnChance', { add: 0.1 }, 'synitem') },
  { name: 'Incinerator Module', tags: ['Fire', 'Tech'], desc: 'Grants Incinerate', ability: 'incinerate' },
  { name: 'Pyre Cell', tags: ['Fire', 'Biotic'], desc: '+15% ability power', fx: () => mod('abilityPower', { mul: 1.15 }, 'synitem') },
  { name: 'Targeting Chip', tags: ['Tech', 'Hunter'], desc: '+6% crit', fx: () => mod('critChance', { add: 0.06 }, 'synitem') },
  { name: 'Drone Core', tags: ['Tech'], desc: 'Grants Gunner Drone', ability: 'drone' },
  { name: 'Capacitor Bank', tags: ['Tech'], desc: '-10% cooldowns', fx: () => mod('cdr', { mul: 0.9 }, 'synitem') },
  { name: 'Overclock Chip', tags: ['Tech', 'Iron'], desc: '+10% fire rate', fx: () => mod('fireRate', { mul: 1.1 }, 'synitem') },
  { name: 'Biotic Amp', tags: ['Biotic'], desc: '+15% ability power', fx: () => mod('abilityPower', { mul: 1.15 }, 'synitem') },
  { name: 'Gravity Well', tags: ['Biotic'], desc: 'Grants Pull', ability: 'pull' },
  { name: 'Warp Rounds', tags: ['Biotic', 'Hunter'], desc: 'Bullets 8% chance to make enemies vulnerable', fx: () => {} },
  { name: 'Mind Lance', tags: ['Biotic', 'Shadow'], desc: 'Grants Dominate', ability: 'dominate' },
  { name: 'Silencer', tags: ['Shadow'], desc: '+10% damage, -10% bloom', fx: () => { mod('damage', { mul: 1.1 }, 'synitem'); mod('bloomPerShot', { mul: 0.9 }, 'synitem'); } },
  { name: 'Smoke Canister', tags: ['Shadow'], desc: 'Grants Smoke Bomb', ability: 'smoke' },
  { name: 'Cloak Field', tags: ['Shadow', 'Tech'], desc: 'Grants Tactical Cloak', ability: 'cloak' },
  { name: 'Assassin Blade', tags: ['Shadow', 'Hunter'], desc: '+40% crit damage', fx: () => mod('critMul', { add: 0.4 }, 'synitem') },
  { name: 'Plating', tags: ['Iron'], desc: '+20 armor', fx: () => mod('maxArmor', { add: 20 }, 'synitem') },
  { name: 'Sandbag Kit', tags: ['Iron'], desc: 'Grants Deployable Cover', ability: 'coverWall' },
  { name: 'Heavy Frame', tags: ['Iron'], desc: '+20 max HP, -5% speed', fx: () => { mod('maxHp', { add: 20 }, 'synitem'); mod('moveSpeed', { mul: 0.95 }, 'synitem'); } },
  { name: 'Reactive Armor', tags: ['Iron', 'Fire'], desc: '+2 armor regen', fx: () => mod('armorRegen', { add: 2 }, 'synitem') },
  { name: 'Scope', tags: ['Hunter'], desc: '-12% spread', fx: () => { mod('spreadStill', { mul: 0.88 }, 'synitem'); mod('spreadMove', { mul: 0.88 }, 'synitem'); } },
  { name: 'Pulse Blade', tags: ['Hunter', 'Tech'], desc: 'Grants Pulse Blade', ability: 'pulseScan' },
  { name: 'Long Barrel', tags: ['Hunter'], desc: '+8% damage, +15% bullet speed', fx: () => { mod('damage', { mul: 1.08 }, 'synitem'); mod('bulletSpeed', { mul: 1.15 }, 'synitem'); } },
  { name: 'Trophy Belt', tags: ['Hunter', 'Iron'], desc: 'Kills give 4 armor', fx: () => {} },
];
defineSystem({ id: 'synergy', name: 'Trait Synergies', inspo: 'Teamfight Tactics / Isaac transformations', tagline: 'Every item has tags. Collect 2/4/6 of a tag to switch on escalating set bonuses. Draft toward a theme or hedge.',
  setup() {
    const S = run.s; S.items = []; S.c = {};
    const t = (tag, n) => (S.c[tag] || 0) >= n;
    const own = name => S.items.includes(name);
    Bus.on('bullet', b => { if (b.src !== 'bullet') return; if (t('Biotic', 4) && Math.random() < 0.12) b.onHit.prime = 'biotic'; if (own('Warp Rounds') && Math.random() < 0.08) b.onHit.vuln = 4; if (t('Fire', 6)) b.onHit.burn = { dps: 10, t: 3 }; if (t('Shadow', 4) && hasFlag('cloak')) { b.dmg *= 2.5; b.color = '#f8fafc'; } });
    Bus.on('kill', ev => { const e = ev.enemy; if (t('Fire', 4) && e.burnT > 0) explode(e.x, e.y, 90, 40, { source: 'item', color: '#fb923c' }); if (t('Hunter', 4)) for (const o of enemiesNear(e.x, e.y, 300)) o.markT = Math.max(o.markT, 4); if (t('Shadow', 6)) addBuff('cloak', 1.5, [], { flags: ['cloak'], label: 'SHADOW', color: '#94a3b8' }); if (own('Trophy Belt')) addArmor(4, true); });
    Bus.on('dodge', () => { if (t('Shadow', 2)) addBuff('cloak', 1, [], { flags: ['cloak'], label: 'SHADOW', color: '#94a3b8' }); });
    Bus.on('ability', ev => { if (t('Tech', 4) && ev.ctx.slot && Math.random() < 0.25) { ev.ctx.slot.charges++; floater(player.x, player.y - 40, 'FREE', '#38bdf8', 0.6); } });
    Bus.on('beforeHit', ev => { if (t('Biotic', 6) && ev.source === 'combo') ev.dmg *= 2; });
    Bus.on('combo', () => { if (t('Biotic', 6)) reduceCooldowns(2); });
    Bus.on('hit', ev => { if (t('Hunter', 6) && ev.crit && ev.source === 'bullet') { const o = nearestEnemy(ev.enemy.x, ev.enemy.y, 300, false, new Set([ev.enemy])); if (o) { beam(ev.enemy.x, ev.enemy.y, o.x, o.y, '#4ade80', 2); hitEnemy(o, ev.dmg * 0.6, { source: 'item' }); } } });
    Bus.on('beforeDamage', ev => { if (t('Iron', 6) && player.hug.length) ev.dmg *= 0.5; });
    Bus.on('roomBuild', () => { if (t('Tech', 6) && !allies.some(a => a.synDrone)) { const d = makeDrone({ life: Infinity, persist: true, dmg: 10 }); d.synDrone = true; } });
  },
  recompute() {
    const S = run.s; S.c = {}; for (const n of S.items) for (const tg of SYN_ITEMS.find(i => i.name === n).tags) S.c[tg] = (S.c[tg] || 0) + 1;
    clearMods('syn'); const t = (tag, n) => (S.c[tag] || 0) >= n;
    if (t('Fire', 2)) mod('burnChance', { add: 0.15 }, 'syn'); if (t('Tech', 2)) mod('cdr', { mul: 0.85 }, 'syn'); if (t('Biotic', 2)) mod('abilityPower', { mul: 1.25 }, 'syn');
    if (t('Iron', 2)) mod('maxArmor', { add: 25 }, 'syn'); if (t('Iron', 4)) mod('armorRegen', { add: 4 }, 'syn'); if (t('Hunter', 2)) mod('critChance', { add: 0.1 }, 'syn');
    if (t('Tech', 6) && !allies.some(a => a.synDrone)) { const d = makeDrone({ life: Infinity, persist: true, dmg: 10 }); d.synDrone = true; }
  },
  countsHtml() { const S = run.s; return `<p>${Object.keys(SYN_TAGS).map(tg => `<span style="color:${SYN_TAGS[tg]};margin-right:10px"><b>${tg} ${S.c[tg] || 0}</b></span>`).join('')}</p><p class="muted">${Object.keys(SYN_TAGS).map(tg => `<span style="color:${SYN_TAGS[tg]}">${tg}</span>: ${SYN_BONUS[tg].map((b, i) => `${(i + 1) * 2}: ${b}`).join(' · ')}`).join('<br>')}</p>`; },
  onExit(next) {
    const S = run.s, pool = SYN_ITEMS.filter(i => !S.items.includes(i.name));
    openChoice({ title: 'Pick an item', html: this.countsHtml(), options: sampleN(pool, 3).map(it => ({ name: it.name, desc: `${it.tags.map(tg => `<b style="color:${SYN_TAGS[tg]}">${tg}</b>`).join(' + ')} · ${it.desc}`, onPick: () => {
      S.items.push(it.name); addPerk(it.name, it.desc); it.fx?.(); this.recompute();
      const reached = it.tags.filter(tg => [2, 4, 6].includes(S.c[tg])); for (const tg of reached) floaterScreen(`${tg} ${S.c[tg]}: ${SYN_BONUS[tg][S.c[tg] / 2 - 1]}`);
      if (it.ability) grantAbility(it.ability, next); else next();
    } })) });
  },
  hudLines() { const S = run.s; return Object.keys(SYN_TAGS).filter(tg => S.c[tg]).map(tg => ({ t: `${tg} ${S.c[tg]} ${'●'.repeat(Math.min(6, S.c[tg]))}${'○'.repeat(Math.max(0, (S.c[tg] >= 6 ? 6 : S.c[tg] >= 4 ? 6 : S.c[tg] >= 2 ? 4 : 2) - S.c[tg]))}`, c: SYN_TAGS[tg] })); },
});

// ============================================================ 18. BLOOD PRICE
const BLOOD_DEALS = [
  { name: 'Pact of Wrath', cost: 20, desc: '+40% damage', fx: () => mod('damage', { mul: 1.4 }) },
  { name: 'Second Heart', cost: 15, desc: '+60 max armor', fx: () => { mod('maxArmor', { add: 60 }); addArmor(60, true); } },
  { name: 'Blood Bullets', cost: 20, desc: 'Bullets pierce 2 enemies', fx: () => mod('pierce', { add: 2 }) },
  { name: 'Sanguine Bond', cost: 25, desc: '8% lifesteal', fx: () => mod('lifesteal', { add: 0.08 }) },
  { name: "Death's Head", cost: 20, desc: 'Kills heal 3 HP, +15% fire rate', fx: () => { mod('fireRate', { mul: 1.15 }); Bus.on('kill', () => healPlayer(3, true)); } },
  { name: 'Abyssal Rounds', cost: 30, desc: 'Fire 2 bullets per shot', fx: () => mod('pellets', { add: 1 }) },
  { name: 'Brimstone Eye', cost: 25, desc: 'Gain a +60% power Phase Round', ability: 'phaseRound', opts: { power: 1.6 } },
  { name: 'Hemomancy', cost: 10, desc: 'Gain a random ability. All abilities recharge almost instantly but cost 6 HP each.', fx: () => { mod('cdr', { mul: 0.1 }); Bus.on('beforeAbility', ev => { if (player.hp <= 7) ev.cancel = true; else player.hp -= 6; }); }, ability: 'random' },
  { name: 'Faustian Clock', cost: 15, desc: 'Every room starts with 4s of slowed time', fx: () => Bus.on('roomStart', () => addTimeSlow(4, 0.3)) },
  { name: 'Ritual Knife', cost: 15, desc: '+20% crit, +50% crit damage', fx: () => { mod('critChance', { add: 0.2 }); mod('critMul', { add: 0.5 }); } },
  { name: 'Bloodlust', cost: 20, desc: '+6% damage per 10% of HP you are missing', fx: () => Bus.on('beforeHit', ev => { ev.dmg *= 1 + 0.6 * (1 - player.hp / stat('maxHp')); }) },
  { name: 'Martyr', cost: 25, desc: 'Below 25% HP: time slows and you deal ×2 damage', fx: () => { Bus.on('beforeHit', ev => { if (player.hp < stat('maxHp') * 0.25) ev.dmg *= 2; }); Bus.on('tick', () => { if (player.hp < stat('maxHp') * 0.25 && !player.dead) enemyTime = Math.min(enemyTime, 0.5); }); } },
];
defineSystem({ id: 'blood', name: 'Blood Price', inspo: 'The Binding of Isaac (devil deals)', tagline: 'No gold, no medkits. Every upgrade costs MAX HP, permanently. How much of yourself will you sell?',
  setup() { run.noDrops = true; run.s.confess = 0; giveAbility(0, 'grenade'); Bus.on('floor', () => { run.s.confess = 0; }); },
  onExit(next) {
    const S = run.s, maxHp = stat('maxHp');
    const deals = sampleN(BLOOD_DEALS.filter(d => !run.perks.some(p => p.name === d.name)), 3);
    const opts = deals.map(d => ({ name: `${d.name} · ♥ -${d.cost} max HP`, desc: d.desc, disabled: maxHp - d.cost < 20, tag: 'devil deal', onPick: () => {
      mod('maxHp', { add: -d.cost }, 'blood'); player.hp = Math.min(player.hp, stat('maxHp')); addPerk(d.name, d.desc); d.fx?.(); sfx.hurt();
      if (d.ability) grantAbility(d.ability === 'random' ? rpick(DRAFTABLE) : d.ability, next, d.opts || {}); else next();
    } }));
    opts.push({ name: 'Confession', desc: 'Heal 35% of max HP (once per floor).', disabled: S.confess > 0, tag: 'angel', onPick: () => { S.confess++; healPlayer(maxHp * 0.35); next(); } });
    opts.push({ name: 'Walk away', onPick: next });
    openChoice({ title: 'The altar hungers', sub: `Max HP ${Math.round(maxHp)} · HP ${Math.ceil(player.hp)}`, options: opts });
  },
  hudLines() { const paid = -player.stats.mods.filter(m => m.source === 'blood').reduce((s, m) => s + m.add, 0); return paid ? [{ t: `Blood paid: ${paid} max HP`, c: '#f87171' }] : []; },
});

// ============================================================ 19. STREAK LADDER
const LADDER = {
  1: [{ name: 'Sharpened', desc: '+12% damage', fx: () => mod('damage', { mul: 1.12 }, 'ladder') }, { name: 'Light Feet', desc: '+12% move speed', fx: () => mod('moveSpeed', { mul: 1.12 }, 'ladder') }],
  2: [{ name: 'Sidestep', desc: '+1 dodge charge', fx: () => mod('dodgeCharges', { add: 1 }, 'ladder') }, { name: 'Speed Loader', desc: '-25% reload time', fx: () => mod('reloadTime', { mul: 0.75 }, 'ladder') }],
  3: [{ name: 'Scavenger', desc: 'Kills restore 6 armor', flag: 'scav' }, { name: 'Piercer', desc: 'Bullets pierce 1', fx: () => mod('pierce', { add: 1 }, 'ladder') }],
  4: [{ name: 'Frenzy', desc: '+25% fire rate', fx: () => mod('fireRate', { mul: 1.25 }, 'ladder') }, { name: 'Overclocked', desc: '-35% cooldowns', fx: () => mod('cdr', { mul: 0.65 }, 'ladder') }],
  5: [{ name: 'Killer Instinct', desc: '+25% crit', fx: () => mod('critChance', { add: 0.25 }, 'ladder') }, { name: 'Rhythm', desc: 'Perfect reload window ×2', fx: () => mod('perfectLen', { mul: 2 }, 'ladder') }],
  6: [{ name: 'Cataclysm', desc: 'Bullets explode', fx: () => mod('explodeRadius', { add: 55 }, 'ladder') }, { name: 'Endless', desc: 'Kills cut cooldowns by 1.5s', flag: 'endless' }],
};
defineSystem({ id: 'ladder', name: 'Streak Ladder', inspo: 'Downwell / no-hit ladders', tagline: 'Clear a room without taking HP damage to climb a tier and lock in a perk. HP damage drops you a tier, and perks above your tier switch off.',
  setup() {
    const S = run.s; S.tier = 0; S.chosen = {}; S.dropped = false; S.pending = 0; S.combo = 0; S.comboT = 0; S.flags = new Set();
    giveAbility(0, 'grenade');
    Bus.on('damaged', ev => { if (ev.hpDmg > 0 && !S.dropped) { S.dropped = true; if (S.tier > 0) { S.tier--; this.recompute(); floater(player.x, player.y - 50, `TIER ${S.tier}`, '#f87171', 1.5); } } S.combo = 0; });
    Bus.on('roomBuild', () => { S.dropped = false; });
    Bus.on('roomClear', () => { if (!S.dropped && S.tier < 6) { S.tier++; if (!S.chosen[S.tier]) S.pending = S.tier; this.recompute(); floater(player.x, player.y - 70, `CLEAN! TIER ${S.tier}`, '#4ade80', 2); } });
    Bus.on('kill', () => { S.combo = S.comboT > 0 ? S.combo + 1 : 1; S.comboT = 2.5; if (S.combo >= 5) addArmor(8, true); if (S.combo >= 8) healPlayer(5, true); if (S.flags.has('scav')) addArmor(6, true); if (S.flags.has('endless')) reduceCooldowns(1.5); });
  },
  update(dt) { run.s.comboT -= dt; if (run.s.comboT <= 0) run.s.combo = 0; },
  recompute() { const S = run.s; clearMods('ladder'); S.flags.clear(); for (let t = 1; t <= S.tier; t++) { const p = S.chosen[t]; if (!p) continue; p.fx?.(); if (p.flag) S.flags.add(p.flag); } },
  onExit(next) {
    const S = run.s;
    if (!S.pending) { next(); return; }
    const t = S.pending; S.pending = 0;
    openChoice({ title: `Tier ${t} perk`, sub: 'Locked in at this tier for the rest of the run. It only works while you are at this tier or higher.', options: LADDER[t].map(p => ({ name: p.name, desc: p.desc, tag: `tier ${t}`, onPick: () => { S.chosen[t] = p; addPerk(p.name, p.desc); this.recompute(); next(); } })) });
  },
  hudLines() {
    const S = run.s, lines = [{ t: `Tier ${S.tier}/6 ${S.dropped ? '(hit this room)' : '(clean so far)'}`, c: S.dropped ? '#f87171' : '#4ade80' }];
    for (let t = 6; t >= 1; t--) if (S.chosen[t]) lines.push({ t: `${t <= S.tier ? '■' : '□'} T${t} ${S.chosen[t].name}`, c: t <= S.tier ? '#fde68a' : '#475569' });
    if (S.combo > 1) lines.push({ t: `Combo ×${S.combo}`, c: '#f472b6' });
    return lines;
  },
});

// ============================================================ 20. BACKPACK
const BP = {
  rounds: { name: 'Sharp Rounds', type: 'weapon', desc: '+7% damage', fx: m => mod('damage', { mul: 1 + 0.07 * m }, 'bp') },
  trigger: { name: 'Hair Trigger', type: 'weapon', desc: '+6% fire rate', fx: m => mod('fireRate', { mul: 1 + 0.06 * m }, 'bp') },
  dagger: { name: 'Dagger', type: 'weapon', desc: '+6% damage per EMPTY side neighbor', special: 'dagger' },
  whetstone: { name: 'Whetstone', type: 'booster', desc: 'Side-adjacent WEAPON items ×1.5' },
  gem: { name: 'Power Gem', type: 'booster', desc: 'All 8 neighbors ×1.3' },
  battery: { name: 'Battery', type: 'booster', desc: 'Side-adjacent TECH items ×1.6' },
  mirror: { name: 'Mirror', type: 'booster', desc: 'Copies the item to its LEFT' },
  plate: { name: 'Iron Plate', type: 'armor', desc: '+12 max armor', fx: m => mod('maxArmor', { add: 12 * m }, 'bp') },
  heart: { name: 'Heart Jar', type: 'armor', desc: '+12 max HP', fx: m => mod('maxHp', { add: 12 * m }, 'bp') },
  feather: { name: 'Feather', type: 'trinket', desc: '+5% move speed', fx: m => mod('moveSpeed', { mul: 1 + 0.05 * m }, 'bp') },
  charm: { name: 'Lucky Charm', type: 'trinket', desc: '+6% crit', fx: m => mod('critChance', { add: 0.06 * m }, 'bp') },
  coolant: { name: 'Coolant Vial', type: 'trinket', desc: '-12% heat per shot', fx: m => mod('heatPerShot', { mul: Math.max(0.1, 1 - 0.12 * m) }, 'bp') },
  watch: { name: 'Stopwatch', type: 'trinket', desc: '-8% ability cooldowns', fx: m => mod('cdr', { mul: Math.max(0.2, 1 - 0.08 * m) }, 'bp') },
  idol: { name: 'Cursed Idol', type: 'trinket', desc: '+25% damage, but side neighbors ×0.5', special: 'idol' },
  satchel: { name: 'Grenade Satchel', type: 'tech', desc: 'Grants Frag Grenade (boost = power)', ability: 'grenade' },
  turretcase: { name: 'Turret Case', type: 'tech', desc: 'Grants Turret (boost = power)', ability: 'turret' },
  cloakdev: { name: 'Cloak Device', type: 'tech', desc: 'Grants Tactical Cloak', ability: 'cloak' },
  emitter: { name: 'Shield Emitter', type: 'tech', desc: 'Grants Bubble Shield', ability: 'bubble' },
};
defineSystem({ id: 'backpack', name: 'Backpack', inspo: 'Backpack Hero / Backpack Battles', tagline: 'Your build is a grid inventory. Boosters multiply their neighbors, daggers like empty space, idols curse their neighbors. Placement IS the build.',
  setup() { const S = run.s; S.w = 3; S.h = 3; S.cells = Array(9).fill(null); S.cells[4] = 'satchel'; S.cells[3] = 'rounds'; this.recompute(); },
  nb(i, diag) { const S = run.s, x = i % S.w, y = Math.floor(i / S.w), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (!diag && dx && dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < S.w && ny < S.h) out.push(ny * S.w + nx); } return out; },
  mults() {
    const S = run.s, C = S.cells, m = C.map(() => 1), eff = C.map((id, i) => id === 'mirror' ? (i % S.w > 0 && C[i - 1] && C[i - 1] !== 'mirror' ? C[i - 1] : null) : id);
    C.forEach((id, i) => {
      if (id === 'whetstone') this.nb(i).forEach(j => { if (eff[j] && BP[eff[j]].type === 'weapon') m[j] *= 1.5; });
      if (id === 'battery') this.nb(i).forEach(j => { if (eff[j] && BP[eff[j]].type === 'tech') m[j] *= 1.6; });
      if (id === 'gem') this.nb(i, true).forEach(j => { m[j] *= 1.3; });
      if (id === 'idol') this.nb(i).forEach(j => { m[j] *= 0.5; });
    });
    return { m, eff };
  },
  recompute() {
    const S = run.s, { m, eff } = this.mults(); clearMods('bp');
    const abil = [];
    eff.forEach((id, i) => {
      if (!id) return; const d = BP[id];
      if (d.fx) d.fx(m[i]);
      if (d.special === 'dagger') { const empty = this.nb(i).filter(j => !S.cells[j]).length; mod('damage', { mul: 1 + 0.06 * empty * m[i] }, 'bp'); }
      if (d.special === 'idol') mod('damage', { mul: 1.25 }, 'bp');
      if (d.ability && abil.length < 3) abil.push({ id: d.ability, power: m[i] });
    });
    for (let k = 0; k < 3; k++) { const a = abil[k], s = player.slots[k]; if (!a) { player.slots[k] = null; continue; } if (s && s.id === a.id) s.power = a.power; else giveAbility(k, a.id, { power: a.power }); }
    player.hp = Math.min(player.hp, stat('maxHp')); player.armor = Math.min(player.armor, stat('maxArmor'));
    S.m = m;
  },
  gridOptions(onCell, extra = []) {
    const S = run.s, m = S.m || [];
    return S.cells.map((id, i) => ({ name: id ? BP[id].name : '·', desc: id ? `${BP[id].type}${m[i] && m[i] !== 1 ? ' ×' + m[i].toFixed(2) : ''}` : 'empty', style: id ? '' : 'opacity:.6', onPick: () => onCell(i) })).concat(extra);
  },
  onExit(next) {
    const S = run.s, offers = sampleN(Object.keys(BP), 3, Math.random).map(k => ({ name: BP[k].name, desc: `${BP[k].type} · ${BP[k].desc}`, tag: BP[k].type, onPick: () => this.place(k, next) }));
    if (room.index % 3 === 0 && S.w * S.h < 16) offers.push({ name: 'Expand backpack', desc: S.w <= S.h ? 'Add a column.' : 'Add a row.', tag: 'bag', onPick: () => { this.expand(); next(); } });
    offers.push({ name: 'Rearrange only', onPick: () => this.rearrange(next) });
    openChoice({ title: 'Loot', options: offers });
  },
  expand() { const S = run.s, old = S.cells.slice(), ow = S.w, oh = S.h; if (S.w <= S.h) S.w++; else S.h++; S.cells = Array(S.w * S.h).fill(null); old.forEach((id, i) => { const x = i % ow, y = Math.floor(i / ow); S.cells[y * S.w + x] = id; }); this.recompute(); },
  place(k, next) {
    const S = run.s;
    openChoice({ title: `Place ${BP[k].name}`, sub: `${BP[k].desc}. Placing on an item replaces it.`, grid: S.w,
      options: this.gridOptions(i => { S.cells[i] = k; addPerk(BP[k].name); this.recompute(); this.rearrange(next); }, [{ name: '✖ Discard', desc: '', onPick: () => this.rearrange(next) }]) });
  },
  rearrange(next, from = null) {
    const S = run.s;
    openChoice({ title: from == null ? 'Backpack: pick an item to move, or finish' : `Move ${BP[S.cells[from]].name} where?`, sub: 'Numbers show each item\'s multiplier from its neighbors.', grid: S.w,
      options: this.gridOptions(i => { if (from == null) { if (S.cells[i]) this.rearrange(next, i); else this.rearrange(next); } else { [S.cells[i], S.cells[from]] = [S.cells[from], S.cells[i]]; this.recompute(); this.rearrange(next); } }, [{ name: 'Done →', desc: '', onPick: next }]) });
  },
  hudLines() { const S = run.s; const lines = []; for (let y = 0; y < S.h; y++) lines.push({ t: S.cells.slice(y * S.w, y * S.w + S.w).map(id => id ? BP[id].name.split(' ').map(w => w[0]).join('').padEnd(3, ' ') : ' · ').join('│'), c: '#cbd5e1' }); return lines; },
});

// ============================================================ 21. CONTRACTS
const CONTRACTS = [
  { id: 'marks', name: 'Marksman', desc: 'Kill 3 enemies while braced', prog: c => [c.bracedKills, 3] },
  { id: 'untouch', name: 'Untouchable', desc: 'Take no HP damage', final: true, fail: c => c.hpDmg > 0 },
  { id: 'speed', name: 'Blitz', desc: 'Clear the room in under 40s', final: true, fail: () => room.t > 40 },
  { id: 'mech', name: 'Mechanic', desc: 'Perfect reload twice', prog: c => [c.perfect, 2] },
  { id: 'entrench', name: 'Entrenched', desc: 'Get 3 kills while hugging cover', prog: c => [c.hugKills, 3] },
  { id: 'demo', name: 'Demolitions', desc: 'Get 2 ability kills', prog: c => [c.abilityKills, 2] },
  { id: 'double', name: 'Double Tap', desc: 'Kill 2 enemies within 1.5s', prog: c => [c.doubles, 1] },
  { id: 'frugal', name: 'Frugal', desc: 'Fire fewer than 45 shots', final: true, fail: c => c.shots >= 45 },
  { id: 'rng', name: 'Run & Gun', desc: 'Get 3 kills while moving', prog: c => [c.movingKills, 3] },
  { id: 'long', name: 'Long Shot', desc: 'Get 2 kills from 600+ away', prog: c => [c.longKills, 2] },
  { id: 'close', name: 'Close Quarters', desc: 'Get 2 kills within 200', prog: c => [c.closeKills, 2] },
  { id: 'cool', name: 'Trigger Discipline', desc: 'Never jam', final: true, fail: c => c.jams > 0 },
  { id: 'dodger', name: 'Dancer', desc: 'Dodge 5 times', prog: c => [c.dodges, 5] },
  { id: 'purist', name: 'Purist', desc: "Don't use abilities", final: true, fail: c => c.abilities > 0 },
];
defineSystem({ id: 'contracts', name: 'Contracts', inspo: 'Hitman / CoD challenges', tagline: 'Rewards ONLY come from completing objectives. Each room posts 3 contracts with their payouts visible. Play the way the contract asks.',
  setup() {
    const S = run.s; S.pendingRewards = [];
    giveAbility(0, 'grenade');
    const c = () => S.c;
    Bus.on('roomStart', () => {
      S.c = { bracedKills: 0, hpDmg: 0, perfect: 0, hugKills: 0, abilityKills: 0, doubles: 0, shots: 0, movingKills: 0, longKills: 0, closeKills: 0, jams: 0, dodges: 0, abilities: 0, lastKill: -9 };
      S.active = sampleN(CONTRACTS, 3, Math.random).map(k => ({ k, reward: Math.random() < 0.3 ? { ability: rpick(DRAFTABLE) } : { stat: rpick(statPool()) } }));
    });
    Bus.on('kill', ev => { const C = c(); if (!C) return; if (ev.braced) C.bracedKills++; if (ev.hugging) C.hugKills++; if (ev.source === 'ability' || ev.source === 'combo') C.abilityKills++; if (ev.moving) C.movingKills++; if (ev.dist > 600) C.longKills++; if (ev.dist < 200) C.closeKills++; if (time - C.lastKill < 1.5) C.doubles++; C.lastKill = time; });
    Bus.on('damaged', ev => { if (c()) c().hpDmg += ev.hpDmg; });
    Bus.on('reload', ev => { if (c() && ev.perfect) c().perfect++; });
    Bus.on('shot', () => { if (c()) c().shots++; });
    Bus.on('jam', () => { if (c()) c().jams++; });
    Bus.on('dodge', () => { if (c()) c().dodges++; });
    Bus.on('ability', () => { if (c()) c().abilities++; });
    Bus.on('roomClear', () => { S.done = S.active.filter(a => this.status(a) === 'done'); S.failed = S.active.length - S.done.length; S.pendingRewards = S.done.map(a => a.reward); });
  },
  status(a) { const C = run.s.c; if (!C) return '…'; if (a.k.fail && a.k.fail(C)) return 'fail'; if (a.k.final) return room.cleared ? 'done' : 'holding'; const [n, need] = a.k.prog(C); return n >= need ? 'done' : `${n}/${need}`; },
  rewardName(r) { return r.ability ? `${ABILITIES[r.ability].name} (ability)` : r.stat.name; },
  onExit(next) {
    const S = run.s, list = (S.done || []).map(a => `✓ ${a.k.name}: ${this.rewardName(a.reward)}`).join('<br>') || 'No contracts completed.';
    const pay = () => { const r = S.pendingRewards.shift(); if (!r) { next(); return; } if (r.ability) grantAbility(r.ability, pay); else { r.stat.apply(); addPerk(r.stat.name, r.stat.desc); pay(); } };
    openChoice({ title: `Contracts: ${(S.done || []).length}/3 complete`, html: `<p>${list}</p>`, options: [{ name: 'Collect & continue', onPick: pay }] });
  },
  hudLines() {
    const S = run.s; if (!S.active || !room.combat) return [];
    return S.active.map(a => { const st = this.status(a); const icon = st === 'done' ? '✓' : st === 'fail' ? '✗' : st === 'holding' ? '…' : st; return { t: `${icon} ${a.k.desc} → ${this.rewardName(a.reward)}`, c: st === 'done' ? '#4ade80' : st === 'fail' ? '#f87171' : '#cbd5e1' }; });
  },
});

// ============================================================ 22. WAGERS
const WAGERS = [
  { id: 'reinf', name: 'Reinforcements', desc: '+50% enemies', heat: 1, fx: () => { run.mods.enemyCount = 1.5; } },
  { id: 'elite', name: 'Elite Guard', desc: '+30% elite chance', heat: 2, fx: () => { run.mods.eliteChance = 0.3; } },
  { id: 'glass', name: 'Glass Jaw', desc: 'You take +50% damage', heat: 2, fx: () => mod('damageTaken', { mul: 1.5 }, 'wager') },
  { id: 'hell', name: 'Bullet Hell', desc: 'Enemy bullets +40% faster', heat: 1, fx: () => { run.mods.enemyBulletSpeed = 1.4; } },
  { id: 'shaky', name: 'Shaky Hands', desc: 'Brace (L2) disabled', heat: 2, fx: () => addBuff('shaky', 9999, [], { flags: ['noBrace'], label: false }) },
  { id: 'blackout', name: 'Blackout', desc: 'View range -30%', heat: 1, fx: () => mod('viewMul', { mul: 0.7 }, 'wager') },
  { id: 'timer', name: 'Hourglass', desc: 'Clear within 45s or lose 25 HP', heat: 2, fx: () => { run.s.timer = 45; } },
  { id: 'hardened', name: 'Hardened', desc: 'Enemies have +40% HP', heat: 1, fx: () => { run.mods.enemyHp = 1.4; } },
  { id: 'ammo', name: 'Ammo Shortage', desc: 'Magazine -40%', heat: 1, fx: () => mod('magSize', { mul: 0.6 }, 'wager') },
];
defineSystem({ id: 'wagers', name: 'Wagers', inspo: 'Hades (Pact of Punishment) / Hitman', tagline: 'Before each room, stack handicaps on yourself. More heat means more and better reward picks afterward. You set your own difficulty.',
  setup() { const S = run.s; S.sel = new Set(); S.heat = 0; S.timer = 0; giveAbility(0, 'grenade'); Bus.on('tick', ({ dt }) => { if (S.timer > 0 && room.combat && !room.cleared) { S.timer -= dt; if (S.timer <= 0) { damagePlayer(25 / stat('damageTaken')); floater(player.x, player.y - 50, 'TIME UP', '#f87171'); } } }); },
  preRoom(go, focus = 0) {
    const S = run.s, heat = [...S.sel].reduce((s, id) => s + WAGERS.find(w => w.id === id).heat, 0), picks = 1 + Math.floor(heat / 2);
    const opts = WAGERS.map((w, i) => ({ name: `${S.sel.has(w.id) ? '☑' : '☐'} ${w.name} (+${w.heat} heat)`, desc: w.desc, onPick: () => { S.sel.has(w.id) ? S.sel.delete(w.id) : S.sel.add(w.id); this.preRoom(go, i); } }));
    opts.push({ name: `Enter room → heat ${heat}: ${picks} reward pick${picks > 1 ? 's' : ''}${heat >= 3 ? ' + ability draft' : ''}`, onPick: () => {
      clearMods('wager'); removeBuff('shaky'); run.mods = { enemyHp: 1, enemyDmg: 1, enemyCount: 1, enemyBulletSpeed: 1, eliteChance: 0 }; S.timer = 0;
      for (const id of S.sel) WAGERS.find(w => w.id === id).fx();
      S.heat = heat; resumePlay(); go();
    } });
    openChoice({ title: 'Wager', sub: 'Toggle handicaps for the NEXT room only. Your rewards scale with total heat.', list: true, options: opts, focus });
  },
  onExit(next) {
    const S = run.s; let picks = 1 + Math.floor(S.heat / 2); const ab = S.heat >= 3;
    const loop = () => { if (picks <= 0) { if (ab) { abilityDraft(next, `Heat ${S.heat} bonus: pick an ability`); } else next(); return; } picks--; statDraft(loop, `Heat ${S.heat} reward (${picks + 1} left)`, S.heat >= 4 ? 4 : 3); };
    loop();
  },
  hudLines() { const S = run.s; const l = []; if (S.sel.size) l.push({ t: `Heat ${S.heat}: ${[...S.sel].map(id => WAGERS.find(w => w.id === id).name).join(', ')}`, c: '#fb923c' }); if (S.timer > 0 && room.combat && !room.cleared) l.push({ t: `⏳ ${S.timer.toFixed(1)}s`, c: S.timer < 10 ? '#f87171' : '#fde68a' }); return l; },
});

// ============================================================ 23. GUN GAME
const GG = [
  { name: 'Pea Shooter', stats: { damage: 22, fireRate: 5, magSize: 12, reloadTime: 1.0, spreadMove: 6 }, flags: { semi: true } },
  { name: 'Machine Pistol', stats: { damage: 12, fireRate: 14, magSize: 30, reloadTime: 1.2, spreadStill: 2.2, bloomPerShot: 0.6, heatPerShot: 0.03 } },
  { name: 'Pump Shotgun', stats: { damage: 12, fireRate: 1.6, magSize: 6, pellets: 8, spreadStill: 6, spreadMove: 10, range: 520, reloadTime: 2 } },
  { name: 'Carbine', stats: { damage: 24, fireRate: 8, magSize: 30 } },
  { name: 'Battle Rifle', stats: { damage: 48, fireRate: 4, magSize: 20, spreadStill: 0.6 }, flags: { semi: true } },
  { name: 'Sniper Rifle', stats: { damage: 120, fireRate: 1.2, magSize: 5, spreadStill: 0.2, spreadMove: 14, bulletSpeed: 2800, range: 1600 }, flags: { semi: true } },
  { name: 'LMG', stats: { damage: 20, fireRate: 11, magSize: 100, reloadTime: 3.2, bloomPerShot: 0.5, heatPerShot: 0.012, braceSpreadMul: 0.3 } },
  { name: 'Auto Shotgun', stats: { damage: 10, fireRate: 4, magSize: 12, pellets: 6, spreadStill: 7, spreadMove: 11, range: 500 } },
  { name: 'Grenade Launcher', stats: { damage: 55, fireRate: 1.5, magSize: 6, bulletSpeed: 700, range: 600 }, flags: { explode: 110 } },
  { name: 'Railgun', stats: { damage: 150, fireRate: 0.9, magSize: 4, bulletSpeed: 3500, spreadStill: 0, range: 2000 }, flags: { semi: true, pierce: 99 } },
  { name: 'Flak Cannon', stats: { damage: 14, fireRate: 2, magSize: 8, pellets: 7, spreadStill: 5, range: 700 }, flags: { explode: 40 } },
  { name: 'Golden Gun', stats: { damage: 999, fireRate: 1, magSize: 1, reloadTime: 2.5, spreadStill: 0.2 }, flags: { semi: true } },
];
defineSystem({ id: 'gungame', name: 'Gun Game', inspo: 'Counter-Strike Arms Race / Gun Game', tagline: 'Every 2 kills swap you to the next gun on a 12-gun ladder. Finish the Golden Gun to prestige. Rewards bend the ladder.',
  setup() {
    const S = run.s; S.rung = 0; S.kills = 0; S.quota = 2; S.prestige = 0; S.pinned = false; S.gunBonus = 1;
    giveAbility(0, 'grenade'); this.equip();
    Bus.on('kill', () => { if (S.pinned) return; S.kills++; if (S.kills >= S.quota) { S.kills = 0; this.advance(1); } });
    Bus.on('bullet', b => { const f = player.wflags; if (b.src !== 'bullet') return; if (f.explode) b.explode = { r: f.explode, dmg: 0.7 }; if (f.pierce) b.pierce = f.pierce; b.dmg *= S.gunBonus; });
    Bus.on('roomBuild', () => { if (S.pinNext) { S.pinned = true; S.pinNext = false; } else S.pinned = false; });
  },
  advance(n) {
    const S = run.s; S.rung += n;
    if (S.rung >= GG.length) { S.rung = 0; S.prestige++; mod('damage', { mul: 1.15 }, 'prestige'); floaterScreen(`PRESTIGE ${S.prestige}! +15% damage forever`); addPerk('Prestige ' + S.prestige); }
    this.equip(); floater(player.x, player.y - 50, GG[S.rung].name.toUpperCase(), '#fde68a', 1.4); sfx.level();
  },
  equip() { const g = GG[run.s.rung]; setWeapon({ name: g.name, stats: { ...TUNE.weapon, ...g.stats }, flags: g.flags || {} }); player.weaponColor = run.s.rung === GG.length - 1 ? '#facc15' : '#e5e7eb'; },
  onExit(next) {
    const S = run.s, opts = [
      { name: 'Skip a rung', desc: `Jump to ${GG[(S.rung + 1) % GG.length].name}.`, onPick: () => { this.advance(1); next(); } },
      { name: 'Pin this gun', desc: `Keep the ${GG[S.rung].name} for the whole next room (kills don't advance).`, onPick: () => { S.pinNext = true; next(); } },
      { name: 'Gunsmith', desc: '+20% damage for every gun on the ladder.', onPick: () => { S.gunBonus *= 1.2; addPerk('Gunsmith'); next(); } },
    ];
    if (S.quota > 1) opts.push({ name: 'Faster ladder', desc: 'Only 1 kill per rung from now on.', onPick: () => { S.quota = 1; addPerk('Faster ladder'); next(); } });
    if (S.quota === 1) opts.push({ name: 'Slower ladder', desc: 'Back to 2 kills per rung (more time with each gun).', onPick: () => { S.quota = 2; next(); } });
    opts.push(rewardOpt(rpick(statPool()), next));
    openChoice({ title: 'Armory', sub: `Rung ${S.rung + 1}/12: ${GG[S.rung].name}. Prestige ${S.prestige}.`, options: sampleN(opts, 3, Math.random) });
  },
  hudLines() { const S = run.s; return [{ t: `Rung ${S.rung + 1}/12 · ${GG[S.rung].name} · ${S.pinned ? 'PINNED' : `${S.kills}/${S.quota} kills`}`, c: '#fde68a' }, { t: `Next: ${GG[(S.rung + 1) % GG.length].name}${S.prestige ? ` · Prestige ${S.prestige}` : ''}`, c: '#94a3b8' }]; },
});

// ============================================================ 24. LINEAGE
const HEIR_CLASSES = {
  knight: { name: 'Knight', abil: ['fortify', 'groundSlam'], fx: () => mod('maxHp', { add: 30 }, 'heir') },
  mage: { name: 'Mage', abil: ['warp', 'pull'], fx: () => mod('abilityPower', { mul: 1.2 }, 'heir') },
  ranger: { name: 'Ranger', abil: ['phaseRound', 'blink'], fx: () => mod('critChance', { add: 0.08 }, 'heir') },
  engineer: { name: 'Engineer', abil: ['turret', 'mine'], fx: () => mod('cdr', { mul: 0.85 }, 'heir') },
  assassin: { name: 'Assassin', abil: ['cloak', 'lightsOut'], fx: () => mod('damage', { mul: 1.1 }, 'heir') },
  barbarian: { name: 'Barbarian', abil: ['charge', 'rally'], fx: () => mod('maxArmor', { add: 25 }, 'heir') },
};
const HEIR_TRAITS = [
  { name: 'Near-Sighted', desc: "Can't see far (smaller view)", fx: () => mod('viewMul', { mul: 0.75 }, 'heir') },
  { name: 'Far-Sighted', desc: 'Huge view, shakier aim', fx: () => { mod('viewMul', { mul: 1.3 }, 'heir'); mod('spreadStill', { add: 1.5 }, 'heir'); } },
  { name: 'Gigantism', desc: 'Huge: +40 HP, -10% speed, bigger target', fx: () => { mod('radiusMul', { mul: 1.4 }, 'heir'); mod('maxHp', { add: 40 }, 'heir'); mod('moveSpeed', { mul: 0.9 }, 'heir'); } },
  { name: 'Dwarfism', desc: 'Tiny: -20 HP, +10% speed, harder to hit', fx: () => { mod('radiusMul', { mul: 0.7 }, 'heir'); mod('maxHp', { add: -20 }, 'heir'); mod('moveSpeed', { mul: 1.1 }, 'heir'); } },
  { name: 'Hyperactive', desc: '+25% speed, +25% bloom', fx: () => { mod('moveSpeed', { mul: 1.25 }, 'heir'); mod('bloomPerShot', { mul: 1.25 }, 'heir'); } },
  { name: 'Colorblind', desc: 'The world is grayscale', filter: 'grayscale(1)' },
  { name: 'Nostalgic', desc: 'Everything is sepia', filter: 'sepia(0.85)' },
  { name: 'Vertigo', desc: 'Colors are all wrong', filter: 'hue-rotate(150deg)' },
  { name: 'Glass Bones', desc: 'Deal +25%, take +25%', fx: () => { mod('damage', { mul: 1.25 }, 'heir'); mod('damageTaken', { mul: 1.25 }, 'heir'); } },
  { name: 'Lucky', desc: '+12% crit', fx: () => mod('critChance', { add: 0.12 }, 'heir') },
  { name: 'Clumsy', desc: 'Fumbles cost double, but reloads are 20% faster', fx: () => { mod('fumblePenalty', { mul: 2 }, 'heir'); mod('reloadTime', { mul: 0.8 }, 'heir'); } },
  { name: 'Trigger Happy', desc: '+30% fire rate, +40% heat', fx: () => { mod('fireRate', { mul: 1.3 }, 'heir'); mod('heatPerShot', { mul: 1.4 }, 'heir'); } },
  { name: 'Stoic', desc: '+20 armor, -10% fire rate', fx: () => { mod('maxArmor', { add: 20 }, 'heir'); mod('fireRate', { mul: 0.9 }, 'heir'); } },
];
const MANOR = {
  hp: { name: 'Barracks', desc: '+10 max HP', base: 40, fx: n => mod('maxHp', { add: 10 * n }, 'manor') },
  dmg: { name: 'Armory', desc: '+5% damage', base: 50, fx: n => mod('damage', { mul: 1 + 0.05 * n }, 'manor') },
  armor: { name: 'Smithy', desc: '+10 max armor', base: 40, fx: n => mod('maxArmor', { add: 10 * n }, 'manor') },
  cdr: { name: 'Library', desc: '-5% cooldowns', base: 60, fx: n => mod('cdr', { mul: Math.pow(0.95, n) }, 'manor') },
  gold: { name: 'Vault', desc: '+15% gold', base: 50, fx: n => mod('goldMul', { mul: 1 + 0.15 * n }, 'manor') },
  rof: { name: 'Shooting Range', desc: '+4% fire rate', base: 50, fx: n => mod('fireRate', { mul: 1 + 0.04 * n }, 'manor') },
};
const HEIR_NAMES = ['Sir Aldous', 'Lady Wren', 'Sir Corwin', 'Lady Isolde', 'Sir Bram', 'Lady Mira', 'Sir Tobin', 'Lady Sable', 'Sir Edric', 'Lady Hale'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
defineSystem({ id: 'lineage', name: 'Lineage', inspo: 'Rogue Legacy', tagline: 'Meta-progression. Pick an heir with random genetic traits. Gold you earn is banked when you die and builds up the family manor across runs.',
  setup() {
    const L = store('lineage') || { gold: 0, gen: 0, up: {} }; run.s.L = L; run.useGold = true;
    Bus.on('runEnd', () => { L.gold += Math.floor(run.gold); L.gen++; store('lineage', L); run.s.banked = Math.floor(run.gold); });
    const heirs = [0, 1, 2].map(() => { const cls = rpick(Object.keys(HEIR_CLASSES)); return { name: `${rpick(HEIR_NAMES)} ${ROMAN[L.gen % ROMAN.length]}`, cls, traits: sampleN(HEIR_TRAITS, Math.random() < 0.5 ? 1 : 2, Math.random) }; });
    openChoice({ title: `Choose an heir · generation ${L.gen + 1}`, sub: `Estate gold: ${L.gold}`, options: heirs.map(h => ({ name: `${h.name} the ${HEIR_CLASSES[h.cls].name}`, desc: `Abilities: ${HEIR_CLASSES[h.cls].abil.map(a => ABILITIES[a].name).join(', ')}<br>${h.traits.map(t => `<b style="color:#fde68a">${t.name}</b>: ${t.desc}`).join('<br>')}`, onPick: () => {
      HEIR_CLASSES[h.cls].fx(); HEIR_CLASSES[h.cls].abil.forEach((a, i) => giveAbility(i, a));
      const filters = []; for (const t of h.traits) { t.fx?.(); if (t.filter) filters.push(t.filter); addPerk(t.name, t.desc); }
      run.renderFilter = filters.join(' ') || null; run.s.heir = h; addPerk(h.name);
      this.manor();
    } })) });
  },
  manor() {
    const L = run.s.L, price = k => Math.round(MANOR[k].base * (1 + 0.6 * (L.up[k] || 0)));
    const apply = () => { clearMods('manor'); for (const k in L.up) MANOR[k].fx(L.up[k]); player.hp = stat('maxHp'); player.armor = stat('maxArmor'); };
    apply();
    openChoice({ title: `The Manor · estate gold ${L.gold}`, sub: 'Permanent upgrades for every future heir. Gold you earn this run is banked when you die.', list: true,
      options: Object.keys(MANOR).map(k => ({ name: `${MANOR[k].name} (Lv ${L.up[k] || 0}) · ${price(k)} gold`, desc: MANOR[k].desc, disabled: L.gold < price(k), onPick: () => { L.gold -= price(k); L.up[k] = (L.up[k] || 0) + 1; store('lineage', L); this.manor(); } }))
        .concat([{ name: 'Enter the castle →', onPick: () => { apply(); resumePlay(); } }]) });
  },
  hudLines() { const S = run.s; return S.heir ? [{ t: `${S.heir.name} · ${S.heir.traits.map(t => t.name).join(', ')}`, c: '#fde68a' }, `Estate ${S.L.gold} (+${Math.floor(run.gold)} this run)`] : []; },
  summary() { return [['Gold banked', run.s.banked ?? Math.floor(run.gold)], ['Estate total', run.s.L.gold]]; },
});

// ============================================================ 25. ECHOES
defineSystem({ id: 'echoes', name: 'Echoes', inspo: 'Original idea (Braid / Cursed to Golf ghosts)', tagline: "Every room you play gets recorded. In later rooms, ghosts of your past runs replay alongside you and shoot where you shot. Your past self is your build.",
  setup() {
    const S = run.s; S.rec = []; S.recs = []; S.count = 1; S.dmg = 0.5; S.loop = false; S.aim = false; S.arsenal = false; S.solid = false; S.recT = 0; S.pendingAb = null;
    giveAbility(0, 'grenade');
    Bus.on('ability', ev => { if (ev.ctx.owner === 'player') S.pendingAb = ev.id; });
    Bus.on('roomBuild', () => {
      if (S.rec.length > 24) { S.recs.unshift(S.rec); S.recs = S.recs.slice(0, 4); }
      S.rec = []; S.recT = 0;
      S.recs.slice(0, S.count).forEach((frames, k) => this.spawnEcho(frames, k));
    });
  },
  spawnEcho(frames, k) {
    const S = run.s;
    addAlly({ x: frames[0].x, y: frames[0].y, r: 13, hp: S.solid ? 80 : null, untargetable: !S.solid, aggro: 1.2, t: 0, cd: 0, lastAb: -1, k, frames, hideHp: !S.solid,
      update(dt) {
        this.t += dt; let i = Math.floor(this.t * 12);
        if (i >= this.frames.length) { if (S.loop) { this.t = 0; i = 0; } else { this.dead = true; burst(this.x, this.y, '#a5b4fc', 10, 100); return; } }
        const f = this.frames[i]; this.x = f.x; this.y = f.y;
        const t = S.aim ? nearestEnemy(this.x, this.y, 900, true) : null;
        this.aim = t ? Math.atan2(t.y - this.y, t.x - this.x) : f.a;
        this.cd -= dt;
        if ((f.f || (S.aim && t && f.f !== undefined && this.frames.slice(Math.max(0, i - 6), i + 1).some(q => q.f))) && this.cd <= 0) {
          this.cd = 1 / stat('fireRate');
          addBullet({ x: this.x + Math.cos(this.aim) * 16, y: this.y + Math.sin(this.aim) * 16, vx: Math.cos(this.aim + rand(-0.04, 0.04)) * 1500, vy: Math.sin(this.aim + rand(-0.04, 0.04)) * 1500, owner: 'player', src: 'ally', dmg: stat('damage') * S.dmg, color: '#a5b4fc', w: 2, range: 1000, ignore: [] });
        }
        if (S.arsenal && f.ab && this.lastAb !== i) { this.lastAb = i; castAbility(f.ab, { x: this.x, y: this.y, aim: this.aim, power: 0.6, owner: 'echo', target: t }); }
      },
      draw() { ctx.globalAlpha = 0.4; ctx.fillStyle = '#a5b4fc'; ctx.beginPath(); ctx.arc(this.x, this.y, 13, 0, TAU); ctx.fill(); ctx.strokeStyle = '#e0e7ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + Math.cos(this.aim || 0) * 20, this.y + Math.sin(this.aim || 0) * 20); ctx.stroke(); ctx.globalAlpha = 1; } });
  },
  update(dt) {
    const S = run.s; if (!room.combat || room.cleared || player.dead) return;
    S.recT += dt; if (S.recT >= 1 / 12) { S.recT -= 1 / 12; S.rec.push({ x: player.x, y: player.y, a: player.aim, f: player.sinceShot < 0.12, ab: S.pendingAb }); S.pendingAb = null; if (S.rec.length > 12 * 120) S.rec.shift(); }
  },
  onExit(next) {
    const S = run.s, ups = [
      { name: 'Another Echo', desc: `+1 echo replays each room (now ${S.count}, max 4).`, ok: S.count < 4, fx: () => S.count++ },
      { name: 'Louder Echoes', desc: '+30% echo damage.', ok: true, fx: () => S.dmg *= 1.3 },
      { name: 'Eternal Return', desc: 'Echoes loop instead of fading.', ok: !S.loop, fx: () => S.loop = true },
      { name: 'Echo Sight', desc: 'Echoes aim at enemies instead of where you aimed.', ok: !S.aim, fx: () => S.aim = true },
      { name: 'Echo Arsenal', desc: 'Echoes recast the abilities you used, at 60% power.', ok: !S.arsenal, fx: () => S.arsenal = true },
      { name: 'Solid Echoes', desc: 'Echoes draw enemy fire and soak 80 damage each.', ok: !S.solid, fx: () => S.solid = true },
    ].filter(u => u.ok);
    const opts = sampleN(ups, 2, Math.random).map(u => ({ name: u.name, desc: u.desc, tag: 'echo', onPick: () => { u.fx(); addPerk(u.name, u.desc); next(); } }));
    opts.push(rewardOpt(rpick(statPool()), next));
    openChoice({ title: 'Resonance', sub: `You have ${S.recs.length + (S.rec.length > 24 ? 1 : 0)} recorded room(s). The most recent ${S.count} will replay next room.`, options: opts });
  },
  hudLines() { const S = run.s; return [{ t: `Echoes ${Math.min(S.count, S.recs.length)}/${S.count} · recording ${(S.rec.length / 12).toFixed(0)}s`, c: '#a5b4fc' }]; },
});

// ============================================================ 26. RHYTHM
defineSystem({ id: 'rhythm', name: 'On the Beat', inspo: 'Metal: Hellsinger / Crypt of the NecroDancer', tagline: 'A metronome drives everything. Shots, reloads, dodges and abilities on the beat are much stronger. On-beat kills build Fury up to ×16.',
  setup() {
    const S = run.s; S.bpm = 100; S.t = 0; S.win = 0.09; S.fury = 0; S.off = 0; S.half = false; S.down = false; S.metroArmor = false; S.refund = false; S.lastBeat = -1; S.judge = null; S.dmgBonus = 1;
    setWeapon({ name: 'Metronome Pistol', stats: { ...TUNE.weapon, damage: 30, fireRate: 12, magSize: 14, reloadTime: 1.4 }, flags: { semi: true } });
    giveAbility(0, 'concussive'); giveAbility(1, 'groundSlam');
    const FURY = [1, 1.15, 1.3, 1.5, 1.8];
    Bus.on('bullet', b => { if (b.src !== 'bullet') return; const on = this.onBeat(); b.dmg *= (on ? 1.6 * FURY[S.fury] * S.dmgBonus * (S.down && this.isDownbeat() ? 2 : 1) : 0.7); if (on) { b.color = '#f472b6'; b.w = 3; } });
    Bus.on('shot', () => { const on = this.onBeat(); S.judge = { on, t: 0.4 }; if (on) { S.off = 0; S.lastOnShot = time; player.bloom = Math.max(0, player.bloom - stat('bloomPerShot')); } else if (++S.off >= 3) { S.off = 0; if (S.fury > 0) { S.fury--; floater(player.x, player.y - 50, 'FURY DOWN', '#f87171'); } } });
    Bus.on('reloadStart', ev => { if (this.onBeat() && player.reload) { finishReload(true); if (S.metroArmor) addArmor(10); } });
    Bus.on('dodge', () => { if (this.onBeat()) { player.iframes *= 2; floater(player.x, player.y - 40, 'ON BEAT', '#f472b6', 0.5); } });
    Bus.on('beforeAbility', ev => { if (this.onBeat()) { ev.ctx.power *= 1.5; S.abOnBeat = true; } else S.abOnBeat = false; });
    Bus.on('ability', ev => { if (S.refund && S.abOnBeat && ev.ctx.slot) ev.ctx.slot.cd *= 0.7; });
    Bus.on('kill', () => { if (time - (S.lastOnShot || -9) < 0.3 || S.abOnBeat) { if (S.fury < 4) { S.fury++; floater(player.x, player.y - 56, `FURY ×${[1, 2, 4, 8, 16][S.fury]}`, '#f472b6', 1); } } });
    Bus.on('damaged', () => { if (S.fury > 0) S.fury--; });
  },
  period() { const S = run.s; return 60 / S.bpm / (S.half ? 2 : 1); },
  onBeat() { const S = run.s, p = this.period(), ph = (S.t % p) / p; return Math.min(ph, 1 - ph) * p <= S.win; },
  isDownbeat() { const S = run.s, p = 60 / S.bpm; return Math.round(S.t / p) % 4 === 0; },
  update(dt) { const S = run.s; S.t += dt; const p = 60 / S.bpm, b = Math.floor(S.t / p); if (b !== S.lastBeat) { S.lastBeat = b; sfx.beat(b % 4 === 0); } if (S.judge) { S.judge.t -= dt; if (S.judge.t <= 0) S.judge = null; } },
  drawWorld(layer) {
    if (layer !== 'over' || player.dead) return; const S = run.s, p = 60 / S.bpm, ph = (S.t % p) / p;
    ctx.strokeStyle = this.onBeat() ? '#f472b6' : 'rgba(244,114,182,.35)'; ctx.lineWidth = this.onBeat() ? 4 : 2;
    ctx.beginPath(); ctx.arc(player.x, player.y, 22 + (1 - ph) * 40, 0, TAU); ctx.stroke();
  },
  drawHud(c, box) {
    const S = run.s, p = 60 / S.bpm, ph = (S.t % p) / p, x = cw / 2, y = ch - safe.b - 90, on = this.onBeat();
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x - 120, y - 6, 240, 12);
    for (let k = -2; k <= 2; k++) { const bx = x + (k - ph + (ph > 0.5 ? 1 : 0)) * 60; c.fillStyle = k === 0 || (ph > 0.5 && k === 1) ? '#f472b6' : '#64748b'; c.fillRect(bx - 2, y - 8, 4, 16); }
    c.strokeStyle = on ? '#f472b6' : '#e5e7eb'; c.lineWidth = 2; c.strokeRect(x - 10, y - 10, 20, 20);
    c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.fillStyle = '#f472b6'; c.fillText(`FURY ×${[1, 2, 4, 8, 16][S.fury]}`, x, y - 16);
    if (S.judge) { c.fillStyle = S.judge.on ? '#4ade80' : '#f87171'; c.fillText(S.judge.on ? 'ON BEAT' : 'off', x, y + 26); }
  },
  onExit(next) {
    const S = run.s, ups = [
      { name: 'Wider Window', desc: '+30ms timing window.', ok: S.win < 0.16, fx: () => S.win += 0.03 },
      { name: 'Double Time', desc: 'Half-beats count as on-beat too.', ok: !S.half, fx: () => S.half = true },
      { name: 'Heavy Downbeat', desc: 'Shots on every 4th beat deal ×2 more.', ok: !S.down, fx: () => S.down = true },
      { name: 'Metronome Armor', desc: 'On-beat reloads restore 10 armor.', ok: !S.metroArmor, fx: () => S.metroArmor = true },
      { name: 'Tempo Up', desc: '+12 BPM and +10% on-beat damage.', ok: S.bpm < 160, fx: () => { S.bpm += 12; S.dmgBonus *= 1.1; } },
      { name: 'Encore', desc: 'Abilities used on-beat recharge 30% faster.', ok: !S.refund, fx: () => S.refund = true },
    ].filter(u => u.ok);
    const opts = sampleN(ups, 2, Math.random).map(u => ({ name: u.name, desc: u.desc, tag: 'rhythm', onPick: () => { u.fx(); addPerk(u.name, u.desc); next(); } }));
    opts.push(rewardOpt(rpick(statPool()), next));
    openChoice({ title: 'Setlist', sub: `${S.bpm} BPM · window ±${Math.round(S.win * 1000)}ms`, options: opts });
  },
  hudLines() { const S = run.s; return [{ t: `${S.bpm} BPM · ±${Math.round(S.win * 1000)}ms${S.half ? ' · double time' : ''}`, c: '#f472b6' }]; },
});

// ============================================================ 27. DICE
const DICE_EQ = {
  blaster: { name: 'Blaster', short: 'BLST', req: 'any', fit: v => true, pick: 'max', desc: 'A bolt dealing 12 × die.', fx: (v, p) => abilityShot(abilityCtx(), { dmg: 12 * v * p, speed: 1800, color: '#fde68a', w: 3 + v / 2, homing: 2 }) },
  frag: { name: 'Frag', short: 'FRAG', req: '≥4', fit: v => v >= 4, pick: 'max', desc: 'Grenade dealing 18 × die.', fx: (v, p) => lob(abilityCtx(), { radius: 100, onLand: (x, y) => explode(x, y, 100, 18 * v * p, { detonate: true, color: '#a3e635' }) }) },
  medkit: { name: 'Medkit', short: 'MED', req: '≤3', fit: v => v <= 3, pick: 'max', desc: 'Heal 6 × die.', fx: (v, p) => healPlayer(6 * v * p) },
  barrier: { name: 'Barrier', short: 'BARR', req: 'even', fit: v => v % 2 === 0, pick: 'max', desc: 'Armor 8 × die.', fx: (v, p) => addArmor(8 * v * p) },
  haste: { name: 'Haste', short: 'HSTE', req: 'odd', fit: v => v % 2 === 1, pick: 'max', desc: '+5% × die speed and fire rate for 4s.', fx: (v, p) => addBuff('haste', 4, [{ stat: 'moveSpeed', mul: 1 + 0.05 * v * p }, { stat: 'fireRate', mul: 1 + 0.05 * v * p }], { label: 'HASTE', color: '#4ade80' }) },
  nudge: { name: 'Nudge', short: '+1', req: '≤5', fit: v => v <= 5, pick: 'min', desc: 'Turn a die into die+1.', fx: v => { run.s.dice.push(v + 1); } },
  split: { name: 'Splitter', short: 'SPLT', req: '≥2', fit: v => v >= 2, pick: 'max', desc: 'Split a die into two halves.', fx: v => { run.s.dice.push(Math.floor(v / 2), Math.ceil(v / 2)); } },
  reroll: { name: 'Reroll', short: 'RR', req: 'any', fit: v => true, pick: 'min', desc: 'Reroll your lowest die.', fx: () => { run.s.dice.push(1 + Math.floor(Math.random() * 6)); } },
  blink: { name: 'Blink', short: 'BLNK', req: '≥3', fit: v => v >= 3, pick: 'min', desc: 'Teleport forward.', fx: () => castAbility('blink', abilityCtx()) },
  freeze: { name: 'Freeze', short: 'FRZ', req: '=6', fit: v => v === 6, pick: 'max', desc: 'Stop time for 1.8s.', fx: (v, p) => addTimeSlow(1.8 * p, 0) },
  rail: { name: 'Railshot', short: 'RAIL', req: '≥5', fit: v => v >= 5, pick: 'max', desc: 'Piercing shot dealing 25 × die.', fx: (v, p) => abilityShot(abilityCtx(), { dmg: 25 * v * p, speed: 2600, color: '#fef08a', w: 6, pierce: 99, range: 1500 }) },
  sentry: { name: 'Sentry', short: 'SNTY', req: '≤2', fit: v => v <= 2, pick: 'max', desc: 'Turret lasting 6 × die seconds.', fx: (v, p) => makeTurret(player.x + 30, player.y, { life: 6 * v * p, dmg: 9 * p }) },
  zap: { name: 'Zap', short: 'ZAP', req: 'any', fit: v => true, pick: 'max', desc: 'Chain lightning dealing 8 × die.', fx: (v, p) => { const t = pickTarget(abilityCtx(), 650); if (!t) return false; chain(t, 3, 260, 8 * v * p, { stun: 0.3 }); } },
};
defineSystem({ id: 'dice', name: 'Dice Equipment', inspo: 'Dicey Dungeons', tagline: 'Every 8s you roll dice, and unspent dice are lost. Your abilities are equipment cards that eat dice that fit their requirement. Value = power.',
  slotsAlways: true,
  setup() {
    const S = run.s; S.n = 3; S.dice = []; S.turn = 8; S.turnT = 0; S.eq = [{ id: 'blaster', lvl: 1 }, { id: 'frag', lvl: 1 }, { id: 'medkit', lvl: 1 }];
    for (let i = 0; i < 3; i++) player.slots[i] = { onUse: () => this.use(i), label: '', sub: '' };
    Bus.on('roomStart', () => { S.turnT = 0; });
  },
  roll() { const S = run.s; S.dice = Array.from({ length: S.n }, () => 1 + Math.floor(Math.random() * 6)); sfx.click(); },
  use(i) {
    const S = run.s, e = S.eq[i]; if (!e) return; const d = DICE_EQ[e.id];
    const fits = S.dice.map((v, k) => [v, k]).filter(([v]) => d.fit(v)); if (!fits.length) { sfx.click(); return; }
    fits.sort((a, b) => d.pick === 'max' ? b[0] - a[0] : a[0] - b[0]);
    const [v, k] = fits[0]; S.dice.splice(k, 1);
    const ok = d.fx(v, 1 + 0.3 * (e.lvl - 1));
    if (ok === false) { S.dice.push(v); sfx.click(); return; }
    sfx.ability(); floater(player.x, player.y - 40, `${d.name} [${v}]`, '#fde68a', 0.6); Bus.emit('ability', { id: e.id, ctx: abilityCtx() });
  },
  update(dt) {
    const S = run.s;
    if (room.combat && !room.cleared) { S.turnT -= dt; if (S.turnT <= 0) { S.turnT = S.turn; this.roll(); } }
    for (let i = 0; i < 3; i++) { const e = S.eq[i], sl = player.slots[i]; if (!e) { sl.label = '—'; sl.sub = ''; continue; } const d = DICE_EQ[e.id]; sl.label = d.short + (e.lvl > 1 ? '+' : ''); sl.sub = d.req; sl.disabled = !S.dice.some(v => d.fit(v)); sl.color = sl.disabled ? '#475569' : '#fde68a'; }
  },
  drawHud(c) {
    const S = run.s, s = 30, gap = 6, w = S.dice.length * (s + gap), x0 = cw / 2 - w / 2, y = ch - safe.b - 110;
    S.dice.forEach((v, k) => { const x = x0 + k * (s + gap); c.fillStyle = '#f8fafc'; c.fillRect(x, y, s, s); c.fillStyle = '#111'; c.font = 'bold 18px system-ui'; c.textAlign = 'center'; c.fillText(v, x + s / 2, y + s / 2 + 6); });
    if (room.combat && !room.cleared) { c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(cw / 2 - 60, y + s + 4, 120, 4); c.fillStyle = '#fde68a'; c.fillRect(cw / 2 - 60, y + s + 4, 120 * (1 - S.turnT / S.turn), 4); }
  },
  onExit(next) {
    const S = run.s, owned = new Set(S.eq.map(e => e.id)), opts = [];
    for (const id of sampleN(Object.keys(DICE_EQ).filter(k => !owned.has(k)), 2, Math.random)) { const d = DICE_EQ[id]; opts.push({ name: `${d.name} [${d.req}]`, desc: d.desc, tag: 'equipment', onPick: () => openChoice({ title: `Equip ${d.name} in which slot?`, list: true, options: [0, 1, 2].map(i => ({ name: `${SLOT_LABELS[i]}: replace ${S.eq[i] ? DICE_EQ[S.eq[i].id].name : 'empty'}`, onPick: () => { S.eq[i] = { id, lvl: 1 }; addPerk(d.name); next(); } })).concat([{ name: 'Cancel', onPick: () => this.onExit(next) }]) }) }); }
    if (S.n < 6) opts.push({ name: '+1 Die', desc: `Roll ${S.n + 1} dice per turn.`, tag: 'dice', onPick: () => { S.n++; addPerk('+1 Die'); next(); } });
    opts.push({ name: 'Upgrade equipment', desc: '+30% effect on one card.', tag: 'upgrade', onPick: () => openChoice({ title: 'Upgrade which?', list: true, options: S.eq.map((e, i) => ({ name: `${DICE_EQ[e.id].name} → Lv ${e.lvl + 1}`, onPick: () => { e.lvl++; next(); } })) }) });
    if (S.turn > 4) opts.push({ name: 'Quicker Turns', desc: `Roll every ${S.turn - 1}s instead of ${S.turn}s.`, tag: 'tempo', onPick: () => { S.turn--; next(); } });
    openChoice({ title: 'Loot', options: sampleN(opts, 3, Math.random) });
  },
  hudLines() { const S = run.s; return [{ t: `${S.n} dice / ${S.turn}s turns · ${S.eq.map(e => DICE_EQ[e.id].name + (e.lvl > 1 ? '+' : '')).join(', ')}`, c: '#fde68a' }]; },
});

// ============================================================ 28. PARAGON / RENEGADE
const PR_EVENTS = [
  { text: 'A wounded merc begs for help.', p: ['Patch him up', 'He covers you next room as a turret.', S => { S.mercNext = true; }], r: ['Take his ammo', '+6 magazine.', () => mod('magSize', { add: 6 }, 'pr')] },
  { text: 'A captured scout knows the next room.', p: ['Let her go', 'Next room, enemies start marked.', S => { S.markNext = true; }], r: ['Make her talk', '+15% damage for the next room.', () => addBuff('intel', 60, [{ stat: 'damage', mul: 1.15 }], { label: 'INTEL', color: '#f87171' })] },
  { text: 'Two scared civilians block the door.', p: ['Talk them down', 'Heal 25 HP.', () => healPlayer(25)], r: ['Shove through', '+8% fire rate.', () => mod('fireRate', { mul: 1.08 }, 'pr')] },
  { text: 'An enemy officer offers to surrender.', p: ['Accept', '+20 max armor.', () => { mod('maxArmor', { add: 20 }, 'pr'); addArmor(20, true); }], r: ['Refuse', '+8% crit chance.', () => mod('critChance', { add: 0.08 }, 'pr')] },
  { text: 'A medic asks for your spare stim.', p: ['Give it', 'Lose 15 HP now. +1 HP/s regen forever.', () => { player.hp = Math.max(1, player.hp - 15); mod('hpRegen', { add: 1 }, 'pr'); }], r: ['Keep it', 'Heal 20 HP.', () => healPlayer(20)] },
  { text: 'Your team wants to rest before the next push.', p: ['Rest', 'Heal 30 HP.', () => healPlayer(30)], r: ['Push on', '-12% ability cooldowns.', () => mod('cdr', { mul: 0.88 }, 'pr')] },
];
defineSystem({ id: 'paragon', name: 'Paragon / Renegade', inspo: 'Mass Effect 1-3', tagline: 'Two morality meters fill from HOW you fight and the choices you make. Prompts appear mid-fight (L1 Paragon / R1 Renegade). Each path unlocks its own powers.',
  setup() {
    const S = run.s; S.P = 0; S.R = 0; S.unl = new Set(); S.int = null; S.intCd = 4;
    giveAbility(0, 'concussive');
    const gain = (k, v) => { S[k] += v; this.check(); };
    Bus.on('kill', ev => { if (ev.hugging) gain('P', 3); if (ev.braced) gain('P', 1.5); if (ev.dist < 200) gain('R', 3); if (ev.moving) gain('R', 1.5); if (ev.source === 'ability') gain('R', 1.5); if (S.unl.has('P20')) addArmor(3, true); if (S.unl.has('R20') && ev.dist < 200) healPlayer(3, true); if (S.int && S.int.e === ev.enemy) S.int = null; });
    Bus.on('reload', ev => { if (ev.perfect) gain('P', 1.5); });
    Bus.on('roomClear', () => { if (!S.hurt) gain('P', 6); });
    Bus.on('roomBuild', () => { S.hurt = false; });
    Bus.on('damaged', ev => { if (ev.hpDmg > 0) S.hurt = true; });
    Bus.on('roomStart', () => { if (S.mercNext) { S.mercNext = false; makeTurret(player.x + 40, player.y, { life: 40, dmg: 10, hp: 150 }); } if (S.markNext) { S.markNext = false; for (const e of enemies) e.markT = 10; } });
    Bus.on('beforeHit', ev => { if (S.unl.has('R80') && ev.enemy.hp - ev.dmg < ev.enemy.maxHp * 0.2) { ev.dmg = ev.enemy.hp + 1; } });
    Bus.on('beforeDamage', ev => { if (S.unl.has('P80')) ev.dmg *= 0.85; });
  },
  check() {
    const S = run.s, U = (k, m, fn) => { if (!S.unl.has(k) && S[k[0]] >= +k.slice(1)) { S.unl.add(k); fn(); floaterScreen(m); addPerk(m); sfx.level(); } };
    U('P20', 'Paragon: Inspiring (kills restore 3 armor)', () => {});
    U('P45', 'Paragon: Dominate unlocked (R1)', () => giveAbility(1, 'dominate'));
    U('P80', 'Paragon: Aura (take 15% less damage)', () => {});
    U('R20', 'Renegade: Bloodthirst (close kills heal 3)', () => {});
    U('R45', 'Renegade: Nova unlocked (△)', () => giveAbility(2, 'nova'));
    U('R80', 'Renegade: Brutal (bullets execute enemies below 20%)', () => {});
  },
  onSlot(i) {
    const S = run.s; if (!S.int || i > 1) return false;
    const e = S.int.e; S.int = null; S.intCd = 7;
    if (i === 0) { hitEnemy(e, 1, { charm: 12, quiet: true }); S.P += 5; floater(e.x, e.y - 30, 'SPARED · fights for you', '#60a5fa', 1.5); }
    else { hitEnemy(e, e.hp + 10, { source: 'ability' }); healPlayer(10); S.R += 5; floater(e.x, e.y - 30, 'EXECUTED', '#f87171', 1.5); cam.shake = 8; }
    this.check(); sfx.ability(); return true;
  },
  update(dt) {
    const S = run.s;
    if (S.int) { S.int.t -= dt; if (S.int.t <= 0 || S.int.e.dead) S.int = null; }
    else { S.intCd -= dt; if (S.intCd <= 0) { const e = enemies.find(e => !e.dead && e.charmT <= 0 && (e.stun > 0 || e.hp < e.maxHp * 0.35) && hyp(e.x - player.x, e.y - player.y) < 500 && hasLOS(player.x, player.y, e.x, e.y)); if (e) { S.int = { e, t: 2.5 }; sfx.beat(true); } } }
  },
  drawWorld(layer) {
    const S = run.s; if (layer !== 'over' || !S.int) return; const e = S.int.e;
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = '#60a5fa'; ctx.fillText('L1 PARAGON: Spare', e.x, e.y - e.r - 34);
    ctx.fillStyle = '#f87171'; ctx.fillText('R1 RENEGADE: Execute', e.x, e.y - e.r - 18);
    ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * S.int.t / 2.5); ctx.stroke();
  },
  onExit(next) {
    const S = run.s, ev = rpick(PR_EVENTS);
    openChoice({ title: 'Conversation', sub: ev.text, options: [
      { name: `<span style="color:#60a5fa">PARAGON:</span> ${ev.p[0]}`, desc: ev.p[1], onPick: () => { ev.p[2](S); S.P += 8; this.check(); next(); } },
      { name: `<span style="color:#f87171">RENEGADE:</span> ${ev.r[0]}`, desc: ev.r[1], onPick: () => { ev.r[2](S); S.R += 8; this.check(); next(); } },
    ] });
  },
  drawHud(c, box) {
    const S = run.s, w = 120, x = cw / 2 - w - 6, y = safe.t + 40;
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, y, w, 6); c.fillRect(cw / 2 + 6, y, w, 6);
    c.fillStyle = '#60a5fa'; c.fillRect(x + w * (1 - Math.min(1, S.P / 100)), y, w * Math.min(1, S.P / 100), 6);
    c.fillStyle = '#f87171'; c.fillRect(cw / 2 + 6, y, w * Math.min(1, S.R / 100), 6);
    c.font = '10px system-ui'; c.textAlign = 'right'; c.fillStyle = '#60a5fa'; c.fillText(`PARAGON ${Math.floor(S.P)}`, x - 4, y + 7); c.textAlign = 'left'; c.fillStyle = '#f87171'; c.fillText(`${Math.floor(S.R)} RENEGADE`, cw / 2 + w + 10, y + 7);
  },
});

// ============================================================ 29. FORTIFICATIONS
const STRUCTS = {
  sandbag: { name: 'Sandbags', cost: 1, desc: 'Low cover' }, wall: { name: 'Wall', cost: 2, desc: 'Full wall that blocks everything' },
  turret: { name: 'Auto Turret', cost: 4, desc: 'A turret for the whole room' }, mine: { name: 'Mine', cost: 1, desc: 'Proximity mine' },
  medic: { name: 'Med Station', cost: 3, desc: 'Heals you 6 HP/s nearby' }, tesla: { name: 'Tesla Coil', cost: 4, desc: 'Zaps the nearest enemy every 1.5s' },
  wire: { name: 'Barbed Wire', cost: 1, desc: 'Slows enemies 60% inside' }, dummy: { name: 'Decoy Dummy', cost: 2, desc: 'Draws fire (200 HP)' },
  crate: { name: 'Ammo Crate', cost: 2, desc: 'Near it: instant reloads and no heat' },
};
defineSystem({ id: 'fort', name: 'Fortifications', inspo: 'Tower defense / Orcs Must Die / Sanctum', tagline: 'You barely level up. The ARENA does. Each room starts with a build phase where you spend build points on cover, turrets, mines and wire. Then △ to fight.',
  slotsAlways: true,
  preRoomLabel: 'BUILD: L1/R1 select · ✕ place · △ start the fight',
  setup() {
    const S = run.s; S.unlocked = ['sandbag', 'wall', 'turret', 'mine']; S.bpMax = 6; S.bp = 6; S.sel = 0; S.lvl = {}; S.building = false;
    Bus.on('tick', () => { for (const o of objects) if (o.crate && hyp(player.x - o.x, player.y - o.y) < 70) { player.heat = 0; if (player.reload && !player.reload.jam) finishReload(false); } });
  },
  preRoom(go) {
    const S = run.s; S.building = true; S.bp = S.bpMax; S.go = go;
    player.slots = [{ onUse: () => {}, label: '◀' }, { onUse: () => {}, label: '▶' }, { onUse: () => {}, label: 'FIGHT' }];
  },
  onSlot(i) {
    const S = run.s; if (!S.building) return false;
    if (i === 0) S.sel = (S.sel - 1 + S.unlocked.length) % S.unlocked.length;
    if (i === 1) S.sel = (S.sel + 1) % S.unlocked.length;
    if (i === 2) { S.building = false; player.slots = [null, null, null]; S.go(); }
    sfx.click(); return true;
  },
  placePoint() { const a = player.aim; return { x: player.x + Math.cos(a) * 60, y: player.y + Math.sin(a) * 60, a }; },
  rectFor(id, p) { const horiz = Math.abs(Math.cos(p.a)) < 0.7; if (id === 'sandbag') return horiz ? { x: p.x - 45, y: p.y - 15, w: 90, h: 30, type: 'low', built: true } : { x: p.x - 15, y: p.y - 45, w: 30, h: 90, type: 'low', built: true }; if (id === 'wall') return horiz ? { x: p.x - 60, y: p.y - 20, w: 120, h: 40, type: 'wall', built: true } : { x: p.x - 20, y: p.y - 60, w: 40, h: 120, type: 'wall', built: true }; return null; },
  valid(id, p) { const r = this.rectFor(id, p); if (r) return r.x > 0 && r.y > 0 && r.x + r.w < ROOM_W && r.y + r.h < ROOM_H && !room.rects.some(o => rectGap(o, r) < 4) && pointRectDist(player.x, player.y, r) > player.r + 2; return !blocked(p.x, p.y, 14); },
  onInteract() {
    const S = run.s; if (!S.building) return false;
    const id = S.unlocked[S.sel], c = STRUCTS[id], p = this.placePoint(), L = 1 + 0.4 * ((S.lvl[id] || 1) - 1);
    if (S.bp < c.cost || !this.valid(id, p)) { sfx.click(); floater(player.x, player.y - 40, S.bp < c.cost ? 'not enough BP' : "can't build there", '#f87171', 0.7); return true; }
    S.bp -= c.cost; sfx.reload(); burst(p.x, p.y, '#a3e635', 8, 100);
    const r = this.rectFor(id, p); if (r) { room.rects.push(r); return true; }
    if (id === 'turret') makeTurret(p.x, p.y, { life: Infinity, hp: 120 * L, dmg: 10 * L });
    if (id === 'mine') addObject({ layer: 'under', update() { if (room.combat && enemiesNear(p.x, p.y, 50).length) { explode(p.x, p.y, 120, 90 * L, { detonate: true }); return false; } }, draw() { ctx.fillStyle = '#b45309'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, TAU); ctx.fill(); } });
    if (id === 'medic') zone(p.x, p.y, 90, 1e9, { color: '#22c55e', alpha: 0.15, every: 0.2, tick: (z, dt) => { if (hyp(player.x - z.x, player.y - z.y) < z.r) healPlayer(6 * L * dt, true); } });
    if (id === 'tesla') addObject({ t: 0, update(dt) { this.t += dt; if (this.t > 1.5 && room.combat) { const e = nearestEnemy(p.x, p.y, 260 + 40 * (L - 1), true); if (e) { this.t = 0; beam(p.x, p.y, e.x, e.y, '#38bdf8', 3); hitEnemy(e, 35 * L, { source: 'item', stun: 0.5 }); sfx.zap(); } } }, draw() { ctx.fillStyle = '#0c4a6e'; ctx.fillRect(p.x - 9, p.y - 9, 18, 18); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.strokeRect(p.x - 9, p.y - 9, 18, 18); ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(p.x, p.y, 260 + 40 * (L - 1), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; } });
    if (id === 'wire') zone(p.x, p.y, 75, 1e9, { color: '#a8a29e', alpha: 0.18, every: 0.1, tick: z => { for (const e of enemiesNear(z.x, z.y, z.r)) { e.slowT = Math.max(e.slowT, 0.3); e.slowMul = 0.4; } } });
    if (id === 'dummy') addAlly({ x: p.x, y: p.y, r: 14, hp: 200 * L, aggro: 3, color: '#d6d3d1' });
    if (id === 'crate') addObject({ crate: true, x: p.x, y: p.y, layer: 'under', update() {}, draw() { ctx.fillStyle = '#854d0e'; ctx.fillRect(p.x - 12, p.y - 9, 24, 18); ctx.strokeStyle = '#facc15'; ctx.strokeRect(p.x - 12, p.y - 9, 24, 18); ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(p.x, p.y, 70, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; } });
    return true;
  },
  drawWorld(layer) {
    const S = run.s; if (layer !== 'over' || !S.building) return;
    const id = S.unlocked[S.sel], p = this.placePoint(), ok = this.valid(id, p) && S.bp >= STRUCTS[id].cost, r = this.rectFor(id, p);
    ctx.strokeStyle = ok ? '#4ade80' : '#f87171'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    if (r) ctx.strokeRect(r.x, r.y, r.w, r.h); else { ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]);
  },
  hudLines() { const S = run.s; return S.building ? [{ t: `BUILD POINTS ${S.bp}/${S.bpMax}`, c: '#a3e635' }, { t: `▶ ${STRUCTS[S.unlocked[S.sel]].name} (${STRUCTS[S.unlocked[S.sel]].cost} BP): ${STRUCTS[S.unlocked[S.sel]].desc}`, c: '#fde68a' }, 'L1/R1 select · ✕ place in front of you · △ FIGHT'] : [{ t: `Arsenal: ${S.unlocked.map(k => STRUCTS[k].name).join(', ')}`, c: '#94a3b8' }]; },
  onExit(next) {
    const S = run.s, opts = [], locked = Object.keys(STRUCTS).filter(k => !S.unlocked.includes(k));
    for (const k of sampleN(locked, 2, Math.random)) opts.push({ name: `Blueprint: ${STRUCTS[k].name}`, desc: `${STRUCTS[k].desc} (${STRUCTS[k].cost} BP)`, tag: 'unlock', onPick: () => { S.unlocked.push(k); addPerk(STRUCTS[k].name); next(); } });
    opts.push({ name: '+2 Build Points', desc: `Max BP ${S.bpMax} → ${S.bpMax + 2}`, tag: 'logistics', onPick: () => { S.bpMax += 2; next(); } });
    const up = rpick(S.unlocked.filter(k => ['turret', 'mine', 'medic', 'tesla', 'dummy'].includes(k)));
    if (up) opts.push({ name: `Upgrade ${STRUCTS[up].name}`, desc: '+40% power.', tag: 'upgrade', onPick: () => { S.lvl[up] = (S.lvl[up] || 1) + 1; next(); } });
    openChoice({ title: 'Engineering', options: sampleN(opts, 3, Math.random) });
  },
});

// ============================================================ 30. DECAY
const DECAY_KIT = [
  { name: "Warlord's Might", desc: '+50% damage', fx: s => mod('damage', { mul: 1.5 }, s) },
  { name: 'Hair Trigger', desc: '+30% fire rate', fx: s => mod('fireRate', { mul: 1.3 }, s) },
  { name: 'Juggernaut', desc: '+60 max HP', fx: s => mod('maxHp', { add: 60 }, s) },
  { name: 'Bulwark', desc: '+40 max armor', fx: s => mod('maxArmor', { add: 40 }, s) },
  { name: 'Piercing Rounds', desc: 'Bullets pierce 2', fx: s => mod('pierce', { add: 2 }, s) },
  { name: 'Explosive Rounds', desc: 'Bullets explode', fx: s => mod('explodeRadius', { add: 50 }, s) },
  { name: 'Vampirism', desc: '6% lifesteal', fx: s => mod('lifesteal', { add: 0.06 }, s) },
  { name: 'Acrobat', desc: '+1 dodge charge', fx: s => mod('dodgeCharges', { add: 1 }, s) },
  { name: 'Quickdraw', desc: '-40% reload time, bigger perfect window', fx: s => { mod('reloadTime', { mul: 0.6 }, s); mod('perfectLen', { add: 0.08 }, s); } },
  { name: 'Deadeye', desc: '+20% crit', fx: s => mod('critChance', { add: 0.2 }, s) },
  { name: 'Perfect Aim', desc: '-50% spread', fx: s => { mod('spreadStill', { mul: 0.5 }, s); mod('spreadMove', { mul: 0.5 }, s); } },
  { name: 'Cold Barrel', desc: 'No heat, never jam', fx: s => mod('heatPerShot', { mul: 0 }, s) },
  { name: 'Frag Grenade ×3', desc: 'L1 ability', slot: 0, ability: 'grenade', opts: { charges: 3, power: 1.5 } },
  { name: 'Phase Round', desc: 'R1 ability', slot: 1, ability: 'phaseRound' },
  { name: 'Time Stop', desc: '△ ability', slot: 2, ability: 'timeStop' },
];
defineSystem({ id: 'decay', name: 'Decay', inspo: 'Reverse roguelike (lateral)', tagline: 'You start god-tier with everything. After every room you MUST give one thing up. Each sacrifice leaves a tiny ember. Which parts of the build do you really need?',
  setup() {
    const S = run.s; S.kit = DECAY_KIT.map((k, i) => ({ ...k, src: 'decay' + i })); S.embers = 0; S.offered = false;
    for (const k of S.kit) { if (k.fx) k.fx(k.src); if (k.ability) giveAbility(k.slot, k.ability, k.opts || {}); addPerk(k.name, k.desc); }
    player.hp = stat('maxHp'); player.armor = stat('maxArmor'); player.mag = Math.round(stat('magSize'));
    Bus.on('floor', () => { S.offered = false; });
  },
  lose(k) {
    const S = run.s; S.kit = S.kit.filter(x => x !== k); clearMods(k.src); if (k.ability) player.slots[k.slot] = null;
    run.perks = run.perks.filter(p => p.name !== k.name);
    S.embers++; clearMods('ember'); mod('damage', { mul: 1 + 0.03 * S.embers }, 'ember'); mod('maxHp', { add: 4 * S.embers }, 'ember');
    player.hp = Math.min(player.hp, stat('maxHp')); player.armor = Math.min(player.armor, stat('maxArmor'));
  },
  onExit(next) {
    const S = run.s; if (!S.kit.length) { next(); return; }
    const offer = sampleN(S.kit, Math.min(3, S.kit.length), Math.random);
    const opts = offer.map(k => ({ name: `Lose ${k.name}`, desc: k.desc, tag: 'sacrifice', onPick: () => { this.lose(k); next(); } }));
    if (!S.offered) opts.push({ name: 'Bleed instead', desc: 'Lose 20 max HP and keep everything (once per floor).', tag: 'blood', disabled: stat('maxHp') < 50, onPick: () => { S.offered = true; mod('maxHp', { add: -20 }, 'bleed'); player.hp = Math.min(player.hp, stat('maxHp')); next(); } });
    openChoice({ title: 'The toll', sub: `You must give something up. Embers so far: ${S.embers} (+3% damage, +4 max HP each).`, options: opts });
  },
  hudLines() { const S = run.s; return [{ t: `Kit ${S.kit.length}/${DECAY_KIT.length} · Embers ${S.embers}`, c: '#fb923c' }, ...S.kit.filter(k => !k.ability).map(k => ({ t: '· ' + k.name, c: '#cbd5e1' }))]; },
});
