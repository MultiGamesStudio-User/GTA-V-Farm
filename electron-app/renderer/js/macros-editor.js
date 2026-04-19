'use strict';
/* ═══════════════════════════════════════════════════════════════
   MACROS EDITOR — form, rules, conditions, actions inline
════════════════════════════════════════════════════════════════ */

/* ── Modal control ──────────────────────────────────────────── */
function openMacroModal(idx) {
  currentMacroIdx = idx;
  const modal   = document.getElementById('macro-modal');
  const titleEl = document.getElementById('macro-modal-title-text');
  if (!modal) return;
  const macro = macros[idx];
  if (titleEl) titleEl.textContent = macro?.name || 'Macro';
  renderMacroEditor();
  modal.style.display = 'flex';
  document.addEventListener('keydown', _modalEscHandler);
}

function closeMacroModal() {
  const modal = document.getElementById('macro-modal');
  if (!modal || modal.style.display === 'none') return;
  if (currentMacroIdx >= 0) flushEditorToMacro();
  modal.style.display = 'none';
  document.removeEventListener('keydown', _modalEscHandler);
  renderMacroList();
  renderDashboard();
}

function _modalEscHandler(e) {
  if (e.key === 'Escape') closeMacroModal();
}

async function saveMacroFromModal() {
  if (currentMacroIdx >= 0) flushEditorToMacro();
  // Update modal title to reflect any name change
  const macro   = macros[currentMacroIdx];
  const titleEl = document.getElementById('macro-modal-title-text');
  if (titleEl && macro) titleEl.textContent = macro.name || 'Macro';
  renderMacroList();
  await saveMacros();
}

const COND_LABELS = {
  // Vision
  pixel_color: 'Pixel couleur', pixel_color_not: 'Pixel couleur ≠',
  pixel_changed: 'Pixel a changé', pixel_not_changed: 'Pixel n\'a pas changé',
  region_color_avg: 'Couleur moyenne zone',
  text_contains: 'Texte contient', text_not_contains: 'Texte ≠',
  text_regex: 'Texte regex',
  template_match: 'Template match', template_not_found: 'Template absent',
  // Fenêtres & processus
  window_focused: 'Fenêtre active', window_not_focused: 'Fenêtre inactive',
  window_exists: 'Fenêtre existe', window_not_exists: 'Fenêtre absente',
  process_running: 'Processus actif', process_not_running: 'Processus inactif',
  // Macros
  macro_is_running: 'Macro en cours', macro_not_running: 'Macro arrêtée',
  // Variables & compteurs
  counter_eq: 'Compteur =', counter_not_eq: 'Compteur ≠',
  counter_gte: 'Compteur ≥', counter_lte: 'Compteur ≤',
  counter_gt: 'Compteur >', counter_lt: 'Compteur <',
  counter_between: 'Compteur entre',
  variable_equals: 'Variable =', variable_contains: 'Variable contient',
  // Temporel & aléatoire
  time_between: 'Heure entre', random_chance: 'Chance aléatoire',
  // Entrées
  key_is_held: 'Touche enfoncée', key_not_held: 'Touche relâchée',
  clipboard_contains: 'Presse-papier contient',
  // Universel
  always: 'Toujours vrai', never: 'Toujours faux',
};

const ACT_LABELS = {
  // Clavier
  key_tap: 'Appui touche', key_hold: 'Maintien touche', key_release: 'Relâcher touche',
  key_combo: 'Combo touches', type_text: 'Taper du texte',
  // Souris
  mouse_move: 'Déplacer souris', mouse_click: 'Clic souris',
  mouse_double_click: 'Double-clic souris', mouse_drag: 'Drag souris', scroll: 'Scroll',
  // Temporisation
  wait: 'Attendre (fixe)', random_wait: 'Attendre (aléatoire)',
  // Contrôle macro
  macro_start: 'Lancer macro', macro_stop: 'Arrêter macro', stop_self: 'Arrêter cette macro',
  // Variables & Compteurs
  set_variable: 'Définir variable', counter_set: 'Définir compteur',
  counter_inc: '++ Incrémenter', counter_dec: '-- Décrémenter', counter_reset: 'Reset compteur',
  // Notifications
  send_webhook: '🔔 Envoyer webhook', log_message: '📝 Log message',
  notify_toast: '💬 Notification Windows', play_sound: '🔊 Jouer son',
  // Flux
  repeat: '🔁 Répéter bloc',
  // Système
  focus_window: 'Focus fenêtre', screenshot_save: 'Sauvegarder screenshot',
  clipboard_set: 'Copier presse-papier',
};

/* ── Editor form ──────────────────────────────────────────── */
function renderMacroEditor() {
  const macro = macros[currentMacroIdx];
  if (!macro) return;
  document.getElementById('macro-editor-empty').style.display = 'none';
  document.getElementById('macro-editor-form').style.display = '';
  document.getElementById('me-name').value = macro.name || '';
  document.getElementById('me-loop').checked = macro.loop !== false;
  document.getElementById('me-loop-delay').value = macro.loop_delay != null ? macro.loop_delay : 0.1;
  document.getElementById('me-max-iter').value = macro.max_iterations != null ? macro.max_iterations : 0;
  document.getElementById('me-timeout').value = macro.timeout_s != null ? macro.timeout_s : 0;
  document.getElementById('me-humanize').checked = !!macro.humanize;
  document.getElementById('me-humanize-factor').value = macro.humanize_factor != null ? macro.humanize_factor : 0.12;
  // Window scope — populate asynchronously with all windows
  const scopeEl = document.getElementById('me-target-window');
  if (scopeEl) {
    scopeEl.innerHTML = '<option value="">Aucune (toutes les fenêtres)</option>';
    // Keep saved value visible immediately
    if (macro.target_hwnd) {
      scopeEl.innerHTML += `<option value="${macro.target_hwnd}" selected>hwnd: ${macro.target_hwnd}</option>`;
    }
    // Fetch all windows and populate
    _populateWindowScopeDropdown(scopeEl, macro.target_hwnd);
  }
  renderRules();
  renderAdvancedSections();
  updateMacroRunButtons();
}

async function _populateWindowScopeDropdown(scopeEl, selectedHwnd) {
  try {
    await ensureEngine();
    const res = await window.api.listWindows();
    if (res.ok === false || !res.windows) {
      // Engine error — keep placeholder
      return;
    }
    const wins = res.windows;
    scopeEl.innerHTML = '<option value="">Aucune (toutes les fenêtres)</option>';
    let found = false;
    for (const w of wins) {
      const sel = (selectedHwnd != null && String(w.hwnd) === String(selectedHwnd)) ? 'selected' : '';
      if (sel) found = true;
      scopeEl.innerHTML += `<option value="${w.hwnd}" ${sel}>${escHtml(w.title)} (${escHtml(w.exe)})</option>`;
    }
    // If saved hwnd is not in the current list, keep it as option
    if (selectedHwnd && !found) {
      scopeEl.innerHTML += `<option value="${selectedHwnd}" selected>hwnd: ${selectedHwnd} (fermée?)</option>`;
    }
  } catch (e) {
    // Silently keep the placeholder options
  }
}

function macroFieldChanged() {
  if (currentMacroIdx < 0) return;
  const m = macros[currentMacroIdx];
  m.name             = document.getElementById('me-name').value;
  m.loop             = document.getElementById('me-loop').checked;
  m.loop_delay       = parseFloat(document.getElementById('me-loop-delay').value) || 0.1;
  m.max_iterations   = parseInt(document.getElementById('me-max-iter').value, 10) || 0;
  m.timeout_s        = parseFloat(document.getElementById('me-timeout').value) || 0;
  m.humanize         = document.getElementById('me-humanize').checked;
  m.humanize_factor  = parseFloat(document.getElementById('me-humanize-factor').value) || 0.12;
  const scopeEl = document.getElementById('me-target-window');
  if (scopeEl) {
    const val = scopeEl.value;
    m.target_hwnd = val || null;
  }
  const items = document.querySelectorAll('.macro-list-item');
  if (items[currentMacroIdx]) {
    const nameEl = items[currentMacroIdx].querySelector('.macro-list-name');
    if (nameEl) nameEl.textContent = m.name || 'Sans nom';
  }
  // Update modal title live
  const titleEl = document.getElementById('macro-modal-title-text');
  if (titleEl) titleEl.textContent = m.name || 'Sans nom';
}

