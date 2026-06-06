/* ── app.js  – Guest Lecture Leaderboard ──────────────────────
   Single-file vanilla JS. No dependencies.
   ──────────────────────────────────────────────────────────── */

'use strict';

// ── STATE ────────────────────────────────────────────────────────
const state = {
  participants: [],   // { id, name, score, joinedAt }
  pickedIds: new Set(),
  sortMode: 'score',  // 'score' | 'name' | 'time'
  sessionStart: Date.now(),
  timerInterval: null,
};

// ── PERSISTENCE ──────────────────────────────────────────────────
const STORAGE_KEY = 'gl_leaderboard_v2';

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      participants: state.participants,
      pickedIds: [...state.pickedIds],
      sessionStart: state.sessionStart,
    }));
  } catch (_) { /* ignore quota errors */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.participants = saved.participants || [];
    state.pickedIds    = new Set(saved.pickedIds || []);
    state.sessionStart = saved.sessionStart || Date.now();
  } catch (_) { /* ignore */ }
}

// ── HELPERS ──────────────────────────────────────────────────────
let nextId = 1;
function genId() { return nextId++; }

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sanitizeName(n) {
  return n.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function rankEmoji(r) {
  if (r === 1) return '🥇';
  if (r === 2) return '🥈';
  if (r === 3) return '🥉';
  return r;
}

function rankClass(r) {
  if (r <= 3) return `rank-${r}`;
  return '';
}

// ── SORTED PARTICIPANTS ───────────────────────────────────────────
function getSorted() {
  const arr = [...state.participants];
  if (state.sortMode === 'score') {
    arr.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  } else if (state.sortMode === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    arr.sort((a, b) => a.joinedAt - b.joinedAt);
  }
  return arr;
}

// ── RENDER SCOREBOARD ────────────────────────────────────────────
function renderScoreboard() {
  const list  = document.getElementById('scoreboard-list');
  const empty = document.getElementById('scoreboard-empty');

  if (state.participants.length === 0) {
    list.innerHTML = '';
    list.appendChild(empty);
    return;
  }

  const sorted = getSorted();
  // Build rank map (by score order)
  const byScore = [...state.participants].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const rankMap = {};
  byScore.forEach((p, i) => { rankMap[p.id] = i + 1; });

  // Preserve existing DOM elements for smooth animation (keyed by id)
  const existing = {};
  list.querySelectorAll('.participant-row[data-id]').forEach(el => {
    existing[el.dataset.id] = el;
  });

  const seen = new Set();
  const fragment = document.createDocumentFragment();

  sorted.forEach(p => {
    seen.add(String(p.id));
    const rank = rankMap[p.id];
    let row = existing[p.id];

    if (!row) {
      row = createParticipantRow(p, rank);
    } else {
      updateParticipantRow(row, p, rank);
    }
    fragment.appendChild(row);
  });

  // Remove rows not in sorted
  Object.keys(existing).forEach(id => {
    if (!seen.has(id)) {
      const el = existing[id];
      el.classList.add('removing');
      setTimeout(() => el.remove(), 300);
    }
  });

  list.innerHTML = '';
  list.appendChild(fragment);
}

function createParticipantRow(p, rank) {
  const row = document.createElement('div');
  row.className = `participant-row ${rankClass(rank)}`;
  row.dataset.id = p.id;
  row.innerHTML = rowHTML(p, rank);
  attachRowEvents(row, p);
  return row;
}

function updateParticipantRow(row, p, rank) {
  // Update rank class
  row.className = `participant-row ${rankClass(rank)}`;
  // Update inner content, preserving any animations
  row.innerHTML = rowHTML(p, rank);
  attachRowEvents(row, p);
}

function rowHTML(p, rank) {
  const medal = rank <= 3 ? rankEmoji(rank) : rank;
  const joined = new Date(p.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="rank-badge">${medal}</div>
    <div class="participant-info">
      <div class="participant-name">${escapeHtml(p.name)}</div>
      <div class="participant-meta">Joined ${joined}</div>
    </div>
    <div class="score-controls">
      <button class="score-btn minus" data-action="dec" title="–1 point">−</button>
      <span class="score-value" id="sv-${p.id}">${p.score}</span>
      <button class="score-btn" data-action="inc" title="+1 point">+</button>
    </div>
    <button class="delete-btn" data-action="delete" title="Remove participant">✕</button>
  `;
}

function attachRowEvents(row, p) {
  row.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'inc')    changeScore(p.id, +1);
    if (action === 'dec')    changeScore(p.id, -1);
    if (action === 'delete') removeParticipant(p.id);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── MUTATIONS ────────────────────────────────────────────────────
function addParticipant(name, score = 0) {
  name = sanitizeName(name);
  if (!name) return;
  // Prevent exact duplicate names
  if (state.participants.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    flashInput('input-name', 'duplicate');
    return;
  }
  const p = { id: genId(), name, score: Math.max(0, Number(score) || 0), joinedAt: Date.now() };
  state.participants.push(p);
  saveState();
  renderAll();
}

function removeParticipant(id) {
  const row = document.querySelector(`.participant-row[data-id="${id}"]`);
  if (row) {
    row.classList.add('removing');
    setTimeout(() => {
      state.participants = state.participants.filter(p => p.id !== id);
      state.pickedIds.delete(id);
      saveState();
      renderAll();
    }, 300);
  } else {
    state.participants = state.participants.filter(p => p.id !== id);
    saveState();
    renderAll();
  }
}

function changeScore(id, delta) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;
  const newScore = Math.max(0, p.score + delta);
  if (newScore === p.score) return;
  p.score = newScore;

  // Flash the row
  const row = document.querySelector(`.participant-row[data-id="${id}"]`);
  if (row) {
    row.classList.remove('score-up', 'score-down');
    void row.offsetWidth; // reflow
    row.classList.add(delta > 0 ? 'score-up' : 'score-down');
    setTimeout(() => row.classList.remove('score-up', 'score-down'), 700);

    // Bump score value
    const sv = document.getElementById(`sv-${id}`);
    if (sv) {
      sv.textContent = newScore;
      sv.classList.remove('bump');
      void sv.offsetWidth;
      sv.classList.add('bump');
    }
  }

  // Confetti if this participant reaches multiples of 5
  if (p.score > 0 && p.score % 5 === 0) launchConfetti();

  saveState();
  renderAll();
}

function resetAll() {
  state.participants = [];
  state.pickedIds.clear();
  state.sessionStart = Date.now();
  nextId = 1;
  saveState();
  renderAll();
  renderPickedHistory();
  updatePickerResult('', false);
}

// ── RENDER ALL ───────────────────────────────────────────────────
function renderAll() {
  renderScoreboard();
  renderStats();
  renderLeaderboard();
  renderQuickScore();
}

// ── STATISTICS ───────────────────────────────────────────────────
function renderStats() {
  const total = state.participants.length;
  document.getElementById('stat-total').textContent = total;

  const scored = state.participants.filter(p => p.score > 0);
  document.getElementById('stat-active').textContent = scored.length;

  if (total === 0) {
    document.getElementById('stat-highest').textContent = '—';
    document.getElementById('stat-average').textContent = '—';
    document.getElementById('stat-top').textContent    = '—';
    return;
  }

  const scores = state.participants.map(p => p.score);
  const highest = Math.max(...scores);
  const avg = (scores.reduce((a, b) => a + b, 0) / total).toFixed(1);
  const top = state.participants.reduce((a, b) => b.score > a.score ? b : a);

  document.getElementById('stat-highest').textContent = highest;
  document.getElementById('stat-average').textContent = avg;

  const topEl = document.getElementById('stat-top');
  topEl.textContent = top.name;
  topEl.title = `${top.name} — ${top.score} pts`;
}

// ── LEADERBOARD ──────────────────────────────────────────────────
function renderLeaderboard() {
  const grid  = document.getElementById('leaderboard-grid');

  if (state.participants.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🏆</span>
        <p>The leaderboard is empty. Add participants and start scoring!</p>
      </div>`;
    return;
  }

  const sorted = [...state.participants].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  grid.innerHTML = sorted.map((p, i) => {
    const rank = i + 1;
    const rankCls = rank <= 3 ? `lb-rank-${rank}` : '';
    const medal   = rank <= 3 ? rankEmoji(rank) : `#${rank}`;
    const badge   = rank <= 3 ? `<span class="lb-badge top3">Top ${rank}</span>` : `<span class="lb-badge">#${rank}</span>`;
    return `
      <div class="lb-card ${rankCls}" style="animation-delay:${i * 0.04}s">
        <div class="lb-rank-num">${medal}</div>
        <div class="lb-name">${escapeHtml(p.name)}</div>
        <div class="lb-score">${p.score}</div>
        ${badge}
      </div>`;
  }).join('');
}

// ── QUICK SCORE ──────────────────────────────────────────────────
function renderQuickScore() {
  const body = document.getElementById('quick-score-body');
  if (state.participants.length === 0) {
    body.innerHTML = '<p class="empty-hint">Add participants to the scoreboard first.</p>';
    return;
  }

  const sorted = [...state.participants].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  body.innerHTML = sorted.map(p => `
    <div class="qs-row" data-qid="${p.id}">
      <span class="qs-name">${escapeHtml(p.name)}</span>
      <span class="qs-score">${p.score}</span>
      <div class="qs-btn-group">
        <button class="score-btn minus" data-action="qs-dec" title="–1">−</button>
        <button class="score-btn" data-action="qs-inc" title="+1">+</button>
      </div>
    </div>`).join('');

  body.querySelectorAll('[data-qid]').forEach(row => {
    const id = Number(row.dataset.qid);
    row.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'qs-inc') changeScore(id, +1);
      if (btn.dataset.action === 'qs-dec') changeScore(id, -1);
    });
  });
}

