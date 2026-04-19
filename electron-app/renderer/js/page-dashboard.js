'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE: DASHBOARD
════════════════════════════════════════════════════════════════ */

function renderDashboard() {
  /* ── Counters ─── */
  const totalEl = document.getElementById('val-total-macros');
  if (totalEl) totalEl.textContent = macros.length;

  /* ── Running macros ─── */
  const el = document.getElementById('dash-running');
  if (el) {
    const countEl = document.getElementById('val-running-count');
    if (countEl) countEl.textContent = runningMacros.size;
    if (runningMacros.size === 0) {
      el.innerHTML = '<div class="empty-state">Aucune macro active en ce moment</div>';
    } else {
      el.innerHTML = [...runningMacros].map(name => `
        <div class="running-item">
          <div class="running-dot"></div>
          <span class="running-item-name">${escHtml(name)}</span>
          <button class="btn btn-xs btn-danger" onclick="stopMacroByName('${escHtml(name).replace(/'/g,"\\'")}')">Arrêter</button>
        </div>
      `).join('');
    }
  }

  /* ── Quick-launch grid ─── */
  const ql = document.getElementById('dash-ql-grid');
  if (!ql) return;
  if (!macros || macros.length === 0) {
    ql.innerHTML = '<div class="empty-state" style="padding:1rem;font-size:12px">Aucune macro créée</div>';
    return;
  }
  ql.innerHTML = macros.map((m, i) => {
    const isRunning = runningMacros.has(m.name);
    const rulesCount = (m.rules || []).length;
    return `
      <div class="ql-card ${isRunning ? 'ql-card-running' : ''}">
        <div class="ql-card-name" title="${escHtml(m.name)}">${escHtml(m.name || 'Sans nom')}</div>
        <div class="ql-card-meta">${rulesCount} règle${rulesCount !== 1 ? 's' : ''}</div>
        <div class="ql-card-actions">
          ${isRunning
            ? `<button class="btn btn-xs btn-danger" onclick="stopMacroByName('${escHtml(m.name).replace(/'/g,"\\'")}')">⏹ Stop</button>`
            : `<button class="btn btn-xs btn-success" onclick="startMacro(${i})">▶ Lancer</button>`
          }
          <button class="btn btn-xs btn-secondary" onclick="selectMacro(${i});navigate('macros')" title="Modifier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}
