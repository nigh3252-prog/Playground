/* ==========================================================================
   BB — shared Backbone (PlayStation Edition) controller kit
   Gamepad input w/ PS glyphs, analog triggers, haptics, keyboard fallback,
   synth audio, title / pause / game-over shell, best scores.
   ========================================================================== */
(function () {
  'use strict';

  // ---- Standard Gamepad mapping (Backbone One reports "standard") --------
  const BTN = {
    CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3,
    L1: 4, R1: 5, L2: 6, R2: 7,
    CREATE: 8, OPTIONS: 9, L3: 10, R3: 11,
    UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16,
  };
  const NBTN = 17;
  const COLORS = { cross: '#7fb1ff', circle: '#ff6b7a', square: '#ff8be0', triangle: '#3ee6b4' };
  const NAME_TO_BTN = {
    cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7,
    create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15,
  };

  // ---- Keyboard fallback (for desktop testing) ---------------------------
  const KEYMAP = {
    Space: 0, KeyZ: 0, KeyK: 0, KeyX: 1, KeyL: 1, KeyC: 2, KeyJ: 2, KeyV: 3, KeyI: 3,
    KeyQ: 4, KeyE: 5, KeyF: 6, KeyR: 7, Enter: 9, Escape: 9, Backspace: 8, KeyM: 8,
    ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15,
  };
  const keys = new Set();
  addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    Audio.unlock();
  }, { passive: false });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function dz(x, y, d = 0.16) {
    const m = Math.hypot(x, y);
    if (m < d) return [0, 0];
    const s = Math.min(1, (m - d) / (1 - d)) / m;
    return [x * s, y * s];
  }

  // ---- Pad --------------------------------------------------------------
  const Pad = {
    connected: false, id: '', gp: null, kb: false,
    lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0,
    cur: new Float32Array(NBTN), prev: new Float32Array(NBTN),
    lastInput: 0,
    update() {
      this.prev.set(this.cur);
      this.cur.fill(0);
      let gp = null;
      const list = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const g of list) {
        if (g && g.connected && (!gp || g.timestamp > gp.timestamp)) gp = g;
      }
      this.gp = gp;
      let lx = 0, ly = 0, rx = 0, ry = 0;
      if (gp) {
        if (!this.connected) { this.connected = true; this.id = gp.id; fire('connect', gp); }
        for (let i = 0; i < NBTN && i < gp.buttons.length; i++) {
          const b = gp.buttons[i];
          this.cur[i] = b ? (b.value || (b.pressed ? 1 : 0)) : 0;
        }
        const ax = gp.axes;
        [lx, ly] = dz(ax[0] || 0, ax[1] || 0);
        [rx, ry] = dz(ax[2] || 0, ax[3] || 0);
      } else if (this.connected) {
        this.connected = false; fire('disconnect');
      }
      // keyboard merge
      this.kb = keys.size > 0;
      for (const k of keys) { const b = KEYMAP[k]; if (b !== undefined) this.cur[b] = 1; }
      const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const ky = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      if (kx || ky) { const m = Math.hypot(kx, ky); lx = kx / m; ly = ky / m; }
      if (keys.has('KeyW')) this.cur[BTN.UP] = 1;
      if (keys.has('KeyS')) this.cur[BTN.DOWN] = 1;
      if (keys.has('KeyA')) this.cur[BTN.LEFT] = 1;
      if (keys.has('KeyD')) this.cur[BTN.RIGHT] = 1;
      const jx = (keys.has('Numpad6') || keys.has('KeyO') ? 1 : 0) - (keys.has('Numpad4') || keys.has('KeyU') ? 1 : 0);
      const jy = (keys.has('Numpad2') || keys.has('Semicolon') ? 1 : 0) - (keys.has('Numpad8') || keys.has('Digit9') ? 1 : 0);
      if (jx || jy) { const m = Math.hypot(jx, jy); rx = jx / m; ry = jy / m; }
      this.lx = lx; this.ly = ly; this.rx = rx; this.ry = ry;
      this.l2 = this.cur[BTN.L2]; this.r2 = this.cur[BTN.R2];
      for (let i = 0; i < NBTN; i++) if (this.cur[i] > 0.5 && this.prev[i] <= 0.5) { this.lastInput = performance.now(); Audio.resume(); break; }
    },
    down(b) { return this.cur[b] > 0.5; },
    pressed(b) { return this.cur[b] > 0.5 && this.prev[b] <= 0.5; },
    released(b) { return this.cur[b] <= 0.5 && this.prev[b] > 0.5; },
    value(b) { return this.cur[b]; },
    anyPressed() { for (let i = 0; i < NBTN; i++) if (this.pressed(i)) return true; return false; },
    /** Left stick merged with d-pad. */
    move() {
      let x = this.lx, y = this.ly;
      const dx = (this.down(BTN.RIGHT) ? 1 : 0) - (this.down(BTN.LEFT) ? 1 : 0);
      const dy = (this.down(BTN.DOWN) ? 1 : 0) - (this.down(BTN.UP) ? 1 : 0);
      if (dx || dy) { const m = Math.hypot(dx, dy); x = dx / m; y = dy / m; }
      return { x, y };
    },
    /** Edge-triggered menu navigation from d-pad or stick (with repeat). */
    _nav: { x: 0, y: 0, t: 0 },
    nav(dt) {
      const m = this.move();
      const nx = Math.abs(m.x) > 0.55 ? Math.sign(m.x) : 0;
      const ny = Math.abs(m.y) > 0.55 ? Math.sign(m.y) : 0;
      const n = this._nav;
      let ox = 0, oy = 0;
      if (nx !== n.x || ny !== n.y) { ox = nx; oy = ny; n.t = 0.38; }
      else if (nx || ny) { n.t -= dt || 0.016; if (n.t <= 0) { ox = nx; oy = ny; n.t = 0.11; } }
      n.x = nx; n.y = ny;
      return { x: ox, y: oy };
    },
    _lastRumble: 0,
    rumble(strong = 0.6, weak = 0.6, ms = 120) {
      if (Settings.haptics === false) return;
      const gp = this.gp;
      const va = gp && gp.vibrationActuator;
      if (va && va.playEffect) {
        try { va.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) }).catch(() => {}); } catch (e) { /* noop */ }
      }
      // The Backbone has no rumble motors, so big moments also buzz the phone itself
      // (Android; iOS Safari has no vibration API). Needs a prior tap on the page.
      const ua = navigator.userActivation;
      if (navigator.vibrate && strong > 0.45 && (!ua || ua.hasBeenActive)) {
        const now = performance.now();
        if (now - this._lastRumble > 90) { this._lastRumble = now; try { navigator.vibrate(Math.min(ms, 200)); } catch (e) { /* noop */ } }
      }
    },
  };

  const listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function fire(ev, a) { (listeners[ev] || []).forEach((f) => { try { f(a); } catch (e) { console.error(e); } }); }

  // ---- Storage-safe settings / best scores -----------------------------
  function load(k, d) { try { const v = localStorage.getItem('bb:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('bb:' + k, JSON.stringify(v)); } catch (e) { /* noop */ } }
  const Settings = { muted: load('muted', false), haptics: load('haptics', true) };
  function best(key, score, lowerIsBetter) {
    const prev = load('best:' + key, null);
    let isNew = false, b = prev;
    if (score !== undefined && score !== null) {
      if (prev === null || (lowerIsBetter ? score < prev : score > prev)) { b = score; isNew = prev !== null || score > 0; save('best:' + key, score); }
    }
    return { best: b, isNew, prev };
  }

  // ---- Audio ------------------------------------------------------------
  const Audio = {
    ctx: null, master: null, sfx: null, music: null, _noise: null,
    init() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = Settings.muted ? 0 : 0.9;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
      this.music = this.ctx.createGain(); this.music.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
      return this.ctx;
    },
    unlock() { this.init(); this.resume(); },
    resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); },
    get running() { return !!this.ctx && this.ctx.state === 'running'; },
    now() { return this.ctx ? this.ctx.currentTime : 0; },
    setMuted(m) { Settings.muted = m; save('muted', m); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03); },
    tone(o) {
      const c = this.ctx; if (!c || c.state !== 'running') return;
      const t = (o.when !== undefined ? o.when : c.currentTime);
      const dur = o.dur || 0.1, vol = o.vol === undefined ? 0.2 : o.vol;
      const osc = c.createOscillator();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(o.f || 440, t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
      if (o.detune) osc.detune.value = o.detune;
      const g = c.createGain();
      const a = o.attack || 0.004;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = osc;
      if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 1; osc.connect(f); node = f; }
      node.connect(g); g.connect(o.dest || this.sfx);
      osc.start(t); osc.stop(t + dur + 0.05);
    },
    noise(o) {
      const c = this.ctx; if (!c || c.state !== 'running') return;
      const t = (o.when !== undefined ? o.when : c.currentTime);
      const dur = o.dur || 0.2, vol = o.vol === undefined ? 0.3 : o.vol;
      const src = c.createBufferSource(); src.buffer = this._noise;
      const f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 1200, t);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
      f.Q.value = o.q || 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.003));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(o.dest || this.sfx);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    },
  };
  const unlockEvents = ['pointerdown', 'touchend', 'mousedown'];
  unlockEvents.forEach((ev) => addEventListener(ev, () => Audio.unlock(), { passive: true }));

  // ---- Glyphs -----------------------------------------------------------
  function glyphSVG(name, size) {
    size = size || 26;
    const col = COLORS[name];
    const disc = '<circle cx="16" cy="16" r="14.5" fill="#151924" stroke="rgba(255,255,255,.28)" stroke-width="1.2"/>';
    const st = `fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
    let inner = '', vb = '0 0 32 32', w = size, h = size;
    switch (name) {
      case 'cross': inner = disc + `<path d="M10.5 10.5L21.5 21.5M21.5 10.5L10.5 21.5" ${st}/>`; break;
      case 'circle': inner = disc + `<circle cx="16" cy="16" r="6.4" ${st}/>`; break;
      case 'square': inner = disc + `<rect x="10.2" y="10.2" width="11.6" height="11.6" rx="0.6" ${st}/>`; break;
      case 'triangle': inner = disc + `<path d="M16 9.2L23 21.4H9Z" ${st}/>`; break;
      case 'l1': case 'r1': case 'l2': case 'r2': {
        vb = '0 0 44 30'; w = size * 44 / 30; h = size;
        const top = name[1] === '2';
        const path = top ? 'M4 26V12Q4 4 12 4H32Q40 4 40 12V26Z' : 'M3 24V10Q3 6 7 6H37Q41 6 41 10V24Z';
        inner = `<path d="${path}" fill="#151924" stroke="rgba(255,255,255,.4)" stroke-width="1.4"/><text x="22" y="${top ? 20.5 : 19.6}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="12" fill="#e8ecf6">${name.toUpperCase()}</text>`;
        break;
      }
      case 'ls': case 'rs': case 'l3': case 'r3': {
        const L = name[0] === 'l' ? 'L' : 'R';
        inner = `<circle cx="16" cy="16" r="14.5" fill="#151924" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><circle cx="16" cy="16" r="9.5" fill="#232a3a" stroke="rgba(255,255,255,.18)"/>` +
          `<path d="M16 2.8l2.2 2.6h-4.4zM16 29.2l2.2-2.6h-4.4zM2.8 16l2.6-2.2v4.4zM29.2 16l-2.6-2.2v4.4z" fill="rgba(255,255,255,.55)"/>` +
          `<text x="16" y="20.2" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="${name[1] === '3' ? 9.5 : 11}" fill="#e8ecf6">${name[1] === '3' ? L + '3' : L}</text>`;
        break;
      }
      case 'dpad': case 'up': case 'down': case 'left': case 'right': {
        const hi = (d) => (name === d ? '#e8ecf6' : '#3a4256');
        inner = `<circle cx="16" cy="16" r="14.5" fill="#151924" stroke="rgba(255,255,255,.28)" stroke-width="1.2"/>` +
          `<path d="M12.6 5.5h6.8v7h-6.8z" fill="${name === 'dpad' ? '#cfd6e6' : hi('up')}"/><path d="M12.6 19.5h6.8v7h-6.8z" fill="${name === 'dpad' ? '#cfd6e6' : hi('down')}"/>` +
          `<path d="M5.5 12.6h7v6.8h-7z" fill="${name === 'dpad' ? '#cfd6e6' : hi('left')}"/><path d="M19.5 12.6h7v6.8h-7z" fill="${name === 'dpad' ? '#cfd6e6' : hi('right')}"/><rect x="12.6" y="12.6" width="6.8" height="6.8" fill="#2a3245"/>`;
        break;
      }
      case 'options': case 'create': {
        vb = '0 0 30 30';
        const lines = name === 'options' ? '<path d="M10 11h10M10 15h10M10 19h10" stroke="#e8ecf6" stroke-width="1.8" stroke-linecap="round"/>'
          : '<path d="M15 9v9M11.5 12.5L15 9l3.5 3.5M10 17v4h10v-4" fill="none" stroke="#e8ecf6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
        inner = `<rect x="3" y="5" width="24" height="20" rx="10" fill="#151924" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>${lines}`;
        break;
      }
      default: inner = disc;
    }
    return `<svg class="bbg" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${vb}" aria-label="${name}">${inner}</svg>`;
  }

  /** Draw a face-button glyph on a canvas. */
  function drawGlyph(ctx, name, x, y, r, opts) {
    opts = opts || {};
    const col = opts.color || COLORS[name] || '#fff';
    ctx.save();
    ctx.translate(x, y);
    if (opts.disc !== false) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = opts.discFill || 'rgba(14,17,26,.92)'; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.08); ctx.strokeStyle = opts.ring || 'rgba(255,255,255,.3)'; ctx.stroke();
    }
    ctx.strokeStyle = col; ctx.lineWidth = opts.lw || r * 0.18; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const s = r * 0.42;
    ctx.beginPath();
    if (name === 'cross') { ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); }
    else if (name === 'circle') { ctx.arc(0, 0, s * 1.05, 0, Math.PI * 2); }
    else if (name === 'square') { ctx.rect(-s * 0.95, -s * 0.95, s * 1.9, s * 1.9); }
    else if (name === 'triangle') { ctx.moveTo(0, -s * 1.15); ctx.lineTo(s * 1.15, s * 0.85); ctx.lineTo(-s * 1.15, s * 0.85); ctx.closePath(); }
    ctx.stroke();
    ctx.restore();
  }

  /** Replace <i data-g="cross"></i> elements with SVG glyphs. */
  function hydrate(root) {
    (root || document).querySelectorAll('[data-g]').forEach((el) => {
      if (el.dataset.done) return;
      el.dataset.done = 1;
      el.innerHTML = glyphSVG(el.dataset.g, +el.dataset.s || 24);
    });
  }

  // ---- Shell UI ----------------------------------------------------------
  const CSS = `
  :root{--bb-acc:#7fb1ff;--bb-bg:#07080d}
  html,body{margin:0;height:100%;background:var(--bb-bg);overflow:hidden;overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eef2fb}
  .bbg{display:inline-block;vertical-align:middle;flex:none}
  #bb-ui{position:fixed;inset:0;pointer-events:none;z-index:50}
  .bb-screen{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:safe center;overflow-y:auto;gap:clamp(6px,1.6vh,14px);
    padding:max(14px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
    background:radial-gradient(ellipse at center,rgba(6,8,14,.55),rgba(4,5,9,.88));pointer-events:auto;text-align:center;box-sizing:border-box}
  .bb-screen.on{display:flex;animation:bbIn .28s ease-out}
  @keyframes bbIn{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:none}}
  .bb-title{font-weight:900;letter-spacing:.08em;font-size:clamp(30px,8.5vh,78px);line-height:.95;margin:0;
    background:linear-gradient(180deg,#fff 10%,var(--bb-acc) 95%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 22px color-mix(in srgb,var(--bb-acc) 55%,transparent))}
  .bb-tag{margin:0;color:#aeb7cc;font-size:clamp(12px,2.6vh,17px);max-width:44em}
  .bb-controls{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 16px;max-width:min(92vw,820px);margin-top:4px}
  .bb-controls span{display:inline-flex;align-items:center;gap:6px;font-size:clamp(11px,2.3vh,14px);color:#d5dbea;white-space:nowrap}
  .bb-prompt{margin-top:6px;font-weight:800;letter-spacing:.14em;font-size:clamp(13px,3vh,19px);display:inline-flex;align-items:center;gap:10px;animation:bbPulse 1.4s ease-in-out infinite}
  @keyframes bbPulse{50%{opacity:.45}}
  .bb-status{font-size:12px;color:#8590a8;letter-spacing:.04em}
  .bb-status b{color:#3ee6b4;font-weight:700}
  .bb-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
  .bb-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 16px 9px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#eef2fb;font:inherit;font-weight:700;font-size:clamp(12px,2.5vh,15px);cursor:pointer}
  .bb-btn:active{background:rgba(255,255,255,.16)}
  .bb-h2{margin:0;font-size:clamp(26px,7vh,56px);font-weight:900;letter-spacing:.1em}
  .bb-stats{display:grid;grid-template-columns:auto auto;gap:4px 22px;font-size:clamp(13px,2.8vh,17px);margin:4px 0 8px}
  .bb-stats dt{color:#99a3ba;text-align:right}.bb-stats dd{margin:0;text-align:left;font-weight:800;font-variant-numeric:tabular-nums}
  .bb-new{color:#ffd76a;font-weight:900;letter-spacing:.2em;font-size:13px;animation:bbPulse .8s infinite}
  #bb-toast{position:absolute;left:50%;top:max(12px,env(safe-area-inset-top));transform:translate(-50%,-140%);transition:transform .35s cubic-bezier(.2,1.4,.4,1);background:rgba(16,19,28,.92);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:7px 16px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center;white-space:nowrap}
  #bb-toast.on{transform:translate(-50%,0)}
  #bb-rotate{position:fixed;inset:0;z-index:99;background:#07080d;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#cfd6e6;font-weight:700;text-align:center;padding:24px}
  @media (orientation:portrait) and (pointer:coarse){#bb-rotate{display:flex}}
  #bb-rotate .ph{width:46px;height:80px;border:3px solid #cfd6e6;border-radius:9px;animation:bbRot 2s ease-in-out infinite}
  @keyframes bbRot{0%,30%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}
  .bb-extra{display:flex;flex-direction:column;align-items:center;gap:8px}
  `;

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  const g = (n, s) => `<i data-g="${n}" data-s="${s || 22}"></i>`;

  let game = null, ui = {}, state = 'boot', stateT = 0, lastT = 0, toastTimer = 0, overDelay = 0;

  function controlsHTML(list) {
    return list.map(([keys, label]) => {
      const ks = Array.isArray(keys) ? keys : [keys];
      return `<span>${ks.map((k) => g(k, 22)).join('')} ${label}</span>`;
    }).join('');
  }

  function buildUI(cfg) {
    const st = el('style'); st.textContent = CSS; document.head.appendChild(st);
    if (cfg.accent) document.documentElement.style.setProperty('--bb-acc', cfg.accent);
    const root = el('div'); root.id = 'bb-ui'; document.body.appendChild(root);

    ui.title = el('div', 'bb-screen');
    ui.title.innerHTML = `<h1 class="bb-title">${cfg.title}</h1><p class="bb-tag">${cfg.tagline || ''}</p>
      <div class="bb-extra"></div>
      <div class="bb-controls">${controlsHTML(cfg.controls || [])}</div>
      <div class="bb-prompt">${g('cross', 28)} ${cfg.startLabel || 'PRESS TO START'}</div>
      <div class="bb-status"></div>`;
    ui.titleExtra = ui.title.querySelector('.bb-extra');
    if (cfg.titleExtra) ui.titleExtra.innerHTML = cfg.titleExtra; else ui.titleExtra.remove();
    ui.status = ui.title.querySelector('.bb-status');
    ui.prompt = ui.title.querySelector('.bb-prompt');
    ui.title.addEventListener('click', (e) => { if (e.target.closest('[data-noclick]')) return; if (state === 'title') begin(); });
    root.appendChild(ui.title);

    ui.pause = el('div', 'bb-screen');
    const extra = (cfg.pauseActions || []).map((a, i) => `<button class="bb-btn" data-pa="${i}">${g(a.btn, 24)} ${a.label}</button>`).join('');
    ui.pause.innerHTML = `<h2 class="bb-h2">PAUSED</h2><div class="bb-row">
      <button class="bb-btn" data-a="resume">${g('cross', 24)} Resume</button>
      <button class="bb-btn" data-a="restart">${g('triangle', 24)} Restart</button>${extra}
      <button class="bb-btn" data-a="quit">${g('circle', 24)} Arcade</button></div>
      <div class="bb-controls" style="margin-top:10px">${controlsHTML(cfg.controls || [])}</div>
      <div class="bb-status">${g('create', 20)} sound on/off · ${g('l3', 20)}+${g('r3', 20)} haptics on/off</div>`;
    ui.pause.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a],[data-pa]'); if (!b) return;
      if (b.dataset.pa) return pauseAction(+b.dataset.pa);
      ({ resume, restart, quit })[b.dataset.a]();
    });
    root.appendChild(ui.pause);

    ui.over = el('div', 'bb-screen');
    ui.over.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b || overDelay > 0) return;
      ({ restart, quit })[b.dataset.a]();
    });
    root.appendChild(ui.over);

    ui.toast = el('div'); ui.toast.id = 'bb-toast'; root.appendChild(ui.toast);
    const rot = el('div'); rot.id = 'bb-rotate'; rot.innerHTML = '<div class="ph"></div><div>Rotate to landscape<br><span style="font-weight:500;color:#8590a8">and snap in your Backbone</span></div>'; document.body.appendChild(rot);
    hydrate(document);
  }

  function updateStatus() {
    if (!ui.status) return;
    let s = Pad.connected ? `<b>●</b> ${escapeHTML(shortId(Pad.id))}` : 'Connect your Backbone and press any button';
    if (!Audio.running) s += ' · tap screen for sound';
    if (Settings.muted) s += ' · muted';
    if (ui.status._s !== s) { ui.status._s = s; ui.status.innerHTML = s; }
  }
  function shortId(id) { return (id || '').replace(/\(.*?Vendor.*?\)/i, '').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Controller'; }
  function escapeHTML(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function show(name) { ['title', 'pause', 'over'].forEach((k) => ui[k].classList.toggle('on', k === name)); }
  function setState(s) { state = s; stateT = 0; }

  function begin() {
    Audio.unlock();
    if (game.canStart && !game.canStart()) return;
    show(null); setState('play');
    game.start && game.start();
  }
  function resume() { show(null); setState('play'); game.resume && game.resume(); }
  function restart() { show(null); setState('play'); game.start && game.start(); }
  function quit() { game.quit && game.quit(); location.href = game.home || 'index.html'; }
  function pause() { if (state !== 'play') return; setState('paused'); show('pause'); game.pause && game.pause(); }
  function pauseAction(i) { const a = game.pauseActions[i]; show(null); setState('play'); a.fn(); }
  function toTitle() { setState('title'); show('title'); game.onTitle && game.onTitle(); }

  function over(o) {
    o = o || {};
    if (state === 'over') return;
    setState('over');
    overDelay = 0.9;
    const stats = (o.stats || []).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    ui.over.innerHTML = `<h2 class="bb-h2" style="color:${o.color || '#fff'}">${o.title || 'GAME OVER'}</h2>
      ${o.isNew ? '<div class="bb-new">NEW BEST</div>' : ''}
      <dl class="bb-stats">${stats}</dl>
      <div class="bb-row"><button class="bb-btn" data-a="restart">${g('cross', 24)} ${o.again || 'Play again'}</button>
      <button class="bb-btn" data-a="quit">${g('circle', 24)} Arcade</button></div>`;
    hydrate(ui.over);
    setTimeout(() => { if (state === 'over') show('over'); }, o.delay === undefined ? 700 : o.delay);
  }

  function toast(html, ms) {
    ui.toast.innerHTML = html; hydrate(ui.toast);
    ui.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('on'), ms || 2200);
  }

  function frame(t) {
    requestAnimationFrame(frame);
    let dt = (t - lastT) / 1000; lastT = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    Pad.update();
    stateT += dt;
    // global toggles
    if (Pad.pressed(BTN.CREATE)) { Audio.unlock(); Audio.setMuted(!Settings.muted); toast(Settings.muted ? '🔇 Sound off' : '🔊 Sound on'); }
    if ((Pad.pressed(BTN.L3) && Pad.down(BTN.R3)) || (Pad.pressed(BTN.R3) && Pad.down(BTN.L3))) {
      Settings.haptics = !Settings.haptics; save('haptics', Settings.haptics);
      toast(Settings.haptics ? '📳 Haptics on' : 'Haptics off'); if (Settings.haptics) Pad.rumble(0.8, 0.8, 200);
    }
    if (state === 'title') {
      updateStatus();
      game.titleInput && game.titleInput(dt);
      if (stateT > 0.25 && Pad.pressed(BTN.CROSS)) begin();
      else if (stateT > 0.25 && Pad.pressed(BTN.CIRCLE) && !game.noTitleQuit) quit();
    } else if (state === 'play') {
      if (Pad.pressed(BTN.OPTIONS)) pause();
      else game.update && game.update(dt);
    } else if (state === 'paused') {
      if (Pad.pressed(BTN.CROSS) || Pad.pressed(BTN.OPTIONS)) resume();
      else if (Pad.pressed(BTN.TRIANGLE)) restart();
      else if (Pad.pressed(BTN.CIRCLE)) quit();
      else (game.pauseActions || []).forEach((a, i) => { if (Pad.pressed(NAME_TO_BTN[a.btn])) pauseAction(i); });
    } else if (state === 'over') {
      overDelay -= dt;
      game.overUpdate && game.overUpdate(dt);
      if (overDelay <= 0) {
        if (Pad.pressed(BTN.CROSS)) restart();
        else if (Pad.pressed(BTN.CIRCLE)) quit();
      }
    }
    game.render && game.render(dt, t / 1000, state);
  }

  /** Register a game and boot the shell. */
  function run(cfg) {
    game = cfg;
    const boot = () => {
      buildUI(cfg);
      on('connect', (gp) => toast(`${g('cross', 18)} ${escapeHTML(shortId(gp.id))} connected`));
      on('disconnect', () => { toast('Controller disconnected'); pause(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
      cfg.init && cfg.init();
      toTitle();
      requestAnimationFrame((t) => { lastT = t; frame(t); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  // ---- Small helpers -----------------------------------------------------
  /** Size a canvas to the window at a capped devicePixelRatio. */
  function fitCanvas(cv, maxDpr) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    return { w, h, dpr, cw: innerWidth, ch: innerHeight };
  }
  let safeEl = null;
  /** Safe-area insets in CSS px (notch / home indicator). */
  function safe() {
    if (!safeEl) {
      safeEl = el('div');
      safeEl.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
      document.body.appendChild(safeEl);
    }
    const cs = getComputedStyle(safeEl);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  /** Deterministic RNG. */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  window.BB = {
    BTN, COLORS, Pad, Audio, Settings, run, over, toast, pause, quit, toTitle,
    get state() { return state; }, best, load, save, glyphSVG, drawGlyph, hydrate, fitCanvas,
    rand, clamp, lerp, rng, on, ui, safe,
  };
})();