// ── RANDOM PICKER ────────────────────────────────────────────────
function getPickerPool() {
  const mode = document.querySelector('input[name="picker-pool"]:checked').value;
  if (mode === 'scoreboard') {
    return state.participants.map(p => ({ id: p.id, name: p.name }));
  }
  // custom
  const raw = document.getElementById('picker-custom-names').value;
  return raw.split('\n')
    .map(n => n.trim())
    .filter(Boolean)
    .map((name, i) => ({ id: `custom-${i}`, name }));
}

let spinInterval = null;

function pickName() {
  const pool = getPickerPool();
  if (pool.length === 0) {
    updatePickerResult('⚠️ No names available!', false);
    return;
  }

  const noRepeat  = document.getElementById('picker-no-repeat').checked;
  const awardPts  = document.getElementById('picker-award-points').checked;

  // Build available pool
  let available = noRepeat
    ? pool.filter(x => !state.pickedIds.has(x.id))
    : pool;

  // If all picked, reset
  if (noRepeat && available.length === 0) {
    state.pickedIds.clear();
    available = pool;
    renderPickedHistory();
  }

  // Spin animation
  const resultEl = document.getElementById('picker-result');
  resultEl.className = 'picker-result spinning';
  let spinCount = 0;
  const spinNames = [...pool];

  clearInterval(spinInterval);
  document.getElementById('btn-pick').disabled = true;

  spinInterval = setInterval(() => {
    const rnd = spinNames[randomInt(0, spinNames.length - 1)];
    resultEl.innerHTML = `<span>${escapeHtml(rnd.name)}</span>`;
    spinCount++;
    if (spinCount >= 18) {
      clearInterval(spinInterval);
      // Final pick
      const chosen = available[randomInt(0, available.length - 1)];
      state.pickedIds.add(chosen.id);

      if (awardPts && state.participants.find(p => p.id === chosen.id)) {
        changeScore(chosen.id, +1);
      }

      saveState();
      renderPickedHistory();
      updatePickerResult(chosen.name, true);
      document.getElementById('btn-pick').disabled = false;

      // Confetti for the winner!
      launchConfetti();
    }
  }, 80);
}