function flushEditorToMacro() {
  if (currentMacroIdx < 0) return;
  macroFieldChanged();
}

/* ── Rule collapse state (by rule ID, persists across re-renders) */
let _collapsedRules = new Set();

function toggleRuleCollapse(ri) {
  const macro = macros[currentMacroIdx];
  if (!macro) return;
  const ruleId = macro.rules[ri]?.id || String(ri);
  if (_collapsedRules.has(ruleId)) {
    _collapsedRules.delete(ruleId);
  } else {
    _collapsedRules.add(ruleId);
  }
  // Update DOM directly — no full re-render needed
  const card = document.getElementById('rule-' + ri);
  if (!card) return;
  const isCollapsed = _collapsedRules.has(ruleId);
  card.classList.toggle('collapsed', isCollapsed);
  const chevron = card.querySelector('.rule-chevron');
  if (chevron) chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function collapseAllRules() {
  const macro = macros[currentMacroIdx];
  if (!macro) return;
  macro.rules.forEach((r, ri) => _collapsedRules.add(r.id || String(ri)));
  renderRules();
}

function expandAllRules() {
  _collapsedRules.clear();
  renderRules();
}

/* ── Rules ────────────────────────────────────────────────── */
function renderRules() {
  const macro = macros[currentMacroIdx];
  const container = document.getElementById('rules-container');
  if (!macro || !container) return;
  macro.rules = macro.rules || [];
  if (macro.rules.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:1rem">Aucune règle. Cliquez "+ Règle"</div>';
    return;
  }
  container.innerHTML = macro.rules.map((rule, ri) => renderRuleHTML(rule, ri)).join('');
  _initRulesDnD();
  _initItemsDnD();
}

function renderRuleHTML(rule, ri) {
  rule.conditions = rule.conditions || [];
  rule.actions    = rule.actions    || [];
  const ruleId    = rule.id || String(ri);
  const isCollapsed = _collapsedRules.has(ruleId);
  const condCount = rule.conditions.length;
  const actCount  = rule.actions.length;
  const isDisabled = rule.enabled === false;

  // Compact pills shown in collapsed mode
  const condPill = condCount
    ? `<span class="rule-pill rule-pill-cond">${condCount} cond.</span>`
    : `<span class="rule-pill rule-pill-empty">∅ cond.</span>`;
  const actPill  = actCount
    ? `<span class="rule-pill rule-pill-act">${actCount} action${actCount !== 1 ? 's' : ''}</span>`
    : `<span class="rule-pill rule-pill-empty">∅ action</span>`;

  return `
  <div class="rule-card${isCollapsed ? ' collapsed' : ''}${isDisabled ? ' rule-disabled' : ''}" id="rule-${ri}" draggable="true">
    <div class="rule-header">
      <div class="rule-drag-handle" title="Glisser pour réorganiser">
        <svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11">
          <circle cx="5" cy="3.5" r="1.3"/><circle cx="11" cy="3.5" r="1.3"/>
          <circle cx="5" cy="8"   r="1.3"/><circle cx="11" cy="8"   r="1.3"/>
          <circle cx="5" cy="12.5" r="1.3"/><circle cx="11" cy="12.5" r="1.3"/>
        </svg>
      </div>
      <button class="icon-btn rule-collapse-btn" title="${isCollapsed ? 'Développer' : 'Réduire'}" onclick="toggleRuleCollapse(${ri})">
        <svg class="rule-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12"
          style="transition:transform .2s cubic-bezier(.4,0,.2,1);transform:rotate(${isCollapsed ? '-90' : '0'}deg)">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="rule-header-left">
        <label class="toggle-label" title="${isDisabled ? 'Activer' : 'Désactiver'}">
          <input type="checkbox" class="rule-enabled" ${rule.enabled !== false ? 'checked' : ''}
            onchange="setRuleField(${ri},'enabled',this.checked);this.closest('.rule-card').classList.toggle('rule-disabled',!this.checked)">
          <span class="toggle-track"></span>
        </label>
        <input type="text" class="rule-label-input" value="${escHtml(rule.label || 'Règle ' + (ri + 1))}"
          placeholder="Nom de la règle" oninput="setRuleField(${ri},'label',this.value)">
        <div class="rule-summary-pills">${condPill}${actPill}</div>
      </div>
      <div class="rule-header-right">
        <select class="cond-mode-select" onchange="setRuleField(${ri},'condition_mode',this.value)">
          <option value="all"  ${(rule.condition_mode||'all') === 'all'  ? 'selected' : ''}>Toutes les cond.</option>
          <option value="any"  ${rule.condition_mode === 'any'           ? 'selected' : ''}>Au moins une</option>
          <option value="none" ${rule.condition_mode === 'none'          ? 'selected' : ''}>Aucune (toujours)</option>
        </select>
        <label class="small-check-label">
          <input type="checkbox" ${rule.stop_on_match ? 'checked' : ''} onchange="setRuleField(${ri},'stop_on_match',this.checked)">
          Stop si match
        </label>
        <button class="icon-btn" title="Dupliquer règle" onclick="duplicateRule(${ri})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" title="Supprimer règle" onclick="deleteRule(${ri})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>
    <div class="rule-body">
      <div class="rule-col">
        <div class="rule-col-header">
          <span class="col-title cond-title">CONDITIONS</span>
          <button class="btn btn-xs btn-secondary" onclick="addCondition(${ri})">+ Condition</button>
        </div>
        <div class="cond-list" id="cond-list-${ri}">
          ${rule.conditions.map((c, ci) => renderConditionRowHTML(c, ri, ci, rule.conditions.length)).join('')}
          ${rule.conditions.length === 0 ? '<div class="empty-mini">Pas de condition — règle active si "Aucune cond."</div>' : ''}
        </div>
      </div>
      <div class="rule-col">
        <div class="rule-col-header">
          <span class="col-title act-title">ACTIONS</span>
          <button class="btn btn-xs btn-secondary" onclick="addAction(${ri})">+ Action</button>
        </div>
        <div class="act-list" id="act-list-${ri}">
          ${rule.actions.map((a, ai) => renderActionRowHTML(a, ri, ai, rule.actions.length)).join('')}
          ${rule.actions.length === 0 ? '<div class="empty-mini">Aucune action configurée</div>' : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function setRuleField(ri, field, value) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri][field] = value;
}

function addRule() {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules.push({
    id: 'rule_' + Date.now(),
    label: 'Règle ' + (macros[currentMacroIdx].rules.length + 1),
    enabled: true, condition_mode: 'all', conditions: [], actions: [], stop_on_match: false,
  });
  renderRules();
}

function deleteRule(ri) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules.splice(ri, 1);
  renderRules();
}

function duplicateRule(ri) {
  if (currentMacroIdx < 0) return;
  const copy = JSON.parse(JSON.stringify(macros[currentMacroIdx].rules[ri]));
  copy.id    = 'rule_' + Date.now();
  copy.label = (copy.label || 'Règle') + ' (copie)';
  macros[currentMacroIdx].rules.splice(ri + 1, 0, copy);
  renderRules();
}

function moveCondUp(ri, ci) {
  if (currentMacroIdx < 0 || ci <= 0) return;
  const conds = macros[currentMacroIdx].rules[ri].conditions;
  [conds[ci - 1], conds[ci]] = [conds[ci], conds[ci - 1]];
  renderRules();
}

function moveCondDown(ri, ci) {
  if (currentMacroIdx < 0) return;
  const conds = macros[currentMacroIdx].rules[ri].conditions;
  if (ci >= conds.length - 1) return;
  [conds[ci], conds[ci + 1]] = [conds[ci + 1], conds[ci]];
  renderRules();
}

function moveActUp(ri, ai) {
  if (currentMacroIdx < 0 || ai <= 0) return;
  const acts = macros[currentMacroIdx].rules[ri].actions;
  [acts[ai - 1], acts[ai]] = [acts[ai], acts[ai - 1]];
  renderRules();
}

function moveActDown(ri, ai) {
  if (currentMacroIdx < 0) return;
  const acts = macros[currentMacroIdx].rules[ri].actions;
  if (ai >= acts.length - 1) return;
  [acts[ai], acts[ai + 1]] = [acts[ai + 1], acts[ai]];
  renderRules();
}

/* ── Drag & Drop — rules ─────────────────────────────────── */
let _dndRuleSrc = -1;
function _initRulesDnD() {
  const container = document.getElementById('rules-container');
  if (!container || container._ruleDndReady) return;
  container._ruleDndReady = true;

  container.addEventListener('dragstart', e => {
    const rh = e.target.closest('.rule-drag-handle');
    if (!rh) return;
    const card = rh.closest('.rule-card');
    if (!card) return;
    _dndRuleSrc = parseInt(card.id.split('-')[1]);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(_dndRuleSrc));
    setTimeout(() => card.classList.add('dnd-dragging'), 0);
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    const card = e.target.closest('.rule-card');
    container.querySelectorAll('.rule-card').forEach(c => c.classList.remove('dnd-over-top', 'dnd-over-bot'));
    if (card) {
      const rect = card.getBoundingClientRect();
      card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'dnd-over-top' : 'dnd-over-bot');
    }
  });

  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) {
      container.querySelectorAll('.rule-card').forEach(c => c.classList.remove('dnd-over-top', 'dnd-over-bot'));
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const macro = macros[currentMacroIdx];
    container.querySelectorAll('.rule-card').forEach(c => c.classList.remove('dnd-over-top', 'dnd-over-bot', 'dnd-dragging'));
    const card = e.target.closest('.rule-card');
    if (!card || !macro || _dndRuleSrc < 0) return;
    const dropRi = parseInt(card.id.split('-')[1]);
    if (_dndRuleSrc === dropRi) { _dndRuleSrc = -1; return; }
    const rect = card.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const [moved] = macro.rules.splice(_dndRuleSrc, 1);
    let target = dropRi > _dndRuleSrc ? dropRi - 1 : dropRi;
    if (!insertBefore) target++;
    macro.rules.splice(target, 0, moved);
    _dndRuleSrc = -1;
    renderRules();
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.rule-card').forEach(c => c.classList.remove('dnd-dragging', 'dnd-over-top', 'dnd-over-bot'));
    _dndRuleSrc = -1;
  });
}

/* ── Drag & Drop — condition / action items ──────────────── */
let _dndItemSrc = null; // { type: 'cond'|'act', ri, idx }
function _initItemsDnD() {
  const container = document.getElementById('rules-container');
  if (!container || container._itemDndReady) return;
  container._itemDndReady = true;

  container.addEventListener('dragstart', e => {
    const ch = e.target.closest('.cond-drag-handle');
    const ah = e.target.closest('.act-drag-handle');
    if (!ch && !ah) return;
    const row = (ch || ah).closest('.item-row');
    if (!row) return;
    const parts = row.id.split('-');
    const ri = parseInt(parts[1]);
    const idx = parseInt(parts[2]);
    _dndItemSrc = { type: ch ? 'cond' : 'act', ri, idx };
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation(); // prevent rule drag from triggering
    setTimeout(() => row.classList.add('dnd-dragging'), 0);
  }, true);

  container.addEventListener('dragover', e => {
    if (!_dndItemSrc) return;
    const row = e.target.closest('.item-row');
    if (!row) return;
    const listType = _dndItemSrc.type === 'cond' ? 'cond-list' : 'act-list';
    if (!row.closest('.' + listType)) return;
    e.preventDefault();
    e.stopPropagation();
    const list = row.closest('.' + listType);
    list.querySelectorAll('.item-row').forEach(r => r.classList.remove('dnd-over-top', 'dnd-over-bot'));
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'dnd-over-top' : 'dnd-over-bot');
  }, true);

  container.addEventListener('dragleave', e => {
    const row = e.target.closest('.item-row');
    if (row) row.classList.remove('dnd-over-top', 'dnd-over-bot');
  });

  container.addEventListener('drop', e => {
    if (!_dndItemSrc) return;
    const row = e.target.closest('.item-row');
    if (!row) return;
    const listType = _dndItemSrc.type === 'cond' ? 'cond-list' : 'act-list';
    if (!row.closest('.' + listType)) return;
    e.preventDefault();
    e.stopPropagation();
    const parts = row.id.split('-');
    const dropRi = parseInt(parts[1]);
    const dropIdx = parseInt(parts[2]);
    const { ri, idx } = _dndItemSrc;
    if (ri !== dropRi) { _dndItemSrc = null; renderRules(); return; }
    if (idx === dropIdx) { _dndItemSrc = null; renderRules(); return; }
    const arr = _dndItemSrc.type === 'cond'
      ? macros[currentMacroIdx]?.rules[ri]?.conditions
      : macros[currentMacroIdx]?.rules[ri]?.actions;
    if (!arr) { _dndItemSrc = null; return; }
    const rect = row.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const [moved] = arr.splice(idx, 1);
    let target = dropIdx > idx ? dropIdx - 1 : dropIdx;
    if (!insertBefore) target++;
    arr.splice(target, 0, moved);
    _dndItemSrc = null;
    renderRules();
  }, true);

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.item-row').forEach(r => r.classList.remove('dnd-dragging', 'dnd-over-top', 'dnd-over-bot'));
    _dndItemSrc = null;
  });
}

/* ── Condition rows ───────────────────────────────────────── */
function renderConditionRowHTML(c, ri, ci, total) {
  const type = c.type || 'pixel_color';
  return `
  <div class="item-row" id="crow-${ri}-${ci}" draggable="true">
    <div class="item-row-head">
      <div class="item-drag-handle cond-drag-handle" title="Glisser pour réorganiser">
        <svg viewBox="0 0 16 16" fill="currentColor" width="9" height="9">
          <circle cx="4.5" cy="3.5" r="1.1"/><circle cx="11.5" cy="3.5" r="1.1"/>
          <circle cx="4.5" cy="8"   r="1.1"/><circle cx="11.5" cy="8"   r="1.1"/>
          <circle cx="4.5" cy="12.5" r="1.1"/><circle cx="11.5" cy="12.5" r="1.1"/>
        </svg>
      </div>
      <select class="item-type-select" onchange="setCondType(${ri},${ci},this.value)">
        ${Object.entries(COND_LABELS).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
      </select>
      <div class="item-row-btns">
        <button class="icon-btn" title="Tester" onclick="testConditionInline(${ri},${ci})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </button>
        <button class="icon-btn" title="Monter" onclick="moveCondUp(${ri},${ci})" ${ci === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="icon-btn" title="Descendre" onclick="moveCondDown(${ri},${ci})" ${ci === (total||0) - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" onclick="deleteCondition(${ri},${ci})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="item-fields">${renderConditionInlineFields(c)}</div>
    <div class="inline-test-result" id="ctest-${ri}-${ci}" style="display:none"></div>
  </div>`;
}

function renderConditionInlineFields(c) {
  const t = c.type || 'pixel_color';
  if (t === 'always' || t === 'never') return '';

  const coordFields = `<div class="fields-row">
    <span class="coord-summary" title="X=${c.x || 0}, Y=${c.y || 0}">📍 ${c.x || 0}, ${c.y || 0}</span>
    <input type="hidden" class="cf x" value="${c.x || 0}">
    <input type="hidden" class="cf y" value="${c.y || 0}">
    <button class="pick-btn" title="Choisir un point à l'écran" onclick="pickPointForCondField(this)">🎯 Point</button>
  </div>`;
  const sizeFields = `<div class="fields-row">
    <span class="coord-summary" title="Zone: ${c.x || 0},${c.y || 0} ${c.w || 100}x${c.h || 50}">🔲 ${c.x || 0},${c.y || 0} — ${c.w || 100}×${c.h || 50}</span>
    <input type="hidden" class="cf x" value="${c.x || 0}">
    <input type="hidden" class="cf y" value="${c.y || 0}">
    <input type="hidden" class="cf w" value="${c.w || 100}">
    <input type="hidden" class="cf h" value="${c.h || 50}">
    <button class="pick-btn" title="Sélectionner une zone à l'écran" onclick="pickRegionForCondField(this)">🔲 Zone</button>
    <button class="pick-btn" title="Choisir un point à l'écran" onclick="pickPointForCondField(this)">🎯 Point</button>
  </div>`;

  if (t === 'pixel_color' || t === 'pixel_color_not') {
    return coordFields + `<div class="fields-row">
      <span>Couleur</span>
      <input type="color" class="cf color" value="${rgbToHex(c.color) || '#ff0000'}" onchange="syncCondField(this,'color',false,'color')">
      <span>Tol.</span><input type="number" class="cf tol" value="${c.tolerance || 10}" min="0" max="255" onchange="syncCondField(this,'tolerance',true)">
    </div>`;
  }
  if (t === 'region_color_avg') {
    return sizeFields + `<div class="fields-row">
      <span>Couleur</span>
      <input type="color" class="cf color" value="${rgbToHex(c.color) || '#ff0000'}" onchange="syncCondField(this,'color',false,'color')">
      <span>Tol.</span><input type="number" class="cf tol" value="${c.tolerance || 20}" min="0" max="255" onchange="syncCondField(this,'tolerance',true)">
    </div>`;
  }
  if (t === 'text_contains' || t === 'text_not_contains') {
    return sizeFields + `<div class="fields-row">
      <span>Texte</span><input type="text" class="cf text" value="${escHtml(c.text || '')}" placeholder="texte attendu" onchange="syncCondField(this,'text',false)">
    </div>`;
  }
  if (t === 'text_regex') {
    return sizeFields + `<div class="fields-row">
      <span>Regex</span><input type="text" class="cf pattern" value="${escHtml(c.pattern || '')}" placeholder="expression régulière" onchange="syncCondField(this,'pattern',false)">
    </div>`;
  }
  if (t === 'template_match' || t === 'template_not_found') {
    return sizeFields + `<div class="fields-row">
      <span>Fichier</span><input type="text" class="cf template_path" value="${escHtml(c.template_path || '')}" placeholder="chemin/vers/image.png" onchange="syncCondField(this,'template_path',false)">
      <span>Seuil</span><input type="number" class="cf threshold" value="${c.threshold || 0.8}" min="0" max="1" step="0.05" onchange="syncCondField(this,'threshold',true)">
    </div>`;
  }
  if (t === 'pixel_changed' || t === 'pixel_not_changed') {
    return coordFields + `<div class="fields-row">
      <span>Tol.</span><input type="number" class="cf tolerance" value="${c.tolerance != null ? c.tolerance : 10}" min="0" max="255" onchange="syncCondField(this,'tolerance',true)">
    </div>`;
  }
  if (t === 'window_focused' || t === 'window_not_focused' ||
      t === 'window_exists'  || t === 'window_not_exists') {
    return `<div class="fields-row">
      <span>Titre fenêtre</span>
      <input type="text" class="cf title" style="flex:1" value="${escHtml(c.title || '')}" placeholder="FiveM" onchange="syncCondField(this,'title',false)">
    </div>`;
  }
  if (t === 'process_running' || t === 'process_not_running') {
    return `<div class="fields-row">
      <span>Processus (.exe)</span>
      <input type="text" class="cf exe" style="flex:1" value="${escHtml(c.exe || '')}" placeholder="GTA5.exe" onchange="syncCondField(this,'exe',false)">
    </div>`;
  }
  if (t === 'macro_is_running' || t === 'macro_not_running') {
    return `<div class="fields-row">
      <span>Nom macro</span>
      <input type="text" class="cf name" style="flex:1" value="${escHtml(c.name || '')}" placeholder="Nom de la macro" onchange="syncCondField(this,'name',false)">
    </div>`;
  }
  if (t === 'counter_eq' || t === 'counter_not_eq' || t === 'counter_gte' ||
      t === 'counter_lte' || t === 'counter_gt'    || t === 'counter_lt') {
    return `<div class="fields-row">
      <span>Compteur</span>
      <input type="text" class="cf name" style="width:120px" value="${escHtml(c.name || '')}" placeholder="score" onchange="syncCondField(this,'name',false)">
      <span>Valeur</span>
      <input type="number" class="cf value" value="${c.value != null ? c.value : 0}" onchange="syncCondField(this,'value',true)">
    </div>`;
  }
  if (t === 'counter_between') {
    return `<div class="fields-row">
      <span>Compteur</span>
      <input type="text" class="cf name" style="width:100px" value="${escHtml(c.name || '')}" placeholder="score" onchange="syncCondField(this,'name',false)">
      <span>Min</span>
      <input type="number" class="cf min" value="${c.min != null ? c.min : 0}" onchange="syncCondField(this,'min',true)">
      <span>Max</span>
      <input type="number" class="cf max" value="${c.max != null ? c.max : 10}" onchange="syncCondField(this,'max',true)">
    </div>`;
  }
  if (t === 'variable_equals' || t === 'variable_contains') {
    return `<div class="fields-row">
      <span>Variable</span>
      <input type="text" class="cf name" style="width:120px" value="${escHtml(c.name || '')}" placeholder="ma_var" onchange="syncCondField(this,'name',false)">
      <span>Valeur</span>
      <input type="text" class="cf value" style="flex:1" value="${escHtml(String(c.value != null ? c.value : ''))}" onchange="syncCondField(this,'value',false)">
    </div>`;
  }
  if (t === 'time_between') {
    return `<div class="fields-row">
      <span>De</span>
      <input type="time" class="cf start" value="${c.start || '08:00'}" onchange="syncCondField(this,'start',false)">
      <span>À</span>
      <input type="time" class="cf end" value="${c.end || '22:00'}" onchange="syncCondField(this,'end',false)">
    </div>`;
  }
  if (t === 'random_chance') {
    const _pct = Math.round((c.probability != null ? c.probability : 0.5) * 100);
    return `<div class="fields-row">
      <span>Probabilité</span>
      <input type="number" class="cf probability" value="${_pct}" min="0" max="100" step="1" onchange="syncCondProbability(this)">
      <span>%</span>
    </div>`;
  }
  if (t === 'key_is_held' || t === 'key_not_held') {
    return `<div class="fields-row">
      <span>Touche</span>
      <input type="text" class="cf key key-capture" value="${escHtml(c.key || 'f')}" placeholder="Cliquez puis appuyez" readonly onfocus="startKeyCaptureCond(this,'key')" data-field="key">
    </div>`;
  }
  if (t === 'clipboard_contains') {
    return `<div class="fields-row">
      <span>Texte</span>
      <input type="text" class="cf text" style="flex:1" value="${escHtml(c.text || '')}" placeholder="texte recherché" onchange="syncCondField(this,'text',false)">
    </div>`;
  }
  return '';
}

function syncCondField(inputEl, field, isNum, inputType) {
  const row = inputEl.closest('.item-row');
  if (!row) return;
  let c;
  const section = row.dataset.section;
  if (section) {
    const idx = parseInt(row.dataset.idx);
    c = macros[currentMacroIdx]?.[section]?.[idx];
  } else {
    const [, ri, ci] = row.id.split('-').map(Number);
    c = macros[currentMacroIdx]?.rules[ri]?.conditions[ci];
  }
  if (!c) return;
  if (inputType === 'color') c[field] = hexToRgb(inputEl.value);
  else if (isNum) c[field] = parseFloat(inputEl.value);
  else c[field] = inputEl.value;
}

function syncCondProbability(inputEl) {
  const row = inputEl.closest('.item-row');
  if (!row) return;
  let c;
  const section = row.dataset.section;
  if (section) {
    const idx = parseInt(row.dataset.idx);
    c = macros[currentMacroIdx]?.[section]?.[idx];
  } else {
    const [, ri, ci] = row.id.split('-').map(Number);
    c = macros[currentMacroIdx]?.rules[ri]?.conditions[ci];
  }
  if (!c) return;
  c.probability = Math.max(0, Math.min(100, parseFloat(inputEl.value) || 0)) / 100;
}

function startKeyCaptureCond(input, field) {
  input.value = '⌨ Appuyez…';
  input.classList.add('capturing');
  const handler = (e) => {
    e.preventDefault(); e.stopPropagation();
    input.value = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    input.classList.remove('capturing');
    input.removeEventListener('keydown', handler);
    input.removeEventListener('blur', blurHandler);
    input.blur();
    syncCondField(input, field, false);
  };
  const blurHandler = () => {
    if (input.classList.contains('capturing')) {
      input.value = '';
      input.classList.remove('capturing');
      input.removeEventListener('keydown', handler);
    }
  };
  input.addEventListener('keydown', handler);
  input.addEventListener('blur', blurHandler, { once: true });
}

// Default fields injected when switching to a condition type that needs them
const COND_DEFAULTS = {
  pixel_color:      { x: 0, y: 0, color: [255, 0, 0], tolerance: 10 },
  pixel_color_not:  { x: 0, y: 0, color: [255, 0, 0], tolerance: 10 },
  pixel_changed:    { x: 0, y: 0, tolerance: 10 },
  region_color_avg: { x: 0, y: 0, w: 200, h: 100, color: [255, 0, 0], tolerance: 20 },
  text_contains:    { x: 0, y: 0, w: 300, h: 60, text: '' },
  text_not_contains:{ x: 0, y: 0, w: 300, h: 60, text: '' },
  text_regex:       { x: 0, y: 0, w: 300, h: 60, pattern: '' },
  template_match:   { x: 0, y: 0, w: 400, h: 300, template_path: '', threshold: 0.85 },
  template_not_found:{ x: 0, y: 0, w: 400, h: 300, template_path: '', threshold: 0.85 },
  window_focused:   { title: '' },
  window_not_focused:{ title: '' },
  window_exists:    { title: '' },
  window_not_exists:{ title: '' },
  process_running:  { exe: '' },
  process_not_running:{ exe: '' },
  macro_is_running: { name: '' },
  macro_not_running:{ name: '' },
  counter_eq:       { name: '', value: 0 },
  counter_not_eq:   { name: '', value: 0 },
  counter_gte:      { name: '', value: 0 },
  counter_lte:      { name: '', value: 0 },
  counter_gt:       { name: '', value: 0 },
  counter_lt:       { name: '', value: 0 },
  counter_between:  { name: '', min: 0, max: 10 },
  variable_equals:  { name: '', value: '' },
  variable_contains:{ name: '', value: '' },
  time_between:     { start: '08:00', end: '22:00' },
  random_chance:    { probability: 0.5 },
  key_is_held:      { key: 'f' },
  key_not_held:     { key: 'f' },
  clipboard_contains:{ text: '' },
  pixel_changed:    { x: 0, y: 0, tolerance: 10 },
  pixel_not_changed: { x: 0, y: 0, tolerance: 10 },
};

function setCondType(ri, ci, type) {
  if (currentMacroIdx < 0) return;
  const c = macros[currentMacroIdx].rules[ri].conditions[ci];
  c.type = type;
  // Inject missing defaults for the new type
  const defaults = COND_DEFAULTS[type] || {};
  for (const [k, v] of Object.entries(defaults)) {
    if (c[k] === undefined || c[k] === null) c[k] = v;
  }
  const fieldsEl = document.querySelector(`#crow-${ri}-${ci} .item-fields`);
  if (fieldsEl) fieldsEl.innerHTML = renderConditionInlineFields(c);
}

function addCondition(ri) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri].conditions.push({ type: 'pixel_color', x: 0, y: 0, color: [255, 0, 0], tolerance: 10 });
  renderRules();
}

function deleteCondition(ri, ci) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri].conditions.splice(ci, 1);
  renderRules();
}

