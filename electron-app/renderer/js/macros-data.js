'use strict';
/* ═══════════════════════════════════════════════════════════════
   MACROS DATA — persistence + CRUD + DnD + search + import/export
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
    showToast('Macros sauvegardées', 'success', 2000);
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
  updateMacroCounters();
  openMacroModal(currentMacroIdx);
  setTimeout(() => document.getElementById('me-name')?.select(), 80);
}

function duplicateMacro(idx) {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  const copy = JSON.parse(JSON.stringify(macros[idx]));
  copy.name += ' (copie)';
  macros.splice(idx + 1, 0, copy);
  currentMacroIdx = idx + 1;
  renderMacroList();
  updateMacroCounters();
  openMacroModal(currentMacroIdx);
}

function moveMacroUp(idx) {
  if (idx <= 0) return;
  if (currentMacroIdx >= 0) flushEditorToMacro();
  [macros[idx - 1], macros[idx]] = [macros[idx], macros[idx - 1]];
  if (currentMacroIdx === idx) currentMacroIdx = idx - 1;
  else if (currentMacroIdx === idx - 1) currentMacroIdx = idx;
  renderMacroList();
  renderDashboard();
}

function moveMacroDown(idx) {
  if (idx >= macros.length - 1) return;
  if (currentMacroIdx >= 0) flushEditorToMacro();
  [macros[idx], macros[idx + 1]] = [macros[idx + 1], macros[idx]];
  if (currentMacroIdx === idx) currentMacroIdx = idx + 1;
  else if (currentMacroIdx === idx + 1) currentMacroIdx = idx;
  renderMacroList();
  renderDashboard();
}

function deleteMacro(idx) {
  // Close modal if this macro is being edited
  const modal = document.getElementById('macro-modal');
  if (modal && modal.style.display !== 'none' && currentMacroIdx === idx) {
    modal.style.display = 'none';
    document.removeEventListener('keydown', _modalEscHandler);
  }
  macros.splice(idx, 1);
  if (currentMacroIdx === idx) currentMacroIdx = -1;
  else if (currentMacroIdx > idx) currentMacroIdx--;
  renderMacroList();
  updateMacroCounters();
  renderDashboard();
}

function selectMacro(idx) {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  currentMacroIdx = idx;
  renderMacroList();
  openMacroModal(idx);
  _saveUiPref('lastMacroIdx', idx);
}

/* ── Search / Filter ──────────────────────────────────────── */
let _macroSearchQuery = '';
function filterMacroList() {
  _macroSearchQuery = (document.getElementById('macro-search')?.value || '').toLowerCase().trim();
  _applyMacroFilter();
}
function _applyMacroFilter() {
  const items = document.querySelectorAll('#macro-list .wf-card, #macro-list .macro-list-item');
  items.forEach(item => {
    const name = (item.querySelector('.wf-card-name, .macro-list-name')?.textContent || '').toLowerCase();
    item.style.display = (!_macroSearchQuery || name.includes(_macroSearchQuery)) ? '' : 'none';
  });
}

/* ── Drag & Drop ──────────────────────────────────────────── */
let _dndMacroSrc = -1;
let _dndMacroFromHandle = false;
function _initMacroListDnD() {
  const container = document.getElementById('macro-list');
  if (!container || container._dndReady) return;
  container._dndReady = true;

  container.addEventListener('mousedown', e => {
    _dndMacroFromHandle = !!e.target.closest('.macro-drag-handle');
  });

  container.addEventListener('dragstart', e => {
    if (!_dndMacroFromHandle) { e.preventDefault(); return; }
    const item = e.target.closest('.macro-list-item');
    if (!item) { e.preventDefault(); return; }
    _dndMacroSrc = parseInt(item.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(_dndMacroSrc));
    setTimeout(() => item.classList.add('dnd-dragging'), 0);
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.macro-list-item').forEach(i => i.classList.remove('dnd-over-top', 'dnd-over-bot'));
    const item = e.target.closest('.macro-list-item');
    if (item) {
      const rect = item.getBoundingClientRect();
      item.classList.add(e.clientY < rect.top + rect.height / 2 ? 'dnd-over-top' : 'dnd-over-bot');
    }
  });

  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll('.macro-list-item').forEach(i => i.classList.remove('dnd-over-top', 'dnd-over-bot'));
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    container.querySelectorAll('.macro-list-item').forEach(i => i.classList.remove('dnd-over-top', 'dnd-over-bot', 'dnd-dragging'));
    const item = e.target.closest('.macro-list-item');
    if (!item || _dndMacroSrc < 0) return;
    const dropIdx = parseInt(item.dataset.idx);
    if (_dndMacroSrc === dropIdx) { _dndMacroSrc = -1; return; }
    const rect = item.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const [moved] = macros.splice(_dndMacroSrc, 1);
    let target = dropIdx > _dndMacroSrc ? dropIdx - 1 : dropIdx;
    if (!insertBefore) target++;
    macros.splice(target, 0, moved);
    if (currentMacroIdx === _dndMacroSrc) currentMacroIdx = target;
    else if (_dndMacroSrc < currentMacroIdx && target >= currentMacroIdx) currentMacroIdx--;
    else if (_dndMacroSrc > currentMacroIdx && target <= currentMacroIdx) currentMacroIdx++;
    _dndMacroSrc = -1;
    renderMacroList();
    updateMacroCounters();
    renderDashboard();
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.macro-list-item').forEach(i => i.classList.remove('dnd-dragging', 'dnd-over-top', 'dnd-over-bot'));
    _dndMacroSrc = -1;
  });
}

