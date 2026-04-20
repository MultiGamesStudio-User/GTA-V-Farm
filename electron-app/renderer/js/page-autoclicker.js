/* ── Auto Clicker page ───────────────────────────────────── */
let _acpRunning            = false;
let _acpStatusPoller       = null;
let _acpCountdown          = null;   // setInterval handle for start-delay countdown
let _acpCountdownResolve   = null;   // stored Promise resolve so stopAutoClicker can unblock it
let _acpCountdownCancelled = false;  // true when stopAutoClicker interrupts the countdown
let _acpHotkeys            = {};     // { 'acp-key-start': 'F6', 'acp-key-stop': 'F7' }

const _ACP_STORAGE_KEY = 'acp_settings';

const _ACP_FIELDS = [
  { id: 'acp-h',           type: 'int',   def: 0   },
  { id: 'acp-m',           type: 'int',   def: 0   },
  { id: 'acp-s',           type: 'int',   def: 0   },
  { id: 'acp-ms',          type: 'int',   def: 100 },
  { id: 'acp-rand-offset', type: 'bool',  def: false },
  { id: 'acp-rand-ms',     type: 'int',   def: 40  },
  { id: 'acp-button',      type: 'str',   def: 'left' },
  { id: 'acp-click-type',  type: 'str',   def: 'single' },
  { id: 'acp-repeat-mode', type: 'str',   def: 'until_stopped' },
  { id: 'acp-repeat-count',type: 'int',   def: 1   },
  { id: 'acp-pos-mode',    type: 'str',   def: 'current' },
  { id: 'acp-x',           type: 'int',   def: 0   },
  { id: 'acp-y',           type: 'int',   def: 0   },
  { id: 'acp-start-delay', type: 'int',   def: 3   },
  { id: 'acp-key-start',   type: 'str',   def: 'F6' },
  { id: 'acp-key-stop',    type: 'str',   def: 'F7' },
];

function _acpSave() {
  const data = {};
  _ACP_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    data[f.id] = f.type === 'bool' ? el.checked : el.value;
  });
  localStorage.setItem(_ACP_STORAGE_KEY, JSON.stringify(data));
  // Sync to userData file so the overlay can read it
  window.api.saveAcpConfig && window.api.saveAcpConfig(data).catch(() => {});
}

function _acpLoad() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(_ACP_STORAGE_KEY) || '{}'); } catch (_) {}
  _ACP_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    const val = data[f.id] !== undefined ? data[f.id] : f.def;
    if (f.type === 'bool') { el.checked = val === true || val === 'true'; }
    else                   { el.value = val; }
  });
  // Restore hotkey map
  _acpHotkeys['acp-key-start'] = data['acp-key-start'] || 'F6';
  _acpHotkeys['acp-key-stop']  = data['acp-key-stop']  || 'F7';
  /* restore toggle states after loading */
  const offChk = document.getElementById('acp-rand-offset');
  if (offChk) _acpToggleOffset(offChk);
  _acpToggleRepeat();
  _acpTogglePosition();
}

function _acpBindAutoSave() {
  if (_acpBound) return;
  _acpBound = true;
  _ACP_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    const evt = (f.type === 'bool' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, _acpSave);
  });
}

/* Called by navigate() in app.js when entering the auto clicker page */
function initAutoClicker() {
  _acpLoad();
  _acpBindAutoSave();
  _acpRegisterHotkeys();
}

