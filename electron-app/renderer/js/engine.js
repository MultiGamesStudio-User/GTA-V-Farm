'use strict';
/* ═══════════════════════════════════════════════════════════════
   ENGINE — start, status badge, event listeners
════════════════════════════════════════════════════════════════ */

async function ensureEngine() {
  try { await window.api.startEngine(); } catch (_) {}
}

function updateStatusBadge(running) {
  const dot  = document.getElementById('sidebar-dot');
  const text = document.getElementById('sidebar-status-text');
  if (!dot || !text) return;
  dot.className  = 'dot ' + (running ? 'dot-green' : '');
  text.textContent = running ? 'Actif' : 'Arrêté';
}

function setupEngineEvents() {
  window.api.onEngineLog(ev => {
    appendLog(ev.level || 'INFO', ev.msg || '');
  });

  window.api.onEngineStatus(ev => {
    const running = ev.running || [];
    runningMacros = new Set(running);
    const countEl = document.getElementById('val-running-count');
    if (countEl) countEl.textContent = running.length;
    renderDashboard();
    updateStatusBadge(running.length > 0);
    updateMacroRunButtons();
  });

  window.api.onEngineStatusUpd(ev => {
    updateStatusBadge(ev.running);
  });

  window.api.onEngineStopped(() => {
    updateStatusBadge(false);
    runningMacros.clear();
    renderDashboard();
    updateMacroRunButtons();
    if (typeof stopUptimeClock === 'function') stopUptimeClock();
    appendLog('WARNING', 'Engine Python arrêté');
  });

  window.api.onSetupProgress(ev => {
    const banner = document.getElementById('deps-banner');
    const msg    = document.getElementById('deps-msg');
    if (banner && msg) {
      banner.classList.remove('deps-hidden');
      msg.textContent = ev.message || ev.msg || '';
    }
  });

  window.api.onSetupDone(() => {
    const banner = document.getElementById('deps-banner');
    if (banner) {
      banner.classList.add('deps-done');
      document.getElementById('deps-msg').textContent = 'Dépendances Python prêtes ✓';
      setTimeout(() => banner.classList.add('deps-hidden'), 3000);
    }
    appendLog('INFO', 'Dépendances Python installées');
  });

  window.api.onSetupError(err => {
    const banner = document.getElementById('deps-banner');
    const msgEl  = document.getElementById('deps-msg');
    if (banner && msgEl) {
      banner.classList.add('deps-error');
      msgEl.textContent = 'Erreur setup: ' + (err?.msg || err || '');
    }
    appendLog('ERROR', 'Erreur setup Python: ' + (err?.msg || err));
  });
}
