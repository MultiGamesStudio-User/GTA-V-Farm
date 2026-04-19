'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE : PÊCHE AUTOMATIQUE — tout est automatique, rien à config
════════════════════════════════════════════════════════════════ */

let _fishRunning = false;

/* ── Zone de capture ────────────────────────────────────────── */
let _fishZone = null;  // { x, y, w, h } ou null (= auto plein écran)

/* ── Config (options avancées seulement) ───────────────────── */
function _getFishConfig() {
  const rawKey = (document.getElementById('fish-default-key')?.value || '').trim().toLowerCase();
  const cfg = {
    poll_ms:     parseInt(document.getElementById('fish-poll-ms')?.value)  || 30,
    cooldown_ms: parseInt(document.getElementById('fish-cooldown')?.value) || 600,
    tolerance:   parseInt(document.getElementById('fish-tolerance')?.value)|| 10,
    use_direct:  document.getElementById('fish-direct')?.checked ?? true,
    default_key: rawKey,
  };
  if (_fishZone) cfg.capture_zone = _fishZone;
  return cfg;
}

function fishingSaveConfig() {
  const cfg = _getFishConfig();
  if (_fishZone) cfg.capture_zone = _fishZone;
  try { localStorage.setItem('fishing_adv_cfg', JSON.stringify(cfg)); } catch (_) {}
}

function fishingLoadConfig() {
  try {
    const s = localStorage.getItem('fishing_adv_cfg');
    if (!s) return;
    const c = JSON.parse(s);
    if (c.poll_ms     != null) document.getElementById('fish-poll-ms').value    = c.poll_ms;
    if (c.cooldown_ms != null) document.getElementById('fish-cooldown').value    = c.cooldown_ms;
    if (c.tolerance   != null) document.getElementById('fish-tolerance').value   = c.tolerance;
    if (c.use_direct  != null) document.getElementById('fish-direct').checked    = c.use_direct;
    if (c.default_key != null) document.getElementById('fish-default-key').value = c.default_key;
    if (c.capture_zone) {
      _fishZone = c.capture_zone;
      _updateZoneDisplay();
    }
  } catch (_) {}
}

/* ── Toggle options avancées ───────────────────────────────── */
function fishingToggleAdv() {
  const body  = document.getElementById('fish-adv-body');
  const arrow = document.getElementById('fish-adv-arrow');
  if (!body) return;
  const open = body.style.display === '';
  body.style.display  = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)';
}