/* Build a synthetic macro object for macroStart() */
function _acpBuildMacro() {
  const f = _acpReadFields();

  // Interval in seconds
  const intervalS = f.interval_h * 3600 + f.interval_m * 60 + f.interval_s + f.interval_ms / 1000;
  const randS     = f.random_offset_ms / 1000;
  const safeInterval = Math.max(0.001, intervalS);

  // Wait action
  const waitAction = f.random_offset
    ? { type: 'random_wait', min: Math.max(0.001, safeInterval - randS), max: safeInterval + randS }
    : { type: 'wait', duration: safeInterval };

  // Click action — position_mode 'current' = no coords, 'pick'/'pick_app' = absolute coords
  const coords = (f.position_mode !== 'current') ? { x: f.x, y: f.y } : {};
  let clickAction;
  switch (f.click_type) {
    case 'double': clickAction = { type: 'mouse_double_click', button: f.button, ...coords }; break;
    case 'triple': clickAction = { type: 'mouse_click',        button: f.button, count: 3, ...coords }; break;
    default:       clickAction = { type: 'mouse_click',        button: f.button, count: 1, ...coords };
  }

  const ruleActions = (f.repeat_mode === 'count')
    ? [{ type: 'repeat', count: Math.max(1, f.repeat_count), actions: [clickAction, waitAction] }]
    : [clickAction, waitAction];

  return {
    name:       '__auto_clicker__',
    loop:       f.repeat_mode !== 'count',
    loop_delay: 0,
    rules: [{ enabled: true, label: 'click', conditions: [], actions: ruleActions }]
  };
}

/* Read all UI fields and return an action object */
function _acpReadFields() {
  const h  = parseInt(document.getElementById('acp-h').value)  || 0;
  const m  = parseInt(document.getElementById('acp-m').value)  || 0;
  const s  = parseInt(document.getElementById('acp-s').value)  || 0;
  const ms = parseInt(document.getElementById('acp-ms').value) || 100;

  const randOffset = document.getElementById('acp-rand-offset').checked;
  const randMs     = parseInt(document.getElementById('acp-rand-ms').value) || 40;

  const button      = document.getElementById('acp-button').value;
  const clickType   = document.getElementById('acp-click-type').value;
  const repeatMode  = document.getElementById('acp-repeat-mode').value;
  const repeatCount = parseInt(document.getElementById('acp-repeat-count').value) || 1;
  const posMode     = document.getElementById('acp-pos-mode').value;
  const x           = parseInt(document.getElementById('acp-x').value) || 0;
  const y           = parseInt(document.getElementById('acp-y').value) || 0;

  return {
    type: 'auto_clicker',
    interval_h: h, interval_m: m, interval_s: s, interval_ms: ms,
    random_offset: randOffset, random_offset_ms: randMs,
    button, click_type: clickType,
    repeat_mode: repeatMode, repeat_count: repeatCount,
    position_mode: posMode, x, y
  };
}

function _acpSetRunning(running) {
  _acpRunning = running;
  document.getElementById('acp-btn-start').disabled = running;
  document.getElementById('acp-btn-stop').disabled  = !running;
  document.getElementById('acp-status').textContent  = running ? '🟢 En cours…' : '⚪ Arrêté';
}

async function startAutoClicker() {
  if (_acpRunning) return;

  const delay = parseInt(document.getElementById('acp-start-delay').value) || 0;

  if (delay > 0) {
    document.getElementById('acp-btn-start').disabled = true;
    document.getElementById('acp-btn-stop').disabled  = false;
    let remaining = delay;
    document.getElementById('acp-status').textContent = `⏳ Démarrage dans ${remaining}s…`;
    _acpCountdownCancelled = false;

    await new Promise(resolve => {
      _acpCountdownResolve = resolve;
      _acpCountdown = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(_acpCountdown); _acpCountdown = null;
          _acpCountdownResolve = null;
          resolve();
        } else {
          const el = document.getElementById('acp-status');
          if (el) el.textContent = `⏳ Démarrage dans ${remaining}s…`;
        }
      }, 1000);
    });

    document.getElementById('acp-btn-start').disabled = false;
    if (_acpCountdownCancelled) return;  // stopAutoClicker() was pressed
  }

  const macro = _acpBuildMacro();
  try {
    await ensureEngine();
    const settings = await window.api.readSettings().catch(() => ({}));
    if (settings?.webhookUrl) {
      await window.api.setWebhook({ url: settings.webhookUrl }).catch(() => {});
    }
    await window.api.macroStart({ macro, macro_id: '__auto_clicker__' });
    _acpSetRunning(true);
    _acpStatusPoller = setInterval(async () => {
      try {
        const st = await window.api.engineStatus();
        if (!st?.running?.includes('__auto_clicker__')) {
          _acpSetRunning(false);
          clearInterval(_acpStatusPoller);
          _acpStatusPoller = null;
        }
      } catch (_) {}
    }, 1000);
  } catch (e) {
    appendLog('ERROR', 'Auto Clicker: ' + e.message);
    _acpSetRunning(false);
  }
}

