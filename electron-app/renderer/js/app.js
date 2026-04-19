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
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  if (page === 'conditions') renderConditionFields();
  if (page === 'actions')    renderActionFields();
  if (page === 'macros')     renderMacroList();
  if (page === 'dashboard')  renderDashboard();
  if (page === 'syslog')     refreshSyslog();

  // Persist last page
  _saveUiPref('lastPage', page);
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
async function _saveUiPref(key, val) {
  try {
    const s = (await window.api.readSettings()) || {};
    s[key] = val;
    await window.api.writeSettings(s);
  } catch (_) {}
}

/* ── License gate ──────────────────────────────────────────── */
async function checkLicense() {
  const overlay = document.getElementById('license-overlay');
  const input   = document.getElementById('license-input');
  const btn     = document.getElementById('license-submit');
  const errEl   = document.getElementById('license-error');

  const result = await window.api.checkLicense();
  if (result.valid) {
    overlay.style.display = 'none';
    if (result.offline && result.daysLeft != null) {
      // Avertissement discret mode hors-ligne
      showToast(`Mode hors-ligne — licence non vérifiée (${result.daysLeft}j restants)`, 'warn', 8000);
    }
    return true;
  }

  // Hide splash so the licence modal is fully visible
  hideSplash();

  if (result.reason === 'grace_expired') {
    showLicenseError('Connexion requise pour revalider la licence (délai hors-ligne expiré).');
  }

  // Show modal and wait for valid key
  overlay.style.display = 'flex';
  return new Promise((resolve) => {
    async function submit() {
      const key = input.value.trim();
      if (!key) { showLicenseError('Veuillez entrer une clé de licence.'); return; }
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      errEl.style.display = 'none';
      const res = await window.api.verifyLicense(key);
      if (res.valid) {
        overlay.style.display = 'none';
        resolve(true);
      } else if (res.reason === 'network') {
        showLicenseError('Impossible de contacter le serveur. Vérifiez votre connexion.');
        btn.disabled = false;
        btn.textContent = 'Activer';
      } else {
        showLicenseError('Clé de licence invalide. Veuillez réessayer.');
        btn.disabled = false;
        btn.textContent = 'Activer';
      }
    }
    function showLicenseError(msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
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
  /* Show splash for a minimum time so it feels polished */
  const splashStart = Date.now();

  /* Load app config and set version strings dynamically */
  try {
    const appCfg = await window.api.getConfig();
    const splashSub = document.querySelector('.splash-sub');
    const titleVer  = document.querySelector('.titlebar-version');
    if (splashSub) splashSub.textContent = `${appCfg.appSubtitle} \u00a0\u2022\u00a0 v${appCfg.version}`;
    if (titleVer)  titleVer.textContent  = `v${appCfg.version}`;
  } catch (_) { /* fallback: laisse le texte HTML tel quel */ }

  setSplashMsg('Vérification de la licence...');
  /* License check — block everything until valid */
  await checkLicense();

  setSplashMsg('Chargement des macros...');

  /* Nav */
  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('click', () => navigate(n.dataset.page));
  });

  /* Engine events */
  setupEngineEvents();
  setupRecordingEvents();
  /* Load macros */
  await loadMacros();

  setSplashMsg('Chargement des paramètres...');
  /* Load settings & register shortcuts */
  await loadAppSettings();

  /* Global shortcut handler */
  window.api.onShortcutTriggered((action) => {
    if (action === 'stop')  { stopAllMacros(); appendLog('INFO', 'Raccourci: arrêt de toutes les macros'); }
    if (action === 'pause') { if (currentMacroIdx >= 0) pauseCurrentMacro(); }
  });

  /* Overlay closed externally */
  window.api.onOverlayClosed && window.api.onOverlayClosed(() => {
    _overlayVisible = false;
    _updateOverlayBtn();
  });

  /* Webhook error handler */
  window.api.onWebhookError && window.api.onWebhookError((d) => {
    showToast('Webhook error: ' + (d.msg || 'Erreur inconnue'), 'error', 6000);
    appendLog('WARNING', 'Webhook désactivé: ' + (d.msg || ''));
  });

  /* Cross-macro start request from engine */
  window.api.onMacroStartRequest && window.api.onMacroStartRequest((d) => {
    const idx = macros.findIndex(m => m.name === d.name);
    if (idx >= 0) startMacro(idx);
  });

  /* Webhook URL auto-save */
  initWebhookAutoSave();

  /* Console filter persistence */
  const filterEl = document.getElementById('log-filter');
  if (filterEl) {
    filterEl.addEventListener('change', () => _saveUiPref('consoleFilter', filterEl.value));
  }

  /* Render initial pages */
  renderDashboard();
  renderConditionFields();
  renderActionFields();

  setSplashMsg('Démarrage du moteur Python...');
  appendLog('INFO', 'MacroEngine UI démarrée');

  /* Auto-start engine */
  try {
    await window.api.startEngine();
    appendLog('INFO', 'Engine Python démarré');
    updateStatusBadge(true);
    startUptimeClock();
  } catch (_) {}

  /* Hide splash — ensure at least 2s of display */
  const elapsed = Date.now() - splashStart;
  setTimeout(hideSplash, Math.max(0, 2000 - elapsed));
}

/* ── Settings page functions ──────────────────────────────── */
async function loadAppSettings() {
  try {
    const r = await window.api.readSettings();
    const s = (r && r.settings) ? r.settings : (r || {});

    // Webhook
    const urlEl = document.getElementById('set-webhook-url');
    if (urlEl && s.webhookUrl) {
      urlEl.value = s.webhookUrl;
      // Restore webhook URL to engine
      try { await window.api.setWebhook({ url: s.webhookUrl }); } catch (_) {}
    }

    // Shortcuts
    const stopEl  = document.getElementById('set-shortcut-stop');
    const pauseEl = document.getElementById('set-shortcut-pause');
    if (stopEl  && s.shortcutStop)  stopEl.value  = s.shortcutStop;
    if (pauseEl && s.shortcutPause) pauseEl.value = s.shortcutPause;
    if (s.shortcutStop || s.shortcutPause) {
      const map = {};
      if (s.shortcutStop)  map.stop  = keyToAccelerator(s.shortcutStop);
      if (s.shortcutPause) map.pause = keyToAccelerator(s.shortcutPause);
      await window.api.registerShortcuts(map);
    }

    // Console filter
    if (s.consoleFilter) {
      const filterEl = document.getElementById('log-filter');
      if (filterEl) filterEl.value = s.consoleFilter;
    }

    // RAM limit
    const ramEl = document.getElementById('set-max-ram');
    if (ramEl && s.maxRamMb != null) ramEl.value = s.maxRamMb;

    // Last macro selection
    if (typeof s.lastMacroIdx === 'number' && s.lastMacroIdx >= 0) {
      currentMacroIdx = s.lastMacroIdx;
    }

    // Last page — navigate after short delay so DOM is ready
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

async function saveWebhookSettings() {
  const url = document.getElementById('set-webhook-url').value.trim();
  const statusEl = document.getElementById('webhook-status');
  try {
    const s = (await window.api.readSettings()) || {};
    s.webhookUrl = url;
    await window.api.writeSettings(s);
    if (url) await window.api.setWebhook({ url });
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
    const map = {};
    if (stopKey)  map.stop  = keyToAccelerator(stopKey);
    if (pauseKey) map.pause = keyToAccelerator(pauseKey);
    await window.api.registerShortcuts(map);
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

/* ── Updater ──────────────────────────────────────────────── */
function _setupUpdater() {
  if (!window.api.onUpdaterDone) return;

  window.api.onUpdaterChecking(() => {
    // silencieux au démarrage
  });

  window.api.onUpdaterDone((d) => {
    const n = d.updated ? d.updated.length : 0;
    if (n === 0) return;
    showToast(`✓ ${n} fichier${n > 1 ? 's mis à jour' : ' mis à jour'} — v${d.version}`, 'success', 6000);
    appendLog('INFO', `Mise à jour appliquée (v${d.version}) : ${d.updated.join(', ')}`);
    if (d.errors && d.errors.length) {
      d.errors.forEach(e => appendLog('WARNING', `Updater: erreur sur ${e.file} — ${e.error}`));
    }
  });

  window.api.onUpdaterError((d) => {
    // Pas de toast — juste un log discret (pas de connexion = normal)
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