async function testConditionInline(ri, ci) {
  if (currentMacroIdx < 0) return;
  const cond = macros[currentMacroIdx].rules[ri].conditions[ci];
  const resultEl = document.getElementById(`ctest-${ri}-${ci}`);
  if (!resultEl) return;
  resultEl.style.display = '';
  resultEl.className = 'inline-test-result testing';
  resultEl.textContent = 'Test en cours…';
  try {
    await ensureEngine();
    const res = await window.api.testCondition(cond);
    const ok = res.result === true;
    resultEl.className = 'inline-test-result ' + (ok ? 'test-ok' : 'test-fail');
    resultEl.textContent = ok ? '✅ Condition vraie' : '❌ Condition fausse';
  } catch (e) {
    resultEl.className = 'inline-test-result test-fail';
    resultEl.textContent = 'Erreur: ' + e.message;
  }
}

/* ── Action rows ──────────────────────────────────────────── */
function renderActionRowHTML(a, ri, ai, total) {
  const type = a.type || 'key_tap';
  return `
  <div class="item-row" id="arow-${ri}-${ai}" draggable="true">
    <div class="item-row-head">
      <div class="item-drag-handle act-drag-handle" title="Glisser pour réorganiser">
        <svg viewBox="0 0 16 16" fill="currentColor" width="9" height="9">
          <circle cx="4.5" cy="3.5" r="1.1"/><circle cx="11.5" cy="3.5" r="1.1"/>
          <circle cx="4.5" cy="8"   r="1.1"/><circle cx="11.5" cy="8"   r="1.1"/>
          <circle cx="4.5" cy="12.5" r="1.1"/><circle cx="11.5" cy="12.5" r="1.1"/>
        </svg>
      </div>
      <select class="item-type-select" onchange="setActType(${ri},${ai},this.value)">
        ${Object.entries(ACT_LABELS).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
      </select>
      <div class="item-row-btns">
        <button class="icon-btn" title="Exécuter" onclick="execActionInline(${ri},${ai})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="icon-btn" title="Monter" onclick="moveActUp(${ri},${ai})" ${ai === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="icon-btn" title="Descendre" onclick="moveActDown(${ri},${ai})" ${ai === (total||0) - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" onclick="deleteAction(${ri},${ai})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="item-fields">${renderActionInlineFields(a)}</div>
  </div>`;
}

