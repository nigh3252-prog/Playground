// Stone Wanderer combat audio director.
//
// weapon-lab.html imports this directly and calls onAttackStart/onDummyEvent at
// the exact point those events happen in its own combat code. No iframe, no DOM
// scraping, no MutationObserver — the old wrapper needed those because the lab
// lived behind an iframe boundary; now it's the same page.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// controls: { enabled, beast, grit, damage, beastOut, gritOut, damageOut, testButtons }
export function installCombatAudioDirector({ log, controls = {}, settings = null } = {}) {
  const state = {
    enabled: true,
    beast: 0.55,
    grit: 1,
    damage: 0,
    surge: 0,
    weapon: 'Longsword',
    group: 'vertical'
  };

  function setLog(text) {
    if (log) log.textContent = text;
  }

  function syncControls() {
    if (controls.enabled) state.enabled = controls.enabled.checked;
    if (controls.beast) state.beast = Number(controls.beast.value || 0) / 100;
    if (controls.grit) state.grit = Number(controls.grit.value || 0) / 100;
    if (controls.damage) state.damage = Number(controls.damage.value || 0) / 100;
    settings?.set?.('combat.audioEnabled', state.enabled);
    if (controls.beast) settings?.set?.('combat.audioBeast', controls.beast.value);
    if (controls.grit) settings?.set?.('combat.audioGrit', controls.grit.value);
    if (controls.damage) settings?.set?.('combat.audioDamage', controls.damage.value);
    if (controls.beastOut && controls.beast) controls.beastOut.textContent = controls.beast.value;
    if (controls.gritOut && controls.grit) controls.gritOut.textContent = controls.grit.value;
    if (controls.damageOut && controls.damage) controls.damageOut.textContent = controls.damage.value;
  }

  ['enabled', 'beast', 'grit', 'damage'].forEach(key => {
    const el = controls[key];
    if (el) el.addEventListener('input', syncControls);
  });
  syncControls();

  const AudioDirector = (() => {
    let AC, master, effort, weapon, impact, beast, noiseBuf, lastAt = 0;

    function init() {
      if (AC) return;
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = 0.74;

      const comp = AC.createDynamicsCompressor();
      comp.threshold.value = -13;
      comp.ratio.value = 7;
      comp.attack.value = 0.003;
      comp.release.value = 0.14;

      effort = AC.createGain();
      weapon = AC.createGain();
      impact = AC.createGain();
      beast = AC.createGain();
      effort.connect(master);
      weapon.connect(master);
      impact.connect(master);
      beast.connect(master);
      master.connect(comp).connect(AC.destination);

      noiseBuf = AC.createBuffer(1, AC.sampleRate * 1.6, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let seed = 7777;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = seed / 1073741823 - 1;
      }
    }

    function env(g, t, p, d, a = 0.003) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p), t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    }

    function tone(bus, type, f0, f1, dur, g, delay = 0) {
      init();
      const t = AC.currentTime + delay;
      const o = AC.createOscillator();
      const gn = AC.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, f0), t);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.88);
      env(gn, t, g, dur);
      o.connect(gn).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.04);
    }

    function noise(bus, filter, f0, f1, dur, g, delay = 0, q = 1) {
      init();
      const t = AC.currentTime + delay;
      const s = AC.createBufferSource();
      const f = AC.createBiquadFilter();
      const gn = AC.createGain();
      s.buffer = noiseBuf;
      s.playbackRate.value = 0.65 + Math.random() * 0.9;
      f.type = filter;
      f.Q.value = q;
      f.frequency.setValueAtTime(Math.max(25, f0), t);
      if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(25, f1), t + dur * 0.92);
      env(gn, t, g, dur, 0.002);
      s.connect(f).connect(gn).connect(bus);
      s.start(t, Math.random() * 0.7);
      s.stop(t + dur + 0.05);
    }

    function pulse(bus, freq, count, g, delay = 0) {
      for (let i = 0; i < count; i++) {
        tone(bus, 'square', freq * (1 + Math.random() * 0.08), freq * 0.55, 0.052, g * (1 - i / (count + 1)), delay + i * 0.074);
        noise(bus, 'bandpass', freq * 5.2, freq * 1.2, 0.04, g * 0.42, delay + i * 0.074, 4);
      }
    }

    function growl(kind, amount, delay = 0) {
      amount = clamp(amount, 0, 1);
      if (amount <= 0.025) return;
      const g = 0.07 + amount * 0.34;
      if (kind === 'dog') {
        tone(beast, 'sawtooth', 160, 78, 0.18, g, delay);
        noise(beast, 'bandpass', 720, 220, 0.20, g * 0.55, delay, 3);
      } else if (kind === 'lion') {
        tone(beast, 'sawtooth', 84, 42, 0.58, g * 0.95, delay);
        noise(beast, 'lowpass', 900, 125, 0.56, g * 0.72, delay, 1.15);
      } else if (kind === 'koala') {
        pulse(beast, 58, 4, g * 0.65, delay);
        tone(beast, 'triangle', 72, 38, 0.38, g * 0.55, delay);
      } else if (kind === 'walrus') {
        pulse(beast, 104, 3, g * 0.75, delay);
        noise(beast, 'bandpass', 430, 92, 0.42, g * 0.70, delay, 5);
      } else {
        tone(beast, 'square', 255, 92, 0.16, g, delay);
        noise(beast, 'bandpass', 1550, 260, 0.18, g * 0.55, delay, 5);
      }
    }

    function weaponKind() {
      const w = state.weapon.toLowerCase();
      if (w.includes('hammer') || w.includes('mace')) return 'blunt';
      if (w.includes('axe')) return 'axe';
      if (w.includes('spear') || w.includes('rapier')) return 'thrust';
      if (w.includes('claymore') || w.includes('greatsword')) return 'heavyBlade';
      return 'blade';
    }

    function beastLevel(ctx = {}) {
      return clamp(state.beast * 0.72 + state.damage * 0.55 + state.surge * 0.55 + (ctx.damage || 0) / 175 + (ctx.kill ? 0.22 : 0), 0, 1);
    }

    function play(event, ctx = {}) {
      if (!state.enabled) return;
      init();
      if (AC.state === 'suspended') AC.resume();
      const now = performance.now();
      if (now - lastAt < 24 && event !== 'hurt') return;
      lastAt = now;

      const b = beastLevel(ctx);
      const gr = state.grit;
      const k = weaponKind();
      effort.gain.value = 0.52 + b * 0.18;
      weapon.gain.value = 0.68 + gr * 0.22;
      impact.gain.value = 0.82 + gr * 0.2;
      beast.gain.value = 0.18 + b * 0.78;

      if (event === 'swingLight') {
        const thrust = k === 'thrust' || state.group === 'stab';
        tone(effort, 'triangle', thrust ? 155 : 178, thrust ? 92 : 105, 0.12, 0.07);
        noise(weapon, 'bandpass', thrust ? 1250 : 820, thrust ? 2700 : 2200, thrust ? 0.10 : 0.14, 0.18 * gr, 0.01, thrust ? 3.4 : 2.1);
        tone(weapon, 'square', thrust ? 760 : 560, thrust ? 460 : 330, 0.044, 0.035 * gr, 0.02);
        if (b > 0.42) growl(thrust ? 'mutant' : 'dog', b * 0.32, 0.006);
      } else if (event === 'swingHeavy') {
        tone(effort, 'triangle', 132, 58, 0.28, 0.15);
        noise(weapon, 'bandpass', 330, 1500, 0.29, 0.34 * gr, 0.01, 1.6);
        tone(weapon, 'square', 165, 90, 0.13, 0.06 * gr, 0.04);
        growl(k === 'blunt' ? 'walrus' : (b > 0.62 ? 'koala' : 'dog'), b * 0.54, 0.025);
      } else if (event === 'hitLight') {
        noise(impact, 'highpass', 2800, 1180, 0.055, 0.34 * gr, 0, 1);
        tone(impact, 'square', 390, 185, 0.075, 0.12 * gr);
        noise(impact, 'bandpass', 850, 220, 0.11, 0.16, 0, 2.3);
        if (b > 0.45) growl(k === 'thrust' ? 'mutant' : 'dog', b * 0.24, 0.02);
      } else if (event === 'hitHeavy') {
        tone(impact, 'sine', 145, 39, 0.22, 0.42);
        noise(impact, 'lowpass', 680, 110, 0.2, 0.46, 0, 1);
        noise(impact, 'bandpass', 1600, 260, 0.13, 0.28 * gr, 0.015, 3);
        growl(k === 'blunt' ? 'walrus' : (k === 'axe' ? 'dog' : 'koala'), b * 0.55, 0.01);
        if (b > 0.72) growl('lion', b * 0.34, 0.04);
      } else if (event === 'kill') {
        tone(impact, 'sine', 170, 36, 0.28, 0.52);
        noise(impact, 'lowpass', 760, 80, 0.27, 0.5, 0, 1.1);
        tone(weapon, 'square', 310, 110, 0.09, 0.09 * gr, 0.02);
        growl(k === 'blunt' ? 'walrus' : 'lion', b * 0.65, 0.02);
        growl('koala', b * 0.36, 0.06);
      } else if (event === 'hurt') {
        tone(effort, 'sawtooth', 220, 70, 0.2, 0.18);
        noise(effort, 'bandpass', 520, 140, 0.22, 0.24, 0, 2.5);
        growl(state.damage > 0.55 ? 'koala' : 'dog', clamp(0.25 + b * 0.75, 0, 1), 0.01);
      }

      setLog(`${event} · ${state.weapon} · beast ${Math.round(beastLevel(ctx) * 100)}%`);
    }

    // Layered flesh-impact stack (ported from fencer_hit_feel_lab_v3.html):
    // sine body-thud + square crack + saw grind + wet noise, all pitch-varied so
    // repeats never sound identical, with a 42 Hz sub-boom on kills/huge hits.
    function playImpactFeel({ power = 1, kill = false, gain = 1 } = {}) {
      if (!state.enabled || gain <= 0) return;
      init();
      if (AC.state === 'suspended') AC.resume();
      impact.gain.value = 0.82 + state.grit * 0.2;
      const pitch = (0.88 + Math.random() * 0.24) * (kill ? 0.72 : 1);
      const g = gain;
      tone(impact, 'sine', 74 * pitch, 74 * pitch * 0.42, 0.24 + power * 0.06, (0.18 + power * 0.08) * g);
      tone(impact, 'square', 245 * pitch, 150 * pitch, 0.065, (0.075 + power * 0.03) * g, 0.005);
      tone(impact, 'sawtooth', 122 * pitch, 80 * pitch, 0.13, (0.045 + power * 0.02) * g, 0.012);
      noise(impact, 'lowpass', 650 + power * 300, 180, 0.13 + power * 0.04, (0.15 + power * 0.06) * g, 0.015);
      noise(impact, 'highpass', 2600, 1400, 0.045, 0.08 * g);
      if (kill || power > 1.4) {
        tone(impact, 'sine', 42, 34, 0.45, 0.26 * g, 0.025);
        noise(impact, 'lowpass', 420, 90, 0.22, 0.22 * g, 0.03);
      }
    }

    return { play, playImpactFeel };
  })();

  function isHeavyWeapon() {
    return /Hammer|Mace|Claymore|Greatsword|Axe/i.test(state.weapon);
  }

  // Call this the moment a real attack starts in the host's combat code.
  function onAttackStart({ group, weapon: weaponLabel } = {}) {
    if (group) state.group = group;
    if (weaponLabel) state.weapon = weaponLabel;
    AudioDirector.play(isHeavyWeapon() ? 'swingHeavy' : 'swingLight', { damage: isHeavyWeapon() ? 42 : 22 });
  }

  // Call this the moment a dummy hit (or kill) resolves in the host's combat code.
  function onDummyEvent({ damage = 0, kill = false } = {}) {
    if (kill) {
      state.surge = clamp(state.surge + 0.18, 0, 1);
      AudioDirector.play('kill', { damage: damage || 70, kill: true });
    } else {
      state.surge = clamp(state.surge + damage / 520, 0, 1);
      AudioDirector.play(damage >= 34 ? 'hitHeavy' : 'hitLight', { damage });
    }
  }

  // Call this from the hit-feel system with a normalized hit power (~1 average,
  // ~2+ charged/kill). Layers on top of onDummyEvent's growl/surge kit.
  function onImpactFeel({ damage = 0, kill = false, power = null, gain = 1 } = {}) {
    const p = power ?? clamp(damage / 28, 0.4, 2) + (kill ? 0.9 : 0);
    AudioDirector.playImpactFeel({ power: p, kill, gain });
  }

  const api = {
    onAttackStart,
    onDummyEvent,
    onImpactFeel,
    playTest(event) {
      if (event === 'hurt') {
        state.damage = clamp(state.damage + 0.18, 0, 1);
        if (controls.damage) controls.damage.value = Math.round(state.damage * 100);
        syncControls();
      }
      if (event === 'kill') state.surge = clamp(state.surge + 0.2, 0, 1);
      AudioDirector.play(event, { damage: event === 'kill' ? 70 : event.includes('Heavy') ? 52 : 24, kill: event === 'kill' });
    }
  };

  if (controls.testButtons) {
    controls.testButtons.forEach(button => {
      button.addEventListener('click', () => api.playTest(button.dataset.test));
    });
  }

  return api;
}
