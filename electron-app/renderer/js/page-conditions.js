'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE: CONDITIONS TESTER — complet
════════════════════════════════════════════════════════════════ */

function renderConditionFields() {
  const typeEl = document.getElementById('cond-type');
  const container = document.getElementById('cond-fields');
  if (!typeEl || !container) return;
  container.innerHTML = buildCondTestForm(typeEl.value);
  _toggleOcrButton(typeEl.value);
}

function _toggleOcrButton(type) {
  const btn = document.getElementById('btn-ocr-read');
  if (btn) btn.style.display = ['text_contains','text_not_contains','text_regex'].includes(type) ? '' : 'none';
  const preview = document.getElementById('cond-preview-wrap');
  if (preview) {
    const needsRegion = !['always','never','macro_is_running','macro_not_running',
      'process_running','process_not_running','window_focused','window_not_focused',
      'window_exists','window_not_exists','time_between','random_chance',
      'key_is_held','key_not_held','clipboard_contains',
      'counter_eq','counter_not_eq','counter_gte','counter_lte','counter_gt','counter_lt','counter_between',
      'variable_equals','variable_contains',
    ].includes(type);
    preview.style.display = needsRegion ? '' : 'none';
  }
}

function buildCondTestForm(type) {
  if (type === 'always' || type === 'never') return '<div style="color:var(--text-2);font-size:12px;padding:8px 0">Pas de paramètres.</div>';

  // ── Blocs réutilisables ──────────────────────────────────────
  const coordRow = `
    <div class="form-row">
      <div class="form-group">
        <label>Position X, Y</label>
        <div style="display:flex;gap:6px;align-items:center">
          <span id="ct-coord-lbl" class="coord-summary">📍 0, 0</span>
          <input type="hidden" id="ct-x" value="0">
          <input type="hidden" id="ct-y" value="0">
          <button class="btn btn-xs btn-secondary" onclick="pickPointForCondTest()">🎯 Point</button>
        </div>
      </div>
    </div>`;

  const regionRow = `
    <div class="form-row">
      <div class="form-group">
        <label>Zone (x, y, largeur, hauteur)</label>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span id="ct-zone-lbl" class="coord-summary">🔲 0,0 — 300×60</span>
          <input type="hidden" id="ct-x" value="0">
          <input type="hidden" id="ct-y" value="0">
          <input type="hidden" id="ct-w" value="300">
          <input type="hidden" id="ct-h" value="60">
          <button class="btn btn-xs btn-secondary" onclick="pickRegionForCondTest()">🔲 Zone</button>
          <button class="btn btn-xs btn-secondary" onclick="pickPointForCondTest()">🎯 Point</button>
        </div>
      </div>
    </div>`;

  const ocrOptions = `
    <div class="form-row" style="margin-top:6px">
      <div class="form-group">
        <label>Moteur OCR</label>
        <select id="ct-engine">
          <option value="auto">Auto (EasyOCR → WinRT → Tesseract)</option>
          <option value="easyocr">EasyOCR (deep learning)</option>
          <option value="winrt">WinRT (Windows natif)</option>
          <option value="tesseract">Tesseract</option>
        </select>
      </div>
      <div class="form-group">
        <label>Langue</label>
        <select id="ct-lang">
          <option value="en">Anglais (en)</option>
          <option value="fr">Français (fr)</option>
          <option value="de">Allemand (de)</option>
          <option value="es">Espagnol (es)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Upscale (0=auto)</label>
        <input type="number" id="ct-scale" value="0" min="0" max="8" style="width:70px">
      </div>
      <div class="form-group" style="justify-content:flex-end;align-items:flex-end">
        <label class="check-label" style="margin-bottom:4px">
          <input type="checkbox" id="ct-invert"> Forcer inversion (texte clair)
        </label>
      </div>
    </div>
    <div class="form-row" style="margin-top:2px">
      <div class="form-group flex-2">
        <label>Whitelist chars (laisser vide = tout)</label>
        <input type="text" id="ct-whitelist" placeholder="ex: 0123456789/ Kg" style="font-family:var(--mono)">
      </div>
      <div class="form-group" style="justify-content:flex-end;align-items:flex-end">
        <label class="check-label" style="margin-bottom:4px">
          <input type="checkbox" id="ct-debug"> Debug (sauvegarder images)
        </label>
      </div>
    </div>`;

  // ── Types de condition ───────────────────────────────────────
  if (type === 'pixel_color' || type === 'pixel_color_not') {
    return coordRow + `
      <div class="form-row">
        <div class="form-group"><label>Couleur cible</label><input type="color" id="ct-color" value="#ff0000"></div>
        <div class="form-group"><label>Tolérance (0–255)</label><input type="number" id="ct-tol" value="10" min="0" max="255" style="width:70px"></div>
      </div>`;
  }

  if (type === 'region_color_avg') {
    return regionRow + `
      <div class="form-row">
        <div class="form-group"><label>Couleur cible</label><input type="color" id="ct-color" value="#ff0000"></div>
        <div class="form-group"><label>Tolérance (0–255)</label><input type="number" id="ct-tol" value="20" min="0" max="255" style="width:70px"></div>
      </div>`;
  }

  if (type === 'pixel_changed' || type === 'pixel_not_changed') {
    return coordRow + `
      <div class="form-row">
        <div class="form-group"><label>Clé snapshot</label><input type="text" id="ct-key" value="" placeholder="(auto: pixel_x_y)"></div>
        <div class="form-group"><label>Tolérance</label><input type="number" id="ct-tol" value="10" min="0" max="255" style="width:70px"></div>
        <div class="form-group" style="align-items:flex-end">
          <label class="check-label"><input type="checkbox" id="ct-save"> Re-sauvegarder après détection</label>
        </div>
      </div>`;
  }

  if (type === 'text_contains' || type === 'text_not_contains') {
    return regionRow + `
      <div class="form-row">
        <div class="form-group flex-2"><label>Texte cherché (insensible à la casse)</label><input type="text" id="ct-text" placeholder="texte attendu dans la zone"></div>
      </div>` + ocrOptions;
  }

  if (type === 'text_regex') {
    return regionRow + `
      <div class="form-row">
        <div class="form-group flex-2"><label>Expression régulière</label><input type="text" id="ct-pattern" placeholder="ex: \\d+\\.\\d+\\$"></div>
        <div class="form-group" style="align-items:flex-end">
          <label class="check-label"><input type="checkbox" id="ct-ignorecase" checked> Insensible à la casse</label>
        </div>
      </div>` + ocrOptions;
  }

  if (type === 'template_match' || type === 'template_not_found') {
    return regionRow + `
      <div class="form-row">
        <div class="form-group flex-2"><label>Chemin du template (.png)</label><input type="text" id="ct-template" placeholder="C:\\templates\\image.png"></div>
        <div class="form-group"><label>Seuil (0.0–1.0)</label><input type="number" id="ct-threshold" value="0.85" min="0" max="1" step="0.05" style="width:80px"></div>
      </div>`;
  }

  if (type === 'window_focused' || type === 'window_not_focused' ||
      type === 'window_exists'  || type === 'window_not_exists') {
    return `
      <div class="form-row">
        <div class="form-group flex-2"><label>Titre de la fenêtre (partiel, insensible à la casse)</label><input type="text" id="ct-title" placeholder="FiveM"></div>
      </div>`;
  }

  if (type === 'process_running' || type === 'process_not_running') {
    return `
      <div class="form-row">
        <div class="form-group flex-2"><label>Nom de l'exécutable</label><input type="text" id="ct-exe" placeholder="FiveM.exe"></div>
      </div>`;
  }

  if (type === 'macro_is_running' || type === 'macro_not_running') {
    return `
      <div class="form-row">
        <div class="form-group flex-2"><label>Nom de la macro</label><input type="text" id="ct-name" placeholder="Mon Farm"></div>
      </div>`;
  }

  if (type === 'counter_eq' || type === 'counter_not_eq' ||
      type === 'counter_gte' || type === 'counter_lte' ||
      type === 'counter_gt'  || type === 'counter_lt') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Nom du compteur</label><input type="text" id="ct-name" placeholder="score"></div>
        <div class="form-group"><label>Valeur</label><input type="number" id="ct-value" value="0" style="width:90px"></div>
      </div>`;
  }

  if (type === 'counter_between') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Nom du compteur</label><input type="text" id="ct-name" placeholder="score"></div>
        <div class="form-group"><label>Min</label><input type="number" id="ct-min" value="0" style="width:80px"></div>
        <div class="form-group"><label>Max</label><input type="number" id="ct-max" value="100" style="width:80px"></div>
      </div>`;
  }

  if (type === 'variable_equals' || type === 'variable_contains') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Nom de la variable</label><input type="text" id="ct-name" placeholder="ma_variable"></div>
        <div class="form-group flex-2"><label>Valeur</label><input type="text" id="ct-value" placeholder="valeur attendue"></div>
      </div>`;
  }

  if (type === 'time_between') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Heure début (HH:MM)</label><input type="text" id="ct-start" value="08:00" placeholder="08:00" style="width:90px"></div>
        <div class="form-group"><label>Heure fin (HH:MM)</label><input type="text" id="ct-end" value="22:00" placeholder="22:00" style="width:90px"></div>
        <div style="color:var(--text-3);font-size:11px;align-self:flex-end;padding-bottom:4px">Supporte le passage minuit (ex: 22:00–06:00)</div>
      </div>`;
  }

  if (type === 'random_chance') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Probabilité (0.0–1.0)</label><input type="number" id="ct-probability" value="0.5" min="0" max="1" step="0.05" style="width:100px"></div>
        <div style="color:var(--text-2);font-size:12px;align-self:flex-end;padding-bottom:4px">0.5 = 50% de chance</div>
      </div>`;
  }

  if (type === 'key_is_held' || type === 'key_not_held') {
    return `
      <div class="form-row">
        <div class="form-group"><label>Touche</label><input type="text" id="ct-key" value="f" placeholder="f, ctrl, shift, f1…" style="width:100px;font-family:var(--mono)"></div>
      </div>`;
  }

  if (type === 'clipboard_contains') {
    return `
      <div class="form-row">
        <div class="form-group flex-2"><label>Texte cherché dans le presse-papier</label><input type="text" id="ct-text" placeholder="texte attendu"></div>
      </div>`;
  }

  return coordRow;
}

/* ── Assemblage de l'objet condition ─────────────────────────── */
function getCondTestObj() {
  const type = document.getElementById('cond-type').value;
  const g  = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const gn = id => { const v = g(id); return (v !== null && v !== '') ? parseFloat(v) : null; };
  const gb = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  const obj = { type };

  // Coordonnées
  const x = gn('ct-x'); if (x !== null) obj.x = x;
  const y = gn('ct-y'); if (y !== null) obj.y = y;
  const w = gn('ct-w'); if (w !== null) obj.w = w;
  const h = gn('ct-h'); if (h !== null) obj.h = h;

  // Visuelles
  if (g('ct-color') !== null) obj.color = hexToRgb(g('ct-color'));
  const tol = gn('ct-tol'); if (tol !== null) obj.tolerance = tol;
  if (g('ct-key')  && g('ct-key').trim())  obj.key  = g('ct-key').trim();
  if (g('ct-save') !== null)               obj.save = gb('ct-save');

  // OCR
  if (g('ct-text')      !== null) obj.text      = g('ct-text');
  if (g('ct-pattern')   !== null) obj.pattern   = g('ct-pattern');
  if (g('ct-template')  !== null) obj.template_path = g('ct-template');
  const thr = gn('ct-threshold'); if (thr !== null) obj.threshold = thr;

  // OCR options
  if (g('ct-engine') && g('ct-engine') !== 'auto') obj.engine = g('ct-engine');
  if (g('ct-lang'))                                 obj.lang   = g('ct-lang');
  const scale = gn('ct-scale'); if (scale !== null) obj.scale  = scale;
  if (gb('ct-invert'))          obj.invert  = true;
  if (gb('ct-debug'))           obj.debug   = true;
  if (g('ct-whitelist') && g('ct-whitelist').trim()) obj.whitelist = g('ct-whitelist').trim();

  // Textuels
  if (g('ct-title')   && g('ct-title').trim())   obj.title = g('ct-title').trim();
  if (g('ct-exe')     && g('ct-exe').trim())      obj.exe   = g('ct-exe').trim();
  if (g('ct-name')    && g('ct-name').trim())     obj.name  = g('ct-name').trim();
  const val = g('ct-value');
  if (val !== null && val !== '') obj.value = isNaN(Number(val)) ? val : Number(val);
  const minV = gn('ct-min'); if (minV !== null) obj.min = minV;
  const maxV = gn('ct-max'); if (maxV !== null) obj.max = maxV;

  // Heure
  if (g('ct-start') && g('ct-start').trim()) obj.start = g('ct-start').trim();
  if (g('ct-end')   && g('ct-end').trim())   obj.end   = g('ct-end').trim();

  // Aléatoire
  const prob = gn('ct-probability'); if (prob !== null) obj.probability = prob;

  return obj;
}

/* ── Tester ───────────────────────────────────────────────────── */
async function testCondition() {
  const resultEl = document.getElementById('cond-result');
  resultEl.style.display = '';
  resultEl.className = 'test-result testing';
  resultEl.textContent = 'Test en cours…';
  const ocrEl = document.getElementById('cond-ocr-result');
  if (ocrEl) ocrEl.style.display = 'none';
  try {
    await ensureEngine();
    const res = await window.api.testCondition(getCondTestObj());
    const ok = res.result === true;
    resultEl.className = 'test-result ' + (ok ? 'result-ok' : 'result-fail');
    resultEl.textContent = ok ? '✅ Condition VRAIE' : '❌ Condition FAUSSE';
  } catch (e) {
    resultEl.className = 'test-result result-fail';
    resultEl.textContent = 'Erreur: ' + e.message;
  }
}

/* ── Lire le texte OCR brut ──────────────────────────────────── */
async function readOcrText() {
  const resultEl = document.getElementById('cond-result');
  const ocrEl    = document.getElementById('cond-ocr-result');

  // Vérifier que la zone a bien été sélectionnée
  const w = parseFloat(document.getElementById('ct-w')?.value || 0);
  const h = parseFloat(document.getElementById('ct-h')?.value || 0);
  if (w <= 0 || h <= 0) {
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.className = 'test-result result-fail';
      resultEl.textContent = '⚠️ Sélectionnez une zone d\'abord avec le bouton 🎯 Zone';
    }
    return;
  }

  if (resultEl) {
    resultEl.style.display = '';
    resultEl.className = 'test-result testing';
    resultEl.textContent = 'Lecture OCR en cours (6 variantes)…';
  }
  if (ocrEl) ocrEl.style.display = 'none';
  try {
    await ensureEngine();
    const cond = getCondTestObj();
    const res  = await window.api.ocrText(cond);
    if (!res.ok) {
      if (resultEl) { resultEl.className = 'test-result result-fail'; resultEl.textContent = 'Erreur: ' + res.error; }
      return;
    }
    const text      = res.text  || '';
    const engineUsed = res.engine || 'inconnu';
    const debugDir  = res.debug_dir || null;
    if (resultEl) {
      resultEl.className = 'test-result result-ok';
      resultEl.textContent = text
        ? `✅ OCR OK [${engineUsed}] — ${text.length} caractères`
        : `⚠️ Aucun texte détecté [${engineUsed}]`;
    }
    if (ocrEl) {
      ocrEl.style.display = '';
      const pre = document.getElementById('cond-ocr-text');
      if (pre) {
        pre.textContent = text || '(vide)';
        if (debugDir) {
          pre.textContent += `\n\n[Debug images → ${debugDir}]`;
        }
      }
    }
    await previewConditionRegion();
  } catch (e) {
    if (resultEl) { resultEl.className = 'test-result result-fail'; resultEl.textContent = 'Erreur: ' + e.message; }
  }
}

/* ── Aperçu de la zone ───────────────────────────────────────── */
async function previewConditionRegion() {
  const x = parseFloat(document.getElementById('ct-x')?.value || 0);
  const y = parseFloat(document.getElementById('ct-y')?.value || 0);
  const w = parseFloat(document.getElementById('ct-w')?.value || 300);
  const h = parseFloat(document.getElementById('ct-h')?.value || 60);
  const container = document.getElementById('cond-preview');
  if (!container) return;
  container.innerHTML = '<div class="preview-placeholder">Capture en cours…</div>';
  try {
    await ensureEngine();
    const res = await window.api.previewRegion({ x, y, w, h });
    if (res.b64) {
      container.innerHTML = `<img src="data:image/png;base64,${res.b64}" alt="preview"
        style="max-width:100%;max-height:280px;image-rendering:pixelated;border-radius:4px">`;
    } else {
      container.innerHTML = '<div class="preview-placeholder">Aucun aperçu disponible</div>';
    }
  } catch (e) {
    container.innerHTML = `<div class="preview-placeholder" style="color:var(--accent)">Erreur: ${escHtml(e.message)}</div>`;
  }
}

/* ── Picker couleur ──────────────────────────────────────────── */
async function pickColor() {
  const x = parseInt(document.getElementById('picker-x').value || 0);
  const y = parseInt(document.getElementById('picker-y').value || 0);
  try {
    await ensureEngine();
    const res = await window.api.pickColor({ x, y });
    if (res.color) {
      const [r, g, b] = res.color;
      const hex = rgbToHex([r, g, b]);
      document.getElementById('color-swatch').style.background = hex;
      document.getElementById('color-value').textContent = `rgb(${r}, ${g}, ${b})  ${hex}`;
      document.getElementById('color-result').style.display = '';
    }
  } catch (e) { appendLog('ERROR', 'Erreur picker: ' + e.message); }
}

/* ── Screen picker helpers ──────────────────────────────────── */
async function pickPointForCondTest() {
  try {
    const res = await window.api.pickPoint();
    if (!res || res.cancelled) return;
    _setCoord(res.x, res.y);
  } catch (e) { appendLog('ERROR', 'Picker: ' + e.message); }
}

async function pickRegionForCondTest() {
  try {
    const res = await window.api.pickRegion();
    if (!res || res.cancelled) return;
    _setCoord(res.x, res.y);
    const wEl = document.getElementById('ct-w');
    const hEl = document.getElementById('ct-h');
    if (wEl) wEl.value = res.w;
    if (hEl) hEl.value = res.h;
    const zoneLbl = document.getElementById('ct-zone-lbl');
    if (zoneLbl) zoneLbl.textContent = `🔲 ${res.x},${res.y} — ${res.w}×${res.h}`;
  } catch (e) { appendLog('ERROR', 'Picker: ' + e.message); }
}

function _setCoord(x, y) {
  const xEl = document.getElementById('ct-x');
  const yEl = document.getElementById('ct-y');
  if (xEl) xEl.value = x;
  if (yEl) yEl.value = y;
  const lbl = document.getElementById('ct-coord-lbl');
  if (lbl) lbl.textContent = `📍 ${x}, ${y}`;
  const zoneLbl = document.getElementById('ct-zone-lbl');
  if (zoneLbl) {
    const w = document.getElementById('ct-w')?.value || '?';
    const h = document.getElementById('ct-h')?.value || '?';
    zoneLbl.textContent = `🔲 ${x},${y} — ${w}×${h}`;
  }
}