function renderActionInlineFields(a) {
  const t = a.type || 'key_tap';
  const _chk = (field, label) => `<label style="display:flex;align-items:center;gap:3px;font-size:11px">${label}<input type="checkbox" class="af ${field}" ${a[field] ? 'checked' : ''} onchange="syncActField(this,'${field}',false,'check')"></label>`;
  const _keyCapture = (field, val) => `<input type="text" class="af ${field} key-capture" value="${escHtml(val || '')}" placeholder="Cliquez puis appuyez" readonly onfocus="startKeyCapture(this)" data-field="${field}">`;
  const _coordSummary = (x, y) => `<span class="coord-summary" title="X=${x}, Y=${y}">📍 ${x}, ${y}</span><input type="hidden" class="af x" value="${x}"><input type="hidden" class="af y" value="${y}">`;

  if (t === 'key_tap') {
    return `<div class="fields-row">
      <span>Touche</span>${_keyCapture('key', a.key || 'f')}
      <span>Durée</span><input type="number" class="af dur" value="${a.duration || 0.05}" min="0.01" step="0.01" onchange="syncActField(this,'duration',true)">
      <span>×</span><input type="number" class="af cnt" value="${a.count || 1}" min="1" onchange="syncActField(this,'count',true)">
      ${_chk('use_direct', 'Direct')}
    </div>`;
  }
  if (t === 'key_hold') {
    return `<div class="fields-row">
      <span>Touche</span>${_keyCapture('key', a.key || 'w')}
      <span>Durée (s)</span><input type="number" class="af dur" value="${a.duration || 1}" min="0.01" step="0.1" onchange="syncActField(this,'duration',true)">
      ${_chk('use_direct', 'Direct')}
    </div>`;
  }
  if (t === 'key_release') {
    return `<div class="fields-row"><span>Touche</span>${_keyCapture('key', a.key || 'w')}</div>`;
  }
  if (t === 'type_text') {
    return `<div class="fields-row">
      <span>Texte</span><input type="text" class="af text" style="flex:2" value="${escHtml(a.text || '')}" placeholder="Texte à taper" onchange="syncActField(this,'text')">
      <span>Interval</span><input type="number" class="af interval" value="${a.interval || 0.05}" min="0.01" step="0.01" onchange="syncActField(this,'interval',true)">
    </div>`;
  }
  if (t === 'wait') {
    return `<div class="fields-row"><span>Durée (s)</span><input type="number" class="af dur" value="${a.duration || 1}" min="0.01" step="0.1" onchange="syncActField(this,'duration',true)"></div>`;
  }
  if (t === 'mouse_move') {
    return `<div class="fields-row">
      ${_coordSummary(a.x || 0, a.y || 0)}
      <button class="pick-btn" title="Choisir un point à l'écran" onclick="pickPointForActField(this)">🎯 Point</button>
      <span>Durée</span><input type="number" class="af dur" value="${a.duration || 0.2}" min="0" step="0.05" onchange="syncActField(this,'duration',true)">
      ${_chk('relative', 'Relat.')}
    </div>`;
  }
  if (t === 'mouse_click') {
    return `<div class="fields-row">
      <span class="coord-summary" title="X=${a.x != null ? a.x : 'actuel'}, Y=${a.y != null ? a.y : 'actuel'}">📍 ${a.x != null ? a.x : '?'}, ${a.y != null ? a.y : '?'}</span>
      <input type="hidden" class="af x" value="${a.x != null ? a.x : ''}">
      <input type="hidden" class="af y" value="${a.y != null ? a.y : ''}">
      <button class="pick-btn" title="Choisir un point à l'écran" onclick="pickPointForActField(this)">🎯 Point</button>
      <span>Btn</span><select class="af btn" onchange="syncActField(this,'button')">
        <option value="left" ${(a.button || 'left') === 'left' ? 'selected' : ''}>left</option>
        <option value="right" ${a.button === 'right' ? 'selected' : ''}>right</option>
        <option value="middle" ${a.button === 'middle' ? 'selected' : ''}>middle</option>
      </select>
      <span>×</span><input type="number" class="af cnt" value="${a.count || 1}" min="1" onchange="syncActField(this,'count',true)">
    </div>`;
  }
  if (t === 'mouse_double_click') {
    return `<div class="fields-row">
      <span class="coord-summary" title="X=${a.x != null ? a.x : 'actuel'}, Y=${a.y != null ? a.y : 'actuel'}">📍 ${a.x != null ? a.x : '?'}, ${a.y != null ? a.y : '?'}</span>
      <input type="hidden" class="af x" value="${a.x != null ? a.x : ''}">
      <input type="hidden" class="af y" value="${a.y != null ? a.y : ''}">
      <button class="pick-btn" title="Choisir un point à l'écran" onclick="pickPointForActField(this)">🎯 Point</button>
      <span>Btn</span><select class="af btn" onchange="syncActField(this,'button')">
        <option value="left" ${(a.button || 'left') === 'left' ? 'selected' : ''}>left</option>
        <option value="right" ${a.button === 'right' ? 'selected' : ''}>right</option>
        <option value="middle" ${a.button === 'middle' ? 'selected' : ''}>middle</option>
      </select>
    </div>`;
  }
  if (t === 'mouse_drag') {
    return `<div class="fields-row">
      <span class="coord-summary">📍 Départ: ${a.x1 || 0},${a.y1 || 0}</span>
      <input type="hidden" class="af x1" value="${a.x1 || 0}">
      <input type="hidden" class="af y1" value="${a.y1 || 0}">
      <button class="pick-btn" title="Choisir le point de départ" onclick="pickPointForActField(this,'x1','y1')">🎯 Départ</button>
      <span class="coord-summary">📍 Arrivée: ${a.x2 || 100},${a.y2 || 100}</span>
      <input type="hidden" class="af x2" value="${a.x2 || 100}">
      <input type="hidden" class="af y2" value="${a.y2 || 100}">
      <button class="pick-btn" title="Choisir le point d'arrivée" onclick="pickPointForActField(this,'x2','y2')">🎯 Arrivée</button>
      <span>Durée</span><input type="number" class="af dur" value="${a.duration || 0.5}" min="0.05" step="0.05" onchange="syncActField(this,'duration',true)">
    </div>`;
  }
  if (t === 'scroll') {
    return `<div class="fields-row">
      <span>Clics</span><input type="number" class="af clicks" value="${a.clicks || 3}" min="1" onchange="syncActField(this,'clicks',true)">
      <span>Dir.</span><select class="af direction" onchange="syncActField(this,'direction')">
        <option value="up" ${(a.direction || 'up') === 'up' ? 'selected' : ''}>up</option>
        <option value="down" ${a.direction === 'down' ? 'selected' : ''}>down</option>
      </select>
      <span class="coord-summary">📍 ${a.x != null ? a.x + ',' + a.y : 'position actuelle'}</span>
      <input type="hidden" class="af x" value="${a.x != null ? a.x : ''}">
      <input type="hidden" class="af y" value="${a.y != null ? a.y : ''}">
      <button class="pick-btn" title="Position du scroll" onclick="pickPointForActField(this)">🎯 Position</button>
    </div>`;
  }
  if (t === 'key_combo') {
    return `<div class="fields-row">
      <span>Combo</span><input type="text" class="af keys" style="width:160px" value="${escHtml(a.keys || 'ctrl+c')}" placeholder="ctrl+shift+s" onchange="syncActField(this,'keys')">
      <span>Durée(s)</span><input type="number" class="af dur" value="${a.duration || 0.05}" min="0.01" step="0.01" onchange="syncActField(this,'duration',true)">
    </div>`;
  }
  if (t === 'random_wait') {
    return `<div class="fields-row">
      <span>Min(s)</span><input type="number" class="af min_s" value="${a.min_s || 0.5}" min="0" step="0.1" onchange="syncActField(this,'min_s',true)">
      <span>Max(s)</span><input type="number" class="af max_s" value="${a.max_s || 2.0}" min="0.1" step="0.1" onchange="syncActField(this,'max_s',true)">
    </div>`;
  }
  if (t === 'send_webhook') {
    return `<div class="fields-row">
      <span>Événement</span><input type="text" class="af event" style="width:130px" value="${escHtml(a.event || 'custom_event')}" onchange="syncActField(this,'event')">
      <span>Message</span><input type="text" class="af message" style="flex:1" value="${escHtml((a.data && a.data.message) || '')}" placeholder="Message Discord…" onchange="syncActWebhookMsg(this)">
    </div>`;
  }
  if (t === 'log_message') {
    return `<div class="fields-row">
      <span>Msg</span><input type="text" class="af message" style="flex:1" value="${escHtml(a.message || '')}" placeholder="Message de log" onchange="syncActField(this,'message')">
      <select class="af level" onchange="syncActField(this,'level')">
        <option value="INFO" ${(a.level || 'INFO') === 'INFO' ? 'selected' : ''}>INFO</option>
        <option value="DEBUG" ${a.level === 'DEBUG' ? 'selected' : ''}>DEBUG</option>
        <option value="WARNING" ${a.level === 'WARNING' ? 'selected' : ''}>WARNING</option>
      </select>
    </div>`;
  }
  if (t === 'notify_toast') {
    return `<div class="fields-row">
      <span>Titre</span><input type="text" class="af title" style="width:120px" value="${escHtml(a.title || 'MacroEngine')}" onchange="syncActField(this,'title')">
      <span>Msg</span><input type="text" class="af message" style="flex:1" value="${escHtml(a.message || '')}" placeholder="Notification…" onchange="syncActField(this,'message')">
    </div>`;
  }
  if (t === 'play_sound') {
    return `<div class="fields-row">
      <span>Fichier .wav</span><input type="text" class="af file" style="flex:1" value="${escHtml(a.file || '')}" placeholder="(vide = bip)" onchange="syncActField(this,'file')">
    </div>`;
  }
  if (t === 'screenshot_save') {
    return `<div class="fields-row">
      <span>Chemin</span><input type="text" class="af path" style="flex:1" value="${escHtml(a.path || 'screenshots\\{timestamp}.png')}" onchange="syncActField(this,'path')">
    </div>`;
  }
  if (t === 'focus_window') {
    return `<div class="fields-row">
      <span>Titre fenêtre</span><input type="text" class="af title" style="flex:1" value="${escHtml(a.title || '')}" placeholder="FiveM" onchange="syncActField(this,'title')">
    </div>`;
  }
  if (t === 'clipboard_set') {
    return `<div class="fields-row">
      <span>Texte</span><input type="text" class="af text" style="flex:1" value="${escHtml(a.text || '')}" placeholder="Texte…" onchange="syncActField(this,'text')">
    </div>`;
  }
  if (t === 'set_variable') {
    return `<div class="fields-row">
      <span>Nom</span><input type="text" class="af name" style="width:120px" value="${escHtml(a.name || '')}" placeholder="ma_var" onchange="syncActField(this,'name')">
      <span>Valeur</span><input type="text" class="af value" style="flex:1" value="${escHtml(String(a.value != null ? a.value : ''))}" onchange="syncActField(this,'value')">
    </div>`;
  }
  if (t === 'counter_set') {
    return `<div class="fields-row">
      <span>Compteur</span><input type="text" class="af name" style="width:120px" value="${escHtml(a.name || '')}" placeholder="score" onchange="syncActField(this,'name')">
      <span>Valeur</span><input type="number" class="af value" value="${a.value || 0}" onchange="syncActField(this,'value',true)">
    </div>`;
  }
  if (t === 'counter_inc' || t === 'counter_dec') {
    return `<div class="fields-row">
      <span>Compteur</span><input type="text" class="af name" style="width:120px" value="${escHtml(a.name || '')}" placeholder="score" onchange="syncActField(this,'name')">
      <span>Montant</span><input type="number" class="af amount" value="${a.amount || 1}" min="1" onchange="syncActField(this,'amount',true)">
    </div>`;
  }
  if (t === 'counter_reset') {
    return `<div class="fields-row">
      <span>Compteur</span><input type="text" class="af name" style="width:160px" value="${escHtml(a.name || '')}" placeholder="score" onchange="syncActField(this,'name')">
    </div>`;
  }
  if (t === 'macro_start') {
    return `<div class="fields-row">
      <span>Macro</span><input type="text" class="af name" style="flex:1" value="${escHtml(a.name || '')}" placeholder="Nom de la macro" onchange="syncActField(this,'name')">
    </div>`;
  }
  if (t === 'macro_stop') {
    return `<div class="fields-row">
      <span>Macro</span><input type="text" class="af name" style="flex:1" value="${escHtml(a.name || '')}" placeholder="(vide = toutes)" onchange="syncActField(this,'name')">
    </div>`;
  }
  if (t === 'stop_self') {
    return `<div class="fields-row"><span style="color:var(--text-3);font-size:11px">Arrête immédiatement cette macro.</span></div>`;
  }
  if (t === 'repeat') {
    const actJson = JSON.stringify(a.actions || [], null, 2);
    return `<div class="fields-row">
      <span>Répétitions</span><input type="number" class="af count" value="${a.count || 1}" min="1" onchange="syncActField(this,'count',true)">
      <span>Délai (s)</span><input type="number" class="af delay" value="${a.delay || 0}" min="0" step="0.1" onchange="syncActField(this,'delay',true)">
    </div>
    <div class="fields-row" style="flex-direction:column;align-items:stretch">
      <span style="font-size:11px;color:var(--text-3)">Sous-actions (JSON)</span>
      <textarea class="af actions-json" style="width:100%;min-height:80px;font-family:monospace;font-size:11px;resize:vertical" onchange="syncRepeatActions(this)">${escHtml(actJson)}</textarea>
    </div>`;
  }
  return '';
}

