/* ==========================================================================
   K — shared kit for the Thirty Adventures collection.
   One 960x540 virtual canvas, gamepad + keyboard + touch input with
   PlayStation callouts, synth audio and generated music, particles, camera,
   grid helpers, dialog, and the title / pause / ending shell.
   ========================================================================== */
(function () {
  'use strict';
  const W = 960, H = 540, TAU = Math.PI * 2;
  let cv, g, SC = 1, OX = 0, OY = 0;

  /* ---------- math ---------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const ang = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  function shuffle(a, r) { r = r || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    const f = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    f.range = (a, b) => a + f() * (b - a);
    f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
    f.pick = (a) => a[Math.floor(f() * a.length)];
    return f;
  }
  /* cheap smooth 2D value noise */
  function hash2(x, y, s) { let n = (x * 374761393 + y * 668265263 + (s || 0) * 1442695041) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
  function noise2(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash2(xi, yi, s), hash2(xi + 1, yi, s), u), lerp(hash2(xi, yi + 1, s), hash2(xi + 1, yi + 1, s), u), v);
  }

  /* ---------- canvas ---------- */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    SC = Math.min(cv.width / W, cv.height / H);
    OX = (cv.width - W * SC) / 2; OY = (cv.height - H * SC) / 2;
  }
  function toV(px, py) {
    const r = cv.getBoundingClientRect();
    const dpr = cv.width / r.width;
    return { x: ((px - r.left) * dpr - OX) / SC, y: ((py - r.top) * dpr - OY) / SC };
  }

  /* ---------- draw helpers ---------- */
  const FONT = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  function circ(x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); g.fill(); }
  function ring(x, y, r, col, w) { g.strokeStyle = col; g.lineWidth = w || 2; g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); g.stroke(); }
  function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
  function rectS(x, y, w, h, col, lw) { g.strokeStyle = col; g.lineWidth = lw || 2; g.strokeRect(x, y, w, h); }
  function rr(x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function rrect(x, y, w, h, r, col) { g.fillStyle = col; rr(x, y, w, h, r); g.fill(); }
  function rrectS(x, y, w, h, r, col, lw) { g.strokeStyle = col; g.lineWidth = lw || 2; rr(x, y, w, h, r); g.stroke(); }
  function line(x1, y1, x2, y2, col, w) { g.strokeStyle = col; g.lineWidth = w || 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function txt(s, x, y, size, col, align, weight) {
    g.font = (weight || 700) + ' ' + (size || 16) + 'px ' + FONT;
    g.textAlign = align || 'left'; g.textBaseline = 'middle'; g.fillStyle = col || '#fff';
    g.fillText(s, x, y);
  }
  function txtW(s, size, weight) { g.font = (weight || 700) + ' ' + (size || 16) + 'px ' + FONT; return g.measureText(s).width; }
  function poly(pts, col, stroke, lw) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (col) { g.fillStyle = col; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 2; g.stroke(); }
  }
  function tri(x, y, r, a, col) {
    poly([[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a + 2.5) * r * 0.8, y + Math.sin(a + 2.5) * r * 0.8], [x + Math.cos(a - 2.5) * r * 0.8, y + Math.sin(a - 2.5) * r * 0.8]], col);
  }
  function wrap(s, x, y, maxw, lh, size, col, align, weight) {
    g.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    const words = String(s).split(' '); let ln = '', n = 0;
    const out = [];
    for (const w of words) {
      if (w === '\n') { out.push(ln); ln = ''; continue; }
      const t = ln ? ln + ' ' + w : w;
      if (g.measureText(t).width > maxw && ln) { out.push(ln); ln = w; } else ln = t;
    }
    if (ln) out.push(ln);
    for (const l of out) { txt(l, x, y + n * lh, size, col, align, weight || 600); n++; }
    return n;
  }
  function bar(x, y, w, h, f, col, bg) {
    rrect(x, y, w, h, h / 2, bg || 'rgba(0,0,0,.55)');
    if (f > 0) rrect(x + 2, y + 2, Math.max(h - 4, (w - 4) * clamp(f, 0, 1)), h - 4, (h - 4) / 2, col);
  }
  function hearts(x, y, n, max, col, size) {
    size = size || 9;
    for (let i = 0; i < max; i++) {
      const cx = x + i * (size * 2.5), on = i < n;
      g.fillStyle = on ? (col || '#fb7185') : 'rgba(255,255,255,.14)';
      g.beginPath(); g.moveTo(cx, y + size * 0.9);
      g.bezierCurveTo(cx - size * 1.6, y - size * 0.2, cx - size * 0.6, y - size * 1.2, cx, y - size * 0.3);
      g.bezierCurveTo(cx + size * 0.6, y - size * 1.2, cx + size * 1.6, y - size * 0.2, cx, y + size * 0.9);
      g.fill();
    }
  }
  function hsl(h, s, l, a) { return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')'; }
  const PS = { cross: '#7dd3fc', circle: '#fb7185', square: '#f0abfc', triangle: '#6ee7b7' };
  const LABEL = { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', options: 'OPTIONS', share: 'CREATE', LS: 'L STICK', RS: 'R STICK', DPAD: 'D-PAD', l3: 'L3', r3: 'R3', up: '▲', down: '▼', left: '◀', right: '▶' };
  function glyph(name, x, y, r, alpha) {
    g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.translate(x, y);
    const col = PS[name];
    if (col) {
      circ(0, 0, r, 'rgba(12,15,24,.92)'); ring(0, 0, r, 'rgba(255,255,255,.3)', Math.max(1, r * 0.09));
      g.strokeStyle = col; g.lineWidth = r * 0.2; g.lineCap = 'round'; g.lineJoin = 'round';
      const s = r * 0.42; g.beginPath();
      if (name === 'cross') { g.moveTo(-s, -s); g.lineTo(s, s); g.moveTo(s, -s); g.lineTo(-s, s); }
      else if (name === 'circle') g.arc(0, 0, s * 1.05, 0, TAU);
      else if (name === 'square') g.rect(-s * 0.95, -s * 0.95, s * 1.9, s * 1.9);
      else { g.moveTo(0, -s * 1.15); g.lineTo(s * 1.15, s * 0.85); g.lineTo(-s * 1.15, s * 0.85); g.closePath(); }
      g.stroke();
    } else {
      const lab = LABEL[name] || name.toUpperCase();
      const w = Math.max(r * 2, txtW(lab, r * 0.95, 800) + r * 0.9);
      rrect(-w / 2, -r, w, r * 2, r * 0.5, 'rgba(12,15,24,.92)'); rrectS(-w / 2, -r, w, r * 2, r * 0.5, 'rgba(255,255,255,.3)', 1.2);
      txt(lab, 0, 1, r * 0.95, '#e8ecf6', 'center', 800);
    }
    g.restore();
  }
  function glyphW(name, r) { return PS[name] ? r * 2 : Math.max(r * 2, txtW(LABEL[name] || name.toUpperCase(), r * 0.95, 800) + r * 0.9); }

  /* ---------- audio ---------- */
  const A = { ctx: null, master: null, sfxG: null, musG: null, nz: null, muted: false };
  function audioInit() {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      A.ctx = new AC({ latencyHint: 'interactive' });
      const comp = A.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
      A.master = A.ctx.createGain(); A.master.gain.value = A.muted ? 0 : 0.85;
      A.master.connect(comp); comp.connect(A.ctx.destination);
      A.sfxG = A.ctx.createGain(); A.sfxG.connect(A.master);
      A.musG = A.ctx.createGain(); A.musG.gain.value = 0.5; A.musG.connect(A.master);
      const len = A.ctx.sampleRate; const buf = A.ctx.createBuffer(1, len, len); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A.nz = buf;
    } catch (e) { A.ctx = null; }
  }
  function tone(o) {
    const c = A.ctx; if (!c || c.state !== 'running') return;
    try {
      const t = o.when !== undefined ? o.when : c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.1, vol = o.vol === undefined ? 0.18 : o.vol;
      const osc = c.createOscillator(); osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f || 440, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
      const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = osc;
      if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
      node.connect(gn); gn.connect(o.dest || A.sfxG);
      osc.start(t); osc.stop(t + dur + 0.05);
    } catch (e) { /* never let audio break a frame */ }
  }
  function noise(o) {
    const c = A.ctx; if (!c || c.state !== 'running') return;
    try {
      const t = o.when !== undefined ? o.when : c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.2, vol = o.vol === undefined ? 0.25 : o.vol;
      const src = c.createBufferSource(); src.buffer = A.nz;
      const f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
      f.frequency.setValueAtTime(o.f || 1200, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
      f.Q.value = o.q || 0.8;
      const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(gn); gn.connect(o.dest || A.sfxG);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    } catch (e) { /* noop */ }
  }
  const SFX = {
    select: () => tone({ f: 520, f2: 780, dur: 0.07, type: 'triangle', vol: 0.16 }),
    back: () => tone({ f: 420, f2: 260, dur: 0.09, type: 'triangle', vol: 0.16 }),
    move: () => tone({ f: 330, dur: 0.04, type: 'triangle', vol: 0.1 }),
    jump: () => tone({ f: 300, f2: 620, dur: 0.14, type: 'square', vol: 0.1, lp: 1800 }),
    land: () => noise({ f: 500, f2: 120, dur: 0.09, vol: 0.2 }),
    step: () => noise({ f: 900, dur: 0.035, vol: 0.06, type: 'bandpass' }),
    shoot: () => { tone({ f: 880, f2: 220, dur: 0.1, type: 'sawtooth', vol: 0.09, lp: 2600 }); noise({ f: 3000, dur: 0.05, vol: 0.08, type: 'highpass' }); },
    swing: () => noise({ f: 1800, f2: 500, dur: 0.11, vol: 0.16, type: 'bandpass', q: 1.5 }),
    hit: () => { noise({ f: 1400, f2: 300, dur: 0.1, vol: 0.28 }); tone({ f: 180, f2: 70, dur: 0.1, type: 'square', vol: 0.14 }); },
    hurt: () => { tone({ f: 240, f2: 80, dur: 0.24, type: 'sawtooth', vol: 0.2, lp: 1400 }); noise({ f: 800, dur: 0.14, vol: 0.2 }); },
    die: () => { tone({ f: 300, f2: 40, dur: 0.6, type: 'sawtooth', vol: 0.22, lp: 1200 }); noise({ f: 600, f2: 80, dur: 0.5, vol: 0.25 }); },
    boom: () => { noise({ f: 900, f2: 60, dur: 0.5, vol: 0.45 }); tone({ f: 110, f2: 30, dur: 0.4, type: 'sine', vol: 0.4 }); },
    coin: () => { tone({ f: 990, dur: 0.06, type: 'square', vol: 0.09 }); tone({ f: 1480, dur: 0.14, type: 'square', vol: 0.09, delay: 0.06 }); },
    pick: () => { tone({ f: 660, f2: 990, dur: 0.1, type: 'triangle', vol: 0.16 }); },
    key: () => { [660, 880, 1100, 1320].forEach((f, i) => tone({ f, dur: 0.12, type: 'triangle', vol: 0.15, delay: i * 0.07 })); },
    power: () => { [392, 523, 659, 784].forEach((f, i) => tone({ f, dur: 0.16, type: 'square', vol: 0.1, delay: i * 0.06, lp: 2400 })); },
    door: () => { noise({ f: 300, f2: 120, dur: 0.35, vol: 0.3 }); tone({ f: 90, f2: 60, dur: 0.3, type: 'square', vol: 0.12 }); },
    dash: () => noise({ f: 2400, f2: 400, dur: 0.16, vol: 0.2, type: 'bandpass' }),
    splash: () => noise({ f: 1600, f2: 300, dur: 0.3, vol: 0.2, type: 'bandpass', q: 0.6 }),
    zap: () => { tone({ f: 1400, f2: 200, dur: 0.14, type: 'sawtooth', vol: 0.12 }); },
    charge: () => tone({ f: 200, f2: 900, dur: 0.3, type: 'sawtooth', vol: 0.08, lp: 2000 }),
    clank: () => { tone({ f: 1250, dur: 0.05, type: 'square', vol: 0.12 }); tone({ f: 830, dur: 0.12, type: 'triangle', vol: 0.14, delay: 0.01 }); noise({ f: 4000, dur: 0.04, vol: 0.12, type: 'highpass' }); },
    blip: () => tone({ f: 740, dur: 0.035, type: 'square', vol: 0.06 }),
    ping: () => { tone({ f: 1320, f2: 1300, dur: 0.6, type: 'sine', vol: 0.2 }); },
    bad: () => { tone({ f: 160, dur: 0.14, type: 'square', vol: 0.14 }); tone({ f: 120, dur: 0.2, type: 'square', vol: 0.14, delay: 0.12 }); },
    win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, dur: 0.3, type: 'triangle', vol: 0.18, delay: i * 0.11 })); },
    lose: () => { [392, 349, 311, 233].forEach((f, i) => tone({ f, dur: 0.34, type: 'triangle', vol: 0.18, delay: i * 0.16 })); },
  };
  function sfx(n) { audioInit(); const f = SFX[n]; if (f) f(); }

  /* generated looping music: a few bars of bass, pad and melody from a seed */
  const MODES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10], penta: [0, 3, 5, 7, 10, 12, 15], lydian: [0, 2, 4, 6, 7, 9, 11] };
  const M = { on: false, spec: null, next: 0, step: 0, pat: null };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function musicBuild(spec) {
    const r = rng(spec.seed || 7), sc = MODES[spec.mode || 'minor'];
    const prog = spec.prog || [0, 5, 3, 4];
    const mel = [], bass = [], hat = [], kick = [];
    for (let bar_ = 0; bar_ < 4; bar_++) {
      let deg = prog[bar_ % prog.length] + r.int(0, 2) * 2;
      for (let s = 0; s < 16; s++) {
        const dens = spec.dens === undefined ? 0.45 : spec.dens;
        if (r() < dens * (s % 2 === 0 ? 1.3 : 0.6)) { deg += r.int(-2, 2); deg = clamp(deg, -2, 11); mel.push(deg); } else mel.push(null);
        bass.push(s % 8 === 0 || (s % 8 === 6 && r() < 0.5) || (spec.drive && s % 2 === 0) ? prog[bar_ % prog.length] : null);
        kick.push(spec.drums ? (s % 4 === 0 || (s % 16 === 10 && r() < 0.6)) : false);
        hat.push(spec.drums ? (s % 2 === 1 || r() < 0.2) : false);
      }
    }
    return { mel, bass, kick, hat, sc };
  }
  function noteOf(sc, root, deg) { const o = Math.floor(deg / sc.length), i = ((deg % sc.length) + sc.length) % sc.length; return root + sc[i] + o * 12; }
  function musicTick() {
    const c = A.ctx; if (!M.on || !c || c.state !== 'running') return;
    const sp = M.spec, stepDur = 60 / (sp.bpm || 90) / 4;
    if (M.next < c.currentTime) M.next = c.currentTime + 0.05;
    while (M.next < c.currentTime + 0.2) {
      const i = M.step % 64, p = M.pat, t = M.next, root = sp.root || 45;
      if (p.bass[i] !== null) tone({ when: t, f: mtof(noteOf(p.sc, root - 12, p.bass[i])), dur: stepDur * (sp.drive ? 1.6 : 6), type: sp.bassType || 'triangle', vol: 0.16, dest: A.musG, lp: 700 });
      if (p.mel[i] !== null) tone({ when: t, f: mtof(noteOf(p.sc, root + 12, p.mel[i])), dur: stepDur * (sp.long ? 5 : 2.2), type: sp.lead || 'triangle', vol: sp.leadVol || 0.07, dest: A.musG, lp: sp.lp || 2400, attack: sp.long ? 0.05 : 0.008 });
      if (i % 16 === 0 && sp.pad !== false) { const d = (sp.prog || [0, 5, 3, 4])[(i / 16) % 4]; [0, 2, 4].forEach((k) => tone({ when: t, f: mtof(noteOf(p.sc, root, d + k)), dur: stepDur * 15, type: 'sine', vol: 0.035, dest: A.musG, attack: 0.3 })); }
      if (p.kick[i]) tone({ when: t, f: 120, f2: 40, dur: 0.14, type: 'sine', vol: 0.3, dest: A.musG });
      if (p.hat[i]) noise({ when: t, f: 7000, dur: 0.03, vol: 0.04, type: 'highpass', dest: A.musG });
      M.next += stepDur; M.step++;
    }
  }
  function music(spec) { if (!spec) { M.on = false; return; } M.spec = spec; M.pat = musicBuild(spec); M.step = 0; M.next = 0; M.on = true; }

  /* ---------- input ---------- */
  const BTN = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'share', 'options', 'l3', 'r3', 'up', 'down', 'left', 'right', 'ps'];
  const IN = { lx: 0, ly: 0, rx: 0, ry: 0, cur: {}, prev: {}, val: {}, pad: false, showTouch: false, gest: false, navX: 0, navY: 0, nx: 0, ny: 0, navT: 0 };
  BTN.forEach((b) => { IN.cur[b] = false; IN.prev[b] = false; IN.val[b] = 0; });
  const KEYMAP = {
    KeyW: '_u', KeyS: '_d', KeyA: '_l', KeyD: '_r', ArrowUp: '_ru', ArrowDown: '_rd', ArrowLeft: '_rl', ArrowRight: '_rr',
    KeyK: 'cross', Space: 'cross', KeyL: 'circle', KeyJ: 'square', KeyI: 'triangle', KeyQ: 'l1', KeyE: 'r1', KeyU: 'l2', KeyO: 'r2',
    ShiftLeft: 'l2', KeyF: 'r2', Enter: 'options', Escape: 'options', KeyM: 'share',
  };
  const keys = {};
  const T = { l: null, r: null, btn: {}, held: {}, ptr: new Map() };
  let touchBtns = [];
  function layoutTouch(game) {
    const used = new Set(); (game.controls || []).forEach(([k]) => (Array.isArray(k) ? k : [k]).forEach((n) => used.add(n)));
    const out = [];
    const face = { triangle: [846, 372], circle: [900, 426], cross: [846, 480], square: [792, 426] };
    for (const n in face) if (used.has(n)) out.push({ n, x: face[n][0], y: face[n][1], r: 30 });
    const sh = { l1: [16, 150], l2: [16, 102], r1: [844, 150], r2: [844, 102] };
    for (const n in sh) if (used.has(n)) out.push({ n, x: sh[n][0], y: sh[n][1], w: 100, h: 40 });
    out.push({ n: 'options', x: 436, y: 4, w: 88, h: 26 });
    touchBtns = out;
  }
  function tBtnAt(x, y) {
    for (const b of touchBtns) {
      if (b.r) { if (dist(x, y, b.x, b.y) < b.r + 12) return b; }
      else if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return b;
    }
    return null;
  }
  function ptDown(id, x, y) {
    audioInit();
    if (!IN.pad) IN.showTouch = true;
    IN.tap = { x, y };
    const b = tBtnAt(x, y);
    if (b) { T.btn[b.n] = id; T.held[b.n] = Infinity; T.ptr.set(id, { k: 'b', n: b.n }); return; }
    if (x < W * 0.45) { T.l = { id, ox: x, oy: y, x, y }; T.ptr.set(id, { k: 'l' }); }
    else { T.r = { id, ox: x, oy: y, x, y }; T.ptr.set(id, { k: 'r' }); }
  }
  function ptMove(id, x, y) { const p = T.ptr.get(id); if (!p) return; if (p.k === 'l' && T.l) { T.l.x = x; T.l.y = y; } else if (p.k === 'r' && T.r) { T.r.x = x; T.r.y = y; } }
  function ptUp(id) {
    const p = T.ptr.get(id); if (!p) return;
    if (p.k === 'b') { delete T.btn[p.n]; T.held[p.n] = performance.now() + 90; }
    if (p.k === 'l') T.l = null; if (p.k === 'r') T.r = null;
    T.ptr.delete(id);
  }
  const dz = (v, d) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
  function poll(dt) {
    for (const b of BTN) IN.prev[b] = IN.cur[b];
    let lx = 0, ly = 0, rx = 0, ry = 0; const now = {}, val = {};
    for (const b of BTN) { now[b] = false; val[b] = 0; }
    let found = false;
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gps) {
      if (!gp || !gp.connected) continue; found = true;
      const a = gp.axes, bs = gp.buttons;
      lx += dz(a[0] || 0, 0.18); ly += dz(a[1] || 0, 0.18); rx += dz(a[2] || 0, 0.18); ry += dz(a[3] || 0, 0.18);
      for (let i = 0; i < BTN.length; i++) if (bs[i]) { const v = bs[i].value || (bs[i].pressed ? 1 : 0); if (v > val[BTN[i]]) val[BTN[i]] = v; if (bs[i].pressed || v > 0.4) now[BTN[i]] = true; }
    }
    IN.pad = found; if (found) IN.showTouch = false;
    if (found && !IN.gest) for (const b of BTN) if (now[b]) { IN.gest = true; audioInit(); break; }
    if (keys._u) ly -= 1; if (keys._d) ly += 1; if (keys._l) lx -= 1; if (keys._r) lx += 1;
    if (keys._ru) ry -= 1; if (keys._rd) ry += 1; if (keys._rl) rx -= 1; if (keys._rr) rx += 1;
    for (const b of BTN) if (keys[b]) { now[b] = true; val[b] = 1; }
    if (K._ax) { lx += K._ax.lx || 0; ly += K._ax.ly || 0; rx += K._ax.rx || 0; ry += K._ax.ry || 0; }
    const tn = performance.now();
    for (const n in T.held) { if (T.held[n] > tn) { now[n] = true; val[n] = 1; } else delete T.held[n]; }
    for (const [s, k] of [[T.l, 'l'], [T.r, 'r']]) {
      if (!s) continue;
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), m = Math.min(d, 60) / 60;
      if (d > 5) { if (k === 'l') { lx += dx / d * m; ly += dy / d * m; } else { rx += dx / d * m; ry += dy / d * m; } }
    }
    if (Math.hypot(lx, ly) < 0.05) { if (now.left) lx -= 1; if (now.right) lx += 1; if (now.up) ly -= 1; if (now.down) ly += 1; }
    const lm = Math.hypot(lx, ly); if (lm > 1) { lx /= lm; ly /= lm; }
    const rm = Math.hypot(rx, ry); if (rm > 1) { rx /= rm; ry /= rm; }
    IN.lx = lx; IN.ly = ly; IN.rx = rx; IN.ry = ry;
    for (const b of BTN) { IN.cur[b] = now[b]; IN.val[b] = val[b]; }
    /* menu / grid navigation edges with auto-repeat */
    const nx = lx < -0.55 ? -1 : lx > 0.55 ? 1 : 0, ny = ly < -0.55 ? -1 : ly > 0.55 ? 1 : 0;
    IN.nx = 0; IN.ny = 0;
    if (nx !== IN.navX || ny !== IN.navY) { IN.nx = nx; IN.ny = ny; IN.navT = 0.3; }
    else if (nx || ny) { IN.navT -= dt; if (IN.navT <= 0) { IN.nx = nx; IN.ny = ny; IN.navT = 0.13; } }
    IN.navX = nx; IN.navY = ny;
  }
  const down = (b) => IN.cur[b];
  const hit = (b) => IN.cur[b] && !IN.prev[b];
  const up = (b) => !IN.cur[b] && IN.prev[b];
  const trig = (b) => IN.val[b];

  /* ---------- fx ---------- */
  const fx = {
    ps: [], texts: [], shakeT: 0, flashC: null, flashT: 0, stop: 0,
    burst(x, y, col, n, spd, life, size, grav) {
      for (let i = 0; i < (n || 8); i++) {
        if (this.ps.length > 500) break;
        const a = rand(0, TAU), s = rand(0.3, 1) * (spd || 140);
        this.ps.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1) * (life || 0.5), max: life || 0.5, col, size: size || 3, g: grav || 0 });
      }
    },
    spark(x, y, vx, vy, col, life, size, grav) { if (this.ps.length < 500) this.ps.push({ x, y, vx, vy, life: life || 0.4, max: life || 0.4, col, size: size || 3, g: grav || 0 }); },
    text(x, y, s, col, size) { this.texts.push({ x, y, s, col: col || '#fff', t: 0, size: size || 16 }); },
    shake(a) { this.shakeT = Math.max(this.shakeT, a); },
    flash(col, t) { this.flashC = col; this.flashT = t || 0.2; this.flashMax = t || 0.2; },
    hitstop(t) { this.stop = Math.max(this.stop, t); },
    clear() { this.ps.length = 0; this.texts.length = 0; this.shakeT = 0; this.flashT = 0; this.stop = 0; },
    update(dt) {
      for (let i = this.ps.length - 1; i >= 0; i--) {
        const p = this.ps[i]; p.life -= dt; if (p.life <= 0) { this.ps[i] = this.ps[this.ps.length - 1]; this.ps.pop(); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 1.5 * dt; p.vy *= 1 - 1.5 * dt;
      }
      for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.t += dt; t.y -= 28 * dt; if (t.t > 1) this.texts.splice(i, 1); }
      this.shakeT = Math.max(0, this.shakeT - dt * 30);
      this.flashT = Math.max(0, this.flashT - dt);
    },
    draw() {
      for (const p of this.ps) { g.globalAlpha = clamp(p.life / p.max, 0, 1); g.fillStyle = p.col; const s = p.size; g.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
      g.globalAlpha = 1;
      for (const t of this.texts) { g.globalAlpha = clamp(1.2 - t.t, 0, 1); txt(t.s, t.x, t.y, t.size, t.col, 'center', 800); }
      g.globalAlpha = 1;
    },
  };

  /* ---------- camera ---------- */
  const cam = {
    x: W / 2, y: H / 2, zoom: 1,
    reset() { this.x = W / 2; this.y = H / 2; this.zoom = 1; },
    follow(tx, ty, dt, rate) { this.x = damp(this.x, tx, rate || 6, dt); this.y = damp(this.y, ty, rate || 6, dt); },
    bound(ww, wh) {
      const hw = W / 2 / this.zoom, hh = H / 2 / this.zoom;
      this.x = ww <= hw * 2 ? ww / 2 : clamp(this.x, hw, ww - hw);
      this.y = wh <= hh * 2 ? wh / 2 : clamp(this.y, hh, wh - hh);
    },
    begin() {
      g.save();
      const s = fx.shakeT;
      g.translate(W / 2 + (s ? rand(-s, s) : 0), H / 2 + (s ? rand(-s, s) : 0));
      g.scale(this.zoom, this.zoom); g.translate(-this.x, -this.y);
    },
    end() { g.restore(); },
    sx(wx) { return (wx - this.x) * this.zoom + W / 2; },
    sy(wy) { return (wy - this.y) * this.zoom + H / 2; },
    /* visible world rect with margin */
    see(x, y, m) { m = m || 40; const hw = W / 2 / this.zoom + m, hh = H / 2 / this.zoom + m; return x > this.x - hw && x < this.x + hw && y > this.y - hh && y < this.y + hh; },
  };

  /* ---------- grids ---------- */
  function grid(w, h, fill) {
    const d = new Uint8Array(w * h); if (fill) d.fill(fill);
    return {
      w, h, d,
      inb(x, y) { return x >= 0 && y >= 0 && x < w && y < h; },
      get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? d[y * w + x] : 1; },
      set(x, y, v) { if (x >= 0 && y >= 0 && x < w && y < h) d[y * w + x] = v; },
    };
  }
  /* breadth-first distances from (sx,sy); pass(x,y) says a cell is walkable */
  function bfs(w, h, sx, sy, pass, maxD) {
    const D = new Int16Array(w * h).fill(-1); const q = [sx, sy]; D[sy * w + sx] = 0;
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1], d0 = D[y * w + x];
      if (maxD && d0 >= maxD) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || D[ny * w + nx] >= 0 || !pass(nx, ny)) continue;
        D[ny * w + nx] = d0 + 1; q.push(nx, ny);
      }
    }
    return D;
  }
  /* step downhill on a bfs map toward its source */
  function bfsStep(D, w, h, x, y) {
    let best = D[y * w + x], bx = 0, by = 0; if (best < 0) best = 32000;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const d = D[ny * w + nx]; if (d >= 0 && d < best) { best = d; bx = dx; by = dy; }
    }
    return [bx, by];
  }
  /* tile line of sight in world units */
  function los(x0, y0, x1, y1, solid, ts) {
    const d = dist(x0, y0, x1, y1), n = Math.ceil(d / (ts * 0.4));
    for (let i = 1; i < n; i++) { const t = i / n; if (solid(Math.floor(lerp(x0, x1, t) / ts), Math.floor(lerp(y0, y1, t) / ts))) return false; }
    return true;
  }
  /* move a centred circle/box (e.x,e.y,e.r) against solid tiles, axis by axis */
  function moveC(e, dx, dy, solid, ts) {
    const r = e.r; let hx = false, hy = false;
    const blocked = (x, y) => {
      const x0 = Math.floor((x - r) / ts), x1 = Math.floor((x + r - 0.001) / ts), y0 = Math.floor((y - r) / ts), y1 = Math.floor((y + r - 0.001) / ts);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
      return false;
    };
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (ts * 0.45)));
    for (let i = 0; i < steps; i++) {
      const sx = dx / steps, sy = dy / steps;
      if (sx) { if (!blocked(e.x + sx, e.y)) e.x += sx; else hx = true; }
      if (sy) { if (!blocked(e.x, e.y + sy)) e.y += sy; else hy = true; }
    }
    return { hx, hy };
  }
  /* platformer box: e.x,e.y top-left, e.w,e.h. Sets e.ground / e.wall / e.ceil */
  function moveB(e, dx, dy, solid, ts) {
    const blocked = (x, y) => {
      const x0 = Math.floor(x / ts), x1 = Math.floor((x + e.w - 0.001) / ts), y0 = Math.floor(y / ts), y1 = Math.floor((y + e.h - 0.001) / ts);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solid(tx, ty)) return true;
      return false;
    };
    e.wall = 0; e.ceil = false; e.ground = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (ts * 0.4)));
    for (let i = 0; i < steps; i++) {
      const sx = dx / steps, sy = dy / steps;
      if (sx) {
        if (!blocked(e.x + sx, e.y)) e.x += sx;
        else { e.wall = Math.sign(sx); e.x = sx > 0 ? Math.floor((e.x + sx + e.w) / ts) * ts - e.w : Math.floor((e.x + sx) / ts + 1) * ts; if (blocked(e.x, e.y)) e.x -= sx; }
      }
      if (sy) {
        if (!blocked(e.x, e.y + sy)) e.y += sy;
        else { if (sy > 0) { e.ground = true; e.y = Math.floor((e.y + sy + e.h) / ts) * ts - e.h; } else { e.ceil = true; e.y = Math.floor((e.y + sy) / ts + 1) * ts; } if (blocked(e.x, e.y)) e.y -= sy; }
      }
    }
    if (!e.ground && blocked(e.x, e.y + 1)) e.ground = true;
    return e;
  }
  /* cellular cave: 1 = rock, 0 = open; keeps only the largest open region */
  function cave(w, h, r, fillP, iters) {
    const G = grid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) G.d[y * w + x] = (x < 2 || y < 2 || x >= w - 2 || y >= h - 2 || r() < (fillP || 0.45)) ? 1 : 0;
    for (let it = 0; it < (iters || 4); it++) {
      const n = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += G.get(x + dx, y + dy) ? 1 : 0;
        n[y * w + x] = c >= 5 || x < 1 || y < 1 || x >= w - 1 || y >= h - 1 ? 1 : 0;
      }
      G.d.set(n);
    }
    let best = null, bestN = 0; const seen = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (G.d[y * w + x] || seen[y * w + x]) continue;
      const D = bfs(w, h, x, y, (a, b) => !G.d[b * w + a]); let n = 0;
      for (let i = 0; i < D.length; i++) if (D[i] >= 0) { n++; seen[i] = 1; }
      if (n > bestN) { bestN = n; best = D; }
    }
    if (best) for (let i = 0; i < best.length; i++) if (best[i] < 0) G.d[i] = 1;
    G.open = bestN;
    return G;
  }
  /* perfect maze on odd-sized grid: 1 = wall */
  function maze(w, h, r, braid) {
    const G = grid(w, h, 1); const st = [[1, 1]]; G.set(1, 1, 0);
    while (st.length) {
      const [x, y] = st[st.length - 1];
      const ds = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], r).filter(([dx, dy]) => x + dx > 0 && y + dy > 0 && x + dx < w - 1 && y + dy < h - 1 && G.get(x + dx, y + dy) === 1);
      if (!ds.length) { st.pop(); continue; }
      const [dx, dy] = ds[0]; G.set(x + dx / 2, y + dy / 2, 0); G.set(x + dx, y + dy, 0); st.push([x + dx, y + dy]);
    }
    if (braid) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (G.get(x, y) !== 1 || r() > braid) continue;
      const hor = G.get(x - 1, y) === 0 && G.get(x + 1, y) === 0 && G.get(x, y - 1) === 1 && G.get(x, y + 1) === 1;
      const ver = G.get(x, y - 1) === 0 && G.get(x, y + 1) === 0 && G.get(x - 1, y) === 1 && G.get(x + 1, y) === 1;
      if (hor || ver) G.set(x, y, 0);
    }
    return G;
  }
  /* rooms and corridors: returns grid (1 wall, 0 floor) and room list */
  function rooms(w, h, r, count, minS, maxS) {
    const G = grid(w, h, 1), list = [];
    for (let t = 0; t < count * 30 && list.length < count; t++) {
      const rw = r.int(minS || 5, maxS || 9), rh = r.int(minS || 5, (maxS || 9) - 1), x = r.int(1, w - rw - 2), y = r.int(1, h - rh - 2);
      if (list.some((o) => x < o.x + o.w + 1 && x + rw + 1 > o.x && y < o.y + o.h + 1 && y + rh + 1 > o.y)) continue;
      list.push({ x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1) });
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) G.set(xx, yy, 0);
    }
    const carve = (a, b) => {
      let x = a.cx, y = a.cy;
      while (x !== b.cx) { G.set(x, y, 0); x += Math.sign(b.cx - x); }
      while (y !== b.cy) { G.set(x, y, 0); y += Math.sign(b.cy - y); }
    };
    for (let i = 1; i < list.length; i++) {
      let best = 0, bd = 1e9; for (let j = 0; j < i; j++) { const d = Math.abs(list[i].cx - list[j].cx) + Math.abs(list[i].cy - list[j].cy); if (d < bd) { bd = d; best = j; } }
      carve(list[i], list[best]);
    }
    return { G, list };
  }
  /* push overlapping circles apart */
  function separate(list, strength) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, rr_ = a.r + b.r, d2 = dx * dx + dy * dy;
      if (d2 >= rr_ * rr_ || d2 === 0) continue;
      const d = Math.sqrt(d2), p = (rr_ - d) / d * 0.5 * (strength || 1);
      a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p;
    }
  }

  /* ---------- storage ---------- */
  let game = null;
  function load(k, d) { try { const v = localStorage.getItem('adv30:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('adv30:' + k, JSON.stringify(v)); } catch (e) { /* noop */ } }

  /* ---------- dialog / banner ---------- */
  const dlg = { on: false, lines: [], i: 0, ch: 0, cb: null, who: '' };
  function say(lines, cb, who) { dlg.on = true; dlg.lines = Array.isArray(lines) ? lines : [lines]; dlg.i = 0; dlg.ch = 0; dlg.cb = cb || null; dlg.who = who || ''; }
  function dlgUpdate(dt) {
    const s = dlg.lines[dlg.i]; const before = Math.floor(dlg.ch);
    dlg.ch += dt * 60; if (Math.floor(dlg.ch) > before && dlg.ch < s.length && before % 3 === 0) sfx('blip');
    if (hit('cross') || hit('circle') || IN.tap) {
      if (dlg.ch < s.length) dlg.ch = s.length;
      else { dlg.i++; dlg.ch = 0; if (dlg.i >= dlg.lines.length) { dlg.on = false; const c = dlg.cb; dlg.cb = null; if (c) c(); } }
    }
  }
  function dlgDraw() {
    const x = 130, y = 372, w = 700, h = 128;
    rrect(x, y, w, h, 14, 'rgba(8,10,18,.94)'); rrectS(x, y, w, h, 14, game.color || '#94a3b8', 2);
    if (dlg.who) { const ww = txtW(dlg.who, 14, 800) + 24; rrect(x + 18, y - 14, ww, 28, 8, game.color || '#94a3b8'); txt(dlg.who, x + 30, y + 1, 14, '#0b0d14', 'left', 800); }
    wrap(dlg.lines[dlg.i].slice(0, Math.floor(dlg.ch)), x + 26, y + 36, w - 52, 26, 19, '#e8ecf6', 'left', 600);
    if (dlg.ch >= dlg.lines[dlg.i].length) glyph('cross', x + w - 26, y + h - 24, 12, 0.6 + 0.4 * Math.sin(performance.now() / 150));
  }
  const ban = { t: 0, s: '', sub: '', dur: 2.4 };
  function banner(s, sub, dur) { ban.s = s; ban.sub = sub || ''; ban.t = dur || 2.4; ban.dur = dur || 2.4; }
  function banDraw() {
    if (ban.t <= 0) return;
    const a = clamp(Math.min(ban.t, ban.dur - ban.t) * 4, 0, 1);
    g.globalAlpha = a;
    rect(0, 196, W, ban.sub ? 96 : 70, 'rgba(6,8,14,.72)');
    txt(ban.s, W / 2, ban.sub ? 228 : 232, 34, game.color || '#fff', 'center', 900);
    if (ban.sub) txt(ban.sub, W / 2, 266, 17, '#cbd5e1', 'center', 600);
    g.globalAlpha = 1;
  }
  let hintS = '', hintT = 0;
  function hint(s, t) { hintS = s; hintT = t || 3; }

  /* ---------- shell ---------- */
  let scene = 'title', sceneT = 0, menuI = 0, overData = null, crash = null, clock = 0, playT = 0;
  function setScene(s) { scene = s; sceneT = 0; menuI = 0; }
  function begin(retry) {
    audioInit(); fx.clear(); cam.reset(); dlg.on = false; ban.t = 0; hintT = 0;
    if (!retry) playT = 0;
    setScene('play');
    if (retry && game.retry) game.retry(); else game.start();
    if (game.music) music(game.music);
  }
  function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function win(o) {
    if (scene !== 'play') return; o = o || {};
    const prev = load('done:' + game.id, null);
    const rec = { t: Math.round(playT) }; let isNew = !prev || rec.t < prev.t;
    if (isNew) save('done:' + game.id, rec);
    overData = { win: true, title: o.title || 'JOURNEY COMPLETE', text: o.text || '', stats: (o.stats || []).concat([['Time', fmtTime(playT)], ['Best', fmtTime(isNew ? rec.t : prev.t)]]), isNew: isNew && !!prev };
    setScene('over'); sfx('win'); music(null);
  }
  function lose(o) {
    if (scene !== 'play') return; o = o || {};
    overData = { win: false, title: o.title || 'YOU FELL', text: o.text || '', stats: o.stats || [], retry: !!game.retry && o.retry !== false };
    setScene('over'); sfx('lose'); music(null);
  }
  function quit() { location.href = 'index.html'; }

  function drawBackdrop(t) {
    const c = game.color || '#7dd3fc';
    rect(0, 0, W, H, '#07080e');
    const gr = g.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.4, 620);
    gr.addColorStop(0, c + '33'); gr.addColorStop(1, 'rgba(7,8,14,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.5;
    for (let i = 0; i < 40; i++) {
      const x = (hash2(i, 1, 3) * W + t * (6 + hash2(i, 2, 3) * 18)) % W, y = hash2(i, 3, 3) * H + Math.sin(t * 0.6 + i) * 8;
      circ(x, y, 1 + hash2(i, 4, 3) * 2, c);
    }
    g.globalAlpha = 1;
  }
  function ctrlRow(list, cx, y, r, size) {
    /* centred, wrapping row of [buttons,label] */
    const items = list.map(([k, label]) => { const ks = Array.isArray(k) ? k : [k]; let w = 0; ks.forEach((n) => { w += glyphW(n, r) + 4; }); return { ks, label, w: w + txtW(label, size, 600) + 6 }; });
    const rows = [[]]; let cw = 0;
    for (const it of items) { if (cw + it.w + 22 > 860 && rows[rows.length - 1].length) { rows.push([]); cw = 0; } rows[rows.length - 1].push(it); cw += it.w + 22; }
    rows.forEach((row, ri) => {
      let tw = -22; row.forEach((it) => { tw += it.w + 22; }); let x = cx - tw / 2; const yy = y + ri * (r * 2 + 10);
      for (const it of row) { for (const n of it.ks) { const gw = glyphW(n, r); glyph(n, x + gw / 2, yy, r); x += gw + 4; } txt(it.label, x + 2, yy + 1, size, '#cbd5e1', 'left', 600); x += txtW(it.label, size, 600) + 4 + 22; }
    });
    return rows.length * (r * 2 + 10);
  }
  function titleDraw(t) {
    drawBackdrop(t);
    if (game.art) { g.save(); try { game.art(t); } catch (e) { /* decorative only */ } g.restore(); }
    txt('ADVENTURE ' + (game.num ? String(game.num).padStart(2, '0') : '') + ' OF 30', W / 2, 62, 13, '#8b93a7', 'center', 800);
    g.save(); g.shadowColor = game.color; g.shadowBlur = 28;
    txt(game.title, W / 2, 128, game.title.length > 15 ? 58 : 72, '#fff', 'center', 900); g.restore();
    txt(game.tag || '', W / 2, 184, 19, game.color, 'center', 700);
    rrect(150, 216, 660, 86, 14, 'rgba(255,255,255,.05)');
    txt('YOUR QUEST', W / 2, 234, 11, '#8b93a7', 'center', 800);
    wrap(game.goal || '', W / 2, 258, 610, 22, 16, '#e2e8f0', 'center', 600);
    ctrlRow(game.controls || [], W / 2, 340, 13, 14);
    g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4);
    const pw = txtW('BEGIN', 20, 900) + 44; glyph('cross', W / 2 - pw / 2 + 14, 470, 15); txt('BEGIN', W / 2 - pw / 2 + 40, 471, 20, '#fff', 'left', 900);
    g.globalAlpha = 1;
    glyph('circle', 404, 512, 9, 0.7); txt('All adventures', 418, 513, 12, '#8b93a7', 'left', 600);
    const st = IN.pad ? 'Controller connected' : 'Controller, touch or keyboard';
    txt(st + (A.muted ? ' · muted' : ''), 540, 513, 12, IN.pad ? '#6ee7b7' : '#8b93a7', 'left', 600);
    const done = load('done:' + game.id, null); if (done) txt('✓ COMPLETED · BEST ' + fmtTime(done.t), W / 2, 30, 13, '#6ee7b7', 'center', 800);
  }
  function menuDraw(title, col, items, sub) {
    rect(0, 0, W, H, 'rgba(5,6,12,.82)');
    txt(title, W / 2, 120, 50, col, 'center', 900);
    let y = 176;
    if (sub) { const n = wrap(sub, W / 2, y, 640, 23, 17, '#cbd5e1', 'center', 600); y += n * 23 + 10; }
    return y;
  }
  function menuList(items, y) {
    items.forEach((it, i) => {
      const yy = y + i * 46, sel = i === menuI;
      rrect(W / 2 - 170, yy - 19, 340, 38, 10, sel ? (game.color || '#7dd3fc') : 'rgba(255,255,255,.07)');
      txt(it, W / 2, yy + 1, 17, sel ? '#0b0d14' : '#e2e8f0', 'center', 800);
    });
  }
  function menuInput(n, y) {
    if (IN.ny) { menuI = (menuI + IN.ny + n) % n; sfx('move'); }
    if (IN.tap) for (let i = 0; i < n; i++) if (Math.abs(IN.tap.x - W / 2) < 170 && Math.abs(IN.tap.y - (y + i * 46)) < 21) { menuI = i; return true; }
    return hit('cross');
  }
  let menuY = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (crash) { crashDraw(); return; }
    try { step(now); } catch (e) { crash = e; console.error(e); window.__crash = String(e && e.stack || e); }
  }
  let last = 0;
  function step(now) {
    let dt = (now - last) / 1000; last = now; if (!(dt > 0)) dt = 0.016; dt = Math.min(dt, 0.05);
    clock += dt; sceneT += dt;
    poll(dt); musicTick();
    if (hit('share')) { A.muted = !A.muted; save('muted', A.muted); if (A.master) A.master.gain.value = A.muted ? 0 : 0.85; }
    g.setTransform(SC, 0, 0, SC, OX, OY);
    g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    if (scene === 'title') {
      titleDraw(clock);
      if (sceneT > 0.25) { if (hit('cross') || (IN.tap && IN.tap.y > 60)) { sfx('select'); begin(false); } else if (hit('circle')) quit(); }
    } else if (scene === 'play') {
      if (hit('options')) { setScene('pause'); sfx('back'); }
      else {
        if (fx.stop > 0) fx.stop -= dt;
        else if (dlg.on) dlgUpdate(dt);
        else { playT += dt; game.update(dt); fx.update(dt); }
        ban.t -= dt; hintT -= dt;
      }
      game.draw(clock);
      overlay();
    } else if (scene === 'pause') {
      game.draw(clock);
      const items = ['RESUME', 'RESTART', 'ALL ADVENTURES'];
      const y = menuDraw('PAUSED', '#fff', items, game.goal) + 24;
      const used = ctrlRow(game.controls || [], W / 2, y, 12, 13);
      menuY = y + used + 26; menuList(items, menuY);
      if (hit('options') || hit('circle')) { setScene('play'); sceneT = 1; }
      else if (menuInput(items.length, menuY)) { sfx('select'); if (menuI === 0) { scene = 'play'; } else if (menuI === 1) begin(false); else quit(); }
    } else if (scene === 'over') {
      game.draw(clock);
      const o = overData;
      const items = o.win ? ['PLAY AGAIN', 'ALL ADVENTURES'] : (o.retry ? ['TRY AGAIN', 'START OVER', 'ALL ADVENTURES'] : ['TRY AGAIN', 'ALL ADVENTURES']);
      let y = menuDraw(o.title, o.win ? (game.color || '#6ee7b7') : '#fb7185', items, o.text);
      if (o.isNew) { txt('NEW BEST TIME', W / 2, y + 4, 14, '#fde047', 'center', 900); y += 26; }
      o.stats.forEach(([k, v], i) => { txt(k, W / 2 - 12, y + i * 24 + 6, 16, '#94a3b8', 'right', 600); txt(String(v), W / 2 + 12, y + i * 24 + 6, 16, '#fff', 'left', 800); });
      menuY = y + o.stats.length * 24 + 40; menuList(items, menuY);
      if (sceneT > 0.7 && menuInput(items.length, menuY)) {
        sfx('select'); const it = items[menuI];
        if (it === 'ALL ADVENTURES') quit(); else if (it === 'TRY AGAIN' && !o.win && o.retry) begin(true); else begin(false);
      }
    }
    if (fx.flashT > 0) { g.globalAlpha = clamp(fx.flashT / fx.flashMax, 0, 1) * 0.6; rect(0, 0, W, H, fx.flashC); g.globalAlpha = 1; }
    if (IN.showTouch && scene === 'play') touchDraw();
    g.restore();
    /* letterbox */
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000';
    if (OX > 0) { g.fillRect(0, 0, OX, cv.height); g.fillRect(cv.width - OX, 0, OX + 1, cv.height); }
    if (OY > 0) { g.fillRect(0, 0, cv.width, OY); g.fillRect(0, cv.height - OY, cv.width, OY + 1); }
    IN.tap = null;
  }
  function overlay() {
    banDraw();
    if (hintT > 0 && !dlg.on) {
      g.globalAlpha = clamp(hintT * 2, 0, 1); const w = txtW(hintS, 15, 700) + 30;
      rrect(W / 2 - w / 2, 462, w, 30, 15, 'rgba(6,8,14,.8)'); txt(hintS, W / 2, 478, 15, '#e2e8f0', 'center', 700); g.globalAlpha = 1;
    }
    if (dlg.on) dlgDraw();
  }
  function touchDraw() {
    g.globalAlpha = 0.5;
    for (const b of touchBtns) {
      if (b.r) glyph(b.n, b.x, b.y, b.r, T.btn[b.n] !== undefined ? 1 : 0.6);
      else { rrect(b.x, b.y, b.w, b.h, 9, T.btn[b.n] !== undefined ? 'rgba(255,255,255,.3)' : 'rgba(12,15,24,.7)'); rrectS(b.x, b.y, b.w, b.h, 9, 'rgba(255,255,255,.3)', 1.2); txt(LABEL[b.n] || b.n, b.x + b.w / 2, b.y + b.h / 2 + 1, 13, '#e8ecf6', 'center', 800); }
    }
    for (const s of [T.l, T.r]) {
      if (!s) continue; ring(s.ox, s.oy, 60, 'rgba(255,255,255,.4)', 2);
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy) || 1, m = Math.min(d, 60);
      circ(s.ox + dx / d * m, s.oy + dy / d * m, 24, 'rgba(255,255,255,.35)');
    }
    if (!T.l) { ring(120, 420, 52, 'rgba(255,255,255,.18)', 2); }
    g.globalAlpha = 1;
  }
  function crashDraw() {
    g.setTransform(SC, 0, 0, SC, OX, OY);
    rect(0, 0, W, H, '#12060a');
    txt('SOMETHING BROKE', W / 2, 150, 40, '#fb7185', 'center', 900);
    wrap(String(crash && crash.message || crash), W / 2, 210, 760, 22, 15, '#fecdd3', 'center', 600);
    txt('Press ✕ / tap to reload · ○ for all adventures', W / 2, 400, 16, '#e2e8f0', 'center', 700);
    poll(0.016);
    if (hit('cross') || IN.tap) location.reload(); else if (hit('circle')) quit();
    IN.tap = null;
  }

  function run(cfg) {
    game = cfg;
    const boot = () => {
      document.title = cfg.title.replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()) + ' — Thirty Adventures';
      const st = document.createElement('style');
      st.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}canvas{display:block;width:100%;height:100%;touch-action:none}';
      document.head.appendChild(st);
      cv = document.createElement('canvas'); document.body.appendChild(cv);
      g = cv.getContext('2d', { alpha: false }); K.g = g;
      resize(); addEventListener('resize', resize); addEventListener('orientationchange', resize);
      A.muted = load('muted', false);
      layoutTouch(cfg);
      addEventListener('keydown', (e) => { const k = KEYMAP[e.code]; if (k) { keys[k] = true; e.preventDefault(); } audioInit(); });
      addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) { keys[k] = false; e.preventDefault(); } });
      addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
      cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* noop */ } const v = toV(e.clientX, e.clientY); ptDown(e.pointerId, v.x, v.y); e.preventDefault(); });
      cv.addEventListener('pointermove', (e) => { const v = toV(e.clientX, e.clientY); ptMove(e.pointerId, v.x, v.y); e.preventDefault(); });
      cv.addEventListener('pointerup', (e) => { ptUp(e.pointerId); e.preventDefault(); });
      cv.addEventListener('pointercancel', (e) => { ptUp(e.pointerId); });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('visibilitychange', () => { if (document.hidden && scene === 'play') setScene('pause'); });
      if (cfg.init) cfg.init();
      requestAnimationFrame((t) => { last = t; frame(t); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  const K = {
    W, H, TAU, g: null, run, win, lose, say, banner, hint, sfx, tone, noise, music, fx, cam,
    rand, irand, pick, clamp, lerp, dist, ang, approach, angDiff, damp, shuffle, rng, hash2, noise2,
    circ, ring, rect, rectS, rrect, rrectS, line, txt, txtW, poly, tri, wrap, bar, hearts, hsl, glyph,
    down, hit, up, trig, IN, grid, bfs, bfsStep, los, moveC, moveB, cave, maze, rooms, separate, load, save, fmtTime,
    get scene() { return scene; }, get time() { return playT; }, get talking() { return dlg.on; },
    /* test hook: lets the smoke test drive buttons without a real device */
    _keys: keys, _ax: null,
  };
  window.K = K;
})();
