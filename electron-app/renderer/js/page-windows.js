'use strict';
/* ═══════════════════════════════════════════════════════════════
   PAGE: WINDOWS — list, select target, focus, get rect
════════════════════════════════════════════════════════════════ */

let targetWindow = null; // { hwnd, title, pid, exe }
let windowsList = [];    // cached list from last refresh

async function refreshWindows() {
  const container = document.getElementById('windows-list');
  container.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    await ensureEngine();
    const res = await window.api.listWindows();
    if (res.ok === false) {
      container.innerHTML = `<div class="empty-state" style="color:var(--accent-red)">Erreur moteur: ${escHtml(res.error || 'inconnue')}</div>`;
      return;
    }
    const wins = res.windows || [];
    windowsList = wins;
    if (wins.length === 0) {
      container.innerHTML = '<div class="empty-state">Aucune fenêtre détectée</div>';
      return;
    }
    container.innerHTML = wins.map((w, i) => {
      const isTarget = targetWindow && targetWindow.hwnd === w.hwnd;
      return `
      <div class="window-row ${isTarget ? 'window-selected' : ''}">
        <div class="window-info">
          <span class="window-title">${escHtml(w.title || '(sans titre)')}</span>
          <span class="window-meta">PID ${w.pid || '?'} — ${escHtml(w.exe || '?')}</span>
        </div>
        <div class="window-actions">
          <button class="btn btn-xs ${isTarget ? 'btn-success' : 'btn-secondary'}" onclick="selectTargetWindowByIdx(${i})">
            ${isTarget ? '✓ Cible' : 'Cibler'}
          </button>
          <button class="btn btn-xs btn-secondary" onclick="focusWindowByIdx(${i})">Focus</button>
          <button class="btn btn-xs btn-secondary" onclick="showWindowRectByIdx(${i})">Rect</button>
          <span class="window-hwnd">hwnd: ${w.hwnd || '?'}</span>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--accent-red)">Erreur: ${escHtml(e.message)}</div>`;
  }
}

function selectTargetWindowByIdx(idx) {
  const w = windowsList[idx];
  if (!w) return;
  selectTargetWindow(w.hwnd, w.title, w.pid, w.exe);
}

function focusWindowByIdx(idx) {
  const w = windowsList[idx];
  if (!w) return;
  focusWindowById(w.hwnd);
}

function showWindowRectByIdx(idx) {
  const w = windowsList[idx];
  if (!w) return;
  showWindowRect(w.hwnd);
}

function selectTargetWindow(hwnd, title, pid, exe) {
  targetWindow = { hwnd, title, pid, exe };
  refreshWindows();
  const infoEl = document.getElementById('target-window-info');
  if (infoEl) {
    infoEl.innerHTML = `<span class="target-dot"></span> <strong>${escHtml(title)}</strong> <span class="window-meta">(hwnd: ${hwnd}, PID: ${pid})</span>`;
    infoEl.style.display = '';
  }
  appendLog('INFO', `Fenêtre cible: "${title}" (hwnd: ${hwnd})`);
}

async function focusWindowById(hwnd) {
  try {
    await ensureEngine();
    await window.api.focusWindow({ hwnd });
    appendLog('INFO', 'Fenêtre focalisée (hwnd: ' + hwnd + ')');
  } catch (e) {
    appendLog('ERROR', 'Erreur focus: ' + e.message);
  }
}

async function showWindowRect(hwnd) {
  try {
    await ensureEngine();
    const res = await window.api.getWindowRect({ hwnd });
    if (res.rect) {
      const r = res.rect;
      const w = r.right - r.left;
      const h = r.bottom - r.top;
      const rectEl = document.getElementById('window-rect-info');
      if (rectEl) {
        rectEl.innerHTML = `<code>X: ${r.left}, Y: ${r.top}, W: ${w}, H: ${h}</code> <span class="window-meta">(${r.left},${r.top} → ${r.right},${r.bottom})</span>`;
        rectEl.style.display = '';
      }
      appendLog('INFO', `Rect: X=${r.left} Y=${r.top} W=${w} H=${h}`);
    }
  } catch (e) {
    appendLog('ERROR', 'Erreur rect: ' + e.message);
  }
}

async function checkOcrStatus() {
  const el = document.getElementById('ocr-status-text');
  if (!el) return;
  el.textContent = 'Vérification…';
  try {
    await ensureEngine();
    const res = await window.api.checkOcr();
    if (res.available) {
      el.innerHTML = '<span style="color:var(--accent-green)">✓ OCR disponible (Tesseract détecté)</span>';
    } else {
      el.innerHTML = '<span style="color:var(--accent-red)">✗ OCR indisponible — Installez <a href="#" style="color:var(--accent)" onclick="return false">Tesseract-OCR</a> puis redémarrez</span>';
    }
  } catch (e) {
    el.innerHTML = '<span style="color:var(--accent-red)">Erreur: ' + escHtml(e.message) + '</span>';
  }
}