function updatePickerResult(name, revealed) {
  const el = document.getElementById('picker-result');
  if (!name) {
    el.className = 'picker-result';
    el.innerHTML = '<span class="picker-result-idle">Press Pick to select a name!</span>';
    return;
  }
  el.className = revealed ? 'picker-result revealed' : 'picker-result';
  el.innerHTML = `<span>${escapeHtml(name)}</span>`;
}

function renderPickedHistory() {
  const chips     = document.getElementById('picked-chips');
  const container = document.getElementById('picked-history-container');
  if (state.pickedIds.size === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const pool = getPickerPool();
  const names = [];
  state.pickedIds.forEach(id => {
    const p = pool.find(x => String(x.id) === String(id));
    if (p) names.push(p.name);
  });

  chips.innerHTML = names.map(n => `<span class="chip">${escapeHtml(n)}</span>`).join('');
}

// ── CONFETTI ─────────────────────────────────────────────────────
const confettiCanvas  = document.getElementById('confetti-canvas');
const confettiCtx     = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiRAF       = null;

const CONFETTI_COLORS = ['#4f8ef7','#7c5ef7','#f7924f','#3ecf8e','#f7c94f','#f74f4f','#fff'];

function launchConfetti() {
  confettiCanvas.width  = window.innerWidth;
  confettiCanvas.height = window.innerHeight;

  for (let i = 0; i < 120; i++) {
    confettiParticles.push({
      x:   randomInt(0, confettiCanvas.width),
      y:   randomInt(-40, -10),
      w:   randomInt(7, 14),
      h:   randomInt(5, 11),
      r:   Math.random() * Math.PI * 2,
      dr:  (Math.random() - 0.5) * 0.25,
      dx:  (Math.random() - 0.5) * 3,
      dy:  randomInt(3, 7),
      color: CONFETTI_COLORS[randomInt(0, CONFETTI_COLORS.length - 1)],
      life: 180,
    });
  }

  if (!confettiRAF) animateConfetti();
}

function animateConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles = confettiParticles.filter(p => p.life > 0);

  confettiParticles.forEach(p => {
    p.x  += p.dx;
    p.y  += p.dy;
    p.r  += p.dr;
    p.life--;
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.r);
    confettiCtx.globalAlpha = Math.min(1, p.life / 30);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    confettiCtx.restore();
  });

  if (confettiParticles.length > 0) {
    confettiRAF = requestAnimationFrame(animateConfetti);
  } else {
    confettiRAF = null;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

// ── SESSION TIMER ────────────────────────────────────────────────
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function startTimer() {
  state.timerInterval = setInterval(() => {
    document.getElementById('session-timer').textContent =
      formatTime(Date.now() - state.sessionStart);
  }, 1000);
}

// ── FLASH INPUT ──────────────────────────────────────────────────
function flashInput(id, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = type === 'duplicate' ? 'var(--warning)' : 'var(--danger)';
  el.style.boxShadow   = type === 'duplicate'
    ? '0 0 0 3px rgba(247,201,79,.25)'
    : '0 0 0 3px rgba(247,79,79,.25)';
  el.focus();
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
  }, 1400);
}

