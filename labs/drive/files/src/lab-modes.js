// Stone Wanderer lab modes — Stance Cards vs. Individual Moves review.
//
// weapon-lab.html calls installLabModes(api) once during setup. The core has a
// small number of permanent extension points (in labAction, updateVariantReadout,
// updateMainStatusLine, setDir, and the gamepad d-pad read) that call into the
// object this module returns; before install() runs those points are simply
// inert. This replaces the old approach of string-patching a fetched copy of
// the core's HTML at runtime.
//
// Expected api shape:
//   { ATTACK_GROUPS, attackDisplayLabel, combatState, aimState, labState,
//     ATTACK_POOLS: { approved, bad, all },
//     makeLabEvent, startCombatAttack, labOnAttackComplete, flashCombatButton,
//     updateLabUI }

const MODE_KEY = 'stoneWandererMoveTestMode.v1';
const VERTICAL_POOL_KEY = 'stoneWandererMoveVerticalPool.v1';
const RATINGS_KEY = 'stoneWandererIndividualMoveRatings.v1';

const LOCKED_VERTICAL_RATINGS = {
  vertical: 'down', vertical2: 'up', vertical3: 'up', vertical4: 'up', vertical5: 'up', vertical6: 'down',
  vertical7: 'up', vertical8: 'up', vertical9: 'up', vertical10: 'up', vertical11: 'up', vertical12: 'down',
  vertical13: 'down', vertical14: 'down', vertical15: 'up', vertical16: 'up'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function row(label, data) {
  return `<div class="move-review-row"><span>${esc(label)}</span><strong>${esc(data.label)}</strong><b class="move-review-rate">${data.rating === 'up' ? '👍' : data.rating === 'down' ? '👎' : '—'}</b></div>`;
}
function moveGlyph(v) { return v === 'up' ? '👍' : (v === 'down' ? '👎' : '—'); }

export function installLabModes(api) {
  const combatLaunch = api.launchMode === 'combat';
  const { ATTACK_GROUPS, attackDisplayLabel, combatState, aimState, labState, ATTACK_POOLS } = api;

  const state = { selectedGroup: 'vertical', selected: { vertical: 0, horizontal: 0, stab: 0 }, ratings: {} };

  function loadRatings() {
    try { state.ratings = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}') || {}; }
    catch (e) { state.ratings = {}; }
  }
  function saveRatings() {
    try { localStorage.setItem(RATINGS_KEY, JSON.stringify(state.ratings)); } catch (e) {}
  }
  function fullIndex(group, key) {
    const full = ATTACK_GROUPS[group] || [];
    const idx = full.indexOf(key);
    return idx >= 0 ? idx : 0;
  }
  function seedLockedRatings() {
    for (const key of Object.keys(LOCKED_VERTICAL_RATINGS)) {
      const idx = fullIndex('vertical', key);
      const id = 'vertical:' + (idx + 1);
      state.ratings[id] = {
        id, group: 'vertical', index: idx + 1, total: (ATTACK_GROUPS.vertical || []).length,
        key, label: attackDisplayLabel(key), weapon: 'locked', rating: LOCKED_VERTICAL_RATINGS[key], locked: true, updatedAt: 'locked-in-file'
      };
    }
    saveRatings();
  }
  loadRatings();
  seedLockedRatings();

  function isMoveTestMode() { return !combatLaunch && localStorage.getItem(MODE_KEY) === 'moves'; }
  function verticalPoolMode() { return localStorage.getItem(VERTICAL_POOL_KEY) || 'approved'; }
  function setMode(mode) {
    if (combatLaunch) mode = 'stance';
    localStorage.setItem(MODE_KEY, mode === 'moves' ? 'moves' : 'stance');
    api.updateVariantReadout?.();
    api.updateLabUI?.();
    api.updateMainStatusLine?.();
    render();
  }
  function setVerticalPool(mode) {
    localStorage.setItem(VERTICAL_POOL_KEY, mode || 'approved');
    state.selected.vertical = 0;
    render();
  }

  const GROUPS = { vertical: { label: 'Slice', family: 'Vertical', pad: '□' }, horizontal: { label: 'Sweep', family: 'Horizontal', pad: '△' }, stab: { label: 'Thrust', family: 'Thrust', pad: '○' } };

  function pool(group) {
    if (group === 'vertical') {
      const mode = verticalPoolMode();
      if (mode === 'bad') return ATTACK_POOLS.bad;
      if (mode === 'all') return ATTACK_POOLS.all;
      return ATTACK_POOLS.approved;
    }
    return ATTACK_GROUPS[group] || [];
  }
  function poolIndex(group) {
    const list = pool(group);
    const n = list.length || 1;
    state.selected[group] = ((state.selected[group] || 0) % n + n) % n;
    return state.selected[group];
  }
  function ratingId(group, actualIndex) { return group + ':' + ((actualIndex || 0) + 1); }
  function slot(group, poolIdx) {
    const list = pool(group);
    const n = list.length || 1;
    const i = ((poolIdx % n) + n) % n;
    const key = list[i];
    const actual = fullIndex(group, key);
    const r = state.ratings[ratingId(group, actual)];
    const full = ATTACK_GROUPS[group] || list;
    return { group, index: actual, poolIndex: i, total: full.length, poolTotal: n, key, label: r?.label || attackDisplayLabel(key), rating: r?.rating || '' };
  }
  function reviewModel() {
    const group = state.selectedGroup || 'vertical';
    const info = GROUPS[group] || GROUPS.vertical;
    const i = poolIndex(group);
    return {
      mode: isMoveTestMode(), group, info, verticalPool: verticalPoolMode(),
      prev: slot(group, i - 1), selected: slot(group, i), next: slot(group, i + 1), then: slot(group, i + 2),
      counts: Object.values(state.ratings).reduce((a, r) => { a.count++; if (r.rating === 'up') a.up++; if (r.rating === 'down') a.down++; return a; }, { count: 0, up: 0, down: 0 })
    };
  }
  function surfacesChanged() { api.updateVariantReadout?.(); api.updateMainStatusLine?.(); render(); }
  function selectGroup(group) { if (!ATTACK_GROUPS[group]) return; state.selectedGroup = group; surfacesChanged(); }
  function nudgeSelection(delta) {
    if (!isMoveTestMode()) return false;
    const group = state.selectedGroup || 'vertical';
    const list = pool(group);
    state.selected[group] = ((poolIndex(group) + delta) % list.length + list.length) % list.length;
    surfacesChanged();
    return true;
  }
  function play(group) {
    selectGroup(group);
    const s = slot(group, poolIndex(group));

    // Mobile pointer events can arrive in fast bursts. Do not create a new lab
    // event or overwrite pending state until the core combo gate says the current
    // attack can accept a follow-up; otherwise individual move review can queue
    // stale thrust events faster than the animation can drain them.
    if (combatState.attack && api.canAcceptLabFollowup && !api.canAcceptLabFollowup()) {
      return true;
    }

    const event = api.makeLabEvent(s.key, s.index);
    event.moveTest = true;
    api.flashCombatButton(group);
    if (!combatState.attack) {
      api.startCombatAttack(s.key, group, event);
    } else {
      combatState.pending = s.key; combatState.pendingGroup = group; combatState.pendingLabEvent = event;
      if (combatState.t > combatState.attack.comboAt) {
        api.labOnAttackComplete();
        api.startCombatAttack(s.key, group, event);
        combatState.pending = null; combatState.pendingGroup = null; combatState.pendingLabEvent = null;
      }
    }
    api.updateLabUI?.();
    surfacesChanged();
    return true;
  }
  function rate(value) {
    const group = state.selectedGroup || 'vertical';
    const s = slot(group, poolIndex(group));
    const id = ratingId(group, s.index);
    if (value) {
      state.ratings[id] = { id, group, index: s.index + 1, total: s.total, key: s.key, label: attackDisplayLabel(s.key), weapon: combatState.weapon, rating: value, updatedAt: new Date().toISOString() };
    } else {
      delete state.ratings[id];
    }
    saveRatings();
    surfacesChanged();
  }

  /* --- Core hook points ------------------------------------------------------
     Each of these matches one of the small edits the old runtime patch made to
     the core's own functions. The core calls these unconditionally; they are
     no-ops (return false / undefined) whenever move-test mode is off. */
  function intercept(action) {
    if (!isMoveTestMode()) return false;
    if (action === 'attack') return play('vertical');
    if (action === 'nextStance') return play('horizontal');
    if (action === 'randomStance') return play('stab');
    if (action === 'rateDown') { rate('down'); return true; }
    if (action === 'rateUp') { rate('up'); return true; }
    if (action === 'clearRating') { rate(''); return true; }
    return false;
  }
  function variantLabel(group) {
    if (!isMoveTestMode()) return null;
    const s = slot(group, poolIndex(group));
    return 'selected ' + (s.poolIndex + 1) + '/' + s.poolTotal;
  }
  function statusLine() {
    if (!isMoveTestMode()) return null;
    const m = reviewModel();
    const gp = aimState.connected ? ' · Controller ready' : '';
    return `${m.info.pad} ${m.info.label} test · Selected: ${m.selected.label} ${moveGlyph(m.selected.rating)} · D-pad ↑/↓ selects · LB/RB rates${gp}`;
  }
  function dpadY(dir, on) {
    if (!isMoveTestMode() || (dir !== 'up' && dir !== 'down')) return false;
    if (on) nudgeSelection(dir === 'up' ? -1 : 1);
    return true;
  }
  function blockDpadY() { return isMoveTestMode(); }
  function dpadSelect(delta) { nudgeSelection(delta); }

  /* --- Chrome: mode / pool selects + review panel, bound to static markup --- */
  function installChrome() {
    const sel = document.getElementById('moveTestModeSelect');
    if (sel) {
      sel.value = isMoveTestMode() ? 'moves' : 'stance';
      sel.addEventListener('change', e => setMode(e.target.value));
    }
    const poolSel = document.getElementById('moveVerticalPoolSelect');
    if (poolSel) {
      poolSel.value = verticalPoolMode();
      poolSel.addEventListener('change', e => setVerticalPool(e.target.value));
    }
  }
  function render() {
    const moves = isMoveTestMode();
    document.body.classList.toggle('move-test-review', moves);

    const sel = document.getElementById('moveTestModeSelect');
    if (sel) sel.value = moves ? 'moves' : 'stance';

    const poolSel = document.getElementById('moveVerticalPoolSelect');
    if (poolSel) poolSel.value = verticalPoolMode();

    const poolRow = document.getElementById('moveVerticalPoolRow');
    if (poolRow) poolRow.style.display = moves ? 'flex' : 'none';

    const panel = document.getElementById('moveReviewPanel');
    if (panel) {
      if (moves) {
        const model = reviewModel();
        panel.innerHTML = `<div class="move-review-title">${esc(model.info.pad)} ${esc(model.info.label)} / ${esc(model.info.family)} test</div>`
          + row('Previous', model.prev) + row('Selected', model.selected) + row('Next', model.next) + row('Then', model.then);
      } else {
        panel.innerHTML = '';
      }
    }

    const meta = document.getElementById('moveTestModeMeta');
    if (meta) {
      if (moves) {
        const model = reviewModel();
        meta.innerHTML = `<strong>Individual Moves</strong><br>□ Slice · △ Sweep · ○ Thrust repeat selected move. D-pad ↑/↓ changes selected move.<br><span class="rating-badge">${model.counts.up} 👍</span><span class="rating-badge">${model.counts.down} 👎</span><span class="rating-badge">${model.counts.count} rated</span>`;
      } else {
        meta.innerHTML = '<strong>Stance Cards</strong><br>□ Attack plays the next chain hit. △ cycles authored stances. ○ creates a random stance. Random verticals use approved slices only.';
      }
    }
  }

  installChrome();
  render();

  return { intercept, variantLabel, statusLine, dpadY, blockDpadY, dpadSelect, render };
}
