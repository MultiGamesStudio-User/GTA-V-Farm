'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE: DASHBOARD
════════════════════════════════════════════════════════════════ */

function renderDashboard() {
  const el = document.getElementById('dash-running');
  if (!el) return;
  const countEl = document.getElementById('val-running-count');
  if (countEl) countEl.textContent = runningMacros.size;
  if (runningMacros.size === 0) {
    el.innerHTML = '<div class="empty-state">Aucune macro active en ce moment</div>';
    return;
  }
  el.innerHTML = [...runningMacros].map(name => `
    <div class="running-item">
      <div class="running-dot"></div>
      <span class="running-item-name">${escHtml(name)}</span>
      <button class="btn btn-xs btn-danger" onclick="stopMacroByName('${escHtml(name).replace(/'/g,"\\'")}')">Arrêter</button>
    </div>
  `).join('');
}
