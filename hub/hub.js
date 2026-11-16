/* Playground Hub v1: local-first discovery, sessions and feedback. No existing games are modified. */
(() => {
  'use strict';

  const STORAGE_KEY = 'playground.hub.v1';
  const MAX_SESSIONS = 500;
  const MAX_EVENTS = 80;
  const $ = (id) => document.getElementById(id);
  const frame = $('playerFrame');
  const blank = () => ({ version: 1, feedback: {}, visits: {}, sessions: [], lastId: null });
  let entries = [];
  let selectedKind = 'all';
  let current = null;
  let session = null;
  let clockTimer = null;
  let toastTimer = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return blank();
      return {
        version: 1,
        feedback: parsed.feedback && typeof parsed.feedback === 'object' ? parsed.feedback : {},
        visits: parsed.visits && typeof parsed.visits === 'object' ? parsed.visits : {},
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.slice(0, MAX_SESSIONS) : [],
        lastId: typeof parsed.lastId === 'string' ? parsed.lastId : null
      };
    } catch {
      return blank();
    }
  }

  let state = loadState();

  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 2800);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      toast('Could not save locally. Export your feedback or free browser storage.');
      return false;
    }
  }

  function getFeedback(id) {
    if (!state.feedback[id] || typeof state.feedback[id] !== 'object') {
      state.feedback[id] = { reaction: null, notes: [] };
    }
    const entry = state.feedback[id];
    if (!Array.isArray(entry.notes)) entry.notes = [];
    return entry;
  }

  const reactionNames = { spark: '✨ Spark', revisit: '🔖 Revisit', pass: '➖ Pass' };

  function visibleTimeMs() {
    if (!session) return 0;
    return Math.max(0, session.visibleMs +
      (session.visibleSince === null ? 0 : performance.now() - session.visibleSince));
  }

  function updateClock() {
    if (!current) return;
    const sec = Math.floor(visibleTimeMs() / 1000);
    const mins = Math.floor(sec / 60);
    $('sessionClock').textContent = 'Session: ' + mins + 'm ' + (sec % 60) +
      's visible · ' + (state.visits[current.id] || 0) + ' launch(es) on this device';
  }

  function startSession(item) {
    const now = new Date().toISOString();
    session = {
      id: 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      experimentId: item.id,
      startedAt: now,
      visibleMs: 0,
      visibleSince: document.hidden ? null : performance.now(),
      events: []
    };
    clearInterval(clockTimer);
    clockTimer = setInterval(updateClock, 1000);
    updateClock();
  }

  function endSession(reason) {
    if (!session) return;
    const endedAt = new Date().toISOString();
    const record = {
      id: session.id,
      experimentId: session.experimentId,
      startedAt: session.startedAt,
      endedAt,
      visibleMs: Math.round(visibleTimeMs()),
      endReason: reason,
      events: session.events
    };
    session = null;
    clearInterval(clockTimer);
    clockTimer = null;
    state.sessions.unshift(record);
    state.sessions.length = Math.min(state.sessions.length, MAX_SESSIONS);
    persist();
  }

  function titleFor(id) {
    return entries.find((entry) => entry.id === id);
  }

  function makeChip(text, extraClass) {
    const tag = document.createElement('span');
    tag.className = 'chip' + (extraClass ? ' ' + extraClass : '');
    tag.textContent = text;
    return tag;
  }

  function filteredEntries() {
    const q = $('gallerySearch').value.trim().toLowerCase();
    return entries.filter((entry) => {
      if (selectedKind !== 'all' && entry.kind !== selectedKind) return false;
      return !q || [entry.title, entry.summary, entry.kind, ...(entry.tags || [])]
        .join(' ').toLowerCase().includes(q);
    });
  }

  function renderCatalog() {
    const list = filteredEntries();
    const grid = $('grid');
    const frag = document.createDocumentFragment();
    for (const entry of list) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.setAttribute('aria-label', 'Play ' + entry.title);
      const top = document.createElement('div');
      top.className = 'tile-top';
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = entry.kind;
      const visits = document.createElement('span');
      visits.className = 'visits';
      const count = state.visits[entry.id] || 0;
      visits.textContent = count ? count + ' visited' : 'unplayed';
      top.append(kind, visits);
      const title = document.createElement('span');
      title.className = 'tile-title';
      title.textContent = entry.title;
      const desc = document.createElement('span');
      desc.className = 'tile-summary';
      desc.textContent = entry.summary;
      const chips = document.createElement('span');
      chips.className = 'chips';
      for (const tag of (entry.tags || []).slice(0, 3)) chips.append(makeChip(tag));
      if (entry.archived) chips.append(makeChip('archived', 'archived'));
      const feedback = state.feedback[entry.id];
      tile.append(top, title, desc, chips);
      if (feedback && (feedback.reaction || (feedback.notes || []).length)) {
        const meta = document.createElement('span');
        meta.className = 'tile-meta';
        meta.textContent = (reactionNames[feedback.reaction] || 'Notes saved') +
          ((feedback.notes || []).length ? ' · ' + feedback.notes.length + ' note(s)' : '');
        tile.append(meta);
      }
      tile.addEventListener('click', () => openEntry(entry));
      frag.append(tile);
    }
    grid.replaceChildren(frag);
    $('empty').classList.toggle('hidden', list.length !== 0);
    $('summary').textContent = entries.length + ' experiments · ' +
      entries.filter((entry) => state.visits[entry.id]).length + ' explored';
    $('surprise').disabled = !entries.some((entry) => entry.surprise !== false && !entry.archived);
    const last = titleFor(state.lastId);
    $('resume').hidden = !last;
    if (last) $('resume').textContent = '↗ Revisit ' + last.title;
  }

  function renderFilters() {
    const kinds = ['all', ...new Set(entries.map((item) => item.kind))];
    const nav = $('filters');
    nav.replaceChildren();
    for (const kind of kinds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter' + (kind === selectedKind ? ' active' : '');
      btn.textContent = kind === 'all' ? 'All experiments' : kind;
      btn.setAttribute('aria-pressed', String(kind === selectedKind));
      btn.addEventListener('click', () => {
        selectedKind = kind;
        renderFilters();
        renderCatalog();
      });
      nav.append(btn);
    }
  }

  function setMenu(open) {
    $('playerMenu').hidden = !open;
    $('playerToggle').setAttribute('aria-expanded', String(open));
    $('playerToggle').dataset.open = String(open);
  }

  function renderNotes() {
    const history = $('noteHistory');
    history.replaceChildren();
    if (!current) return;
    const notes = getFeedback(current.id).notes;
    for (const note of notes.slice(-5).reverse()) {
      const box = document.createElement('div');
      box.className = 'note';
      const time = document.createElement('time');
      time.dateTime = note.at;
      time.textContent = new Date(note.at).toLocaleString();
      const body = document.createElement('div');
      body.textContent = note.text;
      box.append(time, body);
      history.append(box);
    }
    if (!notes.length) {
      const empty = document.createElement('span');
      empty.className = 'fineprint';
      empty.textContent = 'No notes yet. Save a thought or paste a playtest transcript.';
      history.append(empty);
    }
  }

  function renderReactions() {
    const reaction = current ? getFeedback(current.id).reaction : null;
    for (const button of document.querySelectorAll('[data-reaction]')) {
      const active = button.dataset.reaction === reaction;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function saveNote(quiet = false) {
    if (!current) return;
    const input = $('noteInput');
    const text = input.value.trim();
    if (!text) {
      if (!quiet) toast('Write a note first, or choose a quick reaction.');
      return;
    }
    const feedback = getFeedback(current.id);
    const note = { at: new Date().toISOString(), text, sessionId: session ? session.id : null };
    feedback.notes.push(note);
    feedback.notes = feedback.notes.slice(-100);
    if (persist()) {
      input.value = '';
      renderNotes();
      if (!quiet) toast('Note saved on this device.');
    } else {
      feedback.notes.pop();
    }
  }

  function setReaction(value) {
    if (!current) return;
    const feedback = getFeedback(current.id);
    feedback.reaction = feedback.reaction === value ? null : value;
    feedback.reactedAt = new Date().toISOString();
    persist();
    renderReactions();
    toast(feedback.reaction ? 'Marked ' + reactionNames[feedback.reaction] : 'Reaction cleared');
  }

  function openEntry(entry) {
    if (!entry) return;
    if (current) saveNote(true);
    endSession('switch');
    current = entry;
    state.lastId = entry.id;
    state.visits[entry.id] = (state.visits[entry.id] || 0) + 1;
    persist();
    $('catalog').classList.add('hidden');
    $('player').classList.remove('hidden');
    $('viewerName').textContent = entry.title;
    $('menuTitle').textContent = entry.title;
    $('menuDescription').textContent = entry.summary;
    $('noteInput').value = '';
    $('playerFrame').title = entry.title;
    renderNotes();
    renderReactions();
    setMenu(false);
    document.title = entry.title + ' · Playground';
    startSession(entry);
    const url = new URL(entry.path, location.href);
    if (url.origin !== location.origin) toast('External preview: embedded functionality may be limited.');
    frame.src = url.href;
  }

  function showLibrary() {
    if (current) saveNote(true);
    endSession('library');
    current = null;
    frame.removeAttribute('src');
    $('player').classList.add('hidden');
    $('catalog').classList.remove('hidden');
    setMenu(false);
    document.title = 'Playground Hub';
    renderCatalog();
    window.scrollTo(0, 0);
  }

  function eligibleEntries() {
    return entries.filter((entry) => entry.surprise !== false && !entry.archived);
  }

  function surprise() {
    let candidates = eligibleEntries();
    if (!candidates.length) {
      toast('No experiments available for Surprise Me yet.');
      return;
    }
    if (current && candidates.length > 1) {
      candidates = candidates.filter((entry) => entry.id !== current.id);
    }
    const unseen = candidates.filter((entry) => !state.visits[entry.id]);
    const pool = unseen.length ? unseen : candidates;
    openEntry(pool[Math.floor(Math.random() * pool.length)]);
  }

  function step(direction) {
    const list = eligibleEntries();
    if (!list.length) return;
    const index = current ? list.findIndex((entry) => entry.id === current.id) : -1;
    const nextIndex = index < 0 ? 0 : (index + direction + list.length) % list.length;
    openEntry(list[nextIndex]);
  }

  function requestFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
        setMenu(false);
      }).catch(() => {
        toast('Fullscreen was blocked. On iOS, add Playground to your Home Screen.');
      });
    } else {
      toast('Browser fullscreen unavailable. Add Playground to your Home Screen for standalone mode.');
    }
  }

  function exportFeedback() {
    const records = state.sessions.slice();
    if (session) {
      records.unshift({
        id: session.id,
        experimentId: session.experimentId,
        startedAt: session.startedAt,
        endedAt: new Date().toISOString(),
        visibleMs: Math.round(visibleTimeMs()),
        endReason: 'export-snapshot',
        events: session.events.slice()
      });
    }
    const data = {
      schema: 'playground-hub-feedback-v1',
      exportedAt: new Date().toISOString(),
      experiments: entries.map(({ id, title, kind, tags, path }) => ({ id, title, kind, tags, path })),
      feedback: state.feedback,
      visits: state.visits,
      sessions: records
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playground-feedback-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Feedback export prepared.');
  }

  function bindUi() {
    $('surprise').addEventListener('click', surprise);
    $('playerSurprise').addEventListener('click', surprise);
    $('resume').addEventListener('click', () => openEntry(titleFor(state.lastId)));
    $('gallerySearch').addEventListener('input', renderCatalog);
    $('playerToggle').addEventListener('click', () => setMenu($('playerMenu').hidden));
    $('menuClose').addEventListener('click', () => setMenu(false));
    $('home').addEventListener('click', showLibrary);
    $('prev').addEventListener('click', () => step(-1));
    $('next').addEventListener('click', () => step(1));
    $('fullscreen').addEventListener('click', requestFullscreen);
    $('newTab').addEventListener('click', () => {
      if (!current) return;
      window.open(new URL(current.path, location.href).href, '_blank', 'noopener,noreferrer');
      toast('A separate tab is not included in Hub playtime tracking.');
    });
    $('saveNote').addEventListener('click', () => saveNote(false));
    $('exportData').addEventListener('click', exportFeedback);
    $('exportViewer').addEventListener('click', () => {
      saveNote(true);
      exportFeedback();
    });
    for (const button of document.querySelectorAll('[data-reaction]')) {
      button.addEventListener('click', () => setReaction(button.dataset.reaction));
    }
    document.addEventListener('visibilitychange', () => {
      if (!session) return;
      if (document.hidden && session.visibleSince !== null) {
        session.visibleMs += performance.now() - session.visibleSince;
        session.visibleSince = null;
      } else if (!document.hidden && session.visibleSince === null) {
        session.visibleSince = performance.now();
      }
      updateClock();
    });
    window.addEventListener('message', (evt) => {
      if (!session || evt.source !== frame.contentWindow || evt.origin !== location.origin) return;
      const data = evt.data;
      if (!data || typeof data !== 'object' || data.type !== 'playground:metric') return;
      if (typeof data.name !== 'string' || !/^[a-z][a-z0-9:_-]{0,39}$/i.test(data.name)) return;
      const value = data.value;
      if (typeof value !== 'number' && typeof value !== 'boolean' &&
          !(typeof value === 'string' && value.length <= 100)) return;
      if (typeof value === 'number' && !Number.isFinite(value)) return;
      if (session.events.length < MAX_EVENTS) {
        session.events.push({ at: new Date().toISOString(), name: data.name, value });
      }
    });
    window.addEventListener('pagehide', () => {
      if (current) saveNote(true);
      endSession('pagehide');
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && current && !session) startSession(current);
    });
  }

  async function init() {
    bindUi();
    try {
      const response = await fetch('catalog.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.entries)) throw new Error('Invalid catalog');
      const seen = new Set();
      entries = data.entries.filter((entry) => {
        if (!entry || typeof entry.id !== 'string' || !entry.title ||
            typeof entry.path !== 'string' || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      });
      renderFilters();
      renderCatalog();
    } catch (error) {
      $('summary').textContent = 'Could not load the experiment catalog.';
      $('grid').replaceChildren();
      $('empty').classList.remove('hidden');
      $('empty').textContent = 'Open Playground from a web server, not as a local file. ' + error.message;
      $('surprise').disabled = true;
    }
  }

  init();
})();