function stopAutoClicker() {
  if (_acpCountdown) {
    clearInterval(_acpCountdown); _acpCountdown = null;
    _acpCountdownCancelled = true;
    if (_acpCountdownResolve) { _acpCountdownResolve(); _acpCountdownResolve = null; }
  }
  if (_acpStatusPoller) { clearInterval(_acpStatusPoller); _acpStatusPoller = null; }
  window.api.macroStop({ macro_id: '__auto_clicker__' }).catch(() => {});
  _acpSetRunning(false);
}

/* Field toggle helpers */
function _acpToggleOffset(chk) {
  document.getElementById('acp-rand-ms').disabled = !chk.checked;
}

function _acpToggleRepeat() {
  const mode = document.getElementById('acp-repeat-mode').value;
  document.getElementById('acp-repeat-count').disabled = mode !== 'count';
}

function _acpTogglePosition() {
  const mode   = document.getElementById('acp-pos-mode').value;
  const fields = document.getElementById('acp-pos-fields');
  fields.style.display = (mode === 'pick' || mode === 'pick_app') ? 'flex' : 'none';
}

async function _acpPickPoint() {
  try {
    const pos = await window.api.pickPoint();
    if (pos) {
      document.getElementById('acp-x').value = pos.x;
      document.getElementById('acp-y').value = pos.y;
      _acpSave();
    }
  } catch (e) { appendLog('WARNING', 'Sélecteur de point indisponible: ' + (e.message || e)); }
}

/* ── Hotkey capture ──────────────────────────────────────── */
let _acpCapturing = null;  // { el, fieldId } while waiting for key press
let _acpBound     = false; // guard against duplicate event listener registration

function _acpCapKey(el, fieldId) {
  _acpCapturing = { el, fieldId };
  el.value = '⏳ Appuyer sur une touche…';
  el.style.color = 'var(--accent)';
}

function _acpRegisterHotkeys() {
  document.removeEventListener('keydown', _acpHotkeyHandler, true);
  document.addEventListener('keydown', _acpHotkeyHandler, true);
}

function _acpHotkeyHandler(e) {
  const key = e.key === ' ' ? 'Space' : e.key;

  // Capture mode: assign key to focused field
  if (_acpCapturing) {
    e.preventDefault();
    e.stopPropagation();
    _acpCapturing.el.value      = key;
    _acpCapturing.el.style.color = '';
    _acpHotkeys[_acpCapturing.fieldId] = key;
    _acpCapturing = null;
    _acpSave();
    return;
  }

  // Hotkey trigger
  if (_acpHotkeys['acp-key-start'] && key === _acpHotkeys['acp-key-start']) {
    e.preventDefault();
    if (!_acpRunning) startAutoClicker();
  } else if (_acpHotkeys['acp-key-stop'] && key === _acpHotkeys['acp-key-stop']) {
    e.preventDefault();
    stopAutoClicker();
  }
}

/* ── Licence settings helpers ────────────────────────────── */
function _toggleLicenceVis() {
  const inp = document.getElementById('set-licence-key');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveNewLicenceKey() {
  const key    = document.getElementById('set-licence-key').value.trim();
  const status = document.getElementById('licence-status');
  if (!key) { status.textContent = '⚠ Entrez une clé.'; return; }

  status.textContent = 'Vérification…';
  try {
    const res = await window.api.verifyLicense(key);
    if (res.valid) {
      status.textContent = '✅ Licence activée.';
    } else if (res.reason === 'network') {
      status.textContent = '❌ Connexion impossible.';
    } else {
      status.textContent = '❌ Clé invalide.';
    }
  } catch (e) {
    status.textContent = '❌ Erreur: ' + e.message;
  }
  setTimeout(() => { const el = document.getElementById('licence-status'); if (el) el.textContent = ''; }, 4000);
}
