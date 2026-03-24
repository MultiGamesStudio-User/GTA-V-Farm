'use strict';
/* ═══════════════════════════════════════════════════════════════
   MACROS DATA — persistence + CRUD
════════════════════════════════════════════════════════════════ */

async function loadMacros() {
  try {
    const data = await window.api.readMacros();
    macros = Array.isArray(data) ? data : (Array.isArray(data?.macros) ? data.macros : []);
  } catch (_) { macros = []; }
  renderMacroList();
  updateMacroCounters();
}

async function saveMacros() {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  try {
    await window.api.writeMacros(macros);
    appendLog('INFO', 'Macros sauvegardées');
  } catch (e) { appendLog('ERROR', 'Erreur sauvegarde: ' + e.message); }
}

function updateMacroCounters() {
  const el = document.getElementById('val-total-macros');
  if (el) el.textContent = macros.length;
  const badge = document.getElementById('macro-count-badge');
  if (badge) badge.textContent = macros.length;
}

function addMacro() {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  macros.push({ name: 'Nouvelle macro', loop: true, loop_delay: 0.1, max_iterations: 0, timeout_s: 0, humanize: false, humanize_factor: 0.12, rules: [] });
  currentMacroIdx = macros.length - 1;
  renderMacroList();
  renderMacroEditor();
}

function duplicateMacro(idx) {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  const copy = JSON.parse(JSON.stringify(macros[idx]));
  copy.name += ' (copie)';
  macros.splice(idx + 1, 0, copy);
  currentMacroIdx = idx + 1;
  renderMacroList();
  renderMacroEditor();
}

function deleteMacro(idx) {
  macros.splice(idx, 1);
  if (currentMacroIdx === idx) currentMacroIdx = -1;
  else if (currentMacroIdx > idx) currentMacroIdx--;
  renderMacroList();
  if (currentMacroIdx >= 0) renderMacroEditor();
  else {
    const form  = document.getElementById('macro-editor-form');
    const empty = document.getElementById('macro-editor-empty');
    if (form) form.style.display = 'none';
    if (empty) empty.style.display = '';
  }
  updateMacroCounters();
}

function selectMacro(idx) {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  currentMacroIdx = idx;
  renderMacroList();
  renderMacroEditor();
}

function renderMacroList() {
  const container = document.getElementById('macro-list');
  if (!container) return;
  updateMacroCounters();
  if (macros.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:1.2rem">Aucune macro</div>';
    return;
  }
  container.innerHTML = macros.map((m, i) => `
    <div class="macro-list-item ${i === currentMacroIdx ? 'active' : ''}" onclick="selectMacro(${i})">
      <span class="macro-list-name">${escHtml(m.name || 'Sans nom')}</span>
      <div class="macro-list-actions">
        <button class="icon-btn" title="Dupliquer" onclick="event.stopPropagation();duplicateMacro(${i})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" title="Supprimer" onclick="event.stopPropagation();deleteMacro(${i})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}