/* ── Render ──────────────────────────────────────────────── */
function renderMacroList() {
  const container = document.getElementById('macro-list');
  if (!container) return;
  updateMacroCounters();
  if (macros.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="flex-direction:column;gap:.8rem;padding:3rem;text-align:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.25"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <div>Aucune macro créée</div>
        <button class="btn btn-primary btn-sm" onclick="addMacro()">+ Nouvelle macro</button>
      </div>`;
    return;
  }
  container.innerHTML = macros.map((m, i) => {
    const ruleCount = (m.rules || []).length;
    const actCount  = (m.rules || []).reduce((s, r) => s + (r.actions || []).length, 0);
    const loopLabel = m.loop !== false ? '∞ boucle' : '1×';
    const delay     = `${m.loop_delay ?? 0.1}s`;
    const isActive  = i === currentMacroIdx;
    return `
    <div class="wf-card${isActive ? ' wf-selected' : ''}" data-idx="${i}">
      <div class="wf-card-accent-bar"></div>
      <div class="wf-card-body" onclick="selectMacro(${i})">
        <div class="wf-card-name">${escHtml(m.name || 'Sans nom')}</div>
        <div class="wf-card-pills">
          <span class="wf-pill">${ruleCount} règle${ruleCount !== 1 ? 's' : ''}</span>
          <span class="wf-pill">${actCount} action${actCount !== 1 ? 's' : ''}</span>
          <span class="wf-pill">${loopLabel}</span>
          <span class="wf-pill">${delay}</span>
        </div>
      </div>
      <div class="wf-card-footer">
        <button class="btn btn-xs btn-success" onclick="event.stopPropagation();startMacro(${i})">
          <svg viewBox="0 0 24 24" fill="currentColor" width="10"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Démarrer
        </button>
        <div class="wf-card-footer-right">
          <button class="icon-btn" title="Dupliquer" onclick="event.stopPropagation();duplicateMacro(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn" title="Exporter" onclick="event.stopPropagation();exportCurrentMacroByIdx(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="icon-btn btn-danger-icon" title="Supprimer" onclick="event.stopPropagation();deleteMacro(${i})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  _applyMacroFilter();
}

/* ── Import / Export ─────────────────────────────────────── */
function exportAllMacros() {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  const json = JSON.stringify(macros, null, 2);
  _downloadJson(json, 'macros-export.json');
  showToast(`${macros.length} macro${macros.length !== 1 ? 's' : ''} exportée${macros.length !== 1 ? 's' : ''}`, 'success', 3000);
}

function exportCurrentMacro() {
  if (currentMacroIdx < 0) { showToast('Aucune macro sélectionnée', 'warn', 3000); return; }
  exportCurrentMacroByIdx(currentMacroIdx);
}

function exportCurrentMacroByIdx(idx) {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  const macro = macros[idx];
  if (!macro) return;
  const json = JSON.stringify([macro], null, 2);
  _downloadJson(json, (macro.name || 'macro').replace(/[^a-z0-9_-]/gi, '_') + '.json');
  showToast(`"${macro.name}" exportée`, 'success', 3000);
}

function _downloadJson(json, filename) {
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function triggerImportMacros() {
  document.getElementById('macro-import-input')?.click();
}

async function handleImportMacros(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text  = await file.text();
    const data  = JSON.parse(text);
    const items = Array.isArray(data) ? data : (Array.isArray(data?.macros) ? data.macros : null);
    if (!items || !items.length) { showToast('Fichier invalide ou vide', 'error', 4000); return; }
    if (currentMacroIdx >= 0) flushEditorToMacro();
    let added = 0;
    for (const m of items) {
      if (!m || typeof m !== 'object') continue;
      let name = m.name || 'Importée';
      let suf  = 1;
      while (macros.some(x => x.name === name)) name = (m.name || 'Importée') + ' (' + suf++ + ')';
      macros.push({ ...m, name });
      added++;
    }
    renderMacroList();
    renderDashboard();
    updateMacroCounters();
    showToast(`${added} macro${added !== 1 ? 's' : ''} importée${added !== 1 ? 's' : ''}`, 'success', 4000);
    appendLog('INFO', `Import: ${added} macros ajoutées`);
  } catch (err) {
    showToast('Erreur import: ' + err.message, 'error', 5000);
  }
  e.target.value = '';
}
