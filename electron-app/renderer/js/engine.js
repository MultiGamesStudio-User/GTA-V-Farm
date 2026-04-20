'use strict';
/* ═══════════════════════════════════════════════════════════════
   ENGINE — start, status badge, event listeners
════════════════════════════════════════════════════════════════ */

async function ensureEngine() {
  try {
    await window.api.startEngine();
  } catch (e) {
    appendLog('WARNING', 'Engine non disponible: ' + (e.message || e));
    throw e;
  }
}

function updateStatusBadge(running) {
  const dot  = document.getElementById('sidebar-dot');
  const text = document.getElementById('sidebar-status-text');
  if (!dot || !text) return;
  dot.classList.toggle('dot-green', !!running);
  text.textContent = running ? 'Actif' : 'Arrêté';
}

function updateRunningOverlay() {
  const overlay = document.getElementById('running-overlay');
  if (!overlay) return;
  if (!runningMacros || runningMacros.size === 0) {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
    return;
  }
  overlay.classList.remove('hidden');
  overlay.innerHTML = [...runningMacros].map(name => `
    <div class="running-badge">
      <div class="running-badge-dot"></div>
      <span class="running-badge-name">${name}</span>
      <button class="running-badge-stop" data-macro-stop="${name}" onclick="stopMacroByName(this.dataset.macroStop)" title="Arrêter">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="9"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
      </button>
    </div>
  `).join('');
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
    updateRunningOverlay();
  });

  window.api.onEngineStatusUpd(ev => {
    // ev.running may be an array (list of macro ids) or a boolean
    const running = Array.isArray(ev.running) ? ev.running.length > 0 : !!ev.running;
    updateStatusBadge(running);
  });

  window.api.onEngineStopped(() => {
    updateStatusBadge(false);
    runningMacros.clear();
    renderDashboard();
    updateMacroRunButtons();
    updateRunningOverlay();
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
    const msgEl  = document.getElementById('deps-msg');
    if (banner) {
      banner.classList.add('deps-done');
      if (msgEl) msgEl.textContent = 'Dépendances Python prêtes ✓';
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
