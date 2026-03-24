'use strict';
/* ═══════════════════════════════════════════════════════════════
   UTILITIES — escHtml, hexToRgb, rgbToHex
════════════════════════════════════════════════════════════════ */

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return [0, 0, 0];
  return m.map(h => parseInt(h, 16));
}

function rgbToHex(colorArr) {
  if (!colorArr || !Array.isArray(colorArr)) return '#000000';
  const [r, g, b] = colorArr;
  return '#' + [r, g, b].map(v => ((v || 0) & 0xFF).toString(16).padStart(2, '0')).join('');
}
