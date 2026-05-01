'use strict';
/* ═══════════════════════════════════════════════════════════════
   APP — State, navigation, init
   Loaded LAST — all other modules are loaded before this one.
════════════════════════════════════════════════════════════════ */

let macros          = [];
let currentMacroIdx = -1;
let runningMacros   = new Set();
let allLogs         = [];

/* ── Navigation ───────────────────────────────────────────── */
function navigate(page, testTab) {
  // Redirect legacy page names to the unified tests page
  if (page === 'conditions' || page === 'actions' || page === 'windows') {
    testTab = page;
    page    = 'tests';
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  const navEl  = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  if (page === 'tests')       switchTestTab(testTab || null);
  if (page === 'macros')      renderMacroList();
  if (page === 'dashboard')   renderDashboard();
  if (page === 'syslog')      refreshSyslog();
  if (page === 'settings')    switchSettingsTab(null);
  if (page === 'autoclicker') initAutoClicker();

  _saveUiPref('lastPage', page);
}

/* ── Tests page tab switching ─────────────────────────────── */
function switchTestTab(tab) {
  // Default to last saved tab or conditions
  if (!tab) {
    try {
      tab = window._lastTestTab || 'conditions';
    } catch (_) { tab = 'conditions'; }
  }
  window._lastTestTab = tab;

  document.querySelectorAll('.test-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tests-tab').forEach(t => t.classList.remove('active'));

  const panel  = document.getElementById('test-panel-' + tab);
  const tabBtn = document.querySelector(`.tests-tab[data-tab="${tab}"]`);
  if (panel)  panel.classList.add('active');
  if (tabBtn) tabBtn.classList.add('active');

  // Refresh button in header — only shown on Fenêtres tab
  const winActions = document.getElementById('tests-header-actions-windows');
  if (winActions) winActions.style.display = tab === 'windows' ? '' : 'none';

  if (tab === 'conditions') renderConditionFields();
  if (tab === 'actions')    renderActionFields();
  if (tab === 'windows')    refreshWindows();

  _saveUiPref('lastTestTab', tab);
}

/* ── Settings page tab switching ─────────────────────────── */
function switchSettingsTab(tab) {
  if (!tab) tab = window._lastSettingsTab || 'general';
  window._lastSettingsTab = tab;
  document.querySelectorAll('#page-settings .tests-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  const tabBtn = document.querySelector(`#page-settings .tests-tab[data-tab="${tab}"]`);
  const panel  = document.getElementById(`settings-panel-${tab}`);
  if (tabBtn) tabBtn.classList.add('active');
  if (panel)  panel.classList.add('active');
  if (tab === 'logs') refreshSyslog();
  _saveUiPref('lastSettingsTab', tab);
}

/* ── Syslog page ──────────────────────────────────────────── */
function _colorSyslogLine(line) {
  if (!line) return '';
  let cls = '';
  if (line.includes('] [FATAL]') || line.includes('] [ERROR]')) cls = 'style="color:#ff5555"';
  else if (line.includes('] [WARN]') || line.includes('] [PYERR]')) cls = 'style="color:var(--orange)"';
  else if (line.includes('] [INFO]')) cls = 'style="color:var(--text-2)"';
  else cls = 'style="color:var(--text-3)"';
  return `<div ${cls}>${escHtml(line)}</div>`;
}

async function refreshSyslog() {
  const out   = document.getElementById('syslog-output');
  const pathEl = document.getElementById('syslog-path');
  if (!out) return;
  try {
    const r = await window.api.readLog();
    if (pathEl && r.path) pathEl.textContent = '📄 ' + r.path;
    const content = r.content || '';
    out.innerHTML = content.split('\n').map(_colorSyslogLine).join('');
    out.scrollTop = out.scrollHeight;
  } catch (e) {
    if (out) out.innerHTML = `<span style="color:var(--accent)">Erreur: ${escHtml(e.message)}</span>`;
  }
}

async function clearSyslog() {
  await window.api.clearLog();
  await refreshSyslog();
  showToast('Log effacé', 'success', 2000);
}

/* ── Toast notifications ──────────────────────────────────── */
function showToast(msg, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ── UI prefs (light settings — no engine round-trip) ──────── */
let _settingsWriteQueue = Promise.resolve();

async function _saveUiPref(key, val) {
  _settingsWriteQueue = _settingsWriteQueue.then(async () => {
    try {
      const s = (await window.api.readSettings()) || {};
      s[key] = val;
      await window.api.writeSettings(s);
    } catch (e) {
      console.warn('[_saveUiPref] échec sauvegarde', key, ':', e.message);
    }
  });
}

/* ── License gate ──────────────────────────────────────────── */
async function checkLicense() {
  const overlay = document.getElementById('license-overlay');
  const input   = document.getElementById('license-input');
  const btn     = document.getElementById('license-submit');
  const errEl   = document.getElementById('license-error');

  // Timeout strict de 5s pour éviter tout blocage
  const timeoutMs = 5000;
  const timeoutPromise = new Promise(r => setTimeout(() => r({ valid: false, reason: 'timeout' }), timeoutMs));
  let result;
  try {
    result = await Promise.race([window.api.checkLicense(), timeoutPromise]);
  } catch (e) {
    result = { valid: false, reason: 'exception', error: e && e.message };
  }
  if (result.valid) {
    overlay.style.display = 'none';
    if (result.offline && result.daysLeft != null) {
      showToast(`Mode hors-ligne — licence non vérifiée (${result.daysLeft}j restants)`, 'warn', 8000);
    }
    return true;
  }

  function showLicenseError(msg) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }

  hideSplash();
  if (result.reason === 'grace_expired') {
    showLicenseError('Connexion requise pour revalider la licence (délai hors-ligne expiré).');
    btn.disabled = false;
    btn.textContent = 'Activer';
  } else if (result.reason === 'timeout') {
    showLicenseError('Erreur : la vérification de la licence ne répond pas (timeout). Redémarre l\'app ou contacte le support.');
    btn.disabled = false;
    btn.textContent = 'Activer';
  } else if (result.reason === 'exception') {
    showLicenseError('Erreur JS : ' + (result.error || 'inconnue'));
    btn.disabled = false;
    btn.textContent = 'Activer';
  }

  overlay.style.display = 'flex';
  return new Promise((resolve) => {
    async function submit() {
      const key = input.value.trim();
      if (!key) { showLicenseError('Veuillez entrer une clé de licence.'); return; }
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      errEl.style.display = 'none';
      let res;
      try {
        res = await Promise.race([
          window.api.verifyLicense(key),
          new Promise(r => setTimeout(() => r({ valid: false, reason: 'timeout' }), timeoutMs))
        ]);
      } catch (e) {
        res = { valid: false, reason: 'exception', error: e && e.message };
      }
      if (res.valid) {
        overlay.style.display = 'none';
        resolve(true);
      } else if (res.reason === 'network') {
        showLicenseError('Impossible de contacter le serveur. Vérifiez votre connexion.');
        btn.disabled = false;
        btn.textContent = 'Activer';
      } else if (res.reason === 'timeout') {
        showLicenseError('Erreur : la vérification de la licence ne répond pas (timeout). Redémarre l\'app ou contacte le support.');
        btn.disabled = false;
        btn.textContent = 'Activer';
      } else if (res.reason === 'exception') {
        showLicenseError('Erreur JS : ' + (res.error || 'inconnue'));
        btn.disabled = false;
        btn.textContent = 'Activer';
      } else {
        showLicenseError('Clé de licence invalide. Veuillez réessayer.');
        btn.disabled = false;
        btn.textContent = 'Activer';
      }
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

/* ── Splash screen ────────────────────────────────────────── */
let _uptimeStart  = null;
let _uptimeTimer  = null;

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 600);
}

function setSplashMsg(msg) {
  const el = document.getElementById('splash-msg');
  if (el) el.textContent = msg;
}

function startUptimeClock() {
  if (_uptimeTimer) return;
  _uptimeStart = Date.now();
  const el = document.getElementById('val-uptime');
  function tick() {
    if (!_uptimeStart || !el) return;
    const s = Math.floor((Date.now() - _uptimeStart) / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    el.textContent = h > 0
      ? `${h}h${String(m % 60).padStart(2,'0')}m`
      : `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }
  tick();
  _uptimeTimer = setInterval(tick, 1000);
}

function stopUptimeClock() {
  if (_uptimeTimer) { clearInterval(_uptimeTimer); _uptimeTimer = null; }
  _uptimeStart = null;
  const el = document.getElementById('val-uptime');
  if (el) el.textContent = '--:--';
}

/* ── Overlay ──────────────────────────────────────────────── */
let _overlayVisible = false;

async function toggleOverlay() {
  try {
    const r = await window.api.toggleOverlay();
    _overlayVisible = r?.visible ?? false;
    _updateOverlayBtn();
  } catch (_) {}
}

function _updateOverlayBtn() {
  const btn = document.getElementById('btn-overlay-toggle');
  if (!btn) return;
  btn.classList.toggle('active', _overlayVisible);
  btn.title = _overlayVisible ? "Masquer l'overlay" : "Afficher l'overlay";
}

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  /* Load app config and set version strings dynamically */
  try {
    // Lecture version courante depuis package.json à la racine du build (pas cache)
    const appCfg = await window.api.getConfig();
    const splashSub = document.querySelector('.splash-sub');
    const titleVer  = document.querySelector('.titlebar-version');
    if (splashSub) splashSub.textContent = `${appCfg.appSubtitle} \u00a0\u2022\u00a0 v${appCfg.version}`;
    if (titleVer)  titleVer.textContent  = `v${appCfg.version}`;
    window._macroEngineVersion = appCfg.version;
  } catch (e) { console.warn('Erreur lecture version courante:', e); }

  setSplashMsg('Chargement...');

  /* License check + macros + settings en parallèle */
  await Promise.all([
    checkLicense(),
    loadMacros(),
    loadAppSettings(),
  ]);

  console.log('[MacroEngine] Version courante UI:', window._macroEngineVersion);

  /* Nav */
  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('click', () => navigate(n.dataset.page));
  });

  /* Engine events */
  setupEngineEvents();
  setupRecordingEvents();

  /* Global shortcut handler */
  window.api.onShortcutTriggered((action) => {
    if (action === 'stop')      { stopAllMacros(); appendLog('INFO', 'Raccourci: arrêt de toutes les macros'); }
    if (action === 'pause')     { if (currentMacroIdx >= 0) pauseCurrentMacro(); }
    if (action === 'acp_start') { if (typeof startAutoClicker === 'function') startAutoClicker(); }
    if (action === 'acp_stop')  { if (typeof stopAutoClicker  === 'function') stopAutoClicker();  }
  });

  /* Overlay closed externally */
  if (window.api.onOverlayClosed) {
    window.api.onOverlayClosed(() => {
      _overlayVisible = false;
      _updateOverlayBtn();
    });
  }

  /* Webhook error handler */
  if (window.api.onWebhookError) {
    window.api.onWebhookError((d) => {
      showToast('Webhook error: ' + (d.msg || 'Erreur inconnue'), 'error', 6000);
      appendLog('WARNING', 'Webhook désactivé: ' + (d.msg || ''));
    });
  }

  /* Cross-macro start request from engine */
  if (window.api.onMacroStartRequest) {
    window.api.onMacroStartRequest((d) => {
      const idx = macros.findIndex(m => m.name === d.name);
      if (idx >= 0) startMacro(idx);
    });
  }

  /* Surveillance périodique de la licence (révocation côté serveur) */
  if (window.api.onLicenseRevoked) {
    window.api.onLicenseRevoked((d) => {
      appendLog('WARNING', 'Licence révoquée — arrêt forcé (' + (d?.reason || 'invalid') + ')');
      stopAllMacros().catch(() => {});
      // Afficher l'overlay de licence
      const overlay = document.getElementById('license-overlay');
      const errEl   = document.getElementById('license-error');
      const btn     = document.getElementById('license-submit');
      if (overlay) overlay.style.display = 'flex';
      if (errEl)   { errEl.textContent = 'Votre licence a été révoquée ou n\'est plus valide. Entrez une clé valide pour continuer.'; errEl.style.display = 'block'; }
      if (btn)     { btn.disabled = false; btn.textContent = 'Activer'; }
    });
  }

  /* Webhook URL auto-save */
  initWebhookAutoSave();

  /* Console filter persistence */
  const filterEl = document.getElementById('log-level-filter');
  if (filterEl) {
    filterEl.addEventListener('change', () => _saveUiPref('consoleFilter', filterEl.value));
  }

  /* Render initial pages */
  renderDashboard();
  renderConditionFields();
  renderActionFields();
  // Patch : forcer reload complet après update (si update-banner visible)
  const updateBanner = document.getElementById('update-banner');
  const reloadBtn = document.getElementById('update-reload-btn');
  if (updateBanner && reloadBtn) {
    reloadBtn.onclick = () => {
      window.api.restartApp().catch(() => location.reload());
    };
  }

  appendLog('INFO', 'MacroEngine UI démarrée');

  /* Engine déjà démarré par le main process — synchroniser le badge */
  window.api.startEngine().catch(() => {});
  updateStatusBadge(true);
  startUptimeClock();

  hideSplash();
}

/* ── Global shortcut map (merges stop/pause + ACP hotkeys) ────── */
let _globalShortcutMap = {};

async function _applyGlobalShortcuts() {
  try { await window.api.registerShortcuts(_globalShortcutMap); } catch (_) {}
}

window._setGlobalShortcuts = async function(additions) {
  for (const [k, v] of Object.entries(additions)) {
    if (v) _globalShortcutMap[k] = v;
    else   delete _globalShortcutMap[k];
  }
  await _applyGlobalShortcuts();
};

/* ── Settings page functions ──────────────────────────────── */
async function loadAppSettings() {
  try {
    const s = (await window.api.readSettings()) || {};

    // Webhook
    const urlEl = document.getElementById('set-webhook-url');
    if (urlEl && s.webhookUrl) {
      urlEl.value = s.webhookUrl;
    }
    const webhookEvents = s.webhookEvents || ['macro_start', 'macro_stop', 'macro_auto_stop'];
    for (const ev of ['macro_start', 'macro_stop', 'macro_auto_stop', 'rule_triggered']) {
      const cb = document.getElementById(`wh-ev-${ev}`);
      if (cb) cb.checked = webhookEvents.includes(ev);
    }
    if (s.webhookUrl) {
      try { await window.api.setWebhook({ url: s.webhookUrl, events: webhookEvents }); } catch (_) {}
    }

    // Shortcuts
    const stopEl  = document.getElementById('set-shortcut-stop');
    const pauseEl = document.getElementById('set-shortcut-pause');
    if (stopEl  && s.shortcutStop)  stopEl.value  = s.shortcutStop;
    if (pauseEl && s.shortcutPause) pauseEl.value = s.shortcutPause;
    if (s.shortcutStop)  _globalShortcutMap.stop  = keyToAccelerator(s.shortcutStop);
    if (s.shortcutPause) _globalShortcutMap.pause = keyToAccelerator(s.shortcutPause);
    // Also load ACP hotkeys saved in localStorage
    try {
      const acp = JSON.parse(localStorage.getItem('acp_settings') || '{}');
      if (acp['acp-key-start']) _globalShortcutMap.acp_start = keyToAccelerator(acp['acp-key-start']);
      if (acp['acp-key-stop'])  _globalShortcutMap.acp_stop  = keyToAccelerator(acp['acp-key-stop']);
    } catch (_) {}
    if (Object.keys(_globalShortcutMap).length) await _applyGlobalShortcuts();

    // Console filter
    if (s.consoleFilter) {
      const filterEl = document.getElementById('log-level-filter');
      if (filterEl) filterEl.value = s.consoleFilter;
    }

    // RAM limit
    const ramEl = document.getElementById('set-max-ram');
    if (ramEl && s.maxRamMb != null) ramEl.value = s.maxRamMb;

    // Last macro selection
    if (typeof s.lastMacroIdx === 'number' && s.lastMacroIdx >= 0 && s.lastMacroIdx < macros.length) {
      currentMacroIdx = s.lastMacroIdx;
    }

    // Accent color
    if (s.accentColor) applyAccentColor(s.accentColor, false);
    const ocrEl = document.getElementById('set-ocr-engine');
    if (ocrEl && s.ocrEngine) ocrEl.value = s.ocrEngine;

    // Last page — navigate after short delay so DOM is ready
    if (s.lastTestTab)     window._lastTestTab     = s.lastTestTab;
    if (s.lastSettingsTab) window._lastSettingsTab = s.lastSettingsTab;
    if (s.lastPage) {
      setTimeout(() => navigate(s.lastPage), 50);
    }
  } catch (_) {}
}

/* ── Auto-save webhook URL on blur ────────────────────────── */
function initWebhookAutoSave() {
  const urlEl = document.getElementById('set-webhook-url');
  if (!urlEl) return;
  urlEl.addEventListener('blur', async () => {
    const url = urlEl.value.trim();
    try {
      const s = (await window.api.readSettings()) || {};
      if (s.webhookUrl !== url) {
        s.webhookUrl = url;
        await window.api.writeSettings(s);
        if (url) await window.api.setWebhook({ url });
      }
    } catch (_) {}
  });
}

function keyToAccelerator(key) {
  const map = { 'F1':'F1','F2':'F2','F3':'F3','F4':'F4','F5':'F5','F6':'F6',
    'F7':'F7','F8':'F8','F9':'F9','F10':'F10','F11':'F11','F12':'F12',
    'Escape':'Escape','Delete':'Delete','Insert':'Insert',
    'Home':'Home','End':'End','PageUp':'PageUp','PageDown':'PageDown',
    'Pause':'Pause','NumLock':'NumLock','ScrollLock':'ScrollLock' };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}
window.keyToAccelerator = keyToAccelerator;

async function saveWebhookSettings() {
  const url = document.getElementById('set-webhook-url').value.trim();
  const statusEl = document.getElementById('webhook-status');
  try {
    const s = (await window.api.readSettings()) || {};
    s.webhookUrl = url;
    const evIds = ['macro_start', 'macro_stop', 'macro_auto_stop', 'rule_triggered'];
    s.webhookEvents = evIds.filter(ev => document.getElementById(`wh-ev-${ev}`)?.checked);
    await window.api.writeSettings(s);
    if (url) await window.api.setWebhook({ url, events: s.webhookEvents });
    statusEl.textContent = '✅ Sauvegardé';
    statusEl.style.color = 'var(--success)';
  } catch (e) {
    statusEl.textContent = '❌ Erreur: ' + e.message;
    statusEl.style.color = 'var(--accent)';
  }
}

async function testWebhook() {
  const statusEl = document.getElementById('webhook-status');
  try {
    await ensureEngine();
    await window.api.sendWebhook({ event: 'test', data: { message: 'Test de webhook depuis MacroEngine' } });
    statusEl.textContent = '✅ Webhook envoyé';
    statusEl.style.color = 'var(--success)';
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = 'var(--accent)';
  }
}

async function saveShortcutSettings() {
  const stopKey  = document.getElementById('set-shortcut-stop').value.trim();
  const pauseKey = document.getElementById('set-shortcut-pause').value.trim();
  const statusEl = document.getElementById('shortcut-status');
  try {
    const s = (await window.api.readSettings()) || {};
    s.shortcutStop  = stopKey;
    s.shortcutPause = pauseKey;
    await window.api.writeSettings(s);
    if (stopKey)  _globalShortcutMap.stop  = keyToAccelerator(stopKey);
    else          delete _globalShortcutMap.stop;
    if (pauseKey) _globalShortcutMap.pause = keyToAccelerator(pauseKey);
    else          delete _globalShortcutMap.pause;
    await _applyGlobalShortcuts();
    statusEl.textContent = '✅ Raccourcis activés';
    statusEl.style.color = 'var(--success)';
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = 'var(--accent)';
  }
}

async function saveRamSettings() {
  const ramEl = document.getElementById('set-max-ram');
  const statusEl = document.getElementById('ram-status');
  const maxRam = parseInt(ramEl.value, 10) || 0;
  try {
    const s = (await window.api.readSettings()) || {};
    s.maxRamMb = maxRam;
    await window.api.writeSettings(s);
    // Forward to Python engine
    try { await window.api.setVariable({ name: '__max_ram_mb', value: maxRam }); } catch (_) {}
    statusEl.textContent = maxRam > 0 ? `✅ Limite : ${maxRam} Mo` : '✅ Illimité';
    statusEl.style.color = 'var(--success)';
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
    statusEl.style.color = 'var(--accent)';
  }
}

async function refreshMonitors() {
  const container = document.getElementById('monitors-result');
  try {
    const result = await window.api.listMonitors();
    const displays = result && result.displays ? result.displays : [];
    if (!displays.length) {
      container.innerHTML = '<span style="color:var(--txt-muted)">Aucun écran détecté</span>';
      return;
    }
    container.innerHTML = displays.map((d, i) => `<div class="monitor-card">
      <strong>Écran ${i + 1}${d.isPrimary ? ' (principal)' : ''}</strong><br>
      Position: ${d.bounds.x}, ${d.bounds.y}<br>
      Taille: ${d.bounds.width} × ${d.bounds.height}<br>
      Échelle: ${d.scaleFactor}x
    </div>`).join('');
  } catch (e) {
    container.innerHTML = `<span style="color:var(--accent)">Erreur: ${escHtml(e.message)}</span>`;
  }
}

/* ── Accent color ──────────────────────────────────────────── */
function applyAccentColor(color, save = true) {
  document.documentElement.style.setProperty('--accent', color);
  const picker = document.getElementById('set-accent-color');
  if (picker) picker.value = color;
  document.querySelectorAll('.accent-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  if (!save) return;
  window.api.readSettings().then(r => {
    const s = (r && r.settings) ? r.settings : (r || {});
    s.accentColor = color;
    return window.api.writeSettings(s);
  }).catch(() => {});
  const statusEl = document.getElementById('accent-status');
  if (statusEl) {
    statusEl.textContent = '✅ Couleur appliquée';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  }
}

/* ── OCR engine ─────────────────────────────────────────────── */
async function saveOcrEngine() {
  const engine = document.getElementById('set-ocr-engine')?.value || 'auto';
  const statusEl = document.getElementById('set-ocr-status');
  try {
    const r = (await window.api.readSettings()) || {};
    const s = (r && r.settings) ? r.settings : r;
    s.ocrEngine = engine;
    await window.api.writeSettings(s);
    try { await window.api.setVariable({ name: '__ocr_engine', value: engine }); } catch (_) {}
    if (statusEl) {
      statusEl.textContent = '✅ Moteur OCR sauvegardé';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = '❌ ' + e.message;
  }
}

/* ── Updater ──────────────────────────────────────────────── */
function _setupUpdater() {
  if (!window.api.onUpdaterDone) return;

  const banner    = document.getElementById('update-banner');
  const bannerMsg = document.getElementById('update-banner-msg');
  const reloadBtn = document.getElementById('update-reload-btn');
  let   hideTimer = null;

  function showBanner(msg, { done = false, showReload = false } = {}) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    banner.classList.remove('update-banner--hidden', 'update-banner--done');
    if (done) banner.classList.add('update-banner--done');
    bannerMsg.textContent = msg;
    reloadBtn.style.display = showReload ? '' : 'none';
  }

  function hideBanner(delay = 0) {
    if (delay > 0) {
      hideTimer = setTimeout(() => banner.classList.add('update-banner--hidden'), delay);
    } else {
      banner.classList.add('update-banner--hidden');
    }
  }

  window.api.onUpdaterChecking(() => {
    showBanner('Vérification des mises à jour…');
  });

  window.api.onUpdaterProgress((d) => {
    showBanner(`Téléchargement : ${d.file}`);
  });

  window.api.onUpdaterUpToDate(() => {
    hideBanner();
  });

  window.api.onUpdaterDone((d) => {
    const n = d.updated ? d.updated.length : 0;
    if (n === 0) { hideBanner(); return; }

    appendLog('INFO', `Mise à jour appliquée (v${d.version}) : ${d.updated.join(', ')}`);
    if (d.errors && d.errors.length) {
      d.errors.forEach(e => appendLog('WARNING', `Updater: erreur sur ${e.file} — ${e.error}`));
    }

    if (d.needsReload) {
      showBanner(
        `Mise à jour v${d.version} appliquée — rechargez pour en bénéficier`,
        { done: true, showReload: true }
      );
      reloadBtn.onclick = () => location.reload();
    } else {
      showBanner(`✓ ${n} fichier${n > 1 ? 's mis à jour' : ' mis à jour'} — v${d.version}`, { done: true });
      hideBanner(5000);
    }
  });

  window.api.onUpdaterError((d) => {
    hideBanner();
    appendLog('WARNING', 'Updater: ' + (d.error || 'Erreur inconnue'));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  _setupUpdater();
  // Lien "Obtenir une licence" → navigateur système (discord)
  document.querySelector('.license-buy-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal(e.currentTarget.href);
  });
  init();
});