function syncActField(inputEl, field, isNum, inputType) {
  const row = inputEl.closest('.item-row');
  if (!row) return;
  let a;
  const section = row.dataset.section;
  if (section) {
    const idx = parseInt(row.dataset.idx);
    a = macros[currentMacroIdx]?.[section]?.[idx];
  } else {
    const [, ri, ai] = row.id.split('-').map(Number);
    a = macros[currentMacroIdx]?.rules[ri]?.actions[ai];
  }
  if (!a) return;
  let val;
  if (inputType === 'check') val = inputEl.checked;
  else if (isNum) val = parseFloat(inputEl.value);
  else val = inputEl.value;
  a[field] = (typeof val === 'number' && isNaN(val)) ? undefined : val;
}

// Special sync for webhook message (nested in data.message)
function syncActWebhookMsg(inputEl) {
  const row = inputEl.closest('.item-row');
  if (!row) return;
  let a;
  const section = row.dataset.section;
  if (section) {
    const idx = parseInt(row.dataset.idx);
    a = macros[currentMacroIdx]?.[section]?.[idx];
  } else {
    const [, ri, ai] = row.id.split('-').map(Number);
    a = macros[currentMacroIdx]?.rules[ri]?.actions[ai];
  }
  if (!a) return;
  const msg = inputEl.value.trim();
  if (msg) {
    a.data = { ...(a.data || {}), message: msg };
  } else {
    delete a.data;
  }
}