// ── EXPORT CSV ───────────────────────────────────────────────────
function exportCSV() {
  if (state.participants.length === 0) return;
  const sorted = [...state.participants].sort((a, b) => b.score - a.score);
  const rows   = [['Rank', 'Name', 'Score', 'Joined']];
  sorted.forEach((p, i) => {
    rows.push([
      i + 1,
      `"${p.name.replace(/"/g, '""')}"`,
      p.score,
      new Date(p.joinedAt).toLocaleString(),
    ]);
  });
  const csv  = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `leaderboard-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── THEME ────────────────────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = isDark ? 'light' : '';
  document.getElementById('btn-theme').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('gl_theme', isDark ? 'light' : 'dark');
}

function loadTheme() {
  const saved = localStorage.getItem('gl_theme');
  if (saved === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.getElementById('btn-theme').textContent = '☀️';
  }
}

// ── SORT BUTTONS ─────────────────────────────────────────────────
function setSortMode(mode) {
  state.sortMode = mode;
  ['score', 'name', 'time'].forEach(m => {
    const btn = document.getElementById(`btn-sort-${m}`);
    if (btn) btn.classList.toggle('btn-sort-active', m === mode);
  });
  renderScoreboard();
}

// ── EVENT WIRING ─────────────────────────────────────────────────
function wireEvents() {
  // Add participant form
  document.getElementById('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const name  = document.getElementById('input-name').value;
    const score = document.getElementById('input-score').value;
    addParticipant(name, score);
    document.getElementById('input-name').value  = '';
    document.getElementById('input-score').value = '0';
    document.getElementById('input-name').focus();
  });

  // Bulk add
  document.getElementById('btn-bulk-add').addEventListener('click', () => {
    const lines = document.getElementById('bulk-names').value.split('\n');
    lines.forEach(line => { if (line.trim()) addParticipant(line); });
    document.getElementById('bulk-names').value = '';
  });

  // Sort buttons
  document.getElementById('btn-sort-score').addEventListener('click', () => setSortMode('score'));
  document.getElementById('btn-sort-name').addEventListener('click',  () => setSortMode('name'));
  document.getElementById('btn-sort-time').addEventListener('click',  () => setSortMode('time'));

  // Reset flow
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('reset-modal').classList.add('open');
  });
  document.getElementById('btn-reset-cancel').addEventListener('click', () => {
    document.getElementById('reset-modal').classList.remove('open');
  });
  document.getElementById('btn-reset-confirm').addEventListener('click', () => {
    document.getElementById('reset-modal').classList.remove('open');
    resetAll();
  });
  document.getElementById('reset-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // Theme toggle
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Export CSV
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // Random picker
  document.getElementById('btn-pick').addEventListener('click', pickName);

  // Picker pool toggle
  document.querySelectorAll('input[name="picker-pool"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isCustom = radio.value === 'custom' && radio.checked;
      document.getElementById('picker-custom-area').style.display = isCustom ? 'block' : 'none';
    });
  });

  // Clear picked history
  document.getElementById('btn-picker-clear').addEventListener('click', () => {
    state.pickedIds.clear();
    saveState();
    renderPickedHistory();
    updatePickerResult('', false);
  });

  // Keyboard: Enter on score input focuses name input after add
  document.getElementById('input-score').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      document.getElementById('add-form').requestSubmit();
    }
  });

  // Resize confetti canvas
  window.addEventListener('resize', () => {
    confettiCanvas.width  = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  });

  // Keyboard shortcut: Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('reset-modal').classList.remove('open');
    }
  });
}

// ── INIT ─────────────────────────────────────────────────────────
function init() {
  loadState();
  loadTheme();

  // Ensure nextId is safe after load
  if (state.participants.length > 0) {
    nextId = Math.max(...state.participants.map(p => p.id)) + 1;
  }

  wireEvents();
  setSortMode('score');
  renderAll();
  renderPickedHistory();
  startTimer();

  // Initial timer render
  document.getElementById('session-timer').textContent =
    formatTime(Date.now() - state.sessionStart);
}

document.addEventListener('DOMContentLoaded', init);
