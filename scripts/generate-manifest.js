'use strict';
/**
 * generate-manifest.js — Génère update-manifest.json avant un push GitHub
 *
 * Usage : node scripts/generate-manifest.js
 *
 * Scanne tous les fichiers Python du bot et génère update-manifest.json
 * à la racine du repo. Committer ce fichier avec tes modifications.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT    = path.join(__dirname, '..');
const OUTPUT  = path.join(ROOT, 'update-manifest.json');
const PKG     = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-app', 'package.json'), 'utf-8'));

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// Parcourt récursivement un dossier et retourne les chemins relatifs à ROOT
function walk(dir, ext = '.py') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return results;
}

const files = {};

// modules/**/*.py
for (const rel of walk(path.join(ROOT, 'modules'))) {
  files[rel] = fileHash(path.join(ROOT, rel));
}

// Fichiers Python racine
for (const name of ['main.py', 'config.py']) {
  const full = path.join(ROOT, name);
  if (fs.existsSync(full)) files[name] = fileHash(full);
}

const manifest = {
  version : PKG.version,
  date    : new Date().toISOString().slice(0, 10),
  files,
};

fs.writeFileSync(OUTPUT, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`✓  update-manifest.json généré — v${manifest.version} — ${Object.keys(files).length} fichiers`);
for (const f of Object.keys(files)) console.log(`   ${f}`);
