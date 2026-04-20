#!/usr/bin/env node
/**
 * generate-manifest.js
 * Génère update-manifest.json à la racine du repo avec les SHA256
 * de tous les fichiers mis à jour automatiquement.
 *
 * Usage : node electron-app/scripts/generate-manifest.js
 * (doit être lancé depuis la racine du repo)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Racine du repo (le script est dans electron-app/scripts/)
const ROOT = path.resolve(__dirname, '..', '..');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const SKIP_DIRS  = new Set(['__pycache__', '.git', 'node_modules', 'dist', '.venv', 'venv']);
const SKIP_EXTS  = new Set(['.pyc', '.pyo', '.pyd']);

function walk(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, base));
    } else {
      if (SKIP_EXTS.has(path.extname(entry.name))) continue;
      results.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

// ── Fichiers à inclure ─────────────────────────────────────────────────────────

const files = {};

// Python bot files
const pyDirs = ['modules'];
const pyRoots = ['main.py', 'config.py', 'requirements.txt'];

for (const rel of pyRoots) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) files[rel] = sha256(abs);
}

for (const dir of pyDirs) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const rel of walk(abs)) {
    const key = `${dir}/${rel}`;
    files[key] = sha256(path.join(ROOT, dir, rel));
  }
}

// Renderer files (HTML + JS + CSS)
const rendererDir = path.join(ROOT, 'electron-app', 'renderer');
if (fs.existsSync(rendererDir)) {
  for (const rel of walk(rendererDir)) {
    // Only ship source files, not build artifacts
    if (/\.(js|css|html)$/.test(rel)) {
      const key = `electron-app/renderer/${rel}`;
      files[key] = sha256(path.join(rendererDir, rel));
    }
  }
}

// electron-app/package.json (version marker)
const pkgPath = path.join(ROOT, 'electron-app', 'package.json');
if (fs.existsSync(pkgPath)) {
  files['electron-app/package.json'] = sha256(pkgPath);
}

// ── Lire version depuis package.json ──────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const version = pkg.version;

// ── Écrire le manifest ────────────────────────────────────────────────────────
const manifest = {
  version,
  date: new Date().toISOString().split('T')[0],
  files,
};

const outPath = path.join(ROOT, 'update-manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`update-manifest.json generated — v${version} — ${Object.keys(files).length} files`);
