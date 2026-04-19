/* ── Auto Clicker page ───────────────────────────────────── */
let _acpRunning = false;

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
];

function _acpSave() {
  const data = {};
  _ACP_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    data[f.id] = f.type === 'bool' ? el.checked : el.value;
  });
  localStorage.setItem(_ACP_STORAGE_KEY, JSON.stringify(data));
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
  /* restore toggle states after loading */
  const offChk = document.getElementById('acp-rand-offset');
  if (offChk) _acpToggleOffset(offChk);
  _acpToggleRepeat();
  _acpTogglePosition();
}

function _acpBindAutoSave() {
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
  const action = _acpReadFields();
  _acpSetRunning(true);
  try {
    await window.api.execAction(action);
  } catch (e) {
    appendLog('ERROR', 'Auto Clicker: ' + e.message);
  }
  _acpSetRunning(false);
}

function stopAutoClicker() {
  window.api.stopAll();
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
  } catch (e) { /* pickPoint may not be available in all builds */ }
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
