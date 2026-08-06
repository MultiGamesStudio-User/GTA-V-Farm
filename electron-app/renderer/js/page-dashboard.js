'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE: DASHBOARD
════════════════════════════════════════════════════════════════ */

let _dashRunningStats = {}; // macro name → {iterations, errors, last_rule, elapsed_s, ...} from engine:get_stats
let _dashStatsPoller  = null;

function renderDashboard() {
  /* ── Counters ─── */
  const totalEl = document.getElementById('val-total-macros');
  if (totalEl) totalEl.textContent = macros.length;

  const countEl = document.getElementById('val-running-count');
  if (countEl) countEl.textContent = runningMacros.size;

  _renderDashKpisFromStats();
  _renderDashRunningList();
  _renderDashQuickLaunch();
  _refreshDashHistory();
  _startDashStatsPoll();
}

/* ── Run history (persisted server-side, survives app restarts) ──── */
async function _refreshDashHistory() {
  const el = document.getElementById('dash-history');
  if (!el) return;
  let history = [];
  try {
    const res = await window.api.getMacroHistory({ limit: 30 });
    history = (res && res.ok !== false && Array.isArray(res.history)) ? res.history : [];
  } catch (e) { /* engine not started yet — keep empty */ }
  if (history.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:12px">Aucun run terminé pour l\'instant</div>';
    return;
  }
  el.innerHTML = history.map(h => {
    const date = h.ended_at ? new Date(h.ended_at * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '?';
    return `
    <div class="history-item">
      <span class="history-item-name" title="${escHtml(h.name || '?')}">${escHtml(h.name || '?')}</span>
      <span class="history-item-date">${date}</span>
      <div class="history-item-pills">
        <span class="running-stat-pill">🔁 ${h.iterations ?? 0}</span>
        <span class="running-stat-pill">⏱️ ${_fmtElapsed(h.elapsed_s)}</span>
        ${h.errors ? `<span class="running-stat-pill stat-error">⚠️ ${h.errors}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ── Live stats (real backend data via engine:get_stats — iterations,
   rules_triggered, errors, elapsed_s per running macro) ─────────── */
async function _refreshDashStats() {
  if (runningMacros.size === 0) { _dashRunningStats = {}; return; }
  try {
    const res = await window.api.getStats();
    _dashRunningStats = (res && res.ok !== false && res.stats) ? res.stats : {};
  } catch (e) { _dashRunningStats = {}; }
}

function _renderDashKpisFromStats() {
  let cycles = 0, errors = 0;
  for (const name of runningMacros) {
    const s = _dashRunningStats[name];
    if (s) { cycles += s.iterations || 0; errors += s.errors || 0; }
  }
  const cyclesEl = document.getElementById('val-total-cycles');
  const errorsEl = document.getElementById('val-total-errors');
  if (cyclesEl) cyclesEl.textContent = cycles;
  if (errorsEl) errorsEl.textContent = errors;
}

function _fmtElapsed(s) {
  s = Math.floor(s || 0);
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function _fmtAgo(ts) {
  if (!ts) return null;
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 2) return 'à l\'instant';
  if (s < 60) return `il y a ${s}s`;
  return `il y a ${Math.floor(s / 60)}m`;
}

function _renderDashRunningList() {
  const el = document.getElementById('dash-running');
  if (!el) return;
  if (runningMacros.size === 0) {
    el.innerHTML = '<div class="empty-state">Aucune macro active en ce moment</div>';
    return;
  }
  el.innerHTML = [...runningMacros].map(name => {
    const s = _dashRunningStats[name];
    const pills = [];
    if (s) {
      pills.push(`<span class="running-stat-pill">🔁 ${s.iterations ?? 0} cycle${(s.iterations ?? 0) !== 1 ? 's' : ''}</span>`);
      pills.push(`<span class="running-stat-pill">⏱️ ${_fmtElapsed(s.elapsed_s)}</span>`);
      if (s.last_rule) pills.push(`<span class="running-stat-pill">⚡ ${escHtml(s.last_rule)}${_fmtAgo(s.last_rule_ts) ? ' — ' + _fmtAgo(s.last_rule_ts) : ''}</span>`);
      if (s.errors) pills.push(`<span class="running-stat-pill stat-error">⚠️ ${s.errors} erreur${s.errors !== 1 ? 's' : ''}</span>`);
    }
    return `
      <div class="running-item">
        <div class="running-item-head">
          <div class="running-dot"></div>
          <span class="running-item-name">${escHtml(name)}</span>
          <button class="btn btn-xs btn-danger" data-macro-stop="${escHtml(name)}" onclick="stopMacroByName(this.dataset.macroStop)">Arrêter</button>
        </div>
        ${pills.length ? `<div class="running-item-stats">${pills.join('')}</div>` : ''}
      </div>`;
  }).join('');
}

function _startDashStatsPoll() {
  if (_dashStatsPoller) return;
  _dashStatsPoller = setInterval(async () => {
    const pageEl = document.getElementById('page-dashboard');
    if (!pageEl || !pageEl.classList.contains('active')) {
      clearInterval(_dashStatsPoller);
      _dashStatsPoller = null;
      return;
    }
    await _refreshDashStats();
    _renderDashKpisFromStats();
    _renderDashRunningList();
    _refreshDashHistory();
  }, 2000);
  _refreshDashStats().then(() => { _renderDashKpisFromStats(); _renderDashRunningList(); });
}

/* ── Quick-launch grid ─── */
function _renderDashQuickLaunch() {
  const ql = document.getElementById('dash-ql-grid');
  if (!ql) return;
  if (!macros || macros.length === 0) {
    ql.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:12px">Aucune macro créée</div>';
    return;
  }
  ql.innerHTML = macros.map((m, i) => {
    const isRunning  = runningMacros.has(m.name);
    const rulesCount = (m.rules || []).length;
    const loopLabel  = m.loop !== false ? 'boucle' : '1 passe';
    return `
      <div class="ql-card ${isRunning ? 'ql-card-running' : ''}">
        <div class="ql-card-header">
          <div class="ql-card-name" title="${escHtml(m.name)}">${escHtml(m.name || 'Sans nom')}</div>
          ${isRunning ? '<div class="ql-card-indicator"></div>' : ''}
        </div>
        <div class="ql-card-meta">
          <span>${rulesCount} règle${rulesCount !== 1 ? 's' : ''}</span>
          <span class="ql-card-meta-dot"></span>
          <span>${loopLabel}</span>
        </div>
        <div class="ql-card-actions">
          ${isRunning
            ? `<button class="btn btn-xs btn-danger" style="flex:1" data-macro-stop="${escHtml(m.name)}" onclick="stopMacroByName(this.dataset.macroStop)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> Stop
               </button>`
            : `<button class="btn btn-xs btn-success" style="flex:1" onclick="startMacro(${i})">
                <svg viewBox="0 0 24 24" fill="currentColor" width="10"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer
               </button>`
          }
          <button class="btn btn-xs btn-secondary" onclick="selectMacro(${i});navigate('macros')" title="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}