function setActType(ri, ai, type) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri].actions[ai].type = type;
  const fieldsEl = document.querySelector(`#arow-${ri}-${ai} .item-fields`);
  if (fieldsEl) fieldsEl.innerHTML = renderActionInlineFields(macros[currentMacroIdx].rules[ri].actions[ai]);
}

function addAction(ri) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri].actions.push({ type: 'key_tap', key: 'f', duration: 0.05, count: 1 });
  renderRules();
}

function deleteAction(ri, ai) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx].rules[ri].actions.splice(ai, 1);
  renderRules();
}

async function execActionInline(ri, ai) {
  if (currentMacroIdx < 0) return;
  const action = macros[currentMacroIdx].rules[ri].actions[ai];
  try {
    await ensureEngine();
    await window.api.execAction(action);
    appendLog('INFO', 'Action exécutée: ' + action.type);
  } catch (e) { appendLog('ERROR', 'Erreur action: ' + e.message); }
}

/* ── Screen picker helpers ─────────────────────────────── */
function _refreshCoordSummaries(container, prefix) {
  container.querySelectorAll('.coord-summary').forEach(span => {
    const row = span.closest('.fields-row') || container;
    const xs = row.querySelectorAll('.' + prefix + (span.dataset.pair === '2' ? 'x2' : 'x'));
    const ys = row.querySelectorAll('.' + prefix + (span.dataset.pair === '2' ? 'y2' : 'y'));
    // just re-render via parent
  });
  // simpler: re-render the whole macro editor
  renderMacroEditor();
}

