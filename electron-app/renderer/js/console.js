'use strict';
/* ═══════════════════════════════════════════════════════════════
   CONSOLE / LOGS
════════════════════════════════════════════════════════════════ */

function appendLog(level, msg) {
  const ts = new Date().toLocaleTimeString('fr-FR');
  if (allLogs.length >= 1000) allLogs.shift();
  allLogs.push({ level, msg, ts }

  const filter = document.getElementById('log-level-filter')?.value || 'ALL';
  if (filter !== 'ALL' && filter !== level) return;

  const _appendToEl = (id, limit) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ph = el.querySelector('.console-placeholder');
    if (ph) ph.remove();
    const line = document.createElement('div');
    line.className = `log-line log-${level.toLowerCase()}`;
    line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-lvl">${level}</span><span class="log-msg">${escHtml(msg)}</span>`;
    el.appendChild(line);
    while (el.children.length > limit) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  };

  _appendToEl('console-output', 500);
  _appendToEl('dash-console', 50);
}

function filterLogs() {
  const filter = document.getElementById('log-level-filter').value;
  const el = document.getElementById('console-output');
  if (!el) return;
  el.innerHTML = '';
  const filtered = filter === 'ALL' ? allLogs : allLogs.filter(l => l.level === filter);
  for (const { level, msg, ts } of filtered) {
    const line = document.createElement('div');
    line.className = `log-line log-${level.toLowerCase()}`;
    line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-lvl">${level}</span><span class="log-msg">${escHtml(msg)}</span>`;
    el.appendChild(line);
  }
  el.scrollTop = el.scrollHeight;
}

function clearConsole() {
  allLogs.length = 0;
  const el = document.getElementById('console-output');
  if (el) el.innerHTML = '<div class="console-placeholder">Console vidée</div>';
  const dash = document.getElementById('dash-console');
  if (dash) dash.innerHTML = '';
}