/* ── Tester la détection en direct ─────────────────────────── */
async function fishingSnapshot() {
  const btn = document.getElementById('fish-btn-snapshot');
  const res = document.getElementById('fish-snapshot-result');
  if (!btn || !res) return;

  btn.disabled = true;
  res.style.display = 'none';

  try {
    await ensureEngine();
    const snapCfg = {};
    if (_fishZone) snapCfg.capture_zone = _fishZone;
    const r = await window.api.fishingSnapshot({ config: snapCfg });
    if (!r.ok) { showToast('Erreur : ' + r.error, 'error'); return; }

    if (!r.ring_found) {
      res.innerHTML = `<div class="fish-snap-grid">
        <span>❌ Anneau</span><span>Non détecté — lance une canne à pêche dans GTA V d'abord</span>
      </div>`;
      res.className = 'fish-snapshot-result snap-warn';
    } else {
      const zoneOk = (r.zone_pct ?? 0) > 0;
      const indOk  = (r.indicator_pct ?? 0) > 0;
      res.innerHTML = `<div class="fish-snap-grid">
        <span>✅ Anneau</span><span>Trouvé — centre (${r.ring_cx}, ${r.ring_cy}), rayon ${r.ring_radius}px</span>
        <span>${zoneOk ? '✅' : '⚠️'} Zone cible</span><span>${r.zone_pct ?? 0}% de la bande</span>
        <span>${indOk  ? '✅' : '⚠️'} Indicateur</span><span>${r.indicator_pct ?? 0}% de la bande</span>
        <span>${r.touching ? '🎣' : '—'} Déclenchement</span><span>${r.touching ? '<strong>OUI — appui requis !</strong>' : 'Non (indicateur hors zone)'}</span>
        ${r.detected_key ? `<span>🔑 Touche OCR</span><span><strong>${r.detected_key.toUpperCase()}</strong></span>` : ''}
      </div>`;
      res.className = 'fish-snapshot-result ' + (r.touching ? 'snap-trigger' : zoneOk ? 'snap-ok' : 'snap-warn');
    }
    res.style.display = '';
  } catch (e) {
    showToast('Erreur snapshot : ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── Start / Stop ──────────────────────────────────────────── */
async function fishingStart() {
  try {
    await ensureEngine();
    const r = await window.api.fishingStart({ config: _getFishConfig() });
    if (!r.ok) { showToast('Erreur : ' + r.error, 'error'); return; }
    _setRunning(true);
    showToast('Bot pêche démarré', 'success', 2000);
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

async function fishingStop() {
  try {
    const r = await window.api.fishingStop({});
    _setRunning(false);
    if (r?.stats) _applyStats(r.stats);
    showToast(`Arrêté — ${r?.stats?.presses || 0} appuis`, 'success', 3000);
  } catch (e) {
    _setRunning(false);
    showToast('Arrêté', 'success', 2000);
  }
}

/* ── UI helpers ────────────────────────────────────────────── */
function _setRunning(running) {
  _fishRunning = running;
  const btnS = document.getElementById('fish-btn-start');
  const btnE = document.getElementById('fish-btn-stop');
  const bnr  = document.getElementById('fish-status-banner');
  const txt  = document.getElementById('fish-status-text');
  const lk   = document.getElementById('fish-last-key');
  const ri   = document.getElementById('fish-ring-info');

  if (btnS) btnS.style.display = running ? 'none' : '';
  if (btnE) btnE.style.display = running ? '' : 'none';
  if (bnr)  bnr.className = 'fish-status-banner ' + (running ? 'fish-running' : 'fish-idle');
  if (txt)  txt.textContent = running
    ? 'Bot actif — surveillance en cours...'
    : 'En attente — cliquez Démarrer';
  if (!running) {
    if (lk) lk.textContent = '';
    if (ri) ri.textContent = '';
    _setRingIcon(false);
  }
}

function _setRingIcon(found) {
  const ic = document.getElementById('fish-ring-status-icon');
  const cd = document.getElementById('fish-stat-ring-card');
  if (ic) ic.textContent = found ? '🎯' : '⬛';
  if (cd) cd.style.borderColor = found ? 'var(--green)' : '';
}

function _applyStats(stats) {
  const $ = id => document.getElementById(id);
  if (stats.presses    != null) { const e = $('fish-stat-presses');    if (e) e.textContent = stats.presses; }
  if (stats.detections != null) { const e = $('fish-stat-detections'); if (e) e.textContent = stats.detections; }
  if (stats.last_key) {
    const lk = $('fish-last-key');
    if (lk) lk.textContent = `[ ${stats.last_key.toUpperCase()} ]`;
  }
  if (stats.ring_found != null) {
    _setRingIcon(stats.ring_found);
    const ri = $('fish-ring-info');
    if (ri) ri.textContent = stats.ring_found ? 'Anneau détecté' : 'Recherche de l\'anneau...';
  }
}

/* ── Événements Python → UI ────────────────────────────────── */
function setupFishingEvents() {
  if (!window.api?.onFishingPress) return;

  window.api.onFishingPress(({ key }) => {
    const lk  = document.getElementById('fish-last-key');
    const bnr = document.getElementById('fish-status-banner');
    if (lk)  lk.textContent = `[ ${key.toUpperCase()} ]`;
    if (bnr) {
      bnr.classList.add('fish-flash');
      setTimeout(() => bnr.classList.remove('fish-flash'), 350);
    }
  });

  window.api.onFishingStats((stats) => _applyStats(stats));
}

/* ── Sync état au retour sur la page ───────────────────────── */
async function fishingSyncStatus() {
  try {
    const r = await window.api.fishingStatus({});
    if (r?.ok) {
      _setRunning(r.running);
      if (r.running && r.stats) _applyStats(r.stats);
    }
  } catch (_) {}
}

/* ── Zone de capture — picker ─────────────────────────────── */
async function fishingPickZone() {
  try {
    const region = await window.api.pickRegion();
    if (!region) return;
    _fishZone = { x: region.x, y: region.y, w: region.w, h: region.h };
    _updateZoneDisplay();
    fishingSaveConfig();
    showToast('Zone de capture définie', 'success', 2000);
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  }
}

function fishingClearZone() {
  _fishZone = null;
  _updateZoneDisplay();
  fishingSaveConfig();
  showToast('Zone de capture réinitialisée (plein écran)', 'success', 2000);
}

function _updateZoneDisplay() {
  const lbl = document.getElementById('fish-zone-label');
  const btn = document.getElementById('fish-zone-clear');
  if (!lbl) return;
  if (_fishZone) {
    lbl.textContent = `${_fishZone.x}, ${_fishZone.y}  →  ${_fishZone.w}×${_fishZone.h}`;
    lbl.className = 'fish-zone-label zone-set';
    if (btn) btn.style.display = '';
  } else {
    lbl.textContent = 'Auto (centre écran)';
    lbl.className = 'fish-zone-label zone-auto';
    if (btn) btn.style.display = 'none';
  }
}

/* ── Initialisation page ────────────────────────────────────── */
function initFishingPage() {
  fishingLoadConfig();
  fishingSyncStatus();
}

/* ── Setup au chargement DOM ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  setupFishingEvents();
  fishingLoadConfig();
});