async function pickPointForCondField(btn) {
  try {
    const res = await window.api.pickPoint();
    if (!res || res.cancelled) return;
    const row = btn.closest('.item-row');
    if (!row) return;
    const xInput = row.querySelector('.cf.x');
    const yInput = row.querySelector('.cf.y');
    if (xInput) { xInput.value = res.x; xInput.dispatchEvent(new Event('change')); }
    if (yInput) { yInput.value = res.y; yInput.dispatchEvent(new Event('change')); }
    renderMacroEditor();
  } catch (e) { appendLog('ERROR', 'Picker: ' + e.message); }
}

async function pickRegionForCondField(btn) {
  try {
    const res = await window.api.pickRegion();
    if (!res || res.cancelled) return;
    const row = btn.closest('.item-row');
    if (!row) return;
    const xInput = row.querySelector('.cf.x');
    const yInput = row.querySelector('.cf.y');
    const wInput = row.querySelector('.cf.w');
    const hInput = row.querySelector('.cf.h');
    if (xInput) { xInput.value = res.x; xInput.dispatchEvent(new Event('change')); }
    if (yInput) { yInput.value = res.y; yInput.dispatchEvent(new Event('change')); }
    if (wInput) { wInput.value = res.w; wInput.dispatchEvent(new Event('change')); }
    if (hInput) { hInput.value = res.h; hInput.dispatchEvent(new Event('change')); }
    renderMacroEditor();
  } catch (e) { appendLog('ERROR', 'Picker: ' + e.message); }
}

