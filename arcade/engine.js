/* ARC — tiny shared arcade engine for phone + Backbone (standard gamepad mapping).
   Each game calls ARC.game({...}). Engine owns: canvas, scaling, input (pad/keys/touch),
   title/pause/game-over flow, juice (shake, hitstop, slowmo, flash, particles, popups),
   synth audio, best scores, fullscreen. Logical play-field height is always 540 units. */
(function () {
  'use strict';
  const LOGICAL_H = 540;
  const BTN = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'select', 'start'];
  const PAD_IDX = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9 };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  /* ---------------- storage ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('arc:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('arc:' + k, JSON.stringify(v)); } catch (e) { } },
  };

  /* ---------------- audio ---------------- */
  const audio = {
    ctx: null, master: null, noise: null, muted: store.get('muted', false),
    unlock() {
      try {
        if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; // play through the iPhone silent switch
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -14; comp.ratio.value = 6;
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.55;
          this.master.connect(comp); comp.connect(this.ctx.destination);
          const len = this.ctx.sampleRate;
          this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { }
    },
    ok() { return this.ctx && this.ctx.state === 'running' && !this.muted; },
    setMuted(m) { this.muted = m; store.set('muted', m); if (this.master) this.master.gain.value = m ? 0 : 0.55; },
    tone(f, dur, o = {}) {
      if (!this.ok()) return;
      try { this._tone(f, dur, o); } catch (e) { }
    },
    _tone(f, dur, o) {
      const c = this.ctx, t = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
      const v = o.vol == null ? 0.25 : o.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      if (o.pan != null && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); p.connect(this.master); }
      else g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    hiss(dur, o = {}) {
      if (!this.ok()) return;
      try { this._hiss(dur, o); } catch (e) { }
    },
    _hiss(dur, o) {
      const c = this.ctx, t = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource(); src.buffer = this.noise;
      src.playbackRate.value = o.rate || 1;
      const f = c.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.freq || 1200, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      const g = c.createGain(); const v = o.vol == null ? 0.3 : o.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    },
  };
  // presets — p = pitch multiplier
  const sfx = {
    blip(p = 1) { audio.tone(660 * p, 0.07, { type: 'square', vol: 0.12 }); },
    select(p = 1) { audio.tone(520 * p, 0.06, { type: 'square', vol: 0.12 }); audio.tone(780 * p, 0.08, { type: 'square', vol: 0.1, delay: 0.05 }); },
    hit(p = 1) { audio.tone(220 * p, 0.12, { type: 'square', to: 60 * p, vol: 0.3 }); audio.hiss(0.08, { freq: 2500, vol: 0.25, filter: 'highpass' }); },
    heavy(p = 1) { audio.tone(120 * p, 0.3, { type: 'sine', to: 35, vol: 0.6 }); audio.hiss(0.25, { freq: 900, to: 120, vol: 0.4, filter: 'lowpass' }); audio.tone(300 * p, 0.08, { type: 'square', to: 80, vol: 0.2 }); },
    boom(p = 1) { audio.tone(80 * p, 0.6, { type: 'sine', to: 25, vol: 0.7 }); audio.hiss(0.6, { freq: 1500, to: 60, vol: 0.55, filter: 'lowpass' }); },
    whoosh(p = 1) { audio.hiss(0.16, { freq: 500 * p, to: 2200 * p, vol: 0.22, q: 1.5 }); },
    dash(p = 1) { audio.hiss(0.12, { freq: 1800 * p, to: 400, vol: 0.25, q: 2 }); audio.tone(900 * p, 0.08, { type: 'sawtooth', to: 300, vol: 0.06 }); },
    zap(p = 1) { audio.tone(1400 * p, 0.12, { type: 'sawtooth', to: 200 * p, vol: 0.12 }); },
    pickup(p = 1) { audio.tone(880 * p, 0.06, { type: 'triangle', vol: 0.2 }); audio.tone(1320 * p, 0.1, { type: 'triangle', vol: 0.18, delay: 0.05 }); },
    clang(p = 1) { audio.tone(1800 * p, 0.25, { type: 'triangle', vol: 0.2 }); audio.tone(2710 * p, 0.2, { type: 'sine', vol: 0.15 }); audio.hiss(0.05, { freq: 5000, vol: 0.3, filter: 'highpass' }); },
    hurt() { audio.tone(160, 0.35, { type: 'sawtooth', to: 40, vol: 0.35 }); audio.hiss(0.3, { freq: 600, vol: 0.3 }); },
    jump(p = 1) { audio.tone(300 * p, 0.12, { type: 'square', to: 700 * p, vol: 0.1 }); },
    charge(p = 1) { audio.tone(200 * p, 0.05, { type: 'triangle', vol: 0.08 }); },
    combo(n) { const f = 440 * Math.pow(2, Math.min(n, 24) / 12); audio.tone(f, 0.09, { type: 'square', vol: 0.12 }); audio.tone(f * 1.5, 0.12, { type: 'triangle', vol: 0.1, delay: 0.03 }); },
    over() { [392, 330, 262, 196].forEach((f, i) => audio.tone(f, 0.22, { type: 'square', vol: 0.15, delay: i * 0.13 })); },
    start() { [262, 330, 392, 523].forEach((f, i) => audio.tone(f, 0.12, { type: 'square', vol: 0.12, delay: i * 0.06 })); },
  };

  /* ---------------- DOM / style ---------------- */
  const css = `
  html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#05060a;touch-action:none;
    -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;
    font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,sans-serif;overscroll-behavior:none}
  #arc-c{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none}
  .arc-tb{position:fixed;top:max(8px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));display:flex;gap:8px;z-index:30}
  .arc-tb button{width:40px;height:40px;border-radius:12px;border:1px solid #ffffff26;background:#0009;color:#fff;font-size:18px;
    display:flex;align-items:center;justify-content:center;padding:0;touch-action:manipulation;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  #arc-touch{position:fixed;inset:0;z-index:20;touch-action:none}
  #arc-touch.hide .arc-btn,#arc-touch.hide .arc-stick{display:none}
  .arc-btns{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));width:210px;height:190px;pointer-events:none}
  .arc-btn{position:absolute;width:78px;height:78px;border-radius:50%;border:2px solid #ffffff55;background:#0000002e;color:#fff;text-shadow:0 1px 2px #000;
    font-weight:800;font-size:12px;letter-spacing:.06em;display:flex;align-items:center;justify-content:center;text-align:center;
    pointer-events:none;box-shadow:0 4px 0 #0008;line-height:1.05}
  .arc-btn.on{background:#ffffff55;transform:translateY(2px);box-shadow:0 2px 0 #0008}
  .arc-stick{position:fixed;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid #ffffff30;background:#ffffff0c;pointer-events:none;opacity:.0;transition:opacity .15s}
  .arc-stick.on{opacity:1}.arc-stick i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:#ffffff45}
  #arc-toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);background:#000c;color:#fff;padding:9px 14px;border-radius:12px;
    font-size:13px;z-index:40;opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center}
  #arc-rot{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:50;background:#05060ae6;color:#fff;font-size:18px;text-align:center;padding:30px;pointer-events:none}
  @media (orientation:portrait) and (max-width:700px){#arc-rot{display:flex}}
  `;

  function el(tag, attrs, parent) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (parent || document.body).appendChild(e); return e;
  }

  function addMeta() {
    const h = document.head;
    const metas = [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-status-bar-style', 'black-translucent'], ['theme-color', '#05060a']];
    for (const [n, c] of metas) { if (!document.querySelector(`meta[name="${n}"]`)) { const m = document.createElement('meta'); m.name = n; m.content = c; h.appendChild(m); } }
    if (!document.querySelector('link[rel=manifest]')) { const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.json'; h.appendChild(l); }
    const vp = document.querySelector('meta[name=viewport]');
    const want = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
    if (vp) vp.content = want; else { const m = document.createElement('meta'); m.name = 'viewport'; m.content = want; h.appendChild(m); }
    const s = document.createElement('style'); s.textContent = css; h.appendChild(s);
  }

  /* ---------------- fullscreen ---------------- */
  const fsAvail = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen() {
    const d = document.documentElement;
    try {
      if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      if (fsAvail()) {
        const p = (d.requestFullscreen || d.webkitRequestFullscreen).call(d, { navigationUI: 'hide' });
        if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } }).catch(() => toast('Fullscreen blocked — on iPhone use Share → Add to Home Screen'));
      } else toast('iPhone: Share → Add to Home Screen for true fullscreen');
    } catch (e) { toast('iPhone: Share → Add to Home Screen for true fullscreen'); }
  }
  let toastEl, toastT;
  function toast(msg, ms = 2600) { if (!toastEl) return; toastEl.textContent = msg; toastEl.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => toastEl.style.opacity = 0, ms); }

  /* ---------------- input ---------------- */
  function makeInput() {
    const I = {
      mx: 0, my: 0, ax: 0, ay: 0, // move stick, aim stick (right stick)
      raw: {}, prev: {}, _keys: {}, _touch: {}, padIndex: -1, lastDevice: 'touch',
      down(b) { return !!this.raw[b]; },
      pressed(b) { return !!this.raw[b] && !this.prev[b]; },
      released(b) { return !this.raw[b] && !!this.prev[b]; },
      any() { for (const b of BTN) if (this.pressed(b)) return true; return false; },
      // menu nav: returns -1/0/1 per axis with repeat
      _nav: { x: 0, y: 0, t: 0 },
      nav: { x: 0, y: 0 },
      // buffered press: true if b was pressed within `ms`
      _stamp: {},
      buffered(b, ms = 120) { const t = this._stamp[b]; return t != null && performance.now() - t <= ms; },
      consume(b) { this._stamp[b] = null; },
      _blocked: {},
      block() { for (const b of BTN) { if (this.raw[b]) this._blocked[b] = true; this.raw[b] = false; this.prev[b] = false; this._stamp[b] = null; } },
    };
    const keymap = {
      Space: 'a', KeyJ: 'a', KeyZ: 'a', KeyK: 'b', KeyX: 'b', KeyL: 'x', KeyC: 'x', KeyI: 'y', KeyV: 'y',
      KeyQ: 'lb', KeyE: 'rb', ShiftLeft: 'lt', ShiftRight: 'rt', Enter: 'start', Escape: 'start', Tab: 'select', Backspace: 'select',
    };
    addEventListener('keydown', e => {
      audio.unlock(); I.lastDevice = 'keys';
      I._keys[e.code] = true;
      if (keymap[e.code] || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', e => { I._keys[e.code] = false; });
    addEventListener('blur', () => { I._keys = {}; });

    I.poll = function (dt) {
      Object.assign(this.prev, this.raw);
      const r = {};
      for (const b of BTN) r[b] = false;
      let mx = 0, my = 0, ax = 0, ay = 0;
      // keys
      const K = this._keys;
      if (K.KeyA || K.ArrowLeft) mx -= 1; if (K.KeyD || K.ArrowRight) mx += 1;
      if (K.KeyW || K.ArrowUp) my -= 1; if (K.KeyS || K.ArrowDown) my += 1;
      for (const code in keymap) if (K[code]) r[keymap[code]] = true;
      // touch
      const T = this._touch;
      for (const b in T) if (T[b]) r[b] = true;
      if (T.stick) { mx += T.sx; my += T.sy; }
      // gamepad — first connected non-null
      let gp = null;
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected !== false) { gp = pads[i]; this.padIndex = i; break; }
      } catch (e) { }
      this.pad = gp;
      if (gp) {
        const B = gp.buttons, A = gp.axes;
        let used = false;
        for (const b of BTN) { const btn = B[PAD_IDX[b]]; if (btn && (btn.pressed || btn.value > 0.5)) { r[b] = true; used = true; } }
        const dz = (x, y) => { const m = Math.hypot(x, y); if (m < 0.18) return [0, 0]; const s = Math.min(1, (m - 0.18) / 0.78) / m; return [x * s, y * s]; };
        const [lx, ly] = dz(A[0] || 0, A[1] || 0);
        const [rx, ry] = dz(A[2] || 0, A[3] || 0);
        mx += lx; my += ly; ax += rx; ay += ry;
        if (B[12] && B[12].pressed) my -= 1; if (B[13] && B[13].pressed) my += 1;
        if (B[14] && B[14].pressed) mx -= 1; if (B[15] && B[15].pressed) mx += 1;
        this.dpad = { u: !!(B[12] && B[12].pressed), d: !!(B[13] && B[13].pressed), l: !!(B[14] && B[14].pressed), r: !!(B[15] && B[15].pressed) };
        if (used || lx || ly || rx || ry || this.dpad.u || this.dpad.d || this.dpad.l || this.dpad.r) this.lastDevice = 'pad';
        this.lt = B[6] ? B[6].value : 0; this.rt = B[7] ? B[7].value : 0;
      } else { this.dpad = null; this.lt = r.lt ? 1 : 0; this.rt = r.rt ? 1 : 0; }
      const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
      const am = Math.hypot(ax, ay); if (am > 1) { ax /= am; ay /= am; }
      this.mx = mx; this.my = my; this.ax = ax; this.ay = ay;
      for (const b in this._blocked) { if (r[b]) r[b] = false; else delete this._blocked[b]; }
      if (!this._t0) this._t0 = performance.now();
      if (performance.now() - this._t0 < 350) { this.prev = Object.assign({}, r); this.raw = r; return; }
      this.raw = r;
      const now = performance.now();
      for (const b of BTN) if (r[b] && !this.prev[b]) this._stamp[b] = now;
      // menu nav with repeat
      const nx = Math.abs(mx) > 0.5 ? Math.sign(mx) : 0, ny = Math.abs(my) > 0.5 ? Math.sign(my) : 0;
      const n = this._nav; this.nav = { x: 0, y: 0 };
      if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; n.t = 0.35; this.nav = { x: nx, y: ny }; }
      else if (nx || ny) { n.t -= dt; if (n.t <= 0) { n.t = 0.12; this.nav = { x: nx, y: ny }; } }
    };
    return I;
  }

  function haptic(strength = 0.5, ms = 40) {
    try {
      const I = ARC._input; const gp = I && I.pad;
      if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
        gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strength, 0, 1), weakMagnitude: clamp(strength * 0.8, 0, 1) }).catch(() => { });
      } else if (navigator.vibrate && I && I.lastDevice === 'touch') navigator.vibrate(Math.round(ms * strength));
    } catch (e) { }
  }

  /* ---------------- touch controls ---------------- */
  // layout slots around a diamond, matching pad face buttons: a=bottom, b=right, x=left, y=top
  const SLOT = { a: [66, 112], b: [138, 56], x: [-6, 56], y: [66, 0], rb: [138, 140], lb: [-6, 140] };
  function makeTouch(def, I, game) {
    const root = el('div', { id: 'arc-touch' });
    const stick = el('div', { class: 'arc-stick' }, root); const knob = el('i', {}, stick);
    const wrap = el('div', { class: 'arc-btns' }, root);
    const btnEls = [];
    for (const b of def.buttons || [{ id: 'a', label: 'GO' }]) {
      const s = SLOT[b.id] || SLOT.a;
      const e = el('div', { class: 'arc-btn', text: b.label }, wrap);
      e.style.left = s[0] + 'px'; e.style.top = s[1] + 'px';
      if (b.color) e.style.borderColor = b.color;
      if (b.big) { e.style.width = e.style.height = '92px'; e.style.left = (s[0] - 7) + 'px'; e.style.top = (s[1] - 7) + 'px'; }
      btnEls.push({ id: b.id, e });
    }
    const touches = new Map(); // id -> {kind, btn, ox, oy}
    let stickId = null, sOx = 0, sOy = 0;
    const R = 52;
    function hitBtn(x, y) {
      let best = null, bd = 1e9;
      for (const b of btnEls) {
        const r = b.e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < r.width * 0.75 && d < bd) { bd = d; best = b; }
      }
      return best;
    }
    function refresh() {
      const on = {};
      for (const t of touches.values()) if (t.kind === 'btn') on[t.btn.id] = true;
      for (const b of btnEls) { I._touch[b.id] = !!on[b.id]; b.e.classList.toggle('on', !!on[b.id]); }
    }
    function start(e) {
      audio.unlock(); I.lastDevice = 'touch'; root.classList.remove('hide');
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        // in menus, a tap anywhere acts as A (unless on the toolbar)
        if (game.state !== 'play') { touches.set(t.identifier, { kind: 'menu' }); game._menuTap = { x, y }; continue; }
        const b = hitBtn(x, y);
        if (b) { touches.set(t.identifier, { kind: 'btn', btn: b }); continue; }
        if (x < innerWidth * 0.55 && stickId == null) {
          stickId = t.identifier; sOx = x; sOy = y; touches.set(t.identifier, { kind: 'stick' });
          stick.style.left = x + 'px'; stick.style.top = y + 'px'; stick.classList.add('on'); knob.style.transform = '';
          I._touch.stick = true; I._touch.sx = 0; I._touch.sy = 0;
          continue;
        }
        // right side empty space → primary button (big forgiving zone)
        const first = btnEls[0];
        if (first && x >= innerWidth * 0.55) touches.set(t.identifier, { kind: 'btn', btn: first });
      }
      refresh(); e.preventDefault();
    }
    function move(e) {
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); if (!s) continue;
        if (s.kind === 'stick') {
          let dx = t.clientX - sOx, dy = t.clientY - sOy; const m = Math.hypot(dx, dy);
          if (m > R * 1.6) { sOx += dx - dx / m * R * 1.6; sOy += dy - dy / m * R * 1.6; dx = t.clientX - sOx; dy = t.clientY - sOy; stick.style.left = sOx + 'px'; stick.style.top = sOy + 'px'; }
          const mm = Math.hypot(dx, dy); const k = Math.min(1, mm / R);
          const nx = mm ? dx / mm : 0, ny = mm ? dy / mm : 0;
          const kk = mm < 6 ? 0 : k;
          I._touch.sx = nx * kk; I._touch.sy = ny * kk;
          knob.style.transform = `translate(${nx * Math.min(mm, R)}px,${ny * Math.min(mm, R)}px)`;
        } else if (s.kind === 'btn') {
          const b = hitBtn(t.clientX, t.clientY); if (b && b !== s.btn && t.clientX > innerWidth * 0.55) { s.btn = b; refresh(); } // slide between buttons
        }
      }
      e.preventDefault();
    }
    function end(e) {
      audio.unlock();
      for (const t of e.changedTouches) {
        const s = touches.get(t.identifier); touches.delete(t.identifier);
        if (s && s.kind === 'stick') { stickId = null; I._touch.stick = false; I._touch.sx = I._touch.sy = 0; stick.classList.remove('on'); }
      }
      refresh(); e.preventDefault();
    }
    root.addEventListener('touchstart', start, { passive: false });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end, { passive: false });
    root.addEventListener('touchcancel', end, { passive: false });
    // mouse: clicking acts as A in menus
    root.addEventListener('mousedown', e => { audio.unlock(); if (game.state !== 'play') game._menuTap = { x: e.clientX, y: e.clientY }; });
    return {
      root, setVisible(v) { root.classList.toggle('hide', !v); },
      clear() { touches.clear(); stickId = null; stick.classList.remove('on'); for (const k in I._touch) I._touch[k] = false; I._touch.sx = I._touch.sy = 0; refresh(); },
    };
  }

  /* ---------------- particles & popups ---------------- */
  function makeFx() {
    return {
      parts: [], pops: [], rings: [],
      burst(x, y, n, o = {}) {
        for (let i = 0; i < n; i++) {
          const a = o.angle != null ? o.angle + rand(-(o.spread || 0.5), o.spread || 0.5) : rand(0, TAU);
          const s = rand(o.speedMin == null ? (o.speed || 300) * 0.3 : o.speedMin, o.speed || 300);
          this.parts.push({
            x, y, vx: Math.cos(a) * s + (o.vx || 0), vy: Math.sin(a) * s + (o.vy || 0), life: rand(0.6, 1) * (o.life || 0.5), max: 0,
            size: rand(0.6, 1.2) * (o.size || 4), color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : (o.color || '#fff'),
            drag: o.drag == null ? 3 : o.drag, grav: o.grav || 0, shape: o.shape || 'sq', spin: rand(-10, 10), rot: rand(0, TAU),
          });
          this.parts[this.parts.length - 1].max = this.parts[this.parts.length - 1].life;
        }
      },
      ring(x, y, o = {}) { this.rings.push({ x, y, r: o.r || 10, to: o.to || 120, life: o.life || 0.35, max: o.life || 0.35, color: o.color || '#fff', w: o.w || 6 }); },
      pop(x, y, text, o = {}) { this.pops.push({ x, y, text, life: o.life || 0.8, max: o.life || 0.8, color: o.color || '#fff', size: o.size || 26, vy: o.vy == null ? -70 : o.vy }); },
      update(dt) {
        for (let i = this.parts.length - 1; i >= 0; i--) {
          const p = this.parts[i]; p.life -= dt; if (p.life <= 0) { this.parts.splice(i, 1); continue; }
          const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        }
        for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.life -= dt; if (r.life <= 0) this.rings.splice(i, 1); }
        for (let i = this.pops.length - 1; i >= 0; i--) { const p = this.pops[i]; p.life -= dt; p.y += p.vy * dt; p.vy *= Math.exp(-3 * dt); if (p.life <= 0) this.pops.splice(i, 1); }
        if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
      },
      draw(ctx) {
        for (const r of this.rings) {
          const t = 1 - r.life / r.max; const e = 1 - Math.pow(1 - t, 3);
          ctx.globalAlpha = 1 - t; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - t) + 0.5;
          ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r, r.to, e), 0, TAU); ctx.stroke();
        }
        for (const p of this.parts) {
          const t = p.life / p.max; ctx.globalAlpha = Math.min(1, t * 1.5); ctx.fillStyle = p.color;
          const s = p.size * (0.4 + 0.6 * t);
          if (p.shape === 'line') {
            ctx.strokeStyle = p.color; ctx.lineWidth = s * 0.6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
          } else if (p.shape === 'circ') { ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill(); }
          else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore(); }
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const p of this.pops) {
          const t = p.life / p.max; const sc = t > 0.85 ? 1 + (t - 0.85) * 3 : 1;
          ctx.globalAlpha = Math.min(1, t * 2.5);
          ctx.font = `900 ${Math.round(p.size * sc)}px ui-rounded,system-ui,sans-serif`;
          ctx.lineWidth = 5; ctx.strokeStyle = '#000a'; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
        }
        ctx.globalAlpha = 1;
      },
      clear() { this.parts.length = 0; this.pops.length = 0; this.rings.length = 0; },
    };
  }

  /* ---------------- the game runner ---------------- */
  function game(def) {
    addMeta();
    document.title = def.title;
    const canvas = el('canvas', { id: 'arc-c' });
    const ctx = canvas.getContext('2d');
    const I = makeInput(); ARC._input = I;
    const g = {
      def, ctx, canvas, input: I, fx: makeFx(), W: 960, H: LOGICAL_H, t: 0, time: 0,
      state: 'title', score: 0, best: store.get('best:' + def.id, 0), timeScale: 1,
      _shake: 0, _stop: 0, _slow: 0, _slowScale: 1, _flash: 0, _flashColor: '#fff', _menuSel: 0, _menuTap: null, _overT: 0,
      cam: { x: 0, y: 0, zoom: 1 }, sfx, audio, haptic, rand, clamp, lerp, TAU, store,
      shake(a) { this._shake = Math.min(40, Math.max(this._shake, a)); },
      hitstop(s) { this._stop = Math.max(this._stop, s); },
      slowmo(scale, dur) { this._slowScale = scale; this._slow = Math.max(this._slow, dur); },
      flash(color, a = 0.5) { this._flashColor = color; this._flash = Math.max(this._flash, a); },
      addScore(n) { this.score += n; },
      gameOver(msg) { if (this.state !== 'play') return; this.state = 'over'; this._menuSel = 0; this._overMsg = msg || ''; this._overT = 0; this._newBest = false; if (this.score > this.best) { this.best = this.score; store.set('best:' + def.id, this.best); this._newBest = true; } sfx.over(); touch.clear(); },
      restart() { this.fx.clear(); this.score = 0; this.t = 0; this.timeScale = 1; this._slow = 0; this._stop = 0; this._shake = 0; this._flash = 0; this.cam = { x: 0, y: 0, zoom: 1 }; def.init(this); this.state = 'play'; sfx.start(); touch.clear(); I.block(); },
    };
    const tb = el('div', { class: 'arc-tb' });
    const bPause = el('button', { text: 'II', 'aria-label': 'Pause' }, tb);
    const bMute = el('button', { text: audio.muted ? '🔇' : '🔊', 'aria-label': 'Sound' }, tb);
    const bFs = el('button', { text: '⛶', 'aria-label': 'Fullscreen' }, tb);
    const stopEv = e => { e.stopPropagation(); };
    for (const b of [bPause, bMute, bFs]) { b.addEventListener('touchstart', stopEv, { passive: true }); b.addEventListener('mousedown', stopEv); }
    bFs.addEventListener('click', () => { audio.unlock(); toggleFullscreen(); });
    bMute.addEventListener('click', () => { audio.unlock(); audio.setMuted(!audio.muted); bMute.textContent = audio.muted ? '🔇' : '🔊'; });
    bPause.addEventListener('click', () => { audio.unlock(); if (g.state === 'play') { g.state = 'pause'; g._menuSel = 0; touch.clear(); } else if (g.state === 'pause') g.state = 'play'; });
    toastEl = el('div', { id: 'arc-toast' });
    el('div', { id: 'arc-rot', html: '↻<br>Rotate to landscape' });
    const touch = makeTouch(def, I, g);
    addEventListener('gamepadconnected', () => { toast('Controller connected 🎮'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && g.state === 'play') { g.state = 'pause'; g._menuSel = 0; } });

    let dpr = 1, scale = 1;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = innerWidth, h = innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      scale = h / LOGICAL_H;
      g.W = w / scale; g.H = LOGICAL_H;
      if (def.resize) def.resize(g);
    }
    addEventListener('resize', resize); resize();
    def.init(g); g.state = 'title';

    const MENU = { pause: ['RESUME', 'RESTART', 'ARCADE'], over: ['RETRY', 'ARCADE'] };
    function menuChoose(item) {
      sfx.select();
      if (item === 'RESUME') { g.state = 'play'; I.block(); }
      else if (item === 'RESTART' || item === 'RETRY') g.restart();
      else if (item === 'ARCADE') location.href = 'index.html';
    }
    function menuLogic(items) {
      if (I.nav.y) { g._menuSel = (g._menuSel + I.nav.y + items.length) % items.length; sfx.blip(); }
      if (I.pressed('a')) menuChoose(items[g._menuSel]);
      if (g._menuTap) {
        const tp = g._menuTap; g._menuTap = null;
        const ly = tp.y / scale; const top = g.H * 0.55; let hit = -1;
        items.forEach((it, i) => { if (Math.abs(ly - (top + i * 52)) < 26) hit = i; });
        if (hit >= 0) menuChoose(items[hit]);
      }
    }

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      let rdt = (now - last) / 1000; last = now;
      if (!(rdt > 0)) rdt = 1 / 60; rdt = Math.min(rdt, 1 / 30);
      g.time += rdt;
      I.poll(rdt);
      touch.setVisible(I.lastDevice === 'touch' && g.state === 'play');
      // flow
      if (g.state === 'title') {
        if (I.pressed('a') || I.pressed('start') || g._menuTap) { g._menuTap = null; audio.unlock(); g.restart(); }
      } else if (g.state === 'play') {
        if (I.pressed('start')) { g.state = 'pause'; g._menuSel = 0; touch.clear(); sfx.blip(); }
        else if (I.pressed('select')) { g.restart(); }
      } else if (g.state === 'pause') {
        if (I.pressed('start') || I.pressed('b')) { g.state = 'play'; I.block(); } else menuLogic(MENU.pause);
      } else if (g.state === 'over') {
        g._overT += rdt;
        if (g._overT > 0.6) { if (I.pressed('start') || I.pressed('select')) g.restart(); else menuLogic(MENU.over); }
        else g._menuTap = null;
      }
      // sim
      let dt = rdt;
      if (g._stop > 0) { g._stop -= rdt; dt = 0; }
      if (g._slow > 0) { g._slow -= rdt; dt *= g._slowScale; }
      dt *= g.timeScale;
      if (g.state === 'play' || g.state === 'over' || g.state === 'title') {
        const simDt = g.state === 'title' ? rdt * 0.6 : dt;
        if (g.state === 'play') g.t += simDt;
        if (g.state === 'play' || (g.state === 'title' && def.attract)) {
          def.update(g, simDt, rdt);
        }
        g.fx.update(simDt);
      }
      if (def.frame) def.frame(g, rdt);
      g._shake = Math.max(0, g._shake - rdt * 60 * Math.max(1, g._shake * 0.12));
      g._flash = Math.max(0, g._flash - rdt * 3);
      // draw
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.save();
      if (g._shake > 0.1) ctx.translate(rand(-1, 1) * g._shake, rand(-1, 1) * g._shake);
      def.draw(g, ctx);
      ctx.restore();
      if (def.hud) def.hud(g, ctx); else drawHud(g, ctx);
      if (g._flash > 0) { ctx.globalAlpha = Math.min(1, g._flash); ctx.fillStyle = g._flashColor; ctx.fillRect(0, 0, g.W, g.H); ctx.globalAlpha = 1; }
      if (g.state === 'title') drawTitle(g, ctx);
      else if (g.state === 'pause') { drawMenu(g, ctx, 'PAUSED', MENU.pause); drawHelp(g, ctx, g.H * 0.37, 14); }
      if ((g.state === 'title' || g.state === 'pause') && !audio.muted && !(audio.ctx && audio.ctx.state === 'running')) text(ctx, '🔈 tap the screen once for sound', g.W / 2, g.H - 14, 12, '#ffffffaa', 'center', 700);
      else if (g.state === 'over') drawOver(g, ctx);
    }

    function text(ctx, s, x, y, size, color, align = 'center', weight = 900) {
      ctx.font = `${weight} ${size}px ui-rounded,"SF Pro Rounded",system-ui,sans-serif`;
      ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = '#000b'; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y);
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    }
    g.text = (s, x, y, size, color, align, weight) => text(ctx, s, x, y, size, color || '#fff', align, weight);
    function drawHud(g, ctx) {
      if (g.state === 'title') return;
      text(ctx, String(Math.floor(g.score)), 22, 30, 30, '#fff', 'left');
      text(ctx, 'BEST ' + Math.floor(g.best), 22, 58, 13, '#ffffffaa', 'left', 700);
      if (def.hudExtra) def.hudExtra(g, ctx);
    }
    function dim(ctx, a = 0.62) { ctx.fillStyle = `rgba(4,5,10,${a})`; ctx.fillRect(0, 0, g.W, g.H); }
    function drawTitle(g, ctx) {
      dim(ctx, 0.55);
      const c = def.color || '#7cf';
      const pulse = 1 + Math.sin(g.time * 3) * 0.02;
      ctx.save(); ctx.translate(g.W / 2, g.H * 0.26); ctx.scale(pulse, pulse);
      text(ctx, def.title, 0, 0, 74, c); ctx.restore();
      if (def.tagline) text(ctx, def.tagline, g.W / 2, g.H * 0.26 + 52, 18, '#fff', 'center', 700);
      const lines = def.help || [];
      const touchMode = I.lastDevice === 'touch';
      lines.forEach((l, i) => {
        const s = typeof l === 'string' ? l : (touchMode ? l.touch : l.pad) || l.pad || l.touch;
        text(ctx, s, g.W / 2, g.H * 0.48 + i * 28, 16, '#dfe7ff', 'center', 650);
      });
      if (g.best) text(ctx, 'BEST ' + Math.floor(g.best), g.W / 2, g.H * 0.82, 16, c, 'center', 800);
      const blink = (Math.sin(g.time * 5) + 1) / 2;
      ctx.globalAlpha = 0.5 + 0.5 * blink;
      text(ctx, touchMode ? 'TAP TO START' : 'PRESS Ⓐ TO START', g.W / 2, g.H * 0.91, 22, '#fff');
      ctx.globalAlpha = 1;
    }
    function drawHelp(g, ctx, y0, size) {
      const touchMode = I.lastDevice === 'touch';
      (def.help || []).forEach((l, i) => {
        const s = typeof l === 'string' ? l : (touchMode ? l.touch : l.pad) || l.pad || l.touch;
        text(ctx, s, g.W / 2, y0 + i * (size + 8), size, '#dfe7ff', 'center', 650);
      });
    }
    function drawMenu(g, ctx, title, items, sub) {
      dim(ctx);
      text(ctx, title, g.W / 2, g.H * 0.25, 56, def.color || '#7cf');
      if (sub) sub();
      items.forEach((it, i) => {
        const sel = i === g._menuSel; const y = g.H * 0.55 + i * 52;
        if (sel) { ctx.fillStyle = (def.color || '#7cf') + '33'; ctx.fillRect(g.W / 2 - 130, y - 22, 260, 44); }
        text(ctx, (sel ? '▸ ' : '') + it, g.W / 2, y, sel ? 28 : 22, sel ? '#fff' : '#ffffff99');
      });
    }
    function drawOver(g, ctx) {
      const t = Math.min(1, g._overT * 3);
      ctx.globalAlpha = t;
      drawMenu(g, ctx, def.overTitle || 'GAME OVER', MENU.over, () => {
        text(ctx, String(Math.floor(g.score)), g.W / 2, g.H * 0.38, 46, '#fff');
        text(ctx, g._newBest ? '★ NEW BEST ★' : 'BEST ' + Math.floor(g.best), g.W / 2, g.H * 0.45, 17, g._newBest ? '#ffd84a' : '#ffffffaa', 'center', 800);
        if (g._overMsg) text(ctx, g._overMsg, g.W / 2, g.H * 0.16, 16, '#ffffffcc', 'center', 700);
      });
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
    ARC.current = g;
    return g;
  }

  /* ---------------- shared helpers for games ---------------- */
  const util = {
    clamp, lerp, rand, TAU,
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    angLerp(a, b, t) { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; },
    segCircle(x1, y1, x2, y2, cx, cy, r) { // does segment hit circle
      const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy || 1;
      const t = clamp(((cx - x1) * dx + (cy - y1) * dy) / l2, 0, 1);
      const px = x1 + dx * t, py = y1 + dy * t; return Math.hypot(cx - px, cy - py) <= r;
    },
    ease: { out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, back: t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2) },
    glow(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; },
    noGlow(ctx) { ctx.shadowBlur = 0; },
  };

  window.ARC = { game, sfx, audio, util, store, haptic, toggleFullscreen, makeInput, addMeta, toast: m => toast(m) };
})();