async function pickPointForActField(btn, xField, yField) {
  try {
    const res = await window.api.pickPoint();
    if (!res || res.cancelled) return;
    const row = btn.closest('.item-row');
    if (!row) return;
    const xInput = row.querySelector('.af.' + (xField || 'x'));
    const yInput = row.querySelector('.af.' + (yField || 'y'));
    if (xInput) { xInput.value = res.x; xInput.dispatchEvent(new Event('change')); }
    if (yInput) { yInput.value = res.y; yInput.dispatchEvent(new Event('change')); }
    renderMacroEditor();
  } catch (e) { appendLog('ERROR', 'Picker: ' + e.message); }
}

/* ── Key capture helper ────────────────────────────────── */
function startKeyCapture(input) {
  input.value = '⌨ Appuyez sur une touche…';
  input.classList.add('capturing');
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    input.classList.remove('capturing');
    input.removeEventListener('keydown', handler);
    input.removeEventListener('blur', blurHandler);
    input.blur();
    syncActField(input, input.dataset.field);
  };
  const blurHandler = () => {
    if (input.classList.contains('capturing')) {
      input.value = '';
      input.classList.remove('capturing');
      input.removeEventListener('keydown', handler);
    }
  };
  input.addEventListener('keydown', handler);
  input.addEventListener('blur', blurHandler, { once: true });
}

/* ── Repeat action: sync nested actions JSON ───────────── */
function syncRepeatActions(textarea) {
  const row = textarea.closest('.item-row');
  if (!row) return;
  let a;
  const section = row.dataset.section;
  if (section) {
    const idx = parseInt(row.dataset.idx);
    a = macros[currentMacroIdx]?.[section]?.[idx];
  } else {
    const [, ri, ai] = row.id.split('-').map(Number);
    a = macros[currentMacroIdx]?.rules[ri]?.actions[ai];
  }
  if (!a) return;
  try {
    a.actions = JSON.parse(textarea.value);
    textarea.style.borderColor = '';
  } catch (_) {
    textarea.style.borderColor = 'var(--danger)';
  }
}

/* ══════════════════════════════════════════════════════════════
   ADVANCED SECTIONS: start_guard, stop_conditions, pre_stop_actions
══════════════════════════════════════════════════════════════ */

function renderAdvancedSections() {
  const macro = macros[currentMacroIdx];
  if (!macro) return;

  const guardList = document.getElementById('guard-conditions-list');
  if (guardList) {
    macro.start_guard = macro.start_guard || [];
    if (macro.start_guard.length === 0) {
      guardList.innerHTML = '<div class="empty-mini">Aucune condition de garde</div>';
    } else {
      guardList.innerHTML = macro.start_guard.map((c, ci) =>
        renderSectionCondRow(c, ci, 'start_guard', 'gcrow')).join('');
    }
  }

  const stopList = document.getElementById('stop-conditions-list');
  if (stopList) {
    macro.stop_conditions = macro.stop_conditions || [];
    if (macro.stop_conditions.length === 0) {
      stopList.innerHTML = '<div class="empty-mini">Aucune condition d\'arrêt auto</div>';
    } else {
      stopList.innerHTML = macro.stop_conditions.map((c, ci) =>
        renderSectionCondRow(c, ci, 'stop_conditions', 'scrow')).join('');
    }
  }

  const preStopList = document.getElementById('pre-stop-actions-list');
  if (preStopList) {
    macro.pre_stop_actions = macro.pre_stop_actions || [];
    if (macro.pre_stop_actions.length === 0) {
      preStopList.innerHTML = '<div class="empty-mini">Aucune action de nettoyage</div>';
    } else {
      preStopList.innerHTML = macro.pre_stop_actions.map((a, ai) =>
        renderSectionActRow(a, ai, 'pre_stop_actions', 'parow')).join('');
    }
  }
}

function renderSectionCondRow(c, idx, section, prefix) {
  const type = c.type || 'pixel_color';
  return `
  <div class="item-row" id="${prefix}-${idx}" data-section="${section}" data-idx="${idx}">
    <div class="item-row-head">
      <select class="item-type-select" onchange="setSectionCondType('${section}',${idx},this.value)">
        ${Object.entries(COND_LABELS).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
      </select>
      <div class="item-row-btns">
        <button class="icon-btn" title="Tester" onclick="testSectionCondInline('${section}',${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" onclick="deleteSectionCond('${section}',${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="item-fields">${renderConditionInlineFields(c)}</div>
    <div class="inline-test-result" id="${prefix}-test-${idx}" style="display:none"></div>
  </div>`;
}

function renderSectionActRow(a, idx, section, prefix) {
  const type = a.type || 'key_tap';
  return `
  <div class="item-row" id="${prefix}-${idx}" data-section="${section}" data-idx="${idx}">
    <div class="item-row-head">
      <select class="item-type-select" onchange="setSectionActType('${section}',${idx},this.value)">
        ${Object.entries(ACT_LABELS).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
      </select>
      <div class="item-row-btns">
        <button class="icon-btn" title="Exécuter" onclick="execSectionActInline('${section}',${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="icon-btn btn-danger-icon" onclick="deleteSectionAct('${section}',${idx})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="item-fields">${renderActionInlineFields(a)}</div>
  </div>`;
}

function setSectionCondType(section, idx, type) {
  if (currentMacroIdx < 0) return;
  const c = macros[currentMacroIdx][section][idx];
  c.type = type;
  const defaults = COND_DEFAULTS[type] || {};
  for (const [k, v] of Object.entries(defaults)) {
    if (c[k] === undefined || c[k] === null) c[k] = v;
  }
  renderAdvancedSections();
}

function setSectionActType(section, idx, type) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx][section][idx].type = type;
  renderAdvancedSections();
}

function addSectionCond(section) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx][section] = macros[currentMacroIdx][section] || [];
  macros[currentMacroIdx][section].push({ type: 'window_focused', title: '' });
  renderAdvancedSections();
}

function deleteSectionCond(section, idx) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx][section].splice(idx, 1);
  renderAdvancedSections();
}

function addSectionAct(section) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx][section] = macros[currentMacroIdx][section] || [];
  macros[currentMacroIdx][section].push({ type: 'key_tap', key: 'escape', duration: 0.05 });
  renderAdvancedSections();
}

function deleteSectionAct(section, idx) {
  if (currentMacroIdx < 0) return;
  macros[currentMacroIdx][section].splice(idx, 1);
  renderAdvancedSections();
}

async function testSectionCondInline(section, idx) {
  if (currentMacroIdx < 0) return;
  const cond = macros[currentMacroIdx][section][idx];
  const prefix = section === 'start_guard' ? 'gcrow' : 'scrow';
  const resultEl = document.getElementById(`${prefix}-test-${idx}`);
  if (!resultEl) return;
  resultEl.style.display = '';
  resultEl.className = 'inline-test-result testing';
  resultEl.textContent = 'Test en cours…';
  try {
    await ensureEngine();
    const res = await window.api.testCondition(cond);
    const ok = res.result === true;
    resultEl.className = 'inline-test-result ' + (ok ? 'test-ok' : 'test-fail');
    resultEl.textContent = ok ? '✅ Condition vraie' : '❌ Condition fausse';
  } catch (e) {
    resultEl.className = 'inline-test-result test-fail';
    resultEl.textContent = 'Erreur: ' + e.message;
  }
}

async function execSectionActInline(section, idx) {
  if (currentMacroIdx < 0) return;
  const action = macros[currentMacroIdx][section][idx];
  try {
    await ensureEngine();
    await window.api.execAction(action);
    appendLog('INFO', 'Action exécutée: ' + action.type);
  } catch (e) { appendLog('ERROR', 'Erreur action: ' + e.message); }
}
